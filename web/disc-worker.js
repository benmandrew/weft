/* The thread <hypernym-disc> paints on.
 *
 * It holds nothing but a Painter and the canvas the element handed over, so
 * every message is either the layout (once per tree), the hue depth, or one
 * view to draw. The element keeps the layout too, because hit testing, the
 * crumbs and the keyboard have to answer without a round trip.
 *
 * `ready` goes out first and the element waits for it: a canvas can be handed
 * over only once, and only before anything has taken a context on it, so the
 * element cannot paint first and hand over afterwards.
 */
import { Painter } from "./disc-paint.js";

const painter = new Painter();
let g = null;

onmessage = ev => {
  const m = ev.data;
  if (m.canvas) g = m.canvas.getContext("2d");
  if (m.layout) painter.layout(m.layout, m.hd);
  else if (m.hd !== undefined) painter.hueDepth(m.hd);
  if (m.view && g) {
    const stats = painter.paint(g, m.view);
    if (stats) postMessage({ stats });
  }
};

postMessage({ ready: true });
