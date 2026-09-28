/* The resting bundle: every chord the disc can draw, into a square of its own.
 *
 * No DOM here. word-bundle-worker.js hosts it against an OffscreenCanvas and
 * <word-disc> calls it directly where a worker cannot be had, so the fallback
 * cannot drift from the fast path — the same split disc-paint.js and
 * disc-worker.js make for the nested disc.
 *
 * The square is the bundle's own space rather than the frame's: the ring sits
 * at RING of it, and the element blits it scaled to whatever radius it has, so
 * the build is once per word set rather than once per size.
 */

import { bow, TAU } from "./disc-colour.js";
import { MAX_AREA } from "./disc-ratio.js";

// Where the ring sits in the square, short of the half so a stroke at the rim
// has its own width inside the picture rather than clipped by the edge. The
// element inverts this to size the blit, so the two cannot disagree.
export const RING = 0.496;

/* The square is rounded up to a step, so a drag crosses a size boundary a few
   times rather than rebuilding every frame, and capped at the largest square a
   frame inside disc-ratio.js's budget can ask for. Derived rather than written
   down, since a cap short of the budget blurs the bundle alone while the dots
   and labels over it stay sharp, and nothing downstream can tell. */
export const STEP = 256,
  MAX_PX = Math.ceil(Math.sqrt(MAX_AREA) / STEP) * STEP;

/* The square a ring of this radius wants, in device pixels. Here rather than in
   the element so tools/check_web.mjs can hold it: an undersized square draws a
   blurred bundle and nothing downstream can tell. */
/** @param {number} r @param {number} dpr @returns {number} */
export function square(r, dpr) {
  const want = (r * dpr) / RING;
  return Math.min((((want / STEP) | 0) + 1) * STEP, MAX_PX);
}

/* Let a bundle's pixels go. An ImageBitmap's buffer sits outside the JS heap,
   so a replaced one reads to the collector as a small object under no pressure
   and is never reclaimed. A canvas, which is what the main-thread fallback's
   bundle is, carries no close and answers to its dimensions instead. */
/** Duck-typed rather than a union of ImageBitmap and the two canvases, since
   what it needs is the close or the dimensions and nothing else.
   @param {{close?: () => void, width?: number, height?: number} | null | undefined} pic */
export function release(pic) {
  if (!pic) return;
  if (pic.close) pic.close();
  else if (typeof pic.width === "number") pic.width = pic.height = 0;
}

/* A chord as its own subpath: the `moveTo` and then disc-colour.js's `bow`, the
   cubic all three discs draw. The element draws its fan and its chain through
   here too, so the resting picture and the live one cannot differ in shape. */
/** @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} g
   @param {number} cx @param {number} cy
   @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   @param {number} pull */
export function curve(g, cx, cy, x0, y0, x1, y1, pull) {
  g.moveTo(x0, y0);
  bow(g, cx, cy, x0, y0, x1, y1, pull);
}

/* Chords past which the stroke is thinned, and how sharply. The alpha
   accumulates where curves overlap, so a dense category lays that much more ink
   into the same disc and the middle, where every long chord is bowed through,
   floods. FALL sits between two wrong answers: holding ink per pixel level
   wants 1/chords, which rubs the picture out, and leaving it flat is what
   floods. It is the knob to turn if the fringe reads thick or thin. */
export const KNEE = 12000,
  FALL = 0.7;

/* The tuned alpha, thinned by what the disc actually holds. Here rather than in
   the element because an alpha of zero draws nothing and one above the tuned
   value overdraws, and the element could notice neither. */
/** @param {number} alpha @param {number} chords @returns {number} */
export function thin(alpha, chords) {
  if (chords <= KNEE) return alpha;
  return alpha * (KNEE / chords) ** FALL;
}

/* How many bands the z-order is cut into. Every letter puts a slice of its own
   chords into each one, so the stack is shared out rather than handed to
   whichever letter is drawn last. 64 balances the two costs: strokeStyle is set
   at most 26 times a band, however large the category, and the slices are still
   fine enough to interleave the busiest wedge. */
export const BANDS = 64;

/* The angle bins the bundle is merged over. Words nearer each other than a bin
   put their chords on top of one another, so each bin is drawn as one point and
   a stroke between two points stands for every chord between their words. A
   letter's words ending in one letter are a contiguous run of its wedge and
   all of them reach the whole of that letter's wedge, so the merge loses
   nothing but where, inside a bin, a chord ends.

   The count is angular rather than per pixel, so the picture is the same at
   every square. 2,400 is about two device pixels of rim on a 1,536 square, and
   bounds the strokes whatever the word count: entity's 40,117 words and 74
   million chords draw as 192,843. Every one of the 37 categories, animal's
   1,582 words included, puts each word in a bin of its own, so they draw
   stroke for stroke as they did before the merge. */
export const BINS = 2400;

/** The words of one wedge in one bin. A source point also shares a last
   letter, since that decides where its chords go.
   @typedef {{ang: number, n: number, bin: number, tail: number}} Point */

/** Every live letter's points: `to[L]` its wedge by bin, where chords arrive,
   and `from[L]` the same split by last letter, where they leave. A point's
   angle is the mean of its words', so a point of one word is that word.
   @param {ArrayLike<number>} ang @param {number[][]} byHead
   @param {ArrayLike<number>} tail @param {number[]} live
   @returns {{from: Point[][], to: Point[][]}} */
export function points(ang, byHead, tail, live) {
  const width = TAU / BINS;
  /** @type {Point[][]} */
  const from = [];
  /** @type {Point[][]} */
  const to = [];
  /** @type {(held: Map<number, Point>, key: number, i: number, bin: number) => void} */
  const add = (held, key, i, bin) => {
    const p = held.get(key);
    if (p) {
      p.ang += ang[i];
      p.n++;
    } else held.set(key, { ang: ang[i], n: 1, bin, tail: tail[i] });
  };
  for (const L of live) {
    /** @type {Map<number, Point>} */
    const dst = new Map();
    /** @type {Map<number, Point>} */
    const src = new Map();
    for (const i of byHead[L]) {
      const bin = Math.floor((((ang[i] % TAU) + TAU) % TAU) / width);
      add(dst, bin, i, bin);
      add(src, tail[i] * BINS + bin, i, bin);
    }
    // Summed above and divided once. Angles never wrap inside a bin, since the
    // ring's seam is a bin boundary.
    for (const p of dst.values()) p.ang /= p.n;
    for (const p of src.values()) p.ang /= p.n;
    to[L] = [...dst.values()];
    from[L] = [...src.values()];
  }
  return { from, to };
}

/** How many chords a stroke from `s`, leaving letter `L`, to `t` stands for.
   Every word of `s` reaches every word of `t`, less itself: where `s` hands
   over its own letter, its words are among `t`'s when the two share a bin.
   @param {number} L @param {Point} s @param {Point} t @returns {number} */
export function weight(L, s, t) {
  return s.n * t.n - (s.tail === L && s.bin === t.bin ? s.n : 0);
}

/* Every merged chord, stroke by stroke. A stroke apiece rather than one path
   per letter, since the alpha has to accumulate where curves overlap; batched
   into one path a bundle composites once and reads flat. A stroke standing for
   `w` chords is laid at the alpha `w` strokes on top of each other would
   reach, which is also what keeps a dense disc visible at all: entity's chord
   alpha is a ninth of one 8-bit level, which a canvas rounds to nothing.

   Each letter is cut into BANDS slices sized to its own share, drawn
   alternately forwards and backwards, so no letter sits over another
   throughout. Nothing is shuffled and no seed is drawn: the order is fixed by
   the word set alone, so two builds composite identically and a resize or a
   theme change cannot make the picture shimmer. */
/** Everything a build needs, which is what crosses to the worker: `px` the
   square's side in device pixels, `ang` and `tail` indexed by word, `byHead[L]`
   every word starting with L, `colours` one per letter, and `alpha` one
   chord's.
   @typedef {object} Spec
   @property {number} px
   @property {Float64Array} ang
   @property {number[][]} byHead
   @property {Uint8Array} tail
   @property {number[]} live
   @property {string[]} colours
   @property {number} pull
   @property {number} alpha
   @property {number} lineWidth */

/** One letter's place in the draw, carried across the bands.
   @typedef {{L: number, n: number, at: number, to: number, done: number}} Cursor */

/** @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} g
   @param {Spec} spec
   @returns {number} strokes drawn */
export function bundle(g, spec) {
  const run = bands(g, spec);
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value;
}

/* The same draw, handing control back after each band. On an accelerated
   canvas the strokes are only recorded here and painted on the GPU process's
   main thread, the one every frame of the browser is drawn on, and Chrome sends
   them over in a few large batches: entity's 192,843 strokes arrived as three
   of about 45 ms, and for a quarter of a second after a switch frames were
   dropped or shown up to 124 ms late. word-bundle-worker.js snapshots the
   canvas and waits for a task at each yield, which sends the band on its own,
   so the GPU's work comes in 64 pieces with frames drawn between them. */
/** @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} g
   @param {Spec} spec
   @returns {Generator<number, number, void>} yields the band just drawn,
   returns the strokes drawn */
export function* bands(g, spec) {
  const { px, ang, byHead, tail, live, colours, pull, alpha, lineWidth } = spec;
  const c = px / 2,
    r = px * RING;
  g.clearRect(0, 0, px, px);
  g.lineWidth = lineWidth;
  g.globalAlpha = alpha;
  let strokes = 0;
  let laid = 1;
  const { from, to } = points(ang, byHead, tail, live);

  /* A cursor per letter, carried across the bands: `at` is how far into the
     letter's own points it has drawn and `to` how far into that point's
     destinations, so a band resumes where the last one stopped and the strokes
     are never listed out. */
  const cursors = live.map(L => {
    let n = 0;
    for (const s of from[L]) for (const t of to[s.tail] ?? []) if (weight(L, s, t) > 0) n++;
    return { L, n, at: 0, to: 0, done: 0 };
  });

  // One letter's next `want` strokes, wherever the band before it left off.
  /** @type {(s: Cursor, want: number) => void} */
  const slice = (s, want) => {
    const src = from[s.L];
    while (want > 0 && s.at < src.length) {
      const p = src[s.at];
      const dst = to[p.tail] ?? [];
      const x0 = c + Math.cos(p.ang) * r,
        y0 = c - Math.sin(p.ang) * r;
      while (want > 0 && s.to < dst.length) {
        const q = dst[s.to++];
        const w = weight(s.L, p, q);
        if (w <= 0) continue;
        if (w !== laid) {
          // One chord is the alpha as given, spelt out so it is not rounded.
          g.globalAlpha = w === 1 ? alpha : 1 - (1 - alpha) ** w;
          laid = w;
        }
        g.beginPath();
        curve(g, c, c, x0, y0, c + Math.cos(q.ang) * r, c - Math.sin(q.ang) * r, pull);
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
    // in the even bands and the other way in the odd ones and neither is on top
    // on balance. It also joins each band to the next on the same letter, which
    // saves a colour change at every boundary.
    const back = band % 2 === 1;
    for (let t = 0; t < wedges; t++) {
      const s = cursors[back ? wedges - 1 - t : t];
      // Its share of the bands so far, less what it has drawn. The last band
      // asks for the whole count, so rounding leaves nothing behind.
      const want = Math.floor(((band + 1) * s.n) / BANDS) - s.done;
      if (want <= 0) continue;
      g.strokeStyle = colours[s.L];
      slice(s, want);
    }
    yield band;
  }
  return strokes;
}
