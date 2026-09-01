/* The backing-store ratio a canvas of a given CSS box is drawn at.
 *
 * No DOM here — the ratio is passed in — so tools/check_web.mjs can hold this
 * to the rule rather than to whatever screen it happens to run on.
 *
 * The budget bounds area rather than fixing a factor. Browser zoom multiplies
 * devicePixelRatio, so a fixed cap drew the disc at a fraction of the
 * resolution the screen was showing it at; bounding area costs zoom almost
 * nothing, since a page laid out in CSS pixels gets proportionally fewer of
 * them as the ratio rises and the two changes nearly cancel.
 */

/* Device pixels one canvas may hold. Half the 16,777,216 Safari has held a
   canvas to, so an element's base and its overlay together sit inside what one
   canvas is allowed. */
export const MAX_AREA = 8_388_608;

/* The ratio to size a `w` by `h` CSS box's canvas at, never above the screen's
   own and never past the budget. A box of no area keeps the screen's, since
   there is nothing yet to spend. */
export function ratio(dpr, w, h) {
  const d = dpr > 0 ? dpr : 1;
  const area = w * h;
  return area > 0 ? Math.min(d, Math.sqrt(MAX_AREA / area)) : d;
}
