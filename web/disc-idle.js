/* Whether a disc is near enough to the screen to be worth pixels.
 *
 * A disc's canvases are much the largest thing a page carrying one holds, so a
 * disc a screen away from the viewport gives them back and takes them again on
 * the way in. This says when and never what: everything about what a disc drops
 * is the element's own.
 */

/* One viewport above and below, so the pixels are there before the disc is; an
   element waking as its top edge crossed the fold would repaint while it was
   already being read. Nothing either side, since a page scrolls down. */
export const MARGIN = "100% 0px";

/* Watch `el` and call `sleep` when it is more than a viewport away, `wake` when
   it comes back. Returns the observer to disconnect, or null where a browser
   has none — which is a disc that keeps its pixels. */
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
