/* The backing-store ratio a canvas of a given CSS box is drawn at.
 *
 * No DOM here: the ratio is passed in, so tools/check_web.mjs can test the rule
 * on any screen.
 *
 * The budget caps area, never the ratio. Browser zoom multiplies
 * devicePixelRatio, so a capped ratio drew a zoomed disc blurred; a zoomed page
 * also has proportionally fewer CSS pixels, so an area cap costs zoom little.
 */

/* Device pixels one canvas may hold. Half the 16,777,216 Safari has held a
   canvas to, so an element's base and its overlay together sit inside what one
   canvas is allowed. */
export const MAX_AREA = 8_388_608;

/** The ratio to size a `w` by `h` CSS box's canvas at, never above the screen's
   own and never past the budget. A box of no area keeps the screen's, since
   there is nothing yet to spend.
   @param {number} dpr @param {number} w @param {number} h
   @returns {number} */
export function ratio(dpr, w, h) {
  const d = dpr > 0 ? dpr : 1;
  const area = w * h;
  return area > 0 ? Math.min(d, Math.sqrt(MAX_AREA / area)) : d;
}
