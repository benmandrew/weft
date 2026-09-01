/* Where <word-disc> puts a word, with no DOM in it.
 *
 * This is render.py's `words_disc` layout written a second time, so the browser
 * and the SVG place the same word at the same angle. A change on either side
 * has to be made on both; tools/check_web.mjs holds this to the Python's order.
 *
 * A word sits in the wedge of its first letter, so the successors of a word are
 * a whole wedge — every word starting with the letter it ends on — and never a
 * list stored per word. That is graph.py's claim: the game lives on 26 nodes
 * and the word graph is the line graph of that one.
 *
 *   const L = layout(rank(words, zipf));
 *   L.byHead[L.tail[i]]   // everything that can follow word i
 */
import { TAU } from "./disc-colour.js";

const A = "a".charCodeAt(0);
export const LETTERS = 26;

// The gap between two wedges. render.py's `gap`.
export const GAP = (3.5 * Math.PI) / 180;

/* Commonest first, ties by spelling: the order render.py draws and `--limit`
   cuts, for a host that sets `data` itself. */
/** @param {string[]} words @param {number[]} zipf @returns {string[]} */
export function rank(words, zipf) {
  const order = words.map((_, i) => i);
  order.sort(
    (x, y) => zipf[y] - zipf[x] || (words[x] < words[y] ? -1 : words[x] > words[y] ? 1 : 0),
  );
  return order.map(i => words[i]);
}

/* How far round the alphabet a word hands over, counted backwards from its own
   letter. render.py's `_fan_key`. Rotating the alphabet to start just before
   the wedge's own letter puts destinations in the order the ring visits them;
   the direction is opposite to the placement because two chords from one wedge
   avoid crossing when the nearer origin takes the farther destination. */
/** @param {number} head @param {number} tail @returns {number} */
export function fanKey(head, tail) {
  return (head - tail - 1 + LETTERS) % LETTERS;
}

/** One letter's block of the ring, in placement order.
   @typedef {{letter: number, from: number, to: number, mid: number, count: number}} Wedge */

/** Where every word sits. `head` and `tail` are letters 0-25, `ang` is indexed
   by word and `order` by position on the ring, so `order[k]` is the word at the
   k-th slot clockwise from the top. `byHead[L]` is every word starting with L,
   which is the whole successor set of any word ending in L.
   @typedef {object} Layout
   @property {number} n
   @property {Uint8Array} head
   @property {Uint8Array} tail
   @property {Float64Array} ang
   @property {Int32Array} order
   @property {number[][]} byHead
   @property {number[]} live letters with at least one word
   @property {Wedge[]} wedge
   @property {number} span radians one word takes */

/** The whole layout in one pass over the words, which are expected in `rank`
   order. Angles are anticlockwise from the +x axis and run down from the top,
   so a caller makes a point with `Math.cos(ang)` and, canvas y growing
   downward, `-Math.sin(ang)`.
   @param {string[]} words
   @returns {Layout} */
export function layout(words) {
  const n = words.length;
  const head = new Uint8Array(n),
    tail = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    head[i] = words[i].charCodeAt(0) - A;
    tail[i] = words[i].charCodeAt(words[i].length - 1) - A;
  }

  // In the order given, so the wedge sort below is the only thing deciding
  // placement and successors come back commonest first.
  /** @type {number[][]} */
  const byHead = Array.from({ length: LETTERS }, () => []);
  for (let i = 0; i < n; i++) byHead[head[i]].push(i);
  /** @type {number[]} */
  const live = [];
  for (let L = 0; L < LETTERS; L++) if (byHead[L].length) live.push(L);

  // Every word takes the same slice of what the gaps leave, so a wedge's width
  // is its word count.
  const span = (TAU - GAP * live.length) / Math.max(n, 1);
  const ang = new Float64Array(n);
  const order = new Int32Array(n);
  /** @type {Wedge[]} */
  const wedge = [];

  let a = Math.PI / 2,
    at = 0;
  for (const L of live) {
    const block = byHead[L].slice().sort((x, y) => {
      const kx = fanKey(head[x], tail[x]),
        ky = fanKey(head[y], tail[y]);
      if (kx !== ky) return kx - ky;
      return words[x] < words[y] ? -1 : words[x] > words[y] ? 1 : 0;
    });
    const from = a;
    for (const i of block) {
      a -= span;
      ang[i] = a + span / 2;
      order[at++] = i;
    }
    wedge.push({ letter: L, from, to: a, mid: (from + a) / 2, count: block.length });
    a -= GAP;
  }
  return { n, head, tail, ang, order, byHead, live, wedge, span };
}

/* Where a label sits, as a fraction of the dot ring, and the clear space it
   wants along the ring. config.Geometry's label_radius and leading. */
export const LABEL_RADIUS = 1.02,
  LEADING = 1.22;
/* Past the cap a wider disc buys the labels nothing; below the floor they are
   dropped rather than smeared, and the hub names what the pointer is on. */
export const MAX_LABEL_PX = 13,
  MIN_LABEL_PX = 5.5;
/* Room outside the labels for the wedge letter, and the margin outside that. */
export const WEDGE_BAND = 24,
  PAD = 4;
/* The hub, as a fraction of the dot ring: never below HUB_MIN, so a name always
   has somewhere to be read, and never past HUB_MAX, so a small frame cannot
   leave the hub swallowing the dots. It is one radius doing two jobs, what the
   name has to fit inside and what a click in the middle undoes; keeping them as
   one number is what stops the outer half of a name sitting somewhere a click
   does nothing. */
export const HUB_SHARE = 0.45,
  HUB_MIN = 66,
  HUB_MAX = 0.55;

/** `labelPx` is 0 when the labels are dropped, and `outer` is where they end.
   @typedef {{r: number, labelPx: number, hub: number, outer: number}} Fit */

/** The dot ring and the label size, solved together, for a square of `size`
   pixels holding words whose widest is `widest` pixels per pixel of type.
   render.py's `_wanted_inches` grows the canvas until adjacent labels clear;
   here the canvas is whatever the host gave, so the type takes the shortfall.

   `outer` is where the labels end: the wedge letter sits outside it and the
   hit test reaches to it.
   @param {number} span
   @param {number} widest
   @param {number} size
   @returns {Fit} */
export function solve(span, widest, size) {
  const half = size / 2 - PAD;
  // Font size per pixel of radius, at which adjacent labels exactly clear.
  const k = (LABEL_RADIUS * span) / LEADING;
  let r = (half - WEDGE_BAND) / (LABEL_RADIUS + widest * k);
  let labelPx = k * r;
  if (labelPx > MAX_LABEL_PX) {
    // Wider than the labels can use, so the ring takes the rest of the frame.
    labelPx = MAX_LABEL_PX;
    r = (half - WEDGE_BAND - widest * labelPx) / LABEL_RADIUS;
  }
  if (labelPx < MIN_LABEL_PX) {
    labelPx = 0;
    r = (half - WEDGE_BAND) / LABEL_RADIUS;
  }
  // A tiny frame still has to come back with a disc rather than a negative
  // radius, since nothing downstream tests for one.
  r = Math.max(1, r);
  return {
    r,
    labelPx,
    hub: Math.min(Math.max(HUB_MIN, r * HUB_SHARE), r * HUB_MAX),
    outer: r * LABEL_RADIUS + widest * labelPx,
  };
}

/** Turns clockwise from the top, in placement order. Strictly increasing by
   construction, which is what lets `at` binary-search rather than index.
   @param {Layout} L
   @returns {Float64Array} */
export function turns(L) {
  const t = new Float64Array(L.n);
  for (let k = 0; k < t.length; k++) t[k] = Math.PI / 2 - L.ang[L.order[k]];
  return t;
}

/** The word `t` turns clockwise from the top lands on, and -1 for the gaps
   between wedges, which belong to nobody.
   @param {Layout} L
   @param {Float64Array} turn from `turns(L)`
   @param {number} t
   @returns {number} */
export function at(L, turn, t) {
  const half = L.span / 2;
  let lo = 0,
    hi = turn.length - 1,
    k = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (turn[m] <= t) {
      k = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  // Both neighbours, since the search lands below `t` and the slice above it
  // may be the nearer one.
  for (const j of [k, k + 1])
    if (j < turn.length && Math.abs(turn[j] - t) <= half) return L.order[j];
  return -1;
}

/** How many chords the resting bundle holds, counted without building it: the
   element draws the bundle only when this is small enough.
   @param {Layout} L
   @returns {number} */
export function chords(L) {
  let total = 0;
  for (let i = 0; i < L.n; i++) {
    const to = L.byHead[L.tail[i]].length;
    // A word cannot follow itself, which is the case exactly when the letter it
    // hands over is the one it starts with.
    total += L.head[i] === L.tail[i] ? to - 1 : to;
  }
  return total;
}
