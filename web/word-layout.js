/* Where <word-disc> puts a word, with no DOM in it.
 *
 * This is render.py's `words_disc` layout written a second time, so the browser
 * and the SVG place the same word at the same angle. Everything below is that
 * function's arithmetic and nothing else, which is why it is a module of its
 * own: tools/check_web.mjs holds it to the ordering the Python has, and a
 * change on either side has to be made on both.
 *
 * A word runs from its first letter to its last, so the disc is 26 wedges and
 * a word sits in the wedge of its first letter. The successors of a word are
 * therefore a whole wedge — every word starting with the letter it ends on —
 * and never a list stored per word. That is graph.py's claim: the game lives
 * on 26 nodes, and the word graph is the line graph of that one. Materialising
 * it would be 125,000 edges for animal at no limit, against 26 arrays.
 *
 *   const L = layout(rank(words, zipf));
 *   L.byHead[L.tail[i]]   // everything that can follow word i
 */
import { TAU } from "./disc-colour.js";

const A = "a".charCodeAt(0);
export const LETTERS = 26;

// The gap between two wedges, which is what stops the ring reading as one
// continuous band of dots. render.py's `gap`.
export const GAP = (3.5 * Math.PI) / 180;

/* Commonest first, ties by spelling, which is the order render.py draws and
   the order `--limit` cuts. The exporter already writes the file this way, so
   this is what holds a host that sets `data` itself to the same picture. */
export function rank(words, zipf) {
  const order = words.map((_, i) => i);
  order.sort(
    (x, y) => zipf[y] - zipf[x] || (words[x] < words[y] ? -1 : words[x] > words[y] ? 1 : 0),
  );
  return order.map(i => words[i]);
}

/* How far round the alphabet a word hands over, counted backwards from its own
   letter. render.py's `_fan_key`.

   Sorting a wedge on the destination letter alone starts every wedge at A,
   which is arbitrary once the wedges are themselves a ring: it drops the
   destinations nearest S into the middle of the S block and sends the bundle
   back across itself. Rotating the alphabet to begin just before the wedge's
   own letter puts them in the order the ring visits them, and the direction is
   opposite to the placement because two chords from one wedge avoid crossing
   when the nearer origin takes the farther destination. */
export function fanKey(head, tail) {
  return (head - tail - 1 + LETTERS) % LETTERS;
}

/* The whole layout in one pass over the words, which are expected in `rank`
   order. Angles are the maths convention, anticlockwise from the +x axis, and
   they run down from the top because the ring is read clockwise the way a dial
   is. A caller turns one into a point with `Math.cos(ang)` and, since canvas y
   grows downward, `-Math.sin(ang)`. */
export function layout(words) {
  const n = words.length;
  const head = new Uint8Array(n),
    tail = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    head[i] = words[i].charCodeAt(0) - A;
    tail[i] = words[i].charCodeAt(words[i].length - 1) - A;
  }

  // In the order given, so a wedge's own sort below is the only thing that
  // decides placement and the successors of a word come back commonest first.
  const byHead = Array.from({ length: LETTERS }, () => []);
  for (let i = 0; i < n; i++) byHead[head[i]].push(i);
  const live = [];
  for (let L = 0; L < LETTERS; L++) if (byHead[L].length) live.push(L);

  // Every word takes the same slice of what the gaps leave, so a wedge's width
  // is its word count and the ring reads as a histogram of first letters.
  const span = (TAU - GAP * live.length) / Math.max(n, 1);
  const ang = new Float64Array(n);
  const order = new Int32Array(n);
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
   wants along the ring in multiples of its own size. config.Geometry's
   label_radius and leading. */
export const LABEL_RADIUS = 1.02,
  LEADING = 1.22;
/* The label ladder. Past the cap a wider disc buys the labels nothing; below
   the floor they are dropped rather than drawn as a smear, and the hub names
   what the pointer is on instead. */
export const MAX_LABEL_PX = 13,
  MIN_LABEL_PX = 5.5;
/* Room outside the labels for the wedge letter, and the margin outside that. */
export const WEDGE_BAND = 24,
  PAD = 4;
/* The hub, as a fraction of the dot ring: never smaller than HUB_MIN, so a
   name always has somewhere to be read, and never past HUB_MAX of the ring, so
   a frame too small for the floor cannot leave the hub swallowing the dots. */
export const HUB_SHARE = 0.3,
  HUB_MIN = 44,
  HUB_MAX = 0.55;

/* The dot ring and the label size, solved together, for a square of `size`
   pixels holding words whose widest is `widest` pixels per pixel of type.

   A label's length is set by its font size and the room it has along the ring
   is set by the radius, so the two appear on both sides of one equation —
   `_disc_limit` and `_wanted_inches` in render.py are the same equation solved
   the other way round. There the canvas grows until adjacent labels clear each
   other; here the canvas is whatever the host gave, so the type takes the
   shortfall from the start, which is the trade `--limit 0` already makes in
   the SVG.

   `outer` is where the labels end: the wedge letter sits outside it and the
   hit test reaches to it. */
export function solve(span, widest, size) {
  const half = size / 2 - PAD;
  // Font size per pixel of radius, at which adjacent labels exactly clear.
  const k = (LABEL_RADIUS * span) / LEADING;
  let r = (half - WEDGE_BAND) / (LABEL_RADIUS + widest * k);
  let labelPx = k * r;
  if (labelPx > MAX_LABEL_PX) {
    // Wider than the labels can use, so they stop growing and the ring takes
    // the rest of the frame.
    labelPx = MAX_LABEL_PX;
    r = (half - WEDGE_BAND - widest * labelPx) / LABEL_RADIUS;
  }
  if (labelPx < MIN_LABEL_PX) {
    labelPx = 0;
    r = (half - WEDGE_BAND) / LABEL_RADIUS;
  }
  // A frame too small for any of this still has to come back with a disc
  // rather than a negative radius, since nothing downstream tests for one.
  r = Math.max(1, r);
  return {
    r,
    labelPx,
    hub: Math.min(Math.max(HUB_MIN, r * HUB_SHARE), r * HUB_MAX),
    outer: r * LABEL_RADIUS + widest * labelPx,
  };
}

/* Turns clockwise from the top, in placement order. Strictly increasing by
   construction, which is what lets the hit test below be a binary search over
   one array rather than a spatial index. */
export function turns(L) {
  const t = new Float64Array(L.n);
  for (let k = 0; k < t.length; k++) t[k] = Math.PI / 2 - L.ang[L.order[k]];
  return t;
}

/* The word `t` turns clockwise from the top lands on, and -1 for the gaps
   between wedges, which belong to nobody. */
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

/* How many chords the resting bundle holds, counted without building it. The
   element draws the bundle only when this is small enough to read as a
   picture, and the count is the whole of the test. */
export function chords(L) {
  let total = 0;
  for (let i = 0; i < L.n; i++) {
    const to = L.byHead[L.tail[i]].length;
    // A word cannot follow itself, and it is in that group exactly when the
    // letter it hands over is the one it starts with.
    total += L.head[i] === L.tail[i] ? to - 1 : to;
  }
  return total;
}
