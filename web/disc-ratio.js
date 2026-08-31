/* The backing-store ratio a canvas of a given CSS box is drawn at.
 *
 * No DOM here — the ratio is passed in — so tools/check_web.mjs can hold this
 * to the rule rather than to whatever screen it happens to run on, the split
 * word-layout.js's `solve` and word-bundle.js's `square` already make.
 *
 * Both discs used to take `Math.min(devicePixelRatio, 2)`. Browser zoom
 * multiplies devicePixelRatio, so cmd+ on a Retina screen asks for 2.2, 3 or
 * 4, and the cap drew the disc at up to half the resolution the screen was
 * showing it at: sharp at 100%, soft at 200%, which is the blur this replaces.
 * What that cap was guarding is the backing store, and a backing store is an
 * area rather than a ratio, so the area is what is bounded. Zoom costs it
 * almost nothing, since a page laid out in CSS pixels gets proportionally
 * fewer of them as the ratio rises and the two changes nearly cancel; the
 * budget binds on a genuinely large element on a 3x screen, which is where a
 * canvas is actually expensive.
 */

/* Device pixels one canvas may hold. 2^23 is 33.6 MB at four bytes a pixel and
   half the 16,777,216 Safari has held a canvas to, so an element's base and
   its overlay together sit inside what one canvas is allowed. It is also above
   anything the old cap could reach — a 2,048 by 4,096 CSS box at dpr 2 — so no
   disc that fitted a screen before is drawn at less than it was. */
export const MAX_AREA = 8_388_608;

/* The ratio to size a `w` by `h` CSS box's canvas at, never above the screen's
   own and never past the budget. A box of no area keeps the screen's, since
   there is nothing yet to spend. */
export function ratio(dpr, w, h) {
  const d = dpr > 0 ? dpr : 1;
  const area = w * h;
  return area > 0 ? Math.min(d, Math.sqrt(MAX_AREA / area)) : d;
}
