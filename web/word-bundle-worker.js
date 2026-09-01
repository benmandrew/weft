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
 * `ready` goes out first, the same handshake the nested disc waits on: a worker
 * that loads and never answers has to be found before the element commits.
 */
import { bundle } from "./word-bundle.js";

let canvas = null;

self.onmessage = ev => {
  const m = ev.data;
  if (!canvas) canvas = new OffscreenCanvas(m.px, m.px);
  // Sizing a canvas allocates its buffer and clears it.
  else canvas.width = canvas.height = m.px;
  const g = canvas.getContext("2d");
  if (!g) return postMessage({ id: m.id, bitmap: null });
  const strokes = bundle(g, m);
  const bitmap = canvas.transferToImageBitmap();
  canvas.width = canvas.height = 0;
  postMessage({ id: m.id, px: m.px, strokes, bitmap }, [bitmap]);
};

postMessage({ ready: true });
