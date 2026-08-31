/* The thread <word-disc> builds its resting bundle on.
 *
 * Its own worker rather than disc-worker.js, for two reasons. That one is
 * handed the nested disc's canvas through transferControlToOffscreen and holds
 * it for the life of the page, so it can serve one element and no other; and
 * the two jobs are the wrong pair to queue behind each other, since the nested
 * disc paints per frame where a bundle is up to 96,470 strokes in one go. A
 * page carrying both elements gets two threads, which is the count it wants.
 *
 * This one is handed nothing: each message is one bundle to draw and the answer
 * is the bitmap, so the canvas is made here and transferred back rather than
 * given away once, which is why the element may terminate it. A page holding
 * several word discs could therefore share a single instance; they get one
 * apiece instead, so two discs build in parallel rather than in turn.
 *
 * It keeps that canvas and sizes it per message rather than making a new one,
 * and empties it to 0 by 0 as soon as transferToImageBitmap has taken its
 * pixels, so it owns none between builds. Made afresh it cost two buffers a
 * build — the one drawn on and the blank one the transfer leaves behind — which
 * at the article's 1,792 px square is 25 MB a category pick, in a thread whose
 * JS heap is a few kilobytes and whose collector therefore has no reason to
 * run.
 *
 * `ready` goes out first, the same handshake the nested disc waits on: a
 * worker that loads and never answers has to be found before the element
 * commits to it.
 */
import { bundle } from "./word-bundle.js";

let canvas = null;

self.onmessage = ev => {
  const m = ev.data;
  if (!canvas) canvas = new OffscreenCanvas(m.px, m.px);
  // Sizing a canvas allocates its buffer and clears it, which is what a fresh
  // one was for, and 0 by 0 is how one is given back.
  else canvas.width = canvas.height = m.px;
  const g = canvas.getContext("2d");
  if (!g) return postMessage({ id: m.id, bitmap: null });
  const strokes = bundle(g, m);
  const bitmap = canvas.transferToImageBitmap();
  canvas.width = canvas.height = 0;
  postMessage({ id: m.id, px: m.px, strokes, bitmap }, [bitmap]);
};

postMessage({ ready: true });
