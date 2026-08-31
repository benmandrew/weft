/* Whether a disc is near enough to the screen to be worth pixels.
 *
 * A disc's canvases are much the largest thing a page carrying one holds. Both
 * elements paint a base and an overlay over the whole stage, and the stage is
 * whatever height the host gave it: on the page these are embedded in, which
 * gives each `max(26rem, 100vh - 4rem)`, the four canvases come to 63.6 MB on
 * a 16 inch laptop and 115.6 MB on a 5K display, against 21 MB for every name,
 * gloss and typed array on the page put together. A page stacking two discs
 * down a column can only show one of them, so the other was holding 31.8 MB
 * and 57.8 MB of pixels nobody could see.
 *
 * So a disc a screen away from the viewport gives its canvases back and takes
 * them again on the way in. The margin is a whole viewport rather than nothing,
 * so the pixels are there before the disc is: an element that woke as its top
 * edge crossed the fold would be repainting while it was already being read.
 *
 * The DOM here is one observer, which is all a host offers to answer the
 * question with. Everything about what a disc then drops is the element's, so
 * this says when and never what.
 */

/* One viewport above and below. Nothing either side, since the discs sit in a
   column and a page scrolls down. */
export const MARGIN = "100% 0px";

/* Watch `el` and call `sleep` when it is more than a viewport away, `wake` when
   it comes back. Returns the observer to disconnect, or null where a browser
   has none — which is a disc that keeps its pixels, the behaviour before this
   existed. */
export function watch(el, sleep, wake) {
  if (typeof IntersectionObserver === "undefined") return null;
  const io = new IntersectionObserver(
    entries => {
      for (const e of entries) (e.isIntersecting ? wake : sleep)();
    },
    { rootMargin: MARGIN },
  );
  io.observe(el);
  return io;
}
