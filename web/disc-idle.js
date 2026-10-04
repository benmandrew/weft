/* Whether a disc is near enough to the screen to be worth pixels.
 *
 * A disc's canvases are the largest thing its page holds, so a disc a screen
 * away gives them back and takes them again on the way in. This module says
 * when; what a disc drops is the element's own choice.
 */

/* One viewport above and below, so the pixels are there before the disc is on
   screen. Nothing either side, since a page scrolls vertically. */
export const MARGIN = "100% 0px";

/* How long a disc out of range keeps its pixels. Without a hold, a fast scroll
   empties and refills every disc it crosses; a wake cancels the hold, so a
   scroll past a disc costs no sleep at all. Nothing draws while it waits. */
export const HOLD = 1000;

/** Watch `el` and call `sleep` once it has been more than a viewport away for
   `HOLD`, `wake` as soon as it comes back. Returns a handle to disconnect, or
   null where a browser has no observer, and then the disc keeps its pixels.
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
