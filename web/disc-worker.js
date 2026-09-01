/* The thread <hypernym-disc> paints on.
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
  /* Asked for here because the element cannot set a dimension on a canvas it no
     longer owns; `paint` sizes it again from the next view. */
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
