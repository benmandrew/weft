/* The category picker <word-disc>, <letter-disc> and <balance-flow> share.
 *
 * A host naming an index-src gets a select above the element, one option per
 * category, each opening the word file beside the index. Without the attribute
 * nothing is built. The element owns its words; the picker follows them, so it
 * moves with a src the host set as well as with its own change event.
 *
 * A host also naming `tree`, the id of a <hypernym-disc>, gets one more option
 * ahead of the categories: whatever node that disc is on, as a category of its
 * own. Chosen, the element takes the words below that node from the word table
 * beside the index (word-source.js), and keeps taking them as the reader
 * moves the disc, until another category is chosen. The table is fetched the
 * first time the disc moves or the option is chosen, whichever comes first,
 * and once per page however many pickers follow the same disc.
 */
import { beside, href, label as catLabel } from "./disc-index.js";
import { table } from "./word-source.js";

// The follow option's value. Category names are lowercase words and hyphens,
// so this can never be one.
export const FOLLOW = "#tree";
export const TABLE = "wordnet-words.json";

/** @typedef {{category: string, words: string[], zipf: number[]}} WordData */
/** What the picker asks of the element it sits in.
   @typedef {object} PickerHost
   @property {(src: string) => void} open  load a word file, even the one it holds
   @property {(d: WordData) => void} apply  take a derived word list
   @property {() => boolean} ready  whether it holds any words yet
   @property {() => string} category  the category it holds
   @property {(msg: string) => void} fail  report what went wrong
 */
/** The parts of <hypernym-disc> read here.
   @typedef {HTMLElement & {index: number,
     data: {names: string[], par: ArrayLike<number>}}} TreeDisc */

export class Picker {
  /** @type {HTMLElement} */ #host;
  /** @type {HTMLElement} */ #pickEl;
  /** @type {HTMLSelectElement} */ #catEl;
  /** @type {PickerHost} */ #to;
  /** @type {string | null} */ #indexSrc = null;
  #rows = 0;
  /** @type {HTMLOptionElement | null} */ #opt = null;
  /** @type {TreeDisc | null} */ #disc = null;
  #following = false;
  // Set while the picker hands the element its words, so the element marking
  // them can tell the picker's words from a host's.
  #applying = false;
  // The node the element was last given, which is what the option names while
  // it is chosen. Moving to a node with no words leaves the element where it
  // was, so this can lag the disc.
  #drawn = -1;
  // Bumped by every choice and every move, so an answer arriving after the
  // reader moved on is dropped rather than drawn.
  #gen = 0;
  // Set while a follow waits for the disc to paint; see #soon.
  #queued = false;
  /** @type {import("./word-source.js").WordTable | null} */ #table = null;
  #tableFailed = false;

  /** @param {HTMLElement} host @param {HTMLElement} pickEl
      @param {HTMLSelectElement} catEl @param {PickerHost} to */
  constructor(host, pickEl, catEl, to) {
    this.#host = host;
    this.#pickEl = pickEl;
    this.#catEl = catEl;
    this.#to = to;
  }

  get indexSrc() {
    return this.#indexSrc;
  }
  /** Whether the element is drawing the disc's node rather than a file. */
  get following() {
    return this.#following;
  }

  connect() {
    this.#catEl.addEventListener("change", this.#onCat);
    this.index();
    this.tree();
  }
  disconnect() {
    this.#catEl.removeEventListener("change", this.#onCat);
    this.#unbind();
  }

  /* Fetched rather than derived, since the element is handed one word file
     and the names of the others are nowhere in it. */
  async index() {
    const src = this.#host.getAttribute("index-src");
    if (!src || src === this.#indexSrc) return;
    this.#indexSrc = src;
    /** @type {import("./disc-index.js").IndexRow[]} */
    let rows;
    try {
      rows = await (await fetch(src)).json();
    } catch (err) {
      this.#to.fail(
        `<b>Could not load the categories.</b> ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    if (!Array.isArray(rows) || !rows.length) return;
    this.#rows = rows.length;
    this.#catEl.replaceChildren(
      ...rows.map(row => {
        const o = document.createElement("option");
        o.value = row.name;
        // The count, so the size of the category is known before the choice.
        o.textContent = catLabel(row);
        return o;
      }),
    );
    this.#opt = null;
    this.#offer();
    this.mark(this.#to.category());
    /* An index alone opens on its first category rather than on nothing. The
       element's own load has run and found nothing by now, so a src written by
       hand is already loading or loaded. */
    if (!this.#to.ready() && !this.#host.getAttribute("src"))
      this.#to.open(href(src, rows[0].name));
  }

  /* The disc the host names, found through getRootNode so an element inside a
     shadow tree finds the disc beside it. Called again when `tree` changes. */
  tree() {
    this.#unbind();
    const id = this.#host.getAttribute("tree");
    const root = /** @type {Document | ShadowRoot} */ (this.#host.getRootNode());
    this.#disc = id ? /** @type {TreeDisc | null} */ (root.getElementById?.(id) ?? null) : null;
    if (this.#disc) {
      this.#disc.addEventListener("disc-zoom", this.#onZoom);
      this.#disc.addEventListener("disc-names", this.#onNames);
    }
    this.#offer();
  }

  /** Select the option for what the element holds. `category` is its name;
     the picker's own words select the follow option instead, and any other
     words end following, since a host handed them.
     @param {string} category */
  mark(category) {
    if (!this.#applying) this.#following = false;
    const want = this.#following ? FOLLOW : category;
    if (this.#catEl.value !== want) this.#catEl.value = want;
    this.#name();
  }

  /** The element is loading a word file, which is a choice of category. */
  release() {
    if (this.#following) this.#gen++;
    this.#following = false;
    this.#name();
  }

  #unbind() {
    this.#disc?.removeEventListener("disc-zoom", this.#onZoom);
    this.#disc?.removeEventListener("disc-names", this.#onNames);
    this.#disc = null;
  }

  /* The follow option exists where there is both a picker and a disc. */
  #offer() {
    const want = this.#rows > 0 && this.#disc !== null;
    if (want && !this.#opt) {
      this.#opt = document.createElement("option");
      this.#opt.value = FOLLOW;
      this.#catEl.prepend(this.#opt);
    } else if (!want && this.#opt) {
      this.#opt.remove();
      this.#opt = null;
      if (this.#following) this.release();
    }
    // One category is not a choice; one and the disc's is.
    this.#pickEl.hidden = this.#rows + (this.#opt ? 1 : 0) < 2;
    this.#name();
  }

  /* The option's text: the node, and its word count once the table is here,
     which is what tells a large category from a small one before the choice.
     A node with no words below it cannot be chosen. */
  #name() {
    const opt = this.#opt;
    const disc = this.#disc;
    if (!opt || !disc) return;
    const at = this.#following && this.#drawn >= 0 ? this.#drawn : disc.index;
    const names = disc.data?.names;
    const name = names && names.length > at ? String(names[at]) : "";
    if (!name) {
      opt.textContent = "from the tree";
      opt.disabled = true;
      return;
    }
    if (this.#tableFailed) {
      opt.textContent = `from the tree: ${name} (unavailable)`;
      opt.disabled = !this.#following;
      return;
    }
    // Unlike a category row, a zero is shown: it is why the option is off.
    const count = this.#table ? this.#table.words(at).words.length : -1;
    opt.textContent = `from the tree: ${name}${count < 0 ? "" : ` (${count})`}`;
    opt.disabled = count === 0 && !this.#following;
  }

  /** The table over the disc's tree, once its names are in.
     @returns {Promise<import("./word-source.js").WordTable | null>} */
  async #load() {
    if (this.#table) return this.#table;
    const disc = this.#disc;
    const data = disc?.data;
    if (!disc || !data?.par?.length || data.names?.length !== data.par.length) return null;
    try {
      this.#table = await table(beside(this.#indexSrc, TABLE), data.par, data.names);
    } catch (err) {
      this.#tableFailed = true;
      console.warn(`the word table did not load: ${err instanceof Error ? err.message : err}`);
    }
    return this.#table;
  }

  /* Hand the element the words below the disc's node. A node with none leaves
     it on what it had. */
  async #follow() {
    const gen = ++this.#gen;
    const t = await this.#load();
    const disc = this.#disc;
    if (gen !== this.#gen || !this.#following) return;
    if (!t || !disc) {
      // Nothing to follow with, so the select goes back to what is drawn.
      this.release();
      this.mark(this.#to.category());
      return;
    }
    const at = disc.index;
    const got = t.words(at);
    if (got.words.length) {
      this.#drawn = at;
      this.#applying = true;
      try {
        this.#to.apply({ category: String(disc.data.names[at]), words: got.words, zipf: got.zipf });
      } finally {
        this.#applying = false;
      }
    }
    this.#name();
  }

  /* Follow once the page has painted. The disc redraws inside the handler
     that fires disc-zoom, and three elements taking entity's 40,117 words in
     that same task held its new picture back by 172 ms, or 552 ms at a
     quarter of the CPU, so to the reader the disc froze. After the next frame
     the disc shows first and the elements catch up behind it. Moves made
     before the callback runs are one follow, of wherever the disc ended up.
     A hidden page runs no frames, so there it waits for a task alone. */
  #soon() {
    if (this.#queued) return;
    this.#queued = true;
    const run = () => {
      this.#queued = false;
      if (this.#following) this.#follow();
    };
    if (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden")
      requestAnimationFrame(() => setTimeout(run, 0));
    else setTimeout(run, 0);
  }

  #onCat = () => {
    if (this.#catEl.value === FOLLOW) {
      this.#following = true;
      this.#soon();
      return;
    }
    this.release();
    this.#to.open(href(this.#indexSrc, this.#catEl.value));
  };

  #onZoom = () => {
    if (this.#following) {
      this.#soon();
      return;
    }
    // The first move is the reader using the disc, which is when the table
    // starts on its way, so its counts are ready when the picker is opened.
    const gen = this.#gen;
    this.#load().then(() => {
      if (gen === this.#gen) this.#name();
    });
    this.#name();
  };

  #onNames = () => this.#name();
}
