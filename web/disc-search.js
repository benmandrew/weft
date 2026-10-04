/* Ranked name lookup for <hypernym-disc>.
 *
 * No DOM in here, so the element wires it to an input and tools/check_web.mjs
 * runs it on its own, the same split as disc-paint.js.
 *
 * A query is one pass over every name, scoring each and keeping the best few,
 * behind a filter that skips most of them without touching the string. Every
 * band below, the subsequence one included, needs every character of the query
 * to appear somewhere in the name, so a bitmask of which characters a name
 * holds rules it out in one AND. That is the prune an ordering cannot give: a
 * sorted index answers a prefix in log time and still reads all 82,115 names
 * for a subsequence match, where the mask throws most of them out for any query
 * of two characters or more.
 *
 * The masks and the lowercased copy are built together on the first query, and
 * every query after that is the AND, then `score` on what survives.
 *
 * Bands sit 1,000 apart and every penalty is capped below that, so a weaker
 * kind of match can never outrank a stronger one however long the name:
 *
 *   the whole name · from its start · from a word in it · anywhere in it ·
 *   its letters in order
 *
 * The last band is the fuzzy one: "wtrfl" reaches "waterfowl". It is scored
 * last and penalised by how far apart the letters fell, so a query that matches
 * something outright never surfaces a scattered match above it.
 */

const EXACT = 5000,
  PREFIX = 4000,
  WORD = 3000,
  INSIDE = 2000,
  ORDER = 1000;
const SPACE = 32;
// Where a character lands in a name's mask: a to z take a bit each, a space
// takes its own, since a multiword query is common and a space is not in most
// names, and every other character shares the last bit.
const LOW_A = 97,
  LOW_Z = 122,
  SPACE_BIT = 26,
  OTHER_BIT = 27;

/** One hit: the name's index, the name itself and the band it scored in.
   @typedef {{i: number, name: string, score: number}} Hit */

/** The characters `s` holds, as bits. A name can match a query only if its mask
   holds every bit the query's does, whichever band would score it.
   @param {string} s
   @returns {number} */
function mask(s) {
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    m |= 1 << (c >= LOW_A && c <= LOW_Z ? c - LOW_A : c === SPACE ? SPACE_BIT : OTHER_BIT);
  }
  return m;
}

/** 0 for no match. Every branch stays under its band: the length penalty caps at
   500 and the position penalty at 400, so the two together cannot reach 1,000.
   @param {string} s a lowercased name
   @param {string} q the lowercased query
   @returns {number} */
function score(s, q) {
  const n = q.length;
  if (s.length < n) return 0;
  if (s === q) return EXACT;
  const at = s.indexOf(q);
  if (at === 0) return PREFIX - Math.min(s.length, 500);
  if (at > 0) {
    const band = s.charCodeAt(at - 1) === SPACE ? WORD : INSIDE;
    return band - Math.min(s.length, 500) - Math.min(at, 400);
  }
  // Greedy from the first letter that matches, which is not the tightest run
  // through the name but costs one pass rather than a search.
  let k = 0,
    from = -1,
    j = 0;
  for (; j < s.length && k < n; j++) {
    if (s.charCodeAt(j) === q.charCodeAt(k)) {
      if (k === 0) from = j;
      k++;
    }
  }
  if (k < n) return 0;
  return ORDER - Math.min(j - from - n, 500) - Math.min(s.length, 400);
}

/** Best-first, at most `limit`, by insertion: the list is short enough that
   walking it beats sorting the whole run of hits at the end.
   @param {Hit[]} out
   @param {Hit} hit
   @param {number} limit */
function place(out, hit, limit) {
  let k = out.length;
  while (k > 0 && out[k - 1].score < hit.score) k--;
  if (k >= limit) return;
  out.splice(k, 0, hit);
  if (out.length > limit) out.pop();
}

export class Search {
  /** @type {string[]} */
  #names = [];
  /** @type {string[]} */
  #lower = [];
  /** @type {Int32Array} */
  #mask = new Int32Array(0);

  /** @param {Iterable<string>} names */
  constructor(names) {
    this.index(names);
  }

  /** @param {Iterable<string>} names */
  index(names) {
    this.#names = Array.from(names);
    this.#lower = this.#names.map(s => s.toLowerCase());
    // A second pass, over strings the first has just left in cache, which is
    // why it costs nothing measurable.
    this.#mask = new Int32Array(this.#lower.length);
    for (let i = 0; i < this.#lower.length; i++) this.#mask[i] = mask(this.#lower[i]);
  }

  /** Best first. An empty or all-space query matches nothing, since every name
     would score and the order would mean nothing.
     @param {string} text
     @param {number} limit
     @returns {Hit[]} */
  query(text, limit = 12) {
    const q = text.trim().toLowerCase();
    /** @type {Hit[]} */
    const out = [];
    if (!q || limit < 1) return out;
    const low = this.#lower,
      msk = this.#mask,
      qm = mask(q);
    let worst = 0;
    for (let i = 0; i < low.length; i++) {
      if ((msk[i] & qm) !== qm) continue;
      const sc = score(low[i], q);
      if (sc <= 0 || (out.length === limit && sc <= worst)) continue;
      place(out, { i, name: this.#names[i], score: sc }, limit);
      worst = out[out.length - 1].score;
    }
    return out;
  }
}

// How far PageDown and PageUp move through a list.
export const PAGE_STEP = 10;

/** Where a key moves the active row of an `n`-row list from row `at`, -1 being
   none. Null for a key that moves nothing, so the caller leaves it alone. The
   first arrow press lands on the first row, whichever way it points, since a
   list just reached by the keyboard has no row to move from. It stops at the
   ends rather than wrapping, since a column several hundred rows long that
   wraps reads as one that started again. Shared by both elements' columns, so
   they answer the same keys the same way.
   @param {string} key
   @param {number} at
   @param {number} n
   @returns {number | null} */
export function step(key, at, n) {
  if (n < 1) return null;
  const last = n - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (at < 0) return /^(Arrow|Page)/.test(key) ? 0 : null;
  if (key === "ArrowDown" || key === "ArrowRight") return Math.min(last, at + 1);
  if (key === "ArrowUp" || key === "ArrowLeft") return Math.max(0, at - 1);
  if (key === "PageDown") return Math.min(last, at + PAGE_STEP);
  if (key === "PageUp") return Math.max(0, at - PAGE_STEP);
  return null;
}
