/* The turn, HSV as canvas wants a colour, and the chord cubic.
 *
 * What the discs share rather than what any one of them owns. All three read
 * the same letter wheel — palette.py spreads 26 hues over the circle at a
 * fixed saturation and value, and the host hands those two in as --disc-sat
 * and --disc-val — so the conversion sits here rather than in any one
 * pipeline. <word-disc> would otherwise import the whole 405-line Painter for
 * fifteen lines of arithmetic it shares with it.
 */
export const TAU = Math.PI * 2;

/* One chord, bowed towards the centre, as the cubic alone with no `moveTo` in
   front of it. That is what makes a chord read as the pair of points it joins
   rather than as a line across the disc, and it is here rather than in either
   element because all three draw it: word-bundle.js's `curve` is this with the
   `moveTo`, and letter-graph.js's `ribbon` walks a closed boundary and so must
   not start a subpath at every crossing. Four control points and no sampling,
   the same curve render.py's `_curve` writes into the SVG. */
export function bow(g, cx, cy, x0, y0, x1, y1, pull) {
  g.bezierCurveTo(
    cx + (x0 - cx) * pull,
    cy + (y0 - cy) * pull,
    cx + (x1 - cx) * pull,
    cy + (y1 - cy) * pull,
    x1,
    y1,
  );
}

export const hsv = (h, s, v) => {
  const i = Math.floor(h * 6) % 6,
    f = h * 6 - Math.floor(h * 6),
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s);
  const c = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i];
  return `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
};
