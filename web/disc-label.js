/* The hub's text fitting for <hypernym-disc>, with no DOM in it.
 *
 * Only a 2D context is touched, for its font and measureText, so the element
 * hands over its overlay context and tools/check_web.mjs hands over a stub that
 * measures a monospace face. The same split as disc-paint.js and
 * disc-search.js: the part with edge cases is the part that can be checked.
 *
 *   const {lines, lh, font} = fit(ctx, "domestic cat", 49, "Menlo, monospace");
 *
 * `font` is the face the fit settled on, which it has already set on the
 * context. It is returned as well so a caller holding the result can set it
 * again without measuring the name a second time: fitting costs 9.5
 * measureText calls at the median and 539 for the longest name in WordNet, and
 * the pointer crossing back into a wedge asks for the same name it just left.
 */

// The sizes the label steps down through, and the lines it may wrap to.
const SIZES = [12, 11, 10, 9, 8];
const MAX_LINES = 3;

/* A name runs to 71 characters and the hub is about a hundred across, so the
   label steps down the sizes and wraps until it fits, breaking a word only when
   nothing else does. Every line has to clear the chord at the block's edge
   rather than the diameter, which is why the budget narrows as a line is added.
   Sets the font on `g` as it goes. */
export function fit(g, text, r, mono) {
  for (const px of SIZES) {
    const font = `500 ${px}px ${mono}`;
    g.font = font;
    const lh = px + 2;
    for (let n = 1; n <= MAX_LINES && n * lh < 2 * r; n++) {
      const lines = wrap(g, text, 2 * Math.sqrt(r * r - ((n * lh) / 2) ** 2), n);
      if (lines) return { lines, lh, font };
    }
  }
  const font = `500 ${SIZES.at(-1)}px ${mono}`;
  g.font = font;
  return { lines: wrap(g, text, 1.4 * r, MAX_LINES, true), lh: SIZES.at(-1) + 2, font };
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
