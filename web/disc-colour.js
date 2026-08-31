/* The turn, and HSV as canvas wants a colour.
 *
 * Both discs read the same letter wheel — palette.py spreads 26 hues over the
 * circle at a fixed saturation and value, and the host hands those two in as
 * --disc-sat and --disc-val — so the conversion sits here rather than in
 * either pipeline. <word-disc> would otherwise import the whole 405-line
 * Painter for fifteen lines of arithmetic it shares with it.
 */
export const TAU = Math.PI * 2;

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
