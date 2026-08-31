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

self.onmessage = ev => {
  const m = ev.data;
  if (m.canvas) g = m.canvas.getContext("2d");
  /* The element is more than a screen away, so the canvas it handed over gives
     its pixels back — 15.9 MB on a 16 inch laptop, 28.9 MB on a 5K display.
     It is asked for here because the element cannot set a dimension on a
     canvas it no longer owns, and `paint` sizes it again from the next view. */
  if (m.sleep) {
    if (g) {
      g.canvas.width = 0;
      g.canvas.height = 0;
    }
    return;
  }
  if (m.layout) painter.layout(m.layout, m.hd);
  else if (m.hd !== undefined) painter.hueDepth(m.hd);
  if (m.view && g) {
    const stats = painter.paint(g, m.view);
    if (stats) postMessage({ stats });
  }
};

postMessage({ ready: true });
