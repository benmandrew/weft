/* The thread <word-disc> builds its resting bundle on.
 *
 * Its own worker rather than disc-worker.js: that one is handed the nested
 * disc's canvas for the life of the page and so can serve one element and no
 * other. This one is handed nothing — each message is one bundle to draw and
 * the answer is the bitmap — so the element may terminate it.
 *
 * The canvas is kept and sized per message rather than remade, and emptied to
 * 0 by 0 once transferToImageBitmap has taken its pixels, so the thread owns no
 * buffer between builds.
 *
 * A build snapshots the canvas after every band (word-bundle.js's `bands`) and
 * then waits for a task, which makes Chrome send that band's strokes to the GPU
 * on their own. Left to batch them, it sent entity's in pieces of about 45 ms
 * on the thread the whole browser draws its frames on, and frames were late
 * for a quarter of a second. Both halves are needed: the snapshot alone left
 * frames late until 205 ms after a switch, and with the task until 55 ms,
 * which is the main thread's own share. The snapshot is a GPU copy, not a
 * readback; getImageData in its place worked as well and doubled the GPU's
 * work.
 *
 * The wait is a channel message and then a timer of GAP, which is what sets
 * the pace. A bare setTimeout(0) waits 4 ms rather than 0, since the snapshot
 * resolves inside the timer's own task and the next timer counts as nested, so
 * browsers clamp it; that was 290 ms of entity's 390 ms build. A channel
 * message alone ends the task with no wait at all, and was too fast: the GPU
 * process took the bands back to back in tasks of up to 48 ms, and one frame
 * in three traces of a visible 1440-wide window ran 32 to 48 ms late. GAP at 2
 * ms left no frame late in three traces, kept every GPU task under 10.3 ms,
 * and built entity in 255 ms. GAP at 1 built it in 180 ms with no frame late
 * either, but its GPU tasks reached 16 ms, a whole frame at 60 Hz.
 *
 * Waiting between bands, a build can be overtaken by the next message.
 * Builds run one at a time on the one canvas, and one that a newer message has
 * superseded stops at its next band and answers nothing, since the element
 * drops any bundle but the last it asked for.
 *
 * `ready` goes out first, the same handshake the nested disc waits on: a worker
 * that loads and never answers has to be found before the element commits.
 */
import { bands } from "./word-bundle.js";

// Milliseconds between bands. See the header for how it was chosen.
const GAP = 2;

let canvas = null;
let latest = 0;
let queue = Promise.resolve();

self.onmessage = ev => {
  const mine = ++latest;
  queue = queue.then(() => build(ev.data, mine));
};

async function build(m, mine) {
  if (mine !== latest) return;
  if (!canvas) canvas = new OffscreenCanvas(m.px, m.px);
  // Sizing a canvas allocates its buffer and clears it.
  else canvas.width = canvas.height = m.px;
  const g = canvas.getContext("2d");
  if (!g) return postMessage({ id: m.id, bitmap: null });
  const run = bands(g, m);
  // Per build and closed after it, since an open port keeps Node's event loop
  // alive under tools/check_web.mjs.
  const pace = new MessageChannel();
  try {
    let step = run.next();
    while (!step.done) {
      (await createImageBitmap(canvas)).close();
      await gap(pace);
      if (mine !== latest) {
        canvas.width = canvas.height = 0;
        return;
      }
      step = run.next();
    }
    const bitmap = canvas.transferToImageBitmap();
    canvas.width = canvas.height = 0;
    postMessage({ id: m.id, px: m.px, strokes: step.value, bitmap }, [bitmap]);
  } finally {
    pace.port1.close();
  }
}

/* A new task, then GAP. The timer is set from the channel's task, so nothing
   nests it and it is not clamped.
   @param {MessageChannel} pace
   @returns {Promise<void>} */
function gap(pace) {
  return new Promise(r => {
    pace.port1.onmessage = () => setTimeout(r, GAP);
    pace.port2.postMessage(null);
  });
}

postMessage({ ready: true });
