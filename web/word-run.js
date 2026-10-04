/* <word-run> — the chain the disc could still make, shown as its two ends.
 *
 * A perfect round on a large category runs to hundreds of words, which is more
 * than a line can hold and more than a reader wants. So the ends are drawn and
 * the middle is counted: the words play has actually made, then the words
 * perfect play would add, folded to `ends` at each end.
 *
 *   <word-disc id="disc" src="words-animal.json"></word-disc>
 *   <word-run for="disc" ends="4"></word-run>
 *
 * It follows the disc rather than being told about it. <word-disc>'s events
 * bubble and cross the shadow boundary, so binding is an id and the two need no
 * host code between them; a host that would rather own the answer sets `run`
 * and the binding stays out of the way.
 *
 * The disc prices perfect play as a count and this names it, so the two ask
 * word-longest.js the same question and only one of them fetches the words.
 */
import { matrix } from "./letter-graph.js";
import { buckets, longest, name } from "./word-longest.js";

const A = "a".charCodeAt(0);
const LETTERS = 26;

/* Four at each end. Below about three the line stops reading as a chain, and
   much above six it stops fitting the one line it is given. */
export const ENDS = 4;

/** The whole run play could make from where it stands: the words already
   played, then the longest continuation over the words left. A word already
   played is not a move, so the continuation is solved over what remains rather
   than over the category.
   @param {string[]} words @param {string[]} played @returns {string[]} */
export function run(words, played) {
  const spent = new Set(played);
  const rest = words.filter(w => !spent.has(w));
  const last = played.length ? played[played.length - 1] : "";
  // The letter the next word has to start with. A word the disc never drew
  // cannot be in `played`, so this is inside the alphabet whenever it is asked
  // for; the guard is against a host that set the chain by hand.
  let start = -1;
  if (last) {
    const at = last.charCodeAt(last.length - 1) - A;
    if (at >= 0 && at < LETTERS) start = at;
  }
  const { letters } = longest(matrix(rest).count, start);
  return played.concat(name(letters, buckets(rest)));
}

/** Where a run is folded so it fits one line: the first `ends`, the count of
   what is hidden, and the last `ends`. A run short enough to show whole is left
   whole, which is what `hidden` at 0 says.
   @param {number} length @param {number} ends
   @returns {{head: number, hidden: number, tail: number}} */
export function elide(length, ends) {
  const keep = Math.max(1, ends);
  // Hiding one word behind an ellipsis and a count reads worse than the word,
  // so the fold only earns its place past that.
  if (length <= 2 * keep + 1) return { head: length, hidden: 0, tail: 0 };
  return { head: keep, hidden: length - 2 * keep, tail: keep };
}

const TPL = document.createElement("template");
TPL.innerHTML = `
<style>
  :host{display:block;
    --_ground:var(--disc-ground,#0c1112); --_ink:var(--disc-ink,#e7eded);
    --_muted:var(--disc-muted,#90a1a1); --_accent:var(--disc-accent,#59b491);
    --_edge:var(--disc-edge,rgba(231,237,237,.11));
    --_font:var(--disc-font,system-ui,sans-serif);
    --_mono:var(--disc-mono,ui-monospace,monospace);
    color:var(--_ink);background:var(--_ground)}
  /* One line that scrolls, since a second line would take height off whatever
     sits above it. Every word and chevron is an item of the row, so
     space-between spreads the spare width between every pair. Nothing may
     shrink: a flex item shrinks below its content before its parent scrolls,
     and the words overran the chevrons between them.
     (No backticks in here: this is inside a template literal.) */
  .run{display:flex;align-items:baseline;justify-content:space-between;gap:7px;
    font-family:var(--_mono);font-size:15px;line-height:1.7;min-height:1.7em;
    white-space:nowrap;overflow-x:auto;scrollbar-width:none}
  .run>*{flex:0 0 auto}
  .run::-webkit-scrollbar{display:none}
  /* The count sits outside the chain the way the disc's category label does,
     with a rule rather than a separator, since reading as a step in the chain
     is the one thing it must not do. */
  .count{font-family:var(--_font);font-style:italic;color:var(--_muted);
    border-right:1px solid var(--_edge);padding-right:11px}
  /* What has been played against what is only projected. */
  .done{color:var(--_accent)}
  .todo{color:var(--_ink)}
  /* No padding of its own: the row's gap and the space split between the items
     is the whole of the spacing, and a padding on top would double it. */
  .gap{color:var(--_muted)}
  .sep{font-style:normal;color:var(--_muted);opacity:.5}
  .none{font-family:var(--_font);font-style:italic;color:var(--_muted)}
</style>
<div class="run" part="run"></div>`;

/** A <word-disc>, as much of it as this element reads.
   @typedef {Element & {words?: string[], chain?: string[]}} Disc */

class WordRun extends HTMLElement {
  static observedAttributes = ["for", "ends"];

  /** @type {ShadowRoot} */ #sr;
  /** @type {HTMLElement} */ #line;
  /** @type {Disc | null} */ #disc = null;
  /** @type {string[]} */ #run = [];
  /* What the run was last worked out for. The disc redraws far more often than
     its words or its chain move, and every move of them is a solve. */
  #key = " ";
  #on = () => this.#follow();

  constructor() {
    super();
    this.#sr = this.attachShadow({ mode: "open" });
    this.#sr.append(TPL.content.cloneNode(true));
    this.#line = /** @type {HTMLElement} */ (this.#sr.querySelector(".run"));
  }

  connectedCallback() {
    this.#bind();
  }
  disconnectedCallback() {
    this.#unbind();
    this.#key = " ";
  }
  /** @param {string} attr */
  attributeChangedCallback(attr) {
    if (attr === "for") this.#bind();
    else this.#draw();
  }

  /** The disc this follows, for a host holding the element rather than an id.
     Setting it beats the `for` attribute.
     @param {Disc | null} el */
  set source(el) {
    this.#unbind();
    this.#disc = el;
    this.#key = " ";
    this.#listen();
    this.#follow();
  }
  get source() {
    return this.#disc;
  }

  /** The run itself, for a host with its own idea of what to show. It holds
     until the disc moves, which is what puts the element back in charge.
     @param {string[]} words */
  set run(words) {
    this.#run = words.slice();
    this.#draw();
  }
  get run() {
    return this.#run.slice();
  }

  #ends() {
    const said = Number(this.getAttribute("ends"));
    return Number.isFinite(said) && said > 0 ? Math.floor(said) : ENDS;
  }

  #bind() {
    this.#unbind();
    const id = this.getAttribute("for");
    if (!id) {
      this.#draw();
      return;
    }
    // getRootNode rather than document, so an element inside a shadow tree
    // finds the disc beside it rather than one of the same id outside it.
    const root = /** @type {Document | ShadowRoot} */ (this.getRootNode());
    this.#disc = /** @type {Disc | null} */ (root.getElementById?.(id) ?? null);
    this.#key = " ";
    this.#listen();
    this.#follow();
  }

  #listen() {
    if (!this.#disc) return;
    // word-render covers the first draw and a change of category, where
    // word-chain covers play. Both are held off by #key, so the pair costs one
    // solve between them rather than one each.
    this.#disc.addEventListener("word-chain", this.#on);
    this.#disc.addEventListener("word-render", this.#on);
  }

  #unbind() {
    if (!this.#disc) return;
    this.#disc.removeEventListener("word-chain", this.#on);
    this.#disc.removeEventListener("word-render", this.#on);
    this.#disc = null;
  }

  #follow() {
    if (!this.#disc) return;
    const words = this.#disc.words ?? [];
    const played = this.#disc.chain ?? [];
    const key = `${words.length} ${words[0] ?? ""} ${played.join(" ")}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#run = words.length ? run(words, played) : [];
    this.#draw();
  }

  #draw() {
    const played = this.#disc?.chain?.length ?? 0;
    this.#line.replaceChildren();
    if (!this.#run.length) {
      const said = document.createElement("span");
      said.className = "none";
      said.textContent = this.#disc ? "no chain to make" : "no disc to follow";
      this.#line.append(said);
      return;
    }
    const count = document.createElement("span");
    count.className = "count";
    const left = this.#run.length - played;
    count.textContent = played
      ? `${left} more, ${this.#run.length} in all`
      : `${this.#run.length} words`;
    this.#line.append(count);

    const cut = elide(this.#run.length, this.#ends());
    this.#steps(0, cut.head, played);
    if (cut.hidden) {
      const gap = document.createElement("span");
      gap.className = "gap";
      // No ellipsis: the chevrons either side already say the chain runs on
      // through the fold, which without them reads as a break in the chain.
      gap.textContent = `${cut.hidden} more`;
      this.#line.append(this.#sep(), gap, this.#sep());
      this.#steps(this.#run.length - cut.tail, this.#run.length, played);
    }
  }

  /** The chevron between two steps. <word-disc>'s crumb line uses this one,
     and this line is the same chain read further along, so a second glyph
     would say they were different things.
     @returns {HTMLElement} */
  #sep() {
    const sep = document.createElement("i");
    sep.className = "sep";
    sep.textContent = "›";
    return sep;
  }

  /** One stretch of the chain, appended a word and a chevron at a time so each
     is an item of the row and the line's spare width is split between every
     pair rather than dropped in one place.
     @param {number} from @param {number} to @param {number} played
     @returns {void} */
  #steps(from, to, played) {
    for (let i = from; i < to; i++) {
      if (i > from) this.#line.append(this.#sep());
      const word = document.createElement("span");
      word.className = i < played ? "done" : "todo";
      word.textContent = this.#run[i];
      this.#line.append(word);
    }
  }
}

customElements.define("word-run", WordRun);
export { WordRun };
