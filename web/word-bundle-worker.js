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
 * Waiting between bands, a build can be overtaken by the next message.
 * Builds run one at a time on the one canvas, and one that a newer message has
 * superseded stops at its next band and answers nothing, since the element
 * drops any bundle but the last it asked for.
 *
 * `ready` goes out first, the same handshake the nested disc waits on: a worker
 * that loads and never answers has to be found before the element commits.
 */
import { bands } from "./word-bundle.js";

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
  let step = run.next();
  while (!step.done) {
    (await createImageBitmap(canvas)).close();
    await new Promise(r => setTimeout(r, 0));
    if (mine !== latest) {
      canvas.width = canvas.height = 0;
      return;
    }
    step = run.next();
  }
  const bitmap = canvas.transferToImageBitmap();
  canvas.width = canvas.height = 0;
  postMessage({ id: m.id, px: m.px, strokes: step.value, bitmap }, [bitmap]);
}

postMessage({ ready: true });
