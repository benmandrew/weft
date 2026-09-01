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

/* The characters `s` holds, as bits. A name can match a query only if its mask
   holds every bit the query's does, whichever band would score it. */
function mask(s) {
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    m |= 1 << (c >= LOW_A && c <= LOW_Z ? c - LOW_A : c === SPACE ? SPACE_BIT : OTHER_BIT);
  }
  return m;
}

/* 0 for no match. Every branch stays under its band: the length penalty caps at
   500 and the position penalty at 400, so the two together cannot reach 1,000. */
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

/* Best-first, at most `limit`, by insertion: the list is short enough that
   walking it beats sorting the whole run of hits at the end. */
function place(out, hit, limit) {
  let k = out.length;
  while (k > 0 && out[k - 1].score < hit.score) k--;
  if (k >= limit) return;
  out.splice(k, 0, hit);
  if (out.length > limit) out.pop();
}

export class Search {
  #names = [];
  #lower = [];
  #mask = new Int32Array(0);

  constructor(names) {
    this.index(names);
  }

  index(names) {
    this.#names = Array.from(names);
    this.#lower = this.#names.map(s => s.toLowerCase());
    // A second pass, over strings the first has just left in cache, which is
    // why it costs nothing measurable.
    this.#mask = new Int32Array(this.#lower.length);
    for (let i = 0; i < this.#lower.length; i++) this.#mask[i] = mask(this.#lower[i]);
  }

  /* [{i, name, score}], best first. An empty or all-space query matches
     nothing, since every name would score and the order would mean nothing. */
  query(text, limit = 12) {
    const q = text.trim().toLowerCase();
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
