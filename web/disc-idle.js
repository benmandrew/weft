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

/* How long a disc that has gone out of range keeps its pixels. A fast scroll
   crosses the whole band in one gesture, so without a hold a disc flicked past
   is emptied and refilled for a moment nobody spent looking at it, and a page
   carrying three of them pays that at each. Waking is what cancels the hold, so
   a gesture that passes a disc and stops is one wake and no sleep at all, and a
   disc genuinely left behind still gives its pixels back a moment later.
   Holding is only ever memory: nothing draws while the wait runs. */
export const HOLD = 1000;

/** Watch `el` and call `sleep` once it has been more than a viewport away for
   `HOLD`, `wake` as soon as it comes back. Returns a handle to disconnect, or
   null where a browser has no observer — which is a disc that keeps its pixels.
   @param {Element} el
   @param {() => void} sleep
   @param {() => void} wake
   @returns {{ disconnect: () => void } | null} */
export function watch(el, sleep, wake) {
  if (typeof IntersectionObserver === "undefined") return null;
  let held = 0;
  const io = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        clearTimeout(held);
        held = 0;
        if (e.isIntersecting) wake();
        else held = setTimeout(sleep, HOLD);
      }
    },
    { rootMargin: MARGIN },
  );
  io.observe(el);
  return {
    disconnect() {
      clearTimeout(held);
      held = 0;
      io.disconnect();
    },
  };
}
