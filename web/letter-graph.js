/* Where <letter-disc> puts a letter and an arc, with no DOM in it.
 *
 * This is graph.py's claim drawn rather than printed. A word runs from its
 * first letter to its last, so every word is a directed edge between two of 26
 * letters and the whole game lives on a 26-node graph however large the
 * vocabulary gets. <word-disc> draws the line graph of that one — a node per
 * word, 96,470 chords for animal — and this draws the small graph underneath
 * it: 26 nodes and at most 676 arcs, one per letter pair some word bridges.
 *
 * Measured over the 37 categories, animal is the worst at 344 populated pairs,
 * with weights from 1 to 32 and 103 of the 344 at weight 1; 12 of its arcs run
 * a letter back to itself, holding 52 words between them.
 *
 * That is why nothing here is bundled. Bundling buys clutter reduction and
 * pays in traceability, and at 344 every arc is a thing to point at and read a
 * count off, where a merged one is nothing at all — the right tool at
 * <word-disc>'s 96,470 equal chords and the wrong one here. What declutters at
 * this scale is the log weight, the split arcs and the hover.
 *
 * Everything a sizing or an ordering decides lives here rather than in the
 * element, for the reason word-layout.js's `solve` does: an arc that comes
 * back at a negative width draws nothing and the element cannot tell, where
 * tools/check_web.mjs can.
 *
 *   const m = matrix(["cat", "toad"]);
 *   const L = layout(m);
 *   L.edges[at(L, turn)]      // the arc under the pointer
 */
import { bow, TAU } from "./disc-colour.js";

const A = "a".charCodeAt(0);
export const LETTERS = 26;

/* The gap between two letters' arcs.
 *
 * 1.2° rather than <word-disc>'s 3.5°, because 26 gaps there cost a quarter of
 * the circle and the arcs there carry nothing: a wedge is a bag of dots and
 * the gap is the only thing separating one from the next. Here the arc is the
 * measurement — its width is the letter's traffic — so the gaps are held to
 * 31° of the 360 and the arcs get the rest.
 *
 * There is deliberately no floor under an arc. One would stop a quiet letter
 * being a sliver, and it would cost the whole reason the arcs are proportional
 * at all: a floor is a fixed amount plus a share, so a unit of weight would be
 * worth more degrees in a quiet letter than in a busy one, and a ribbon
 * between the two would say two different counts at its two ends. What it
 * buys is small — over the 37 categories the quietest letter is plant's at
 * 0.61° of the ring, 3 px at a 300 px radius, and animal's is 1.14°. The
 * label is what goes there rather than the arc growing, and the ring band
 * still gives a pointer 10 px of depth on it. */
export const GAP = (1.2 * Math.PI) / 180;

/* What an arc's width means. The count spans 1 to 32 on animal and 1 to 45 on
   food, with a third of the arcs at 1, so drawn linearly the singletons are a
   thirtieth of the trunk and disappear: log1p takes that ratio to 5 to 1 and
   leaves every arc a width it can be seen at. log1p rather than log because
   log(1) is 0 and an arc of no width is an arc that was not drawn. */
export const weight = n => Math.log1p(n);

/* The 26 by 26 count, and the two margins of it. Indexed [head * 26 + tail],
   which is letter_matrix in graph.py written a second time — and the whole of
   what the element needs out of a category, so it reads the same
   words-<category>.json <word-disc> does and there is nothing new to export.

   `starts[L]` is the words leaving L and `ends[L]` the words arriving at it,
   which are graph.py's supply and demand under names that describe the picture
   rather than the game. */
export function matrix(words) {
  const count = new Int32Array(LETTERS * LETTERS);
  const starts = new Int32Array(LETTERS),
    ends = new Int32Array(LETTERS);
  let n = 0;
  for (const word of words) {
    if (!word) continue;
    const h = word.charCodeAt(0) - A,
      t = word.charCodeAt(word.length - 1) - A;
    // A word outside a to z is no edge of this graph. The exporter writes
    // lower-case lemmas and multiword entries chain on their outer letters, so
    // this is a guard against a host handing in its own list rather than a
    // case any category reaches.
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
   from its own. word-layout.js's `_fan_key`, and here for the same reason: the
   letters sit in a ring in alphabetical order, so ordering a letter's arcs by
   the destination alone starts every one of them at A and sends the fan back
   across itself. Rotating the alphabet to begin just before the letter's own
   puts them in the order the ring visits them. */
export function fanKey(from, to) {
  return (from - to - 1 + LETTERS) % LETTERS;
}

/* The whole layout in one pass over the matrix.
 *
 * A letter's arc is the sum of the log weights of every arc that touches it,
 * so a unit of weight is the same number of degrees at both ends of a ribbon
 * and its width means one thing wherever it is read. Equal arcs would not: a
 * quiet letter's arcs would be fat and a busy letter's thin, and every ribbon
 * between the two would be a trapezoid saying two different counts.
 *
 * That arc is then split, the leaving half first as the ring is read clockwise
 * and the arriving half after it, each taking its own share of the letter's
 * weight. So an arc's direction is in the geometry rather than in an arrowhead
 * — it leaves the bright half of one letter and lands in the dim half of
 * another — and the split point says at a glance whether a letter is somewhere
 * play sets out from or somewhere it arrives.
 *
 * Angles are the maths convention, anticlockwise from the +x axis, running
 * down from the top because the ring is read clockwise the way a dial is. A
 * caller turns one into a point with `Math.cos(ang)` and, since canvas y grows
 * downward, `-Math.sin(ang)`. Every slot is [hi, lo] with hi above lo, which
 * is what lets `ribbon` walk a boundary in one rotational direction. */
export function layout(m) {
  const { count, starts, ends } = m;
  // The weight each letter carries, out and in, which is what sizes its arc.
  const outW = new Float64Array(LETTERS),
    inW = new Float64Array(LETTERS);
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

  const live = [];
  for (let L = 0; L < LETTERS; L++) if (outW[L] + inW[L] > 0) live.push(L);

  /* Shared out by weight and by nothing else, so one unit of weight is the
     same number of degrees everywhere on the ring. That is what makes a
     ribbon the same width at both of its ends and its width mean one thing
     wherever it is read. A category with no words at all lays nothing out
     rather than dividing by zero. */
  const room = TAU - GAP * live.length;
  const total = live.reduce((s, L) => s + outW[L] + inW[L], 0);
  const width = L => (total > 0 ? (room * (outW[L] + inW[L])) / total : 0);

  const arcs = [];
  const arcOf = new Int32Array(LETTERS).fill(-1);
  let a = Math.PI / 2;
  for (const L of live) {
    const span = width(L);
    const from = a;
    // The split, which is the two halves' own shares of the letter's weight. A
    // letter that only ever ends words has no leaving half at all, and its
    // arc is its arriving one.
    const carries = outW[L] + inW[L];
    const split = from - span * (carries > 0 ? outW[L] / carries : 0.5);
    arcOf[L] = arcs.length;
    arcs.push({ letter: L, from, to: from - span, mid: from - span / 2, split, span });
    a = from - span - GAP;
  }

  /* Each end takes its share of its own half, in the order the ring visits the
     letter at the other end. The leaving ends run one way round the alphabet
     and the arriving ends the other, so a pair of letters trading arcs both
     ways puts the two ribbons side by side rather than crossing them. */
  const byLetter = Array.from({ length: LETTERS }, () => []);
  const out = Array.from({ length: LETTERS }, () => []);
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
    // Both halves come off the arc rather than being carried alongside it, so
    // there is one statement of where the split is and the ends cannot be laid
    // out against a different one from the band that is drawn.
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
     every arc leaving Z over every arc leaving A, which is the bias
     word-bundle.js cuts into bands to escape — there because 96,470 equal
     chords have no order that deserves the top, and not here, because a
     ranking by weight is the one thing these 344 do have. */
  const order = edges.map((_, k) => k).sort((x, y) => edges[x].w - edges[y].w);

  /* Every end, in one increasing sequence of turns clockwise from the top,
     which is what lets the hit test be a binary search rather than a spatial
     index — the same argument both discs already make. Slots tile each half of
     each arc exactly, so the taper the ribbon is drawn with leaves no dead
     ground: a pointer anywhere in an end's slot is on that arc. */
  /* The wedge each arc is confined to, in turns clockwise from the top, so a
     point inside the ring can be refused without asking the path about it.

     Every point of a ribbon lies in the convex hull of its four ring points
     and their control points, and the control points sit on the rays to the
     ring points, so the hull is inside the wedge those four turns span — as
     long as that wedge is under half a turn, since a hull of points spread
     wider than that reaches the centre and the wedge stops saying anything.
     Those arcs are marked `wide` and nothing is pruned for them.

     The wedge is the complement of the largest gap between the four, which is
     what finds it whether or not it straddles the top of the ring. Computed
     once here rather than per pointer event, since it is fixed geometry. */
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
   same job — what the name in the middle has to fit inside — and the two
   elements sit on a page together. */
export const HUB_SHARE = 0.45,
  HUB_MIN = 66,
  HUB_MAX = 0.55;

/* Everything the disc measures, off the square the host left it.
 *
 * Simpler than word-layout.js's `solve`, because the labels are 26 single
 * letters rather than a category's words: nothing here has to be solved
 * against a label's length. What it still owes is a disc that stays inside its
 * own square and comes back positive at any size, which is the part nothing
 * downstream tests for. */
export function solve(size) {
  const half = Math.max(size / 2 - PAD, 1);
  const want = Math.min(Math.max(half * 0.05, MIN_LABEL_PX), MAX_LABEL_PX);
  /* What is left for the ring once the letters outside it are given their
     room. A frame too small for them keeps its disc and loses them, which is
     the trade <word-disc> makes at its own label floor: below it the labels go
     and the hub names what the pointer is on instead. */
  const labels = half - want * LABEL_BAND >= half * 0.55;
  const room = Math.max(labels ? half - want * LABEL_BAND : half, 1);
  /* The band is drawn centred on the ring, so half of it sits outside and the
     radius has to come off that rather than off `room` itself — which is the
     1.2 px this used to put outside its own square. Solved for the unclamped
     band and then taken off whatever the clamp allowed, so `outer` lands on
     `half` exactly either way. */
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
   the range, and the target end's share of its own slot.
 *
 * A fixed pull is what <word-disc> uses and it is wrong here. There a chord
 * joins two of 1,582 dots and the ones worth seeing are long. Here a third of
 * the arcs are short — 31% of animal's 344 cover less than a third of the
 * turn, and 12 of them run a letter back to itself — and drawn at a long
 * chord's pull every one is a spike pointing at the middle. So the pull runs
 * with the turn the arc covers: half the circle dives nearly to the centre,
 * and a loop hugs the ring it leaves.
 *
 * The taper is the second thing saying which way an arc runs, after the split
 * arcs themselves. It costs the target end nothing that can be read — the
 * count is the width at the source, which is where the eye starts. */
export const PULL_FAR = 0.14,
  PULL_NEAR = 0.82,
  TAPER = 0.45;

/* The resting fill, and the pair count past which it is thinned.

   A ribbon is filled rather than stroked, so the alpha accumulates wherever
   two of them overlap and the middle of the disc — where every long arc is
   bowed through — is where they all do. animal draws 344 arcs into the same
   ring that colour draws 67 into, so an alpha that reads as a picture on one
   floods on the other. The knee sits just above the largest category that
   never needed thinning and the falloff is a square root, which is
   word-bundle.js's `thin` written for a fill rather than a stroke and tuned on
   the same argument: holding ink per pixel level wants 1/pairs and rubs the
   picture out, and leaving it flat is what floods.

   Here rather than in the element for the reason `solve` is: an alpha that
   comes back at zero draws nothing and one above the tuned value draws more
   ink than the value was tuned at, and the element could notice neither. */
export const ALPHA = 0.5,
  ALPHA_KNEE = 120,
  ALPHA_FALL = 0.5;

export function fade(alpha, pairs) {
  if (pairs <= ALPHA_KNEE) return alpha;
  return alpha * (ALPHA_KNEE / pairs) ** ALPHA_FALL;
}

/* The pull for an arc covering `d` radians of the ring, which is what makes a
   loop a loop rather than a spike. */
export function pull(d) {
  const k = Math.min(Math.abs(d), Math.PI) / Math.PI;
  return PULL_NEAR + (PULL_FAR - PULL_NEAR) * k;
}

/* One arc, as a filled path: along the ring for the source's slot, across to
   the target, along the ring for the target's tapered slot, and back. Both
   ring runs are walked clockwise and both crossings are bowed to the centre,
   which is what keeps the boundary from folding over itself at any pair of
   slots — including a letter's arc to itself, where the two slots sit in the
   same letter's two halves.
 *
 * Canvas angles run clockwise from +x with y growing down, so a maths angle t
 * is canvas angle -t and a run from hi down to lo is -hi increasing to -lo. */
export function ribbon(g, cx, cy, r, e) {
  const bm = (e.b0 + e.b1) / 2,
    bh = ((e.b0 - e.b1) / 2) * TAPER;
  const t0 = bm + bh,
    t1 = bm - bh;
  const p = pull(e.a1 - t0);
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

/* The arc whose end `t` turns clockwise from the top lands on, and -1 for the
   gaps between letters, which belong to nobody. The slots are strictly
   increasing by construction, so this is one binary search — the same absence
   of a spatial index both other discs have. */
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

/* Whether `t` turns clockwise from the top could be on arc `e` at all.
 *
 * The cheap half of the interior hit test: inside the ring an arc is a curved
 * shape no arithmetic short of the path describes, so the path itself has to
 * be asked, and asking it about all 344 of them on every pointer event is the
 * cost this avoids. A turn outside the arc's own wedge cannot be on it, which
 * refuses three quarters of them for the price of two comparisons — over 720
 * turns of animal's ring, 85 of 344 survive on average, 79 of 321 on food and
 * 15 of 67 on colour. Every arc those categories draw is narrow enough to be
 * pruned at all, food's widest excepted.
 *
 * It is a prune rather than an answer: it never refuses a point that is on the
 * arc, which is what tools/check_web.mjs holds it to by walking each ribbon's
 * own boundary — the same claim disc-search.js's character mask is held to. */
export function near(e, t) {
  if (e.wide) return true;
  return e.t0 <= e.t1 ? t >= e.t0 && t <= e.t1 : t >= e.t0 || t <= e.t1;
}

/* The letter whose arc `t` falls in, for the band outside the ring where the
   letters are drawn. Linear over 26 at most, which is cheaper than a search. */
export function letterAt(L, t) {
  for (const arc of L.arcs) {
    const from = Math.PI / 2 - arc.from,
      to = Math.PI / 2 - arc.to;
    if (t >= from && t <= to) return arc.letter;
  }
  return -1;
}
