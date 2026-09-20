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
 * The ring is no help here. A chord diagram says which letters a word runs
 * between; this says which letter's overflow paid for which letter's shortfall,
 * which is a different question and has two sides rather than one circle.
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
   and backwards on a pair it recovers a word from, which is what lets a later
   path undo part of an earlier one for less than it would cost to start again.
   So a forward step reads head to tail and a reverse step tail to head, and the
   two ends of the walk are the augmentation's own `from` and `to`.
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

/** The units of imbalance the first `k` augmentations have cleared.
   @param {{push: number}[]} frames @param {number} k @returns {number} */
export function shipped(frames, k) {
  let done = 0;
  const end = Math.max(0, Math.min(k, frames.length));
  for (let i = 0; i < end; i++) done += frames[i].push;
  return done;
}

/* What a stack of bands is drawn at. Ink accumulates where they cross, so a
   category with four times the augmentations floods the middle of the picture;
   this is letter-graph.js's `fade` in the same shape, over the bands rather than
   over the pairs. animal's 144 augmentations come out at 0.26 against
   furniture's 36 at the full 0.5.

   FALL is a guess, as `FALL` in word-bundle.js and `ALPHA_FALL` in
   letter-graph.js are: there is no browser here to look in, and `make serve` is
   where to find out. */
export const ALPHA = 0.5,
  KNEE = 40,
  FALL = 0.5;

/** @param {number} alpha @param {number} n @returns {number} */
export function thin(alpha, n) {
  return n <= KNEE ? alpha : alpha * (KNEE / n) ** FALL;
}
