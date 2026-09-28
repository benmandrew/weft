/* The words under any synset of <hypernym-disc>'s tree, derived from the one
 * table tools/export_table.py writes. No DOM here.
 *
 * The 37 category files are lists chosen by name. This answers for any node
 * instead, and answers what lexicon.members would: every filter it applies is
 * a fact about one (word, synset) pair or a sum over the pairs inside the
 * category, so the table ships the pairs and this does the sums. The pairs are
 * grouped by synset in the tree's preorder, which keeps a subtree's pairs in
 * one contiguous run.
 *
 *   const t = await table("wordnet-words.json", disc.data.par, disc.data.names);
 *   t.words(disc.index)   // {words: ["cat", …], zipf: [4.7, …], spell: [5120, …]}
 *
 * A page holding three word elements that follow one disc asks three times for
 * the same node, so the file is fetched and decoded once per page and each
 * node's answer is kept for the next asker.
 */

import { spelling } from "./word-layout.js";

export const MEMBER = 1,
  EARLY = 2,
  LABEL = 4;
const FORMAT = 1;
// Answers kept per table. A reader zooming in and back out asks for the same
// few nodes, and a list is at most 40,000 strings, so a handful is plenty.
const KEEP = 12;

/** What export_table.py writes, as JSON.
   @typedef {object} TableJson
   @property {number} format
   @property {number} nodes
   @property {number} tree
   @property {Selection} selection
   @property {[number, number][]} zipf
   @property {number[]} tagged
   @property {number[]} head
   @property {number[]} word
   @property {number[]} flag
   @property {number[]} count
   @property {number[]} extra
   @property {string[]} text
   @property {Record<string, {at: number[], extra?: string[]}>} categories */
/** The `[selection]` settings the table was written under. `max_rank` and
   `multiword` are already applied; the rest are applied here.
   @typedef {{min_zipf: number, min_dominance: number, max_rank: number,
     min_depth: number, target: number, zipf_floor: number, multiword: boolean}} Selection */
/** `spell` is each word's place in the table's alphabetical order, which is
   what word-layout.js sorts by in place of the strings.
   @typedef {{words: string[], zipf: number[], spell: Int32Array}} Derived */
/** A synset's label by index: the disc's own array, or a disc-lines.js Lines,
   which both answer `at`.
   @typedef {{length: number, at(i: number): string | undefined}} Names */

export class WordTable {
  /** @type {Selection} */ selection;
  #n = 0;
  #par;
  #names;
  // Where each subtree ends: the preorder puts node i's descendants at
  // i + 1 up to end[i].
  #end;
  // Per word: the tagged count over all its senses, its Zipf in hundredths,
  // the synset whose label spells it (or -1), and its text where none does.
  #tagged;
  #centi;
  #labelAt;
  /** @type {(string | undefined)[]} */ #own;
  // Per pair, grouped by synset: pairs of synset i are start[i] to start[i+1].
  #start;
  #word;
  #flag;
  #count;
  // The hypernyms the tree dropped, as child and parent, sorted by parent.
  #xChild;
  #xParent;
  // Scratch, sized once and cleared by what each call touched.
  #inside;
  #seen;
  #matched;
  /** @type {Int32Array | null} */ #kids = null;
  /** @type {Int32Array | null} */ #kidStart = null;
  /** @type {Map<string, Derived>} */ #kept = new Map();
  // Every word's place in alphabetical order, from one sort of all of them on
  // the first answer. Shipped in the file instead, it would be a list with no
  // order to compress: 99 KiB gzipped against the table's 279, to save 9 ms
  // once per page.
  /** @type {Int32Array | null} */ #spell = null;

  /** @param {TableJson} t @param {ArrayLike<number>} par @param {Names} names */
  constructor(t, par, names) {
    if (t?.format !== FORMAT) throw new Error(`word table format ${t?.format}, not ${FORMAT}`);
    const n = par.length;
    if (t.nodes !== n) throw new Error(`word table covers ${t.nodes} nodes, the tree ${n}`);
    if (names.length !== n) throw new Error(`the tree has ${n} nodes and ${names.length} names`);
    if (t.tree !== fingerprint(par)) throw new Error("word table was written against another tree");
    this.selection = t.selection;
    this.#n = n;
    this.#par = par;
    this.#names = names;

    const depth = new Int32Array(n);
    const end = new Int32Array(n);
    // An open ancestor closes at the first node no deeper than itself.
    const open = new Int32Array(n);
    let top = 0;
    for (let i = 0; i < n; i++) {
      const p = par[i];
      depth[i] = p < 0 ? 0 : depth[p] + 1;
      while (top && depth[open[top - 1]] >= depth[i]) end[open[--top]] = i;
      open[top++] = i;
    }
    while (top) end[open[--top]] = n;
    this.#end = end;

    const words = t.tagged.length;
    this.#tagged = Int32Array.from(t.tagged);
    const centi = new Int16Array(words);
    let w = 0;
    for (const [value, run] of t.zipf) {
      centi.fill(value, w, w + run);
      w += run;
    }
    if (w !== words) throw new Error(`word table Zipf runs cover ${w} of ${words} words`);
    this.#centi = centi;

    const start = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + t.head[i];
    this.#start = start;
    this.#word = Int32Array.from(t.word);
    this.#flag = Uint8Array.from(t.flag);
    this.#count = Int32Array.from(t.count);

    const labelAt = new Int32Array(words).fill(-1);
    for (let i = 0; i < n; i++) {
      for (let p = start[i]; p < start[i + 1]; p++) {
        if (this.#flag[p] & LABEL) labelAt[this.#word[p]] = i;
      }
    }
    this.#labelAt = labelAt;
    this.#own = new Array(words);
    let k = 0;
    for (let v = 0; v < words; v++) if (labelAt[v] < 0) this.#own[v] = t.text[k++];
    if (k !== t.text.length)
      throw new Error(`word table spells ${t.text.length} words, needs ${k}`);

    this.#xChild = Int32Array.from(t.extra.filter((_, i) => i % 2 === 0));
    this.#xParent = Int32Array.from(t.extra.filter((_, i) => i % 2 === 1));

    this.#inside = new Uint8Array(n);
    this.#seen = new Uint8Array(words);
    this.#matched = new Float64Array(words);
  }

  /** How many words the table holds. */
  get size() {
    return this.#tagged.length;
  }

  /** The text of word `w`, spelt from the disc's label where one spells it.
     @param {number} w */
  text(w) {
    const at = this.#labelAt[w];
    if (at < 0) return /** @type {string} */ (this.#own[w]);
    return String(this.#names.at(at)).toLowerCase();
  }

  /** The words below one node, or below several taken together, commonest
     first, which is what lexicon.members answers for a category rooted there.
     @param {number | number[]} roots @returns {Derived} */
  words(roots) {
    const list = (Array.isArray(roots) ? roots : [roots]).filter(r => r >= 0 && r < this.#n);
    const key = list.join(",");
    const hit = this.#kept.get(key);
    if (hit) {
      // Moved to the back, so the oldest answer is the one dropped.
      this.#kept.delete(key);
      this.#kept.set(key, hit);
      return hit;
    }
    const ids = this.ids(list);
    if (!this.#spell)
      this.#spell = spelling(Array.from({ length: this.size }, (_, w) => this.text(w)));
    const spell = this.#spell;
    const out = {
      words: Array.from(ids, w => this.text(w)),
      zipf: Array.from(ids, w => this.#centi[w] / 100),
      spell: Int32Array.from(ids, w => spell[w]),
    };
    this.#kept.set(key, out);
    if (this.#kept.size > KEEP)
      this.#kept.delete(/** @type {string} */ (this.#kept.keys().next().value));
    return out;
  }

  /** The same answer as word numbers, which sort commonest first.
     @param {number[]} roots @returns {Int32Array} */
  ids(roots) {
    const sel = this.selection;
    const inside = this.#inside;
    const end = this.#end;
    /** @type {number[]} */
    const nodes = [];
    // A subtree is one run of indices, so taking one in is a loop, and a node
    // taken in already is skipped so no pair is counted twice.
    const take = (/** @type {number} */ r) => {
      for (let i = r; i < end[r]; i++) {
        if (!inside[i]) {
          inside[i] = 1;
          nodes.push(i);
        }
      }
    };
    for (const r of roots) take(r);
    // The dropped hypernyms: a synset whose second parent is inside is inside
    // too, and with it everything under it, which can bring in more. The edges
    // are few, so this repeats over all of them until a pass adds nothing.
    for (let grew = true; grew; ) {
      grew = false;
      for (let e = 0; e < this.#xChild.length; e++) {
        if (inside[this.#xParent[e]] && !inside[this.#xChild[e]]) {
          take(this.#xChild[e]);
          grew = true;
        }
      }
    }
    const shallow = this.#shallow(roots, sel.min_depth);

    const seen = this.#seen;
    const matched = this.#matched;
    /** @type {number[]} */
    const touched = [];
    // Per word: bit 1, a synset inside holds it; bit 2, one of its first
    // senses is inside. Kept in `seen` above the bit that marks it touched.
    for (const i of nodes) {
      if (shallow.has(i)) continue;
      for (let p = this.#start[i]; p < this.#start[i + 1]; p++) {
        const w = this.#word[p];
        if (!seen[w]) {
          seen[w] = 8;
          touched.push(w);
        }
        seen[w] |= this.#flag[p] & (MEMBER | EARLY);
        matched[w] += this.#count[p];
      }
    }
    for (const i of nodes) inside[i] = 0;

    // lexicon._in_category, then _resolve's two Zipf cuts.
    const floor = Math.min(sel.zipf_floor, sel.min_zipf);
    /** @type {number[]} */
    const passed = [];
    for (const w of touched) {
      const bits = seen[w];
      const total = this.#tagged[w];
      const fits = total ? matched[w] / total >= sel.min_dominance : bits & EARLY;
      if (bits & MEMBER && fits && this.#centi[w] / 100 >= floor) passed.push(w);
      seen[w] = 0;
      matched[w] = 0;
    }
    passed.sort((a, b) => a - b);
    const common = passed.filter(w => this.#centi[w] / 100 >= sel.min_zipf);
    return Int32Array.from(common.length >= sel.target ? common : passed.slice(0, sel.target));
  }

  /** The nodes fewer than `depth` hops below the roots, counting every
     hypernym rather than the tree's first alone, as lexicon._closure counts.
     Those are left out of the category: at depth zero sit the roots, whose
     lemmas are the category's own name.
     @param {number[]} roots @param {number} depth @returns {Set<number>} */
  #shallow(roots, depth) {
    const out = new Set();
    if (depth <= 0) return out;
    for (const r of roots) out.add(r);
    if (depth === 1) return out;
    const kids = this.#children();
    let frontier = [...out];
    for (let d = 1; d < depth && frontier.length; d++) {
      /** @type {number[]} */
      const next = [];
      for (const i of frontier) {
        for (let k = kids.start[i]; k < kids.start[i + 1]; k++) {
          const c = kids.list[k];
          if (!out.has(c)) {
            out.add(c);
            next.push(c);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Every node's children, the dropped hypernyms' included, built the first
     time a `min_depth` above one asks. */
  #children() {
    if (!this.#kids || !this.#kidStart) {
      const n = this.#n;
      const start = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) if (this.#par[i] >= 0) start[this.#par[i] + 1]++;
      for (const p of this.#xParent) start[p + 1]++;
      for (let i = 0; i < n; i++) start[i + 1] += start[i];
      const at = start.slice(0, n);
      const list = new Int32Array(start[n]);
      for (let i = 0; i < n; i++) if (this.#par[i] >= 0) list[at[this.#par[i]]++] = i;
      for (let e = 0; e < this.#xChild.length; e++) list[at[this.#xParent[e]]++] = this.#xChild[e];
      this.#kids = list;
      this.#kidStart = start;
    }
    return { list: this.#kids, start: this.#kidStart };
  }
}

/** export_table.py's fingerprint: 32-bit FNV-1a over the parent indices, each
   offset by one. The two exports are positional, so a table written against
   another tree would answer with plausible words from the wrong nodes.
   @param {ArrayLike<number>} par */
export function fingerprint(par) {
  let h = 0x811c9dc5;
  for (let i = 0; i < par.length; i++) h = Math.imul(h ^ (par[i] + 1), 0x01000193);
  return h >>> 0;
}

/** @type {Map<string, Promise<TableJson>>} */
const FILES = new Map();
/** @type {WeakMap<TableJson, WeakMap<object, WordTable>>} */
const BUILT = new WeakMap();

/** The table at `src` over this tree, fetched once per page however many
   elements ask, and decoded once per tree.
   @param {string} src @param {ArrayLike<number>} par @param {Names} names
   @returns {Promise<WordTable>} */
export async function table(src, par, names) {
  let file = FILES.get(src);
  if (!file) {
    file = fetch(src).then(r => {
      if (!r.ok) throw new Error(`${r.status} for ${src}`);
      return r.json();
    });
    // A failure is not kept, so the next ask tries again.
    file.catch(() => FILES.delete(src));
    FILES.set(src, file);
  }
  const t = await file;
  let byTree = BUILT.get(t);
  if (!byTree) {
    byTree = new WeakMap();
    BUILT.set(t, byTree);
  }
  let built = byTree.get(par);
  if (!built) {
    built = new WordTable(t, par, names);
    byTree.set(par, built);
  }
  return built;
}
