/* The resting bundle: every chord the disc can draw, into a square of its own.
 *
 * No DOM here. word-bundle-worker.js hosts it against an OffscreenCanvas and
 * <word-disc> calls it directly where a worker cannot be had, so the fallback
 * cannot drift from the fast path — the same split disc-paint.js and
 * disc-worker.js make for the nested disc.
 *
 * The square is the bundle's own space rather than the frame's: the ring sits
 * at RING of it, and the element blits it scaled to whatever radius it has.
 * That is what takes the build from once per size to once per word set. A
 * bundle is a stroke apiece — 96,470 of them for animal at no limit — and
 * pinning it to the frame meant a drag paid for all of them on every step,
 * which is why the count it was skipped past used to be low enough to lose the
 * picture on the seven largest categories.
 */

import { MAX_AREA } from "./disc-ratio.js";

// Where the ring sits in the square, short of the half so a stroke at the rim
// has its own width inside the picture rather than clipped by the edge. The
// element inverts this to size the blit, so the two cannot disagree.
export const RING = 0.496;

/* The square is rounded up to a step, so a drag crosses a size boundary a few
   times rather than rebuilding on every frame, and capped at the largest one a
   frame inside disc-ratio.js's budget can ask for. Derived rather than written
   down, since a cap short of that blurs the bundle alone while the dots and
   the labels over it stay sharp, and nothing downstream can tell: the ring
   fills the frame, so a square stage of side s at ratio d wants about s * d,
   and the budget holds s * d to the root of MAX_AREA. That is 3,072 today, a
   37.7 MB bitmap at the one disc size that reaches it. */
export const STEP = 256,
  MAX_PX = Math.ceil(Math.sqrt(MAX_AREA) / STEP) * STEP;

/* The square a ring of this radius wants, in device pixels. Here rather than
   in the element because a sizing that comes back at half the resolution it
   needs draws a blurred bundle and nothing downstream can tell, where
   tools/check_web.mjs can. */
export function square(r, dpr) {
  const want = (r * dpr) / RING;
  return Math.min((((want / STEP) | 0) + 1) * STEP, MAX_PX);
}

/* Let a bundle's pixels go. They are the one thing here the collector cannot
   see: an ImageBitmap's buffer sits outside the JS heap, so a bundle that has
   been replaced reads as a small object under no pressure and the tab is free
   to hold its 12.3 MB for as long as it likes. A category pick, a theme change
   and every crossed size step each drop one, and going through the 37
   categories was 1.4 GB of pixels nothing was drawing, which is a tab Safari
   reloads.

   A canvas carries no close and answers to its dimensions instead, which is
   what the main-thread fallback's bundle is; word-bundle-worker.js empties its
   own the same way, in place, since it holds a canvas rather than a picture.
   Here rather than at the call sites because they all drop the same thing and
   none of them can tell whether it went. */
export function release(pic) {
  if (!pic) return;
  if (pic.close) pic.close();
  else if (typeof pic.width === "number") pic.width = pic.height = 0;
}

/* A cubic bowed towards the centre, which is what makes a chord read as the
   pair of letters it joins rather than as a line across the disc. Four control
   points and no sampling, the same curve `_curve` writes into the SVG. The
   element draws its fan and its chain through here too, so the resting picture
   and the live one cannot be drawn to different shapes. */
export function curve(g, cx, cy, x0, y0, x1, y1, pull) {
  g.moveTo(x0, y0);
  g.bezierCurveTo(
    cx + (x0 - cx) * pull,
    cy + (y0 - cy) * pull,
    cx + (x1 - cx) * pull,
    cy + (y1 - cy) * pull,
    x1,
    y1,
  );
}

/* Chords past which the stroke is thinned, and how sharply.

   The alpha accumulates where curves overlap, which is what gives the bundle
   its shape, so a category with eight times the chords lays eight times the
   ink into the same disc and the middle — where every long chord is bowed
   through — floods. At the 0.11 the dense categories are drawn in, a pixel
   crossed by 26 chords is 95% opaque.

   That 0.11 was tuned against bundles that were never dense, because the
   ceiling stopped the bundle being drawn past 24,000 chords at all. The
   densest one ever actually drawn was language's 11,249, so the knee sits just
   above it: every category the value was exercised on comes out exactly as it
   did, and only the seven the ceiling used to refuse are thinned.

   FALL sits between the two wrong answers. Holding ink per pixel level wants
   the alpha to fall as 1/chords, which takes animal to 0.013 and rubs the
   picture out; leaving it flat is what floods. A square root, 0.5, was the
   first guess and still read thick at the top of the range, so it is 0.7:
   drug 0.066, food 0.037 and animal 0.026. It is an exponent rather than a
   second constant to tune because the knee is where the falloff has to start
   whatever its steepness, and it is the knob to turn if the fringe is thick
   or thin from here. */
export const KNEE = 12000,
  FALL = 0.7;

/* The tuned alpha, thinned by what the disc actually holds. Here rather than
   in the element because an alpha that comes back at zero draws nothing and
   one that comes back above one draws a solid disc, and neither is something
   the element could notice — the same argument `solve` and `square` are held
   to. */
export function thin(alpha, chords) {
  if (chords <= KNEE) return alpha;
  return alpha * (KNEE / chords) ** FALL;
}

/* How many bands the z-order is cut into. Every letter puts a slice of its own
   chords into each one, so the stack is shared out instead of being handed to
   whichever letter is drawn last.

   64 is where the two costs meet. The colour is what canvas has to parse, and
   a letter drawn in one run sets it 26 times where a full shuffle would set it
   once per stroke, 96,470 times on animal. Interleaving band by band sets it
   at most 26 times per band, so the ceiling is 1,664 whatever the category:
   a rounding error against animal's strokes, and on a category small enough
   for that ceiling to be a large share of them there is nothing expensive to
   share. It is fine enough to matter as well, cutting animal's busiest wedge
   into slices 8 chords deep. */
export const BANDS = 64;

/* Every chord, stroke by stroke. A stroke apiece rather than one path per
   letter, because the alpha has to accumulate where curves overlap the way it
   does in the figure — batched into one path a bundle composites once and
   reads flat.

   Drawn letter by letter it composited in alphabetical order, so every chord
   leaving Z sat over every chord leaving A and the fringe read as the back of
   the alphabet. Each letter is cut into BANDS slices instead, sized to its own
   share so a wedge of 12 chords is spread as widely as one of 10,000, and the
   bands are drawn alternately forwards and backwards so no pair of letters has
   one of them on top throughout.

   Nothing is shuffled and no seed is drawn. The order is fixed by the word set
   alone, so two builds of the same disc composite identically and neither a
   resize nor a theme change can make the picture shimmer — which a random
   permutation would, since the bundle is rebuilt whenever the square or the
   colours move. */
export function bundle(g, spec) {
  const { px, ang, byHead, tail, live, colours, pull, alpha, lineWidth } = spec;
  const c = px / 2,
    r = px * RING;
  g.clearRect(0, 0, px, px);
  g.lineWidth = lineWidth;
  g.globalAlpha = alpha;
  let strokes = 0;

  /* A cursor per letter, carried across the bands: `at` is how far into the
     letter's own words it has drawn and `to` how far into that word's
     destinations, so a band resumes exactly where the last one stopped. The
     chords are never listed out — animal would be 96,470 entries, which is the
     materialising graph.py exists to avoid. */
  const cursors = live.map(L => {
    let n = 0;
    for (const i of byHead[L]) n += byHead[tail[i]].length - (tail[i] === L ? 1 : 0);
    return { L, n, at: 0, to: 0, done: 0 };
  });

  // One letter's next `want` chords, wherever the band before it left off.
  const slice = (s, want) => {
    const from = byHead[s.L];
    while (want > 0 && s.at < from.length) {
      const i = from[s.at];
      const dst = byHead[tail[i]];
      const x0 = c + Math.cos(ang[i]) * r,
        y0 = c - Math.sin(ang[i]) * r;
      while (want > 0 && s.to < dst.length) {
        const j = dst[s.to++];
        if (j === i) continue;
        g.beginPath();
        curve(g, c, c, x0, y0, c + Math.cos(ang[j]) * r, c - Math.sin(ang[j]) * r, pull);
        g.stroke();
        want--;
        s.done++;
        strokes++;
      }
      if (s.to >= dst.length) {
        s.at++;
        s.to = 0;
      }
    }
  };

  const wedges = cursors.length;
  for (let band = 0; band < BANDS; band++) {
    // Turned round on every other band, so a pair of letters is drawn one way
    // in the even bands and the other way in the odd ones and neither is over
    // the other on balance. Rotating the order instead only moves where the
    // cycle starts: A still went down before B in 25 bands of 26. It also
    // joins each band to the next on the same letter, which is one colour
    // change saved at every boundary.
    const back = band % 2 === 1;
    for (let t = 0; t < wedges; t++) {
      const s = cursors[back ? wedges - 1 - t : t];
      // Its share of the bands so far, less what it has drawn. The last band
      // asks for the whole count, so nothing is left behind by the rounding.
      const want = Math.floor(((band + 1) * s.n) / BANDS) - s.done;
      if (want <= 0) continue;
      g.strokeStyle = colours[s.L];
      slice(s, want);
    }
  }
  return strokes;
}
