/* The hub's text — fitting it, placing its baselines and laying its ground.
 *
 * Only a 2D context is touched, for its font, measureText and fillText, so
 * tools/check_web.mjs can hand over a stub that measures a monospace face.
 *
 *   const {lines, lh, px, font} = fit(ctx, "domestic cat", 49, "Menlo, monospace");
 *
 * `font` is the face the fit settled on and has already set on the context; it
 * is returned so a caller holding the result can set it again without measuring
 * the name a second time.
 */

// The default size ladder, weight and line count. <word-disc> hands in a larger
// ladder of its own, its hub being the only thing in the middle of the disc.
const SIZES = [12, 11, 10, 9, 8];
const WEIGHT = 500;
const MAX_LINES = 3;

/** The one context type the hub touches, so a worker's canvas is as good as a
   document's.
   @typedef {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} Ctx */

/** What the fit settled on. `font` is already set on the context.
   @typedef {{lines: string[], lh: number, px: number, font: string}} Fitted */

/** Steps down the sizes and wraps until the name fits. Every line has to clear
   the chord at the block's edge rather than the diameter, which is why the
   budget narrows as a line is added. Sets the font on `g`, and returns the size
   as well as the face, since a caller's halo is scaled to the type.
   @param {Ctx} g
   @param {string} text
   @param {number} r
   @param {string} mono
   @param {{sizes?: number[], weight?: number}} [opts]
   @returns {Fitted} */
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
  // The ladder is never empty, and `hard` takes what is left rather than
  // giving up, so neither of these can come back missing.
  const px = /** @type {number} */ (sizes.at(-1));
  const font = `${weight} ${px}px ${mono}`;
  g.font = font;
  const lines = /** @type {string[]} */ (wrap(g, text, 1.4 * r, MAX_LINES, true));
  return { lines, lh: px + 2, px, font };
}

/** Greedy by word, null when the text needs more than `n` lines. Under `hard` a
   forced break carries a trailing hyphen, on the last line too, since a hyphen
   says the word goes on where an ellipsis would say the rest is gone.
   @param {Ctx} g
   @param {string} text
   @param {number} w
   @param {number} n
   @param {boolean} [hard]
   @returns {string[] | null} */
export function wrap(g, text, w, n, hard = false) {
  /** @type {(s: string) => boolean} */
  const fits = s => g.measureText(s).width <= w;
  // How much of `s` fits, plainly or hyphenated. At least one character either
  // way, so a break always makes progress and the loop ends.
  /** @type {(s: string) => number} */
  const plain = s => {
    let k = 1;
    while (k < s.length && fits(s.slice(0, k + 1))) k++;
    return k;
  };
  /** @type {(s: string) => number} */
  const upTo = s => {
    let k = 1;
    while (k < s.length - 1 && fits(s.slice(0, k + 1) + "-")) k++;
    return k;
  };
  /** @type {string[]} */
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

/* What a hub's baseline is measured against: a capital and an ascender, and no
   descender, since what sits below the baseline should hang below the centre
   rather than move it. HUB_RISE and HUB_DROP are the proportions of a Latin
   line, used where a context reports no ink metrics. */
export const HUB_REF = "Hd",
  HUB_RISE = 0.72,
  HUB_DROP = 0.2;

/* How far a hub's ground reaches past a letter, as a fraction of the type and
   never less than HALO_MIN, and how many directions the ring holds. HALO is a
   reach rather than a stroke width. The ground is copies of the same fillText
   the ink uses, never a strokeText under it: a stroke is taken off the glyph
   outline where a fill is a rasterised glyph, the two are positioned by
   different code, and the halo then reads as a shadow off to one side of the
   word. Eight directions leave a scallop 0.076 of the reach deep. */
export const HALO = 0.08,
  HALO_MIN = 1,
  HALO_STEPS = 8;

/* How far the face puts ink above the baseline, measured off HUB_REF rather
   than off the name drawn: "iris" stops at the dot where "guppy" runs below the
   baseline, so centring each word on its own ink moves the name as the pointer
   crosses the disc. A caller caches it against `g.font`, the one key that can
   change it. */
/** @param {Ctx} g @returns {number} */
export function band(g) {
  const up = g.measureText(HUB_REF).actualBoundingBoxAscent;
  if (Number.isFinite(up) && up > 0) return up;
  const px = parseFloat(/([\d.]+)px/.exec(g.font)?.[1] ?? "") || 10;
  return px * HUB_RISE;
}

/* The first line's baseline for a block centred on `cy`, so a descender hangs
   below that centre rather than dragging the line up to meet it. `lift` is the
   room a hint below the name takes off the top. */
/** @param {number} cy @param {number} bandPx @param {number} lines
   @param {number} lh @param {number} [lift] @returns {number} */
export function baseline(cy, bandPx, lines, lh, lift = 0) {
  return cy - (bandPx + (lines - 1) * lh) / 2 - lift + bandPx;
}

/* HALO_STEPS copies of the call that draws the ink, ringed at `r` around each
   baseline, so the union reaches r past every letter. Every line's ground goes
   down before any ink, so a line's halo cannot land on the letters above it. */
/** @param {Ctx} g @param {string[]} lines @param {number} cx
   @param {number} first @param {number} lh @param {number} r
   @param {string} ground */
export function halo(g, lines, cx, first, lh, r, ground) {
  g.fillStyle = ground;
  for (let s = 0; s < HALO_STEPS; s++) {
    const a = (s / HALO_STEPS) * Math.PI * 2,
      dx = Math.cos(a) * r,
      dy = Math.sin(a) * r;
    for (const [k, line] of lines.entries()) g.fillText(line, cx + dx, first + k * lh + dy);
  }
}
