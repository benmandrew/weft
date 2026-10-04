/* The thread <word-disc> builds its resting bundle on.
 *
 * Separate from disc-worker.js, which holds the nested disc's canvas for the
 * life of the page. This one is handed nothing: each message is one bundle to
 * draw and the answer is the bitmap, so the element may terminate it. The
 * canvas is kept between messages and emptied to 0 by 0 once
 * transferToImageBitmap has taken its pixels, so the thread owns no buffer
 * between builds.
 *
 * After every band (word-bundle.js's `bands`) a build snapshots the canvas and
 * waits for a task, which makes Chrome send that band's strokes to the GPU on
 * their own. Batched, entity's came as tasks of about 45 ms on the thread that
 * draws every browser frame. Both halves are needed. The snapshot is a GPU
 * copy; getImageData in its place doubled the GPU's work.
 *
 * The wait is a channel message and then GAP. A bare setTimeout(0) is clamped
 * to 4 ms, since the snapshot resolves inside the timer's own task and the next
 * timer counts as nested; that was 290 ms of entity's 390 ms build. A channel
 * message alone was too fast: the GPU process took the bands back to back in
 * tasks of up to 48 ms. GAP at 2 ms kept every GPU task under 10.3 ms and built
 * entity in 255 ms; at 1 ms the tasks reached 16 ms, a whole frame at 60 Hz.
 *
 * A build that a newer message has superseded stops at its next band and
 * answers nothing, since the element drops any bundle but the last it asked
 * for.
 *
 * `ready` goes out first, the handshake the nested disc also waits on: a worker
 * that loads and never answers has to be found before the element commits.
 */
import { bands } from "./word-bundle.js";

// Milliseconds between bands; the header says why 2.
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
