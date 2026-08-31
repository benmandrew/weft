/* The hub's text — fitting it, placing its baselines and laying its ground —
 * with no DOM in it.
 *
 * Only a 2D context is touched, for its font, measureText and fillText, so an
 * element hands over its overlay context and tools/check_web.mjs hands over a
 * stub that measures a monospace face. The same split as disc-paint.js and
 * disc-search.js: the part with edge cases is the part that can be checked.
 *
 * All three discs name something in the middle, and the two below are where
 * that has gone wrong before — a halo that read as a shadow lying off to one
 * side of the word, and a name that moved up and down as the pointer crossed
 * the disc. Written once here rather than once per element, so a second copy
 * cannot drift back to either.
 *
 *   const {lines, lh, px, font} = fit(ctx, "domestic cat", 49, "Menlo, monospace");
 *
 * `font` is the face the fit settled on, which it has already set on the
 * context. It is returned as well so a caller holding the result can set it
 * again without measuring the name a second time: fitting costs 9.5
 * measureText calls at the median and 539 for the longest name in WordNet, and
 * the pointer crossing back into a wedge asks for the same name it just left.
 */

// The sizes the label steps down through by default, its weight, and the lines
// it may wrap to. <word-disc> hands in a ladder of its own: its hub is the
// larger of the two and its label is the only thing in the middle of the disc,
// where the nested disc's shares the space with a ring of its own children.
const SIZES = [12, 11, 10, 9, 8];
const WEIGHT = 500;
const MAX_LINES = 3;

/* A name runs to 71 characters and the hub is about a hundred across, so the
   label steps down the sizes and wraps until it fits, breaking a word only when
   nothing else does. Every line has to clear the chord at the block's edge
   rather than the diameter, which is why the budget narrows as a line is added.
   Sets the font on `g` as it goes, and returns the size as well as the face,
   since a caller drawing a halo under the text scales it to the type. */
export function fit(g, text, r, mono, { sizes = SIZES, weight = WEIGHT } = {}) {
  for (const px of sizes) {
    const font = `${weight} ${px}px ${mono}`;
    g.font = font;
    const lh = px + 2;
    for (let n = 1; n <= MAX_LINES && n * lh < 2 * r; n++) {
      const lines = wrap(g, text, 2 * Math.sqrt(r * r - ((n * lh) / 2) ** 2), n);
      if (lines) return { lines, lh, px, font };
    }
  }
  const px = sizes.at(-1);
  const font = `${weight} ${px}px ${mono}`;
  g.font = font;
  return { lines: wrap(g, text, 1.4 * r, MAX_LINES, true), lh: px + 2, px, font };
}

/* Greedy by word, null when the text needs more than `n` lines. Under `hard` a
   break is marked rather than the overflow hidden: a word too long for a line
   is split with a trailing hyphen and carries on below, and the last line fills
   the width and keeps its hyphen where the cut lands inside a word. A hyphen
   reads as "this word goes on", where the ellipsis it replaced read as "the
   rest is gone". Only the smallest size reaches any of this. */
export function wrap(g, text, w, n, hard = false) {
  const fits = s => g.measureText(s).width <= w;
  // How much of `s` fits, plainly or with a hyphen added. At least one
  // character either way, so a break always makes progress and the loop ends.
  const plain = s => {
    let k = 1;
    while (k < s.length && fits(s.slice(0, k + 1))) k++;
    return k;
  };
  const upTo = s => {
    let k = 1;
    while (k < s.length - 1 && fits(s.slice(0, k + 1) + "-")) k++;
    return k;
  };
  const out = [];
  let rest = text;
  while (rest) {
    if (fits(rest)) {
      out.push(rest);
      return out;
    }
    if (!hard) {
      const at = rest.lastIndexOf(" ", plain(rest));
      if (at <= 0 || out.length === n - 1) return null;
      out.push(rest.slice(0, at));
      rest = rest.slice(at + 1);
      continue;
    }
    // The last line takes what is left, hyphenated unless the cut falls on a
    // space, where a hyphen would invent one inside the name.
    if (out.length === n - 1) {
      const k = upTo(rest),
        head = rest.slice(0, k).trimEnd();
      out.push(rest[k] === " " ? head : head + "-");
      return out;
    }
    const at = rest.lastIndexOf(" ", plain(rest));
    if (at > 0) {
      out.push(rest.slice(0, at));
      rest = rest.slice(at + 1);
    } else {
      const k = upTo(rest);
      out.push(rest.slice(0, k) + "-");
      rest = rest.slice(k);
    }
  }
  return out;
}

/* What a hub's baseline is measured against: a capital and an ascender, which
   between them reach the top of anything a name can hold, and no descender,
   since what sits below the baseline should hang below the centre rather than
   move it. HUB_RISE and HUB_DROP are the proportions of a Latin line, used
   where a context reports no ink metrics and to leave a hint its room under a
   name that may or may not end in a descender. */
export const HUB_REF = "Hd",
  HUB_RISE = 0.72,
  HUB_DROP = 0.2;

/* How far a hub's ground reaches past a letter, as a fraction of the type and
   never less than HALO_MIN, and how many directions the ring holds.

   It is laid as copies of the same fillText the ink uses rather than as a
   strokeText under it. A stroke is centred on the glyph outline, which says
   the ground is centred in the geometry and not in what is drawn: a stroke is
   taken off the outline where a fill is a rasterised glyph, the two are
   positioned by different code, and the halo read as a shadow lying down and
   right of the word. Copies cannot — every one is the call that draws the
   letters and the offsets sum to nothing.

   Eight directions leave a scallop 0.076 of the reach deep, a tenth of a pixel
   at the top of either element's ladder. 0.08 is the reach rather than a
   stroke width, so it is half the 0.16 it replaced and draws the same picture:
   1.3 px clear of a glyph at 16 px type, against chords half a pixel wide. */
export const HALO = 0.08,
  HALO_MIN = 1,
  HALO_STEPS = 8;

/* How far the face puts ink above the baseline, measured off HUB_REF rather
   than off the name being drawn. That is the whole point of it: the ink of
   "iris" stops at the dot and the ink of "guppy" runs below the baseline, so
   centring each word on its own ink moved the name as the pointer crossed the
   disc. The band is the same for every word in a face, so the baseline is too.

   Measured rather than cached — a caller holds it against `g.font`, which is
   the key that can change it. */
export function band(g) {
  const up = g.measureText(HUB_REF).actualBoundingBoxAscent;
  if (Number.isFinite(up) && up > 0) return up;
  const px = parseFloat(/([\d.]+)px/.exec(g.font)?.[1]) || 10;
  return px * HUB_RISE;
}

/* The first line's baseline for a block centred on `cy`, so the block sits in
   the middle of the hub and a descender hangs below that centre rather than
   dragging the line up to meet it. `lift` is the room a hint below the name
   takes off the top. */
export function baseline(cy, bandPx, lines, lh, lift = 0) {
  return cy - (bandPx + (lines - 1) * lh) / 2 - lift + bandPx;
}

/* The ground a hub's text carries with it: HALO_STEPS copies of the same call
   that draws the ink, ringed at `r` around each baseline. The union reaches r
   past every letter, and it cannot be anywhere else. Every line's ground goes
   down before any ink, so a line's halo cannot land on the letters above it. */
export function halo(g, lines, cx, first, lh, r, ground) {
  g.fillStyle = ground;
  for (let s = 0; s < HALO_STEPS; s++) {
    const a = (s / HALO_STEPS) * Math.PI * 2,
      dx = Math.cos(a) * r,
      dy = Math.sin(a) * r;
    for (const [k, line] of lines.entries()) g.fillText(line, cx + dx, first + k * lh + dy);
  }
}
