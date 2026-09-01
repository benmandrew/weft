/* Where <letter-disc> puts a letter and an arc, with no DOM in it: 26 nodes
 * and one arc per letter pair some word bridges. Nothing is bundled, since
 * every arc is a thing to point at and read a count off. Sizing and ordering
 * live here rather than in the element, for the reason word-layout.js's
 * `solve` does — an arc back at a negative width draws nothing and the element
 * cannot tell, where tools/check_web.mjs can.
 *
 *   const m = matrix(["cat", "toad"]);
 *   const L = layout(m);
 *   L.edges[at(L, turn)]      // the arc under the pointer
 */
import { bow, TAU } from "./disc-colour.js";

const A = "a".charCodeAt(0);
export const LETTERS = 26;

/* The gap between two letters' arcs. There is deliberately no floor under an
   arc: a floor is a fixed amount plus a share, so a unit of weight would be
   worth more degrees in a quiet letter than in a busy one and a ribbon between
   them would say two different counts at its ends. */
export const GAP = (1.2 * Math.PI) / 180;

/** An arc's width: drawn linearly the single-word arcs disappear beside the
   trunks. log1p rather than log because log(1) is 0.
   @type {(n: number) => number} */
export const weight = n => Math.log1p(n);

/** `count` is 26 by 26, indexed [head * 26 + tail]; `n` is the words counted,
   `pairs` the populated cells and `loops` those on the diagonal.
   @typedef {object} Matrix
   @property {number} n
   @property {Int32Array} count
   @property {Int32Array} starts
   @property {Int32Array} ends
   @property {number} pairs
   @property {number} loops */

/** The 26 by 26 count, and the two margins of it. Indexed [head * 26 + tail],
   which is letter_matrix in graph.py written a second time. `starts[L]` is the
   words leaving L and `ends[L]` the words arriving at it.
   @param {Iterable<string>} words
   @returns {Matrix} */
export function matrix(words) {
  const count = new Int32Array(LETTERS * LETTERS);
  const starts = new Int32Array(LETTERS),
    ends = new Int32Array(LETTERS);
  let n = 0;
  for (const word of words) {
    if (!word) continue;
    const h = word.charCodeAt(0) - A,
      t = word.charCodeAt(word.length - 1) - A;
    // A word outside a to z is no edge of this graph: a guard against a host
    // handing in its own list.
    if (h < 0 || h >= LETTERS || t < 0 || t >= LETTERS) continue;
    count[h * LETTERS + t]++;
    starts[h]++;
    ends[t]++;
    n++;
  }
  let pairs = 0,
    loops = 0;
  for (let h = 0; h < LETTERS; h++) {
    for (let t = 0; t < LETTERS; t++) {
      if (!count[h * LETTERS + t]) continue;
      pairs++;
      if (h === t) loops++;
    }
  }
  return { n, count, starts, ends, pairs, loops };
}

/* How far round the alphabet one letter reaches to another, counted backwards
   from its own — word-layout.js's `_fan_key`. Ordering a letter's arcs by
   destination alone starts every one at A and sends the fan across itself. */
/** @param {number} from @param {number} to @returns {number} */
export function fanKey(from, to) {
  return (from - to - 1 + LETTERS) % LETTERS;
}

/** One arc, from letter `from` to letter `to`, carrying `n` words at log
   weight `w`. [a0, a1] is its slot in the source's leaving half and [b0, b1]
   its slot in the target's arriving half; [t0, t1] is the wedge it is confined
   to, which `near` prunes on, and `wide` marks the arcs that wedge says nothing
   about.
   @typedef {object} Edge
   @property {number} from
   @property {number} to
   @property {number} n
   @property {number} w
   @property {number} a0
   @property {number} a1
   @property {number} b0
   @property {number} b1
   @property {number} t0
   @property {number} t1
   @property {boolean} wide
   @property {boolean} loop */

/** One letter's band of the ring. `split` is where the leaving half ends and
   the arriving half begins.
   @typedef {object} Arc
   @property {number} letter
   @property {number} from
   @property {number} to
   @property {number} mid
   @property {number} split
   @property {number} span */

/** `arcOf[L]` indexes `arcs`, or -1 for a letter no word touches. `out[L]` and
   `into[L]` index `edges`, in the order the ends are laid out; `order` is the
   draw order, lightest first. `turn`, `upto` and `slotEdge` are every end in
   one increasing sequence of turns clockwise from the top, which is what `at`
   searches.
   @typedef {object} Graph
   @property {number[]} live
   @property {Arc[]} arcs
   @property {Int32Array} arcOf
   @property {Edge[]} edges
   @property {number[]} order
   @property {number[][]} byLetter
   @property {number[][]} out
   @property {number[][]} into
   @property {Float64Array} outW
   @property {Float64Array} inW
   @property {Int32Array} starts
   @property {Int32Array} ends
   @property {Float64Array} turn
   @property {Float64Array} upto
   @property {Int32Array} slotEdge
   @property {number} pairs
   @property {number} loops
   @property {number} words */

/** The whole layout in one pass over the matrix. A letter's arc is the sum of
 * the log weights of every arc touching it, so a unit of weight is the same
 * number of degrees at both ends of a ribbon. Each arc is then split, the
 * leaving half first as the ring is read clockwise, so direction is geometry
 * rather than an arrowhead.
 *
 * Angles are anticlockwise from +x, running down from the top; a caller makes
 * a point with `Math.cos(ang)` and, canvas y growing downward, `-Math.sin(ang)`.
 * Every slot is [hi, lo] with hi above lo, which lets `ribbon` walk a boundary
 * in one direction.
 *
 * @param {Matrix} m
 * @returns {Graph}
 */
export function layout(m) {
  const { count, starts, ends } = m;
  // The weight each letter carries, out and in, which is what sizes its arc.
  const outW = new Float64Array(LETTERS),
    inW = new Float64Array(LETTERS);
  /** @type {Edge[]} */
  const edges = [];
  for (let h = 0; h < LETTERS; h++) {
    for (let t = 0; t < LETTERS; t++) {
      const n = count[h * LETTERS + t];
      if (!n) continue;
      const w = weight(n);
      outW[h] += w;
      inW[t] += w;
      edges.push({
        from: h,
        to: t,
        n,
        w,
        a0: 0,
        a1: 0,
        b0: 0,
        b1: 0,
        // The wedge the arc is confined to, filled in below.
        t0: 0,
        t1: 0,
        wide: true,
        loop: h === t,
      });
    }
  }

  /** @type {number[]} */
  const live = [];
  for (let L = 0; L < LETTERS; L++) if (outW[L] + inW[L] > 0) live.push(L);

  /* Shared out by weight and by nothing else, so one unit of weight is the
     same number of degrees everywhere on the ring. A category with no words
     lays nothing out rather than dividing by zero. */
  const room = TAU - GAP * live.length;
  const total = live.reduce((s, L) => s + outW[L] + inW[L], 0);
  /** @type {(L: number) => number} */
  const width = L => (total > 0 ? (room * (outW[L] + inW[L])) / total : 0);

  /** @type {Arc[]} */
  const arcs = [];
  const arcOf = new Int32Array(LETTERS).fill(-1);
  let a = Math.PI / 2;
  for (const L of live) {
    const span = width(L);
    const from = a;
    // The split is the two halves' own shares of the letter's weight. A letter
    // that only ever ends words has no leaving half at all.
    const carries = outW[L] + inW[L];
    const split = from - span * (carries > 0 ? outW[L] / carries : 0.5);
    arcOf[L] = arcs.length;
    arcs.push({ letter: L, from, to: from - span, mid: from - span / 2, split, span });
    a = from - span - GAP;
  }

  /* Each end takes its share of its own half, in the order the ring visits
     the letter at the other end. The leaving ends run one way round the
     alphabet and the arriving ends the other, so a pair of letters trading
     arcs both ways puts the ribbons side by side rather than crossing. */
  /** @type {number[][]} */
  const byLetter = Array.from({ length: LETTERS }, () => []);
  /** @type {number[][]} */
  const out = Array.from({ length: LETTERS }, () => []);
  /** @type {number[][]} */
  const into = Array.from({ length: LETTERS }, () => []);
  for (const [k, e] of edges.entries()) {
    out[e.from].push(k);
    into[e.to].push(k);
    byLetter[e.from].push(k);
    if (e.to !== e.from) byLetter[e.to].push(k);
  }
  for (const L of live) {
    out[L].sort((x, y) => fanKey(L, edges[x].to) - fanKey(L, edges[y].to));
    into[L].sort((x, y) => fanKey(edges[y].from, L) - fanKey(edges[x].from, L));
    // Both halves come off the arc, so the ends cannot be laid out against a
    // different split from the band that is drawn.
    const arc = arcs[arcOf[L]];
    const outSpan = arc.from - arc.split,
      inSpan = arc.split - arc.to;
    let at = arc.from;
    for (const k of out[L]) {
      const take = (outSpan * edges[k].w) / outW[L];
      edges[k].a0 = at;
      edges[k].a1 = at - take;
      at -= take;
    }
    at = arc.split;
    for (const k of into[L]) {
      const take = (inSpan * edges[k].w) / inW[L];
      edges[k].b0 = at;
      edges[k].b1 = at - take;
      at -= take;
    }
  }

  /* Drawing order: the light arcs first and the heavy ones over them, so the
     trunks read and the hairlines are ground. Alphabetical order would put
     every arc leaving Z over every arc leaving A. */
  const order = edges.map((_, k) => k).sort((x, y) => edges[x].w - edges[y].w);

  /* The wedge each arc is confined to, so a point inside the ring can be
     refused without asking the path about it. Every point of a ribbon lies in
     the convex hull of its four ring points and their control points, which
     sit on the rays to those points, so the hull is inside the wedge the four
     turns span — as long as that wedge is under half a turn, past which the
     hull reaches the centre and the wedge says nothing; those arcs are `wide`
     and nothing is pruned for them. The wedge is the complement of the largest
     gap between the four, not the span from lowest to highest: that is what
     finds it when an arc straddles the top of the ring and its wedge wraps. */
  for (const e of edges) {
    const ts = [e.a0, e.a1, e.b0, e.b1].map(x => (((Math.PI / 2 - x) % TAU) + TAU) % TAU).sort();
    let gap = ts[0] + TAU - ts[3],
      at = 0;
    for (let i = 1; i < 4; i++) {
      if (ts[i] - ts[i - 1] > gap) {
        gap = ts[i] - ts[i - 1];
        at = i;
      }
    }
    e.wide = TAU - gap >= Math.PI;
    e.t0 = ts[at];
    e.t1 = ts[(at + 3) % 4];
  }

  /* Every end, in one increasing sequence of turns clockwise from the top,
     which lets `at` be a binary search. Slots tile each half of each arc
     exactly, so the taper the ribbon is drawn with leaves no dead ground. */
  /** @type {{hi: number, lo: number, edge: number}[]} */
  const slots = [];
  for (const L of live) {
    for (const k of out[L]) slots.push({ hi: edges[k].a0, lo: edges[k].a1, edge: k });
    for (const k of into[L]) slots.push({ hi: edges[k].b0, lo: edges[k].b1, edge: k });
  }
  slots.sort((x, y) => y.hi - x.hi);
  const turn = new Float64Array(slots.length),
    upto = new Float64Array(slots.length),
    slotEdge = new Int32Array(slots.length);
  for (const [k, s] of slots.entries()) {
    turn[k] = Math.PI / 2 - s.hi;
    upto[k] = Math.PI / 2 - s.lo;
    slotEdge[k] = s.edge;
  }

  return {
    live,
    arcs,
    arcOf,
    edges,
    order,
    byLetter,
    out,
    into,
    outW,
    inW,
    starts,
    ends,
    turn,
    upto,
    slotEdge,
    pairs: m.pairs,
    loops: m.loops,
    words: m.n,
  };
}

/* Room outside the ring for the letters, as a multiple of their own size, and
   the margin outside that. */
export const LABEL_BAND = 1.7,
  PAD = 4;
/* The letter size, solved off the frame and held between these, and the ring
   band's thickness as a fraction of the radius. */
export const MIN_LABEL_PX = 9,
  MAX_LABEL_PX = 22,
  BAND_SHARE = 0.032,
  MIN_BAND = 5,
  MAX_BAND = 16;
/* The hub, as a fraction of the ring. <word-disc>'s numbers, since it is the
   same job and the two elements sit on a page together. */
export const HUB_SHARE = 0.45,
  HUB_MIN = 66,
  HUB_MAX = 0.55;

/** `labelPx` is 0 when the frame is too small for the letters outside the
   ring, and `outer` lands on the square's half-width either way.
   @typedef {{r: number, band: number, labelPx: number, hub: number, outer: number}} Fit */

/** Everything the disc measures, off the square the host left it. What it owes
   is a disc that stays inside its own square and comes back positive at any
   size, which is the part nothing downstream tests for.
   @param {number} size
   @returns {Fit} */
export function solve(size) {
  const half = Math.max(size / 2 - PAD, 1);
  const want = Math.min(Math.max(half * 0.05, MIN_LABEL_PX), MAX_LABEL_PX);
  /* What is left for the ring once the letters outside it are given their
     room. A frame too small for them keeps its disc and loses them, the hub
     naming what the pointer is on instead. */
  const labels = half - want * LABEL_BAND >= half * 0.55;
  const room = Math.max(labels ? half - want * LABEL_BAND : half, 1);
  /* The band is drawn centred on the ring, so half of it sits outside and the
     radius has to come off that rather than off `room` itself. Solved for the
     unclamped band and then taken off whatever the clamp allowed, so `outer`
     lands on `half` exactly either way. */
  const band = Math.min(Math.max((room / (1 + BAND_SHARE / 2)) * BAND_SHARE, MIN_BAND), MAX_BAND);
  const r = Math.max(room - band / 2, 1);
  const labelPx = labels ? want : 0;
  return {
    r,
    band,
    labelPx,
    hub: Math.min(Math.max(HUB_MIN, r * HUB_SHARE), r * HUB_MAX),
    outer: r + band / 2 + labelPx * LABEL_BAND,
  };
}

/* How far a chord's control points sit towards the centre, at the two ends of
   the range, and the target end's share of its own slot. The pull runs with
   the turn the arc covers rather than being fixed the way <word-disc>'s is:
   many arcs here are short, and at a long chord's pull each is a spike at the
   middle. The taper is the second thing saying which way an arc runs. */
export const PULL_FAR = 0.14,
  PULL_NEAR = 0.82,
  TAPER = 0.45;

/* The resting fill, and the pair count past which it is thinned: a ribbon is
   filled rather than stroked, so the alpha accumulates wherever two overlap
   and a dense category floods where a sparse one reads. ALPHA_FALL is a guess
   nobody has checked in a browser; `make serve` is where to. Here rather than
   in the element for the reason `solve` is — an alpha back at zero draws
   nothing and the element could not tell. */
export const ALPHA = 0.5,
  ALPHA_KNEE = 120,
  ALPHA_FALL = 0.5;

/** @param {number} alpha @param {number} pairs @returns {number} */
export function fade(alpha, pairs) {
  if (pairs <= ALPHA_KNEE) return alpha;
  return alpha * (ALPHA_KNEE / pairs) ** ALPHA_FALL;
}

/** The pull for an arc covering `d` radians of the ring, which is what makes a
   loop a loop rather than a spike.
   @param {number} d
   @returns {number} */
export function pull(d) {
  const k = Math.min(Math.abs(d), Math.PI) / Math.PI;
  return PULL_NEAR + (PULL_FAR - PULL_NEAR) * k;
}

/* One arc, as a filled path: along the ring for the source's slot, across to
   the target, along the ring for the target's tapered slot, and back. Both
   ring runs are walked clockwise and both crossings bowed to the centre, which
   keeps the boundary from folding over itself at any pair of slots. Canvas
   angles run clockwise from +x with y growing down, so a maths angle t is
   canvas angle -t and a run from hi down to lo is -hi increasing to -lo. */
/** @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} g
   @param {number} cx @param {number} cy @param {number} r @param {Edge} e */
export function ribbon(g, cx, cy, r, e) {
  const bm = (e.b0 + e.b1) / 2,
    bh = ((e.b0 - e.b1) / 2) * TAPER;
  const t0 = bm + bh,
    t1 = bm - bh;
  const p = pull(e.a1 - t0);
  /** @type {(ang: number, at?: number) => [number, number]} */
  const pt = (ang, at = r) => [cx + Math.cos(ang) * at, cy - Math.sin(ang) * at];
  const [x0, y0] = pt(e.a0);
  const [x1, y1] = pt(e.a1);
  const [u0, v0] = pt(t0);
  const [u1, v1] = pt(t1);
  g.beginPath();
  g.moveTo(x0, y0);
  g.arc(cx, cy, r, -e.a0, -e.a1, false);
  bow(g, cx, cy, x1, y1, u0, v0, p);
  g.arc(cx, cy, r, -t0, -t1, false);
  bow(g, cx, cy, u1, v1, x0, y0, p);
  g.closePath();
}

/** The arc whose end `t` turns clockwise from the top lands on, and -1 for the
   gaps between letters, which belong to nobody. The slots are strictly
   increasing by construction, so this is one binary search.
   @param {Graph} L
   @param {number} t
   @returns {number} an index into `L.slotEdge`, not into `L.edges` */
export function at(L, t) {
  const { turn, upto } = L;
  let lo = 0,
    hi = turn.length - 1,
    k = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (turn[m] <= t) {
      k = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return k >= 0 && t <= upto[k] ? k : -1;
}

/* Whether `t` turns clockwise from the top could be on arc `e` at all: the
 * cheap half of the interior hit test, refusing most arcs for two comparisons
 * before a path is built. It is a prune rather than an answer, and it owes
 * never refusing a point that is on the arc — what tools/check_web.mjs holds
 * it to by walking each ribbon's own boundary. */
/** @param {Edge} e @param {number} t @returns {boolean} */
export function near(e, t) {
  if (e.wide) return true;
  return e.t0 <= e.t1 ? t >= e.t0 && t <= e.t1 : t >= e.t0 || t <= e.t1;
}

/** The letter whose arc `t` falls in, for the band outside the ring. Linear
   over 26, which is cheaper than a search.
   @param {Graph} L
   @param {number} t
   @returns {number} */
export function letterAt(L, t) {
  for (const arc of L.arcs) {
    const from = Math.PI / 2 - arc.from,
      to = Math.PI / 2 - arc.to;
    if (t >= from && t <= to) return arc.letter;
  }
  return -1;
}
