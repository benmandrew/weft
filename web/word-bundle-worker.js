/* The thread <word-disc> builds its resting bundle on.
 *
 * Its own worker rather than disc-worker.js, for two reasons. That one is
 * handed the nested disc's canvas through transferControlToOffscreen and holds
 * it for the life of the page, so it can serve one element and no other; and
 * the two jobs are the wrong pair to queue behind each other, since the nested
 * disc paints per frame where a bundle is up to 96,470 strokes in one go. A
 * page carrying both elements gets two threads, which is the count it wants.
 *
 * This one owns nothing between messages: each is one bundle to draw and the
 * answer is the bitmap, so the canvas is made here and transferred back rather
 * than handed over once. A page holding several word discs could therefore
 * share a single instance; they get one apiece instead, so two discs build in
 * parallel rather than in turn.
 *
 * `ready` goes out first, the same handshake the nested disc waits on: a
 * worker that loads and never answers has to be found before the element
 * commits to it.
 */
import { bundle } from "./word-bundle.js";

self.onmessage = ev => {
  const m = ev.data;
  const g = new OffscreenCanvas(m.px, m.px).getContext("2d");
  if (!g) return postMessage({ id: m.id, bitmap: null });
  const strokes = bundle(g, m);
  const bitmap = g.canvas.transferToImageBitmap();
  postMessage({ id: m.id, px: m.px, strokes, bitmap }, [bitmap]);
};

postMessage({ ready: true });
