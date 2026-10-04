/* Where the balancing flow's supply banks, and where each augmentation sits in
 * it. No DOM here, so tools/check_web.mjs can hold the geometry to what nothing
 * downstream can notice: a band outside the slot it belongs to, a slot that
 * overruns the span it was given, or a unit of imbalance worth more pixels on
 * one side of the picture than on the other.
 *
 * The transshipment word-longest.js solves has a shape of its own. A letter more
 * words leave than arrive at is a surplus, a letter the other way round is a
 * deficit, and balancing is shipping one to the other until nothing is owed. So
 * the surpluses bank down one side at their excess, the deficits down the other
 * at theirs, and each augmenting path is a band as wide as the words it moves.
 *
 * A chord diagram says which letters a word runs between; this says which
 * letter's overflow paid for which letter's shortfall, a question with two
 * sides, so it is drawn as two columns and no ring.
 */
import { LETTERS } from "./letter-graph.js";

/** One letter's stack in a column: where it opens, how tall it is, and the units
   of imbalance that height stands for.
   @typedef {object} Slot
   @property {number} letter
   @property {number} y0
   @property {number} h
   @property {number} units */

/** Both columns and the scale they share.
   @typedef {object} Bank
   @property {Slot[]} left
   @property {Slot[]} right
   @property {number} scale
   @property {number} need */

/** One augmentation drawn: the slice it takes of the slot it leaves and of the
   slot it reaches, both `h` tall, since a band carries the same words at each
   end.
   @typedef {object} Band
   @property {number} step
   @property {number} from
   @property {number} to
   @property {number} push
   @property {number} a
   @property {number} b
   @property {number} h */

/** The two columns, laid down `span` pixels with `gap` between neighbours.
   One scale for both sides, so a unit of imbalance is the same height wherever
   it is read and a band comes out the same width at both of its ends. The two
   columns always carry the same units — every word that leaves a letter arrives
   at one — so what differs is only how many slots they are cut into, and the
   column with the most of them is the one that fills the span exactly.
   @param {ArrayLike<number>} excess @param {number} span @param {number} gap
   @returns {Bank} */
export function banks(excess, span, gap) {
  /** @type {number[]} */
  const up = [];
  /** @type {number[]} */
  const down = [];
  let need = 0;
  for (let v = 0; v < excess.length; v++) {
    if (excess[v] > 0) {
      up.push(v);
      need += excess[v];
    } else if (excess[v] < 0) down.push(v);
  }
  const rows = Math.max(up.length, down.length);
  const room = Math.max(0, span - gap * Math.max(0, rows - 1));
  const scale = need > 0 ? room / need : 0;
  /** @param {number[]} letters @param {number} sign @returns {Slot[]} */
  const stack = (letters, sign) => {
    /** @type {Slot[]} */
    const out = [];
    let at = 0;
    for (const letter of letters) {
      const units = sign * excess[letter];
      const h = units * scale;
      out.push({ letter, y0: at, h, units });
      at += h + gap;
    }
    return out;
  };
  return { left: stack(up, 1), right: stack(down, -1), scale, need };
}

/** The bands the first `k` augmentations lay down. Each takes the next slice of
   both the slots it runs between, so the bands in a slot tile it in the order
   the solver found them and the last of them ends exactly where the slot does.
   A frame naming a letter with no slot is passed over rather than drawn off the
   end of the picture.
   @param {{from: number, to: number, push: number}[]} frames
   @param {Bank} bank @param {number} k @returns {Band[]} */
export function bands(frames, bank, k) {
  const a = new Float64Array(LETTERS).fill(Number.NaN);
  const b = new Float64Array(LETTERS).fill(Number.NaN);
  for (const slot of bank.left) a[slot.letter] = slot.y0;
  for (const slot of bank.right) b[slot.letter] = slot.y0;
  /** @type {Band[]} */
  const out = [];
  const end = Math.max(0, Math.min(k, frames.length));
  for (let i = 0; i < end; i++) {
    const f = frames[i];
    if (!Number.isFinite(a[f.from]) || !Number.isFinite(b[f.to])) continue;
    const h = f.push * bank.scale;
    out.push({ step: i, from: f.from, to: f.to, push: f.push, a: a[f.from], b: b[f.to], h });
    a[f.from] += h;
    b[f.to] += h;
  }
  return out;
}

/** The letters an augmentation walked, from the surplus it left to the deficit
   it reached. A step is signed: forward on a pair it discards one more word of,
   backwards on a pair it recovers a word from. So a forward step reads head to
   tail and a reverse step tail to head, and the two ends of the walk are the
   augmentation's own `from` and `to`.
   @param {number[]} steps @returns {number[]} */
export function walk(steps) {
  /** @type {number[]} */
  const seq = [];
  for (const s of steps) {
    const cell = (s > 0 ? s : -s) - 1;
    const head = (cell / LETTERS) | 0,
      tail = cell % LETTERS;
    const [a, b] = s > 0 ? [head, tail] : [tail, head];
    if (!seq.length) seq.push(a);
    seq.push(b);
  }
  return seq;
}

/** One point on the line a band walks, in the picture's own pixels, and the
   letter it stands on. The letter is carried rather than worked out again from
   the frame's steps: `route` drops a letter that banks nowhere, so a caller
   counting along `walk`'s sequence would name the wrong letter from the first
   drop onwards.
   @typedef {object} Point
   @property {number} x
   @property {number} y
   @property {number} letter */

/** The line one augmentation's path walks: a point at every letter on the way,
   placed across the span by how many arcs the path has paid for by the time it
   gets there. A reverse step recovers a word an earlier path discarded, so it
   takes that count back down and its leg runs right to left. Direction is the
   only mark a recovery gets, since it costs no ink and reversing paths are the
   thin ones, about 0.96 px tall on animal.

   The two ends stay where `bands` put them, so the tiling is untouched. An
   interior letter is passed through, so the line crosses its slot's middle and
   takes no slice. A path may push more than a letter it passes was owed, so the
   line is not held to the span: 5 points over the 37 categories overhang it,
   the worst by 2.01 px of 426, into the margin the headings sit in. Clamping
   would take the line off the slot's middle, which is what it has to say. A
   letter that banks nowhere, being in neither column, is dropped rather than
   given an invented height.
   @param {{steps: number[], cost: number}} frame @param {Band} band
   @param {Bank} bank @param {number} lx @param {number} rx @param {number} padY
   @returns {Point[]} */
export function route(frame, band, bank, lx, rx, padY) {
  /** @type {Point[]} */
  const out = [{ x: lx, y: padY + band.a, letter: band.from }];
  const n = frame.steps.length;
  if (n > 1 && frame.cost > 0) {
    const seq = walk(frame.steps);
    const centre = new Float64Array(LETTERS).fill(Number.NaN);
    for (const slot of bank.left) centre[slot.letter] = slot.y0 + slot.h / 2;
    for (const slot of bank.right) centre[slot.letter] = slot.y0 + slot.h / 2;
    let paid = 0;
    for (let i = 0; i < n - 1; i++) {
      paid += frame.steps[i] > 0 ? 1 : -1;
      const y = centre[seq[i + 1]];
      if (!Number.isFinite(y)) continue;
      // No path over the 37 categories leaves [0, cost], but one that did would
      // be drawn off the side.
      const t = Math.min(1, Math.max(0, paid / frame.cost));
      out.push({ x: lx + (rx - lx) * t, y: padY + y - band.h / 2, letter: seq[i + 1] });
    }
  }
  out.push({ x: rx, y: padY + band.b, letter: band.to });
  return out;
}

/** The steps the scrub marks: those whose path recovers a word an earlier path
   discarded. A step is the count of augmentations run, so frame `i` is the band
   lit at step `i + 1`, the step that shows the reversing path. They are rare,
   7.7% of augmentations over the 37 categories, so without a mark finding one
   means reading the path line at every step.
   @param {{steps: number[]}[]} frames @returns {number[]} */
export function reverses(frames) {
  /** @type {number[]} */
  const out = [];
  for (const [i, f] of frames.entries()) if (f.steps.some(s => s < 0)) out.push(i + 1);
  return out;
}

/** The units of imbalance the first `k` augmentations have cleared.
   @param {{push: number}[]} frames @param {number} k @returns {number} */
export function shipped(frames, k) {
  let done = 0;
  const end = Math.max(0, Math.min(k, frames.length));
  for (let i = 0; i < end; i++) done += frames[i].push;
  return done;
}

/** What each letter still owes once the first `k` augmentations have run:
   positive for a surplus still to ship, negative for a deficit still to fill,
   and all zero at the end of a run that settled. The text the element gives a
   screen reader in place of the two columns.
   @param {ArrayLike<number>} excess @param {{from: number, to: number, push: number}[]} frames
   @param {number} k @returns {Int32Array} */
export function owing(excess, frames, k) {
  const left = Int32Array.from(excess);
  const end = Math.max(0, Math.min(k, frames.length));
  for (let i = 0; i < end; i++) {
    left[frames[i].from] -= frames[i].push;
    left[frames[i].to] += frames[i].push;
  }
  return left;
}

/* What a stack of bands is drawn at. Ink accumulates where they cross, so a
   category with four times the augmentations floods the middle of the picture.
   This is letter-graph.js's `fade` over the bands, putting animal's 144 at 0.26.

   FALL is a guess, as `FALL` in word-bundle.js and `ALPHA_FALL` in
   letter-graph.js are; `make serve` is where to find out. */
export const ALPHA = 0.5,
  KNEE = 40,
  FALL = 0.5;

/** @param {number} alpha @param {number} n @returns {number} */
export function thin(alpha, n) {
  return n <= KNEE ? alpha : alpha * (KNEE / n) ** FALL;
}
