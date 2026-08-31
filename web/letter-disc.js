/* <letter-disc> — the letter graph as a chord diagram.
 *
 * Data is {category, words: ["cat", …], zipf: [4.7, …]}, the same file
 * tools/export_words.py writes for <word-disc>. The 26 by 26 count is built
 * from it in one pass, so there is nothing new to export and a page that
 * carries both discs fetches one file for the pair.
 *
 *   <letter-disc src="words-animal.json"></letter-disc>
 *   <letter-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("letter-disc").data = {category, words};
 *
 * A word runs from its first letter to its last, so every word is a directed
 * edge between two of 26 letters. <word-disc> draws the line graph of that —
 * a node per word, 96,470 chords for animal — and this draws the graph
 * underneath it: 26 nodes and one arc per letter pair some word bridges, 344
 * of them at the worst. Where the word disc answers "which word", this
 * answers "which letters, and how heavily".
 *
 * Nothing is bundled. At 344 arcs every one of them is a thing to point at and
 * read a count off, and a merged arc is nothing at all; the log width, the
 * split arcs and the hover are what do the decluttering instead. See
 * letter-graph.js, which holds all of the geometry and none of the DOM.
 *
 * There is no worker either, and no cached bitmap. animal is 344 filled
 * ribbons where <word-disc> is 96,470 strokes, so the whole picture is a
 * frame's work and a resize redraws it rather than blitting one.
 *
 * The pointer highlights and a click drills. Pointing at an arc or a letter
 * lights it and dims the rest, and the column beside the disc lists whatever
 * letter was last clicked into — a list that a hover never rebuilds, so
 * nothing moves under the pointer on its way to a row.
 *
 * Attributes: src, index-src (words-index.json, which turns the picker on),
 *             readout="off", search="off", fit
 * Properties: data, stats, letter, arc. Methods: show(letter), repaint().
 * Events: letter-hover {kind:"arc",from,to,words}
 *                  or {kind:"letter",letter,starts,ends,arcs},
 *         letter-pick {letter,arcs},
 *         letter-render {words,letters,pairs,loops,drawMs}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-sat --disc-val --disc-font --disc-mono
 */
import { hsv, TAU } from "./disc-colour.js";
import { href, label as catLabel } from "./disc-index.js";
import { band, baseline, fit, halo, HALO, HALO_MIN, HUB_DROP } from "./disc-label.js";
import { ratio } from "./disc-ratio.js";
import { Search } from "./disc-search.js";
import {
  ALPHA,
  at as arcAt,
  fade,
  layout,
  letterAt,
  LETTERS,
  matrix,
  near,
  ribbon,
  solve,
} from "./letter-graph.js";

// The hub's name, as <word-disc> sets it: the weight rather than the size is
// what marks it out, and the ladder's bottom rungs are there so a frame too
// small for the hub to mean anything degrades rather than clips.
const HUB_SIZES = [16, 14, 12, 10, 8],
  HUB_WEIGHT = 700;
// The hub's "back" hint, and the room it takes from the name above it.
const HINT_PX = 11,
  HINT_H = 15;

// The column beside the disc and the gutter to it. The same thresholds the
// other two discs break to landscape at, so all three do it together.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
const RESIZE_HOLD = 60;
// Rows into the DOM at a time, and how near the foot of the column a scroll
// has to come before the next lot follow. <word-disc>'s numbers. The resting
// list is every arc the category has — 344 for animal — so paging is a path
// that runs here rather than one that never does.
const ARCS_PAGE = 200,
  ARCS_NEAR = 240;

// How much of the picture is left where something is highlighted, and what the
// lit arcs are drawn at. Dimming is a scrim over the whole frame rather than a
// second pass over 344 arcs at a lower alpha: one fill against 344, and it
// dims the ring bands and the letters with them, so the highlight reads
// against the whole figure rather than against the ribbons alone.
const SCRIM = 0.74,
  LIT = 0.92;
// The arriving half of a letter's ring band, against the leaving half's full
// weight. Bright is where play sets out from and dim is where it lands, which
// is the third thing saying which way an arc runs after the split and the
// taper.
const IN_DIM = 0.38;
// Words named in the readout for the arc under the pointer, before it gives up
// and says how many are left. Two lines of gloss stacked, five in the column.
const NAMED = 14;

const TPL = document.createElement("template");
TPL.innerHTML = `
<style>
  :host{display:block;position:relative;
    --_ground:var(--disc-ground,#0c1112); --_panel:var(--disc-panel,#141b1c);
    --_ink:var(--disc-ink,#e7eded); --_muted:var(--disc-muted,#90a1a1);
    --_accent:var(--disc-accent,#59b491);
    --_sat:var(--disc-sat,.55); --_val:var(--disc-val,.88);
    --_font:var(--disc-font,system-ui,sans-serif);
    --_mono:var(--disc-mono,ui-monospace,Menlo,monospace);
    --_edge:color-mix(in srgb,var(--_muted) 38%,transparent);
    color:var(--_ink);font-family:var(--_font)}
  @media (prefers-color-scheme:light){
    :host{--_ground:var(--disc-ground,#eef1f0); --_panel:var(--disc-panel,#fbfcfc);
      --_ink:var(--disc-ink,#131a1b); --_muted:var(--disc-muted,#5d6d6e);
      --_accent:var(--disc-accent,#2c7359);
      --_sat:var(--disc-sat,.62); --_val:var(--disc-val,.60)}}
  .frame{display:block}
  :host([fit]){height:100%}
  :host([fit]) .frame{display:flex;flex-direction:column;height:100%}
  :host([fit]) .stage{flex:1;min-height:0;width:auto;max-width:100%;align-self:center}
  /* Four rows, the picker's first. No row-gap, so with no index named that row
     measures nothing and every distance below is what it was without it. */
  :host([fit]) .frame.wide{display:grid;column-gap:18px;
    grid-template-columns:minmax(200px,280px) minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto}
  /* One box around the column, as the frame's own ::before placed as a grid
     item: the picker, the search box and the readout are separate grid items
     and the stacked layout puts the readout under the disc, so nothing wraps
     them and CSS cannot move the DOM. Generated first, so it paints behind
     what sits in it. */
  :host([fit]) .frame.wide::before{content:"";grid-area:1/1/4/2;
    border:1px solid var(--_edge);border-radius:3px;pointer-events:none}
  :host([fit]) .frame.wide .pick{grid-area:1/1;padding:10px 10px 0}
  :host([fit]) .frame.wide .find{grid-area:2/1;margin-bottom:0;padding:0 10px 10px;
    display:flex;flex-direction:column;min-height:0}
  :host([fit]) .frame.wide .pick[hidden] + .find{padding-top:10px}
  :host([fit]) .frame.wide .hits{position:static;margin-top:6px;box-shadow:none;
    flex:0 1 auto;min-height:0;max-height:none}
  :host([fit]) .frame.wide .hits li{display:block}
  :host([fit]) .frame.wide .hits .p{display:block;margin-left:0}
  :host([fit]) .frame.wide .stage{grid-area:1/2/4/3;height:100%;min-height:0;
    justify-self:center}
  :host([fit]) .frame.wide .gloss{grid-area:3/1;height:auto;-webkit-line-clamp:5;
    margin-top:0;padding:0 10px 10px}
  :host([fit]) .frame.wide .crumb{grid-area:4/1/5/-1;margin-top:7px}
  .pick{margin-bottom:8px}
  .pick[hidden]{display:none}
  .pick select{width:100%;font-family:var(--_font);font-size:12.5px;line-height:1.5;
    color:var(--_ink);background:var(--_panel);border:1px solid var(--_edge);
    border-radius:2px;padding:5px 9px}
  .pick select:focus-visible{outline:2px solid var(--_accent);outline-offset:-1px}
  .find{position:relative;margin-bottom:8px}
  :host([search="off"]) .find{display:none}
  .find input{width:100%;font-family:var(--_font);font-size:12.5px;line-height:1.5;
    color:var(--_ink);background:var(--_panel);border:1px solid var(--_edge);
    border-radius:2px;padding:5px 9px;-webkit-appearance:none;appearance:none}
  .find input::placeholder{color:var(--_muted)}
  .find input:disabled{opacity:.6}
  .find input:focus-visible{outline:2px solid var(--_accent);outline-offset:-1px}
  .hits{position:absolute;z-index:2;top:calc(100% + 3px);left:0;right:0;
    margin:0;padding:3px;list-style:none;max-height:16em;overflow-y:auto;
    background:var(--_panel);border:1px solid var(--_edge);border-radius:2px;
    box-shadow:0 8px 26px rgba(0,0,0,.32)}
  .hits[hidden]{display:none}
  .hits li{display:flex;gap:10px;align-items:baseline;padding:3px 6px;
    border-radius:2px;cursor:pointer;font-size:12.5px;white-space:nowrap}
  .hits li[aria-selected="true"]{background:color-mix(in srgb,var(--_accent) 18%,transparent)}
  .hits .n{overflow:hidden;text-overflow:ellipsis}
  .hits .n b{font-weight:600;color:var(--_accent)}
  .hits .p{margin-left:auto;font-family:var(--_mono);font-size:10.5px;
    color:var(--_muted);overflow:hidden;text-overflow:ellipsis}
  /* Every arc the disc draws, in the column the search box otherwise leaves
     empty. Landscape only: the stacked layout has no column, and there the
     suggestions are a dropdown over the disc, so nothing is built in that
     shape rather than several hundred elements sitting behind display:none.

     One arc per line, where <word-disc> lists its moves two up: a row here is
     a pair and a count rather than a word, and the count is right-aligned
     against the column's edge, which needs the width. */
  .arcs{display:none}
  :host([fit]) .frame.wide .arcs{display:flex;flex-direction:column;
    flex:1 1 auto;min-height:0;margin-top:9px}
  :host([fit]) .frame.wide .arcs[hidden]{display:none}
  .arcs .why{font-family:var(--_mono);font-size:10.5px;color:var(--_muted);
    flex:none;padding-bottom:5px}
  .arcs .why b{color:var(--_accent);font-weight:600}
  /* The box the suggestions draw in, since the two share this room, and
     flex:1 1 auto inside a stretching row so it runs down to the readout at
     the foot of the column however few arcs are in it. */
  .arcs .list{margin:0;padding:3px;list-style:none;flex:1 1 auto;min-height:0;
    overflow-y:auto;scrollbar-width:thin;background:var(--_panel);
    border:1px solid var(--_edge);border-radius:2px}
  /* A flex of a pair and a count, so the count sits against the column's edge
     however long the pair is. display:flex makes the row block-level and the
     rows abut on that alone — <word-disc>'s line-height:0 is for inline
     blocks and has nothing to fix here. */
  .arcs li{box-sizing:border-box;display:flex;gap:10px;align-items:baseline;
    color:var(--_ink);font-family:var(--_mono);font-size:11.5px;line-height:1.55;
    padding:1px 5px;border-radius:2px;cursor:pointer;white-space:nowrap}
  .arcs li:hover,.arcs li.on{background:color-mix(in srgb,var(--_accent) 18%,transparent)}
  .arcs li .w{margin-left:auto;color:var(--_muted)}
  /* An arc arriving reads apart from one leaving, the way the ring band does:
     the leaving half is the letter's own colour at full weight and the
     arriving half is dimmed, so the list and the disc say the same thing. */
  .arcs li.in{color:var(--_muted)}
  .arcs li .d{color:var(--_muted);opacity:.6}
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  /* The arrow is the resting state and #onMove lifts it to a pointer over
     what a click would take: an arc, a letter, or the hub with something to
     clear. */
  canvas.over{cursor:default;touch-action:none}
  :host([readout="off"]) .gloss,:host([readout="off"]) .crumb{display:none}
  /* Held to a height whatever they hold, which is what stops the disc moving
     under the pointer: with fit set the frame is a flex column and the stage
     takes what these two leave, so a block that grows by a line takes a line
     off the disc's height and, the stage being square, as much off its width. */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .gloss b{font-family:var(--_mono);font-weight:600}
  .gloss .w{color:var(--_muted);font-size:13px}
  .crumb{font-family:var(--_mono);font-size:11px;color:var(--_muted);line-height:1.6;
    min-height:1.6em;margin-top:3px;white-space:nowrap;overflow-x:auto;
    scrollbar-width:none}
  .crumb::-webkit-scrollbar{display:none}
  .crumb button{font:inherit;color:var(--_accent);background:none;border:0;padding:0;
    cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .crumb .now{color:var(--_ink)}
  .crumb em{font-style:normal}
  .crumb i{font-style:normal;color:var(--_muted);opacity:.5;padding:0 4px}
  /* The category the letters came from, which is not one of them. The body
     face against the steps' monospace, italic and muted, with a rule beside it
     rather than a chevron — reading as a letter on the path is the one thing
     it must not do. <word-disc>'s treatment, for the same reason. */
  .crumb .root{font-family:var(--_font);font-style:italic;color:var(--_muted);
    border-right:1px solid var(--_edge);padding-right:9px;margin-right:9px}
  .crumb button.root{text-decoration:none}
  .crumb button.root:hover,.crumb button.root:focus-visible{color:var(--_accent);
    text-decoration:underline;text-underline-offset:2px}
</style>
<div class="frame">
  <div class="pick" hidden><select class="cat" aria-label="category"></select></div>
  <div class="find">
    <input class="q" type="search" role="combobox" autocomplete="off"
           spellcheck="false" aria-controls="hits" aria-expanded="false"
           aria-autocomplete="list" placeholder="Waiting for words…" disabled>
    <ul class="hits" id="hits" role="listbox" hidden></ul>
    <div class="arcs"><div class="why"></div><ul class="list"></ul></div>
  </div>
  <div class="stage">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" aria-hidden="true"></canvas>
  </div>
  <div class="gloss"></div>
  <div class="crumb"><span class="head"></span><span class="tail"></span></div>
</div>`;

class LetterDisc extends HTMLElement {
  static observedAttributes = ["src", "index-src"];

  #sr;
  #base;
  #over;
  #crumb;
  #headEl;
  #tailEl;
  #glossEl;
  #frame;
  #q;
  #hits;
  #arcsEl;
  #whyEl;
  #listEl;
  #pickEl;
  #catEl;
  #ro;
  #mq;

  #category = "";
  #words = [];
  #M = null;
  #L = null;
  #search = null;
  #sug = [];
  #pick = -1;

  /* What the column lists, set by a click and never by a hover, so a list
     cannot rebuild under a pointer on its way to a row. -1 is every arc. */
  #letter = -1;
  /* What the pointer is on: 1 for a letter, 2 for an arc, 0 for nothing. It is
     what the hub names, what the readout describes and what the draw dims
     around, and it is the only one of the two a hover moves. */
  #kind = 0;
  #on = -1;
  // How many rows of #rows are in the DOM; the rest follow on a scroll.
  #rows = [];
  #listed = 0;

  #ready = false;
  #failed = false;
  #loadedSrc = null;
  #indexSrc = null;

  #cx = 0;
  #cy = 0;
  #r = 1;
  #bandPx = 5;
  #rHub = 1;
  #labelPx = 0;
  #outer = 1;
  #alpha = ALPHA;
  #dpr = 1;
  #pw = 0;
  #ph = 0;
  #drawMs = 0;
  #toks = new Map();
  #fits = new Map();
  #bands = new Map();
  #points = false;
  #inHub = false;
  #box = null;
  #resized = -Infinity;
  #fitTimer = 0;
  #dq = null;

  constructor() {
    super();
    this.#sr = this.attachShadow({ mode: "open" });
    this.#sr.append(TPL.content.cloneNode(true));
    this.#base = this.#sr.querySelector(".base");
    this.#over = this.#sr.querySelector(".over");
    this.#crumb = this.#sr.querySelector(".crumb");
    this.#headEl = this.#crumb.querySelector(".head");
    this.#tailEl = this.#crumb.querySelector(".tail");
    this.#glossEl = this.#sr.querySelector(".gloss");
    this.#frame = this.#sr.querySelector(".frame");
    this.#q = this.#sr.querySelector(".q");
    this.#hits = this.#sr.querySelector(".hits");
    this.#arcsEl = this.#sr.querySelector(".arcs");
    this.#whyEl = this.#arcsEl.querySelector(".why");
    this.#listEl = this.#arcsEl.querySelector(".list");
    this.#pickEl = this.#sr.querySelector(".pick");
    this.#catEl = this.#sr.querySelector(".cat");
  }

  connectedCallback() {
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerleave", this.#onLeave);
    this.#over.addEventListener("click", this.#onClick);
    this.#crumb.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) this.show(+b.dataset.l);
    });
    this.#catEl.addEventListener("change", this.#onCat);
    this.#q.addEventListener("input", this.#onQuery);
    this.#q.addEventListener("keydown", this.#onFindKey);
    this.#q.addEventListener("blur", this.#closeFind);
    this.#hits.addEventListener("pointerdown", e => e.preventDefault());
    this.#hits.addEventListener("pointermove", e => {
      const li = e.target.closest("li");
      if (li && +li.dataset.k !== this.#pick) this.#setPick(+li.dataset.k);
    });
    this.#hits.addEventListener("click", e => {
      const li = e.target.closest("li");
      if (li) this.#go(this.#sug[+li.dataset.k].i);
    });
    /* The list does what the disc does: pointing at a row is pointing at its
       arc, and clicking one drills into it. A move landing on no row holds
       what the last one set rather than clearing it — a pointer is over the
       list and over no row at every seam left, the list's own padding and the
       hairline between two rows, and clearing there is what makes a highlight
       blink off and on all the way down the column. Leaving the list is the
       only thing that clears it, which is what pointerleave is for. */
    this.#listEl.addEventListener("pointermove", e => {
      const li = e.target.closest("li[data-k]");
      if (!li) return;
      const k = +li.dataset.k;
      if (!(this.#kind === 2 && this.#on === k)) this.#preview(2, k);
    });
    this.#listEl.addEventListener("pointerleave", () => this.#preview(0, -1));
    this.#listEl.addEventListener("click", e => {
      const li = e.target.closest("li[data-k]");
      if (li) this.#drill(2, +li.dataset.k);
    });
    this.#listEl.addEventListener("scroll", () => {
      const el = this.#listEl;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - ARCS_NEAR) this.#page();
    });
    this.#ro = new ResizeObserver(() => this.#fit());
    /* The stage, whose box is what the canvases are sized from, and the frame,
       whose shape is what decides the layout — because the two do not move
       together. Stacked, the stage is a square of whatever height the flex
       column leaves it, so its height comes off the frame's height and a frame
       dragged wider leaves its box exactly where it was. Observing the stage
       alone, the element drops to the stacked layout when the page narrows and
       then never hears another thing: no callback is raised however wide the
       page is dragged afterwards, and it stays stacked for good. */
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#ro.observe(this.#frame);
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    this.#onRatio();
    /* The font swap both other discs guard against. Canvas text is measured
       rather than laid out, so a face landing after the first frame reflows
       nothing and the hub would keep a fit solved for the fallback. Nothing
       here is solved off a word's width the way <word-disc>'s ring is, so
       repaint() is the whole of it. */
    document.fonts?.ready?.then(() => {
      if (this.#box) this.repaint();
    });
    if (!this.#ready) this.#load();
    this.#loadIndex();
  }
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#mq?.removeEventListener("change", this.#onScheme);
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = null;
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "index-src") this.#loadIndex();
  }
  #onScheme = () => this.repaint();

  async #load() {
    const src = this.getAttribute("src");
    try {
      if (src) {
        if (src === this.#loadedSrc) return;
        this.#loadedSrc = src;
        this.data = await (await fetch(src)).json();
      } else {
        if (this.#ready) return;
        const inline = this.querySelector('script[type="application/json"]');
        if (!inline) return;
        this.data = JSON.parse(inline.textContent);
      }
    } catch (err) {
      this.#say(`<b>Could not load the words.</b> ${err.message}`);
      this.#failed = true;
    }
  }

  /* The picker, built only where the host names an index: a page embedding one
     category names one file and needs no control at all. Fetched rather than
     derived, since the element is handed one word file and the names of the
     other 36 are nowhere in it. */
  async #loadIndex() {
    const src = this.getAttribute("index-src");
    if (!src || src === this.#indexSrc) return;
    this.#indexSrc = src;
    let rows;
    try {
      rows = await (await fetch(src)).json();
    } catch (err) {
      // The words may well have arrived from `src`, and then only the picker
      // is missing, which is not worth taking the readout for.
      if (!this.#ready) {
        this.#say(`<b>Could not load the categories.</b> ${err.message}`);
        this.#failed = true;
      }
      return;
    }
    if (!Array.isArray(rows) || !rows.length) return;
    this.#catEl.replaceChildren(
      ...rows.map(row => {
        const o = document.createElement("option");
        o.value = row.name;
        o.textContent = catLabel(row);
        return o;
      }),
    );
    // One category is not a choice.
    this.#pickEl.hidden = rows.length < 2;
    this.#mark();
    // An index is enough to open on: named without a src it means the first
    // category rather than a blank disc, and #load has already run and found
    // nothing by the time this resolves, so a src written by hand still wins.
    if (!this.#ready && !this.getAttribute("src")) {
      this.setAttribute("src", href(this.#indexSrc, rows[0].name));
    }
  }

  /* The picker follows the words rather than leading them, so it moves with a
     src the host set as well as with its own change event. */
  #mark() {
    if (this.#catEl.value !== this.#category) this.#catEl.value = this.#category;
  }

  #onCat = () => {
    this.setAttribute("src", href(this.#indexSrc, this.#catEl.value));
  };

  set data(d) {
    if (!d?.words) return;
    this.#category = d.category ?? "";
    this.#mark();
    this.#words = Array.from(d.words);
    this.#build();
    this.#ready = true;
    this.#fit();
  }
  get data() {
    return { category: this.#category, words: this.#words };
  }
  /* The letter the column is listing, and the arc the pointer is on, both as
     the host would name them rather than as indices. */
  get letter() {
    return this.#letter < 0 ? "" : String.fromCharCode(65 + this.#letter);
  }
  get arc() {
    if (this.#kind !== 2 || !this.#L) return null;
    const e = this.#L.edges[this.#on];
    return e ? { from: this.#name(e.from), to: this.#name(e.to), words: e.n } : null;
  }
  get stats() {
    return {
      category: this.#category,
      words: this.#L?.words ?? 0,
      letters: this.#L?.live.length ?? 0,
      pairs: this.#L?.pairs ?? 0,
      loops: this.#L?.loops ?? 0,
      labelPx: this.#labelPx,
      alpha: this.#alpha,
      drawMs: this.#drawMs,
    };
  }

  #name(L) {
    return String.fromCharCode(65 + L);
  }

  #build() {
    this.#M = matrix(this.#words);
    this.#L = layout(this.#M);
    this.#alpha = fade(ALPHA, this.#L.pairs);
    this.#letter = -1;
    this.#kind = 0;
    this.#on = -1;
    this.#search = null;
    // A different category makes whatever is in the box a query about words
    // that are no longer drawn, so it goes with the suggestions.
    this.#q.value = "";
    this.#closeFind();
    this.#q.disabled = this.#words.length === 0;
    if (!this.#q.disabled) this.#q.placeholder = "Search words…";
    this.#crumbs();
    this.#showList();
    if (this.#pw) {
      this.#geometry();
      this.#draw();
      this.#overlay();
    }
  }

  #shape() {
    const f = this.#frame.getBoundingClientRect();
    const want = this.hasAttribute("fit") && f.width - f.height >= ASIDE_MIN + ASIDE_GAP;
    if (want === this.#frame.classList.contains("wide")) return false;
    this.#frame.classList.toggle("wide", want);
    // Built on the way in and dropped on the way out, since the list exists
    // only in this shape and #showList is what decides that.
    if (this.#ready) this.#showList();
    return true;
  }

  /* Browser zoom multiplies devicePixelRatio and leaves the CSS box alone, so
     an element a host sized in pixels sees no observation and would go on
     painting at the resolution before the zoom. A media query naming the
     current ratio fires when it moves, and has to be re-armed each time, since
     a query can only report leaving the one value it names. */
  #onRatio = () => {
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.#dq.addEventListener("change", this.#onRatio);
    this.#fit();
  };

  #fit() {
    if (!this.#ready) return;
    if (this.#shape() && this.#pw) return;
    const box = this.#sr.querySelector(".stage").getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = ratio(window.devicePixelRatio, box.width, box.height);
    const pw = Math.round(box.width * dpr),
      ph = Math.round(box.height * dpr);
    if (pw === this.#pw && ph === this.#ph && dpr === this.#dpr) {
      clearTimeout(this.#fitTimer);
      this.#fitTimer = 0;
      return;
    }
    this.#box = { w: box.width, h: box.height, dpr, pw, ph };
    // 344 fills is a frame's work rather than a drag's, so the first change
    // goes through outright and the rest are coalesced; the canvases stretch
    // until the drag stops.
    if (performance.now() - this.#resized > RESIZE_HOLD) return this.#resize();
    clearTimeout(this.#fitTimer);
    this.#fitTimer = setTimeout(this.#resize, RESIZE_HOLD);
  }

  #resize = () => {
    clearTimeout(this.#fitTimer);
    this.#fitTimer = 0;
    this.#resized = performance.now();
    const b = this.#box;
    this.#dpr = b.dpr;
    this.#pw = b.pw;
    this.#ph = b.ph;
    for (const c of [this.#base, this.#over]) {
      c.width = b.pw;
      c.height = b.ph;
    }
    this.#cx = b.w / 2;
    this.#cy = b.h / 2;
    this.#toks.clear();
    this.#fits.clear();
    this.#bands.clear();
    this.#geometry(Math.min(b.w, b.h));
    this.#draw();
    this.#overlay();
  };

  #geometry(size) {
    const s = size ?? Math.min(this.#pw, this.#ph) / this.#dpr;
    const got = solve(s);
    this.#r = got.r;
    this.#bandPx = got.band;
    this.#rHub = got.hub;
    this.#labelPx = got.labelPx;
    this.#outer = got.outer;
  }

  #tok(n, f) {
    let v = this.#toks.get(n);
    if (v === undefined) {
      v = getComputedStyle(this).getPropertyValue(n).trim() || f;
      this.#toks.set(n, v);
    }
    return v;
  }
  /* The letter wheel palette.py spreads over the circle, read through the two
     custom properties the host sets. The same wheel <word-disc> colours its
     wedges with, so a page carrying both says the same thing with the same
     colour in each. */
  #hue(letter) {
    return hsv(letter / LETTERS, +this.#tok("--_sat", ".55"), +this.#tok("--_val", ".88"));
  }

  /* The resting picture: every arc, then the ring band each letter's arcs
     leave from and land in, then the letters. It moves when the data or the
     geometry does and never on a pointer, so a hover repaints the overlay
     alone. */
  #draw() {
    if (!this.#ready || !this.#pw) return;
    const t0 = performance.now();
    const g = this.#base.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#pw / this.#dpr, this.#ph / this.#dpr);
    this.#arcs(g, null, this.#alpha);
    this.#rings(g, 1);
    this.#letters(g, 1);
    this.#drawMs = performance.now() - t0;
    this.#emit("letter-render", { ...this.stats });
  }

  /* Every arc, or the ones `only` holds. Light before heavy, so the trunks
     read over the hairlines rather than the back of the alphabet reading over
     the front — the ranking word-bundle.js has to cut into bands to escape,
     and the one thing 344 unequal arcs do have. */
  #arcs(g, only, alpha) {
    const L = this.#L;
    g.globalAlpha = alpha;
    for (const k of L.order) {
      if (only && !only.has(k)) continue;
      g.fillStyle = this.#hue(L.edges[k].from);
      ribbon(g, this.#cx, this.#cy, this.#r, L.edges[k]);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* The band at the ring, a letter at a time: the leaving half at the letter's
     own weight and the arriving half dimmed. Which half is which is the whole
     of how an arc's direction reads at its ends, so it is drawn under the
     scrim as well as over it. */
  #rings(g, alpha) {
    const r = this.#r;
    g.lineWidth = this.#bandPx;
    for (const arc of this.#L.arcs) {
      g.strokeStyle = this.#hue(arc.letter);
      for (const [from, to, a] of [
        [arc.from, arc.split, 1],
        [arc.split, arc.to, IN_DIM],
      ]) {
        if (from - to < 1e-6) continue;
        g.globalAlpha = alpha * a;
        g.beginPath();
        g.arc(this.#cx, this.#cy, r, -from, -to, false);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  /* The letters outside the ring. Dropped where the arc is narrower than the
     glyph, which under log weighting is the quiet end of animal's range: the
     hub names what the pointer is on instead, which is <word-disc>'s answer at
     its own label floor. The letter under the pointer is drawn whatever its
     arc, since that is the one that has to be identifiable. */
  #letters(g, alpha, force = -1) {
    if (!this.#labelPx) return;
    const at = this.#r + this.#bandPx / 2 + this.#labelPx * 0.95;
    g.font = `600 ${this.#labelPx}px ${this.#tok("--_mono", "monospace")}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const need = (this.#labelPx * 0.85) / at;
    for (const arc of this.#L.arcs) {
      if (arc.span < need && arc.letter !== force) continue;
      g.globalAlpha = alpha;
      g.fillStyle = this.#hue(arc.letter);
      g.fillText(
        this.#name(arc.letter),
        this.#cx + Math.cos(arc.mid) * at,
        this.#cy - Math.sin(arc.mid) * at,
      );
    }
    g.globalAlpha = 1;
  }

  /* The pointer's layer: the picture dimmed to whatever it is on, and the hub.
     Dimming is one scrim over the frame rather than a second pass over 344
     arcs, which also takes the ring bands and the letters down with it so the
     highlight reads against the whole figure. */
  #overlay() {
    if (!this.#ready || !this.#pw) return;
    this.#showRead();
    this.#showTail();
    const g = this.#over.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    const w = this.#pw / this.#dpr,
      h = this.#ph / this.#dpr;
    g.clearRect(0, 0, w, h);

    const lit = this.#lit();
    if (lit) {
      g.globalAlpha = SCRIM;
      g.fillStyle = this.#tok("--_ground", "#0c1112");
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
      this.#arcs(g, lit, LIT);
      this.#rings(g, 1);
      this.#letters(g, 1, this.#kind === 1 ? this.#on : -1);
    }
    this.#hub(g);
  }

  /* Which arcs are lit, and null for the resting picture. A letter lights
     everything that touches it, in either direction, which is the letter's
     whole part in the game; an arc lights itself. */
  #lit() {
    if (this.#kind === 1) return new Set(this.#L.byLetter[this.#on]);
    if (this.#kind === 2) return new Set([this.#on]);
    return null;
  }

  /* disc-label.js's reference band, held per font: the measure is the
     module's and the cache is the element's, since g.font is the one thing
     that can change the answer. */
  #band(g) {
    const held = this.#bands.get(g.font);
    if (held !== undefined) return held;
    const got = band(g);
    this.#bands.set(g.font, got);
    return got;
  }
  #fitted(g, text, r) {
    const key = `${r}|${text}`;
    const had = this.#fits.get(key);
    if (had) {
      g.font = had.font;
      return had;
    }
    const got = fit(g, text, r, this.#tok("--_mono", "monospace"), {
      sizes: HUB_SIZES,
      weight: HUB_WEIGHT,
    });
    if (this.#fits.size > 2048) this.#fits.clear();
    this.#fits.set(key, got);
    return got;
  }

  /* The hub names whatever the pointer is on, otherwise the letter the column
     is listing, otherwise the category, muted, since nothing is selected for
     it to be the name of. Under the name sits the way out, and only where
     there is one: never at the category, where a click on the hub is a no-op,
     and never with the pointer on the disc, where the room is wanted for the
     name.

     Nothing is drawn behind it. The middle is where the long arcs cross, which
     is the part of the figure worth seeing rather than the part to cover, so
     the text carries its own ground: ringed copies of the same fill that draws
     the letters, which hide the shape of their own letters and nothing else. */
  #hub(g) {
    const named = this.#named();
    const way = this.#kind === 0 && this.#letter >= 0;
    const { lines, lh, px } = this.#fitted(g, named.text, this.#rHub - 6 - (way ? HINT_H : 0));

    g.textAlign = "center";
    // Alphabetic and placed by hand, because "middle" centres the em square
    // and its descender space is empty for most names, so the type sits low.
    g.textBaseline = "alphabetic";
    // Both disc-label.js's: the band measured off the face rather than off the
    // name, so every name in a face sits on one baseline and a descender hangs
    // below the centre instead of dragging the line up to meet it.
    const first = baseline(this.#cy, this.#band(g), lines.length, lh, way ? HINT_H / 2 : 0);
    this.#ground(g, lines, first, lh, Math.max(HALO_MIN, px * HALO));
    g.fillStyle = named.ink;
    for (const [k, line] of lines.entries()) g.fillText(line, this.#cx, first + k * lh);

    if (!way) return;
    const y = first + (lines.length - 1) * lh + px * HUB_DROP + HINT_PX;
    g.font = `${HUB_WEIGHT} ${HINT_PX}px ${this.#tok("--_mono", "monospace")}`;
    this.#ground(g, ["↑ all"], y, 0, Math.max(HALO_MIN, HINT_PX * HALO));
    g.fillStyle = this.#tok("--_accent", "#59b491");
    g.fillText("↑ all", this.#cx, y);
  }

  /* disc-label.js's halo, against this element's own ground token. */
  #ground(g, lines, first, lh, r) {
    halo(g, lines, this.#cx, first, lh, r, this.#tok("--_ground", "#0c1112"));
  }

  /* What the hub says and in what colour. One method, so the name in the
     middle, the readout below it and the crumb line can never be of different
     things. */
  #named() {
    const ink = this.#tok("--_ink", "#e7eded");
    if (this.#kind === 2) {
      const e = this.#L.edges[this.#on];
      return { text: `${this.#name(e.from)}→${this.#name(e.to)}`, ink };
    }
    if (this.#kind === 1) return { text: this.#name(this.#on), ink };
    if (this.#letter >= 0) return { text: this.#name(this.#letter), ink };
    return { text: this.#category || "the letters", ink: this.#tok("--_muted", "#90a1a1") };
  }

  /* A point on the disc, as a letter, an arc, or nothing.
   *
   * The ring band answers with an arc and the band outside it with a letter,
   * both by binary search or by a walk over 26 — the same absence of a spatial
   * index both other discs have. Inside the ring an arc is answered for by
   * asking the path itself, since a ribbon there is a curved shape no
   * arithmetic short of the path describes; topmost first, so the answer is
   * the arc that is actually visible at that point. `near` refuses most of
   * them for two comparisons before a path is built at all, which is what
   * keeps this off the pointer's budget at 344 arcs. The transform is dropped,
   * because isPointInPath takes its point in the canvas's own space where the
   * paths are built in CSS pixels. */
  #hit(px, py) {
    const dx = px - this.#cx,
      dy = py - this.#cy,
      d = Math.hypot(dx, dy);
    if (d > this.#outer) return [0, -1];
    const t = (((Math.PI / 2 - Math.atan2(-dy, dx)) % TAU) + TAU) % TAU;
    const half = this.#bandPx / 2;
    if (d >= this.#r - half && d <= this.#r + half) {
      const k = arcAt(this.#L, t);
      if (k >= 0) return [2, this.#L.slotEdge[k]];
    }
    if (d > this.#r + half) {
      const L = letterAt(this.#L, t);
      return L >= 0 ? [1, L] : [0, -1];
    }
    if (d < this.#rHub) return [0, -1];
    const g = this.#over.getContext("2d");
    if (!g.isPointInPath) return [0, -1];
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    let got = [0, -1];
    for (let i = this.#L.order.length - 1; i >= 0; i--) {
      const k = this.#L.order[i];
      if (!near(this.#L.edges[k], t)) continue;
      ribbon(g, this.#cx, this.#cy, this.#r, this.#L.edges[k]);
      if (g.isPointInPath(px, py)) {
        got = [2, k];
        break;
      }
    }
    // A path is not part of the drawing state, so restoring does not drop the
    // last one built here and the next draw would begin on top of it.
    g.beginPath();
    g.restore();
    return got;
  }

  #at(ev) {
    return [ev.offsetX, ev.offsetY];
  }
  #onMove = ev => {
    const [px, py] = this.#at(ev);
    this.#inHub = Math.hypot(px - this.#cx, py - this.#cy) < this.#rHub;
    const [kind, on] = this.#inHub ? [0, -1] : this.#hit(px, py);
    this.#showCursor(kind);
    if (kind === this.#kind && on === this.#on) return;
    this.#preview(kind, on);
  };
  #onLeave = () => {
    this.#inHub = false;
    this.#preview(0, -1);
    this.#showCursor(0);
  };
  #onClick = ev => {
    const [px, py] = this.#at(ev);
    // The hub is the way out, which is the one thing clicking an arc cannot
    // do: it puts the column back to every arc the category has.
    if (Math.hypot(px - this.#cx, py - this.#cy) < this.#rHub) return this.show(-1);
    const [kind, on] = this.#hit(px, py);
    if (kind) this.#drill(kind, on);
  };

  /* The cursor says what a click would do. Written only when it turns over,
     since a pointer move fires several times over one arc and an inline style
     set per event is a style invalidation per event. */
  #showCursor(kind) {
    const on = this.#inHub ? this.#letter >= 0 : kind > 0;
    if (on === this.#points) return;
    this.#points = on;
    this.#over.style.cursor = on ? "pointer" : "default";
  }

  /* Everything pointing at a thing does and nothing else, so a row in the
     column and a suggestion in the search box both look exactly like a hover
     on the disc. It never touches #letter, which is what stops the list
     rebuilding under a pointer on its way to a row. */
  #preview(kind, on) {
    this.#kind = kind;
    this.#on = on;
    this.#markRow();
    this.#overlay();
    if (!kind) return;
    /* An arc and a letter are different things and are reported as different
       things. A letter used to carry a `words` of its starts plus its ends,
       which counts a word twice wherever it begins and ends on that letter —
       12 of animal's arcs do, over 52 words. */
    const e = kind === 2 ? this.#L.edges[on] : null;
    this.#emit(
      "letter-hover",
      e
        ? { kind: "arc", from: this.#name(e.from), to: this.#name(e.to), words: e.n }
        : {
            kind: "letter",
            letter: this.#name(on),
            starts: this.#L.starts[on],
            ends: this.#L.ends[on],
            arcs: this.#L.byLetter[on].length,
          },
    );
  }

  /* A click. Pointing at a thing highlights it and clicking it drills, which
     is the split all three discs make — and it is what keeps the list still
     while the pointer travels to it. An arc drills to the letter it leaves. */
  #drill(kind, on) {
    this.show(kind === 2 ? this.#L.edges[on].from : on);
    this.#preview(kind, on);
  }

  /* The letter the column lists, as a letter or an index, and -1 for every arc
     the category has. The public way in, so a host can drive the column
     without synthesising a pointer event. */
  show(letter) {
    if (!this.#L) return;
    const L = typeof letter === "string" ? letter.toLowerCase().charCodeAt(0) - 97 : letter;
    const want = Number.isInteger(L) && L >= 0 && L < LETTERS ? L : -1;
    if (want === this.#letter) return;
    this.#letter = want;
    this.#crumbs();
    this.#showList();
    this.#overlay();
    this.#emit("letter-pick", {
      letter: this.letter,
      arcs: want < 0 ? this.#L.edges.length : this.#L.byLetter[want].length,
    });
  }

  /* Call after the host changes theme by any means other than
     prefers-color-scheme, which the element already watches. */
  repaint() {
    this.#toks.clear();
    this.#fits.clear();
    this.#bands.clear();
    this.#draw();
    this.#overlay();
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #say(html) {
    this.#headEl.innerHTML = html;
    this.#tailEl.replaceChildren();
  }

  /* One line saying what the thing named in the middle is. It answers off the
     same state the hub does, so the name and the sentence below it can never
     be of different things.

     For an arc that is the words on it, named rather than counted, which is
     what ties this disc to <word-disc>: an arc is 32 words and this is which
     32. Past NAMED it says how many are left instead of running off the end of
     a block held to two lines. */
  #showRead() {
    if (!this.#ready) return;
    const L = this.#L;
    if (this.#kind === 2) {
      const e = L.edges[this.#on];
      const on = this.#words.filter(
        w => w && w.charCodeAt(0) - 97 === e.from && w.charCodeAt(w.length - 1) - 97 === e.to,
      );
      on.sort();
      const shown = on.slice(0, NAMED).join(", ");
      const rest = on.length - Math.min(on.length, NAMED);
      this.#glossEl.innerHTML =
        `<b>${this.#name(e.from)} → ${this.#name(e.to)}</b> · ${e.n} word${e.n === 1 ? "" : "s"}` +
        `${e.from === e.to ? " back to the letter they started on" : ""} · ` +
        `<span class="w">${shown}${rest ? ` and ${rest} more` : ""}</span>`;
      return;
    }
    const L2 = this.#kind === 1 ? this.#on : this.#letter;
    if (L2 >= 0) {
      const out = L.starts[L2],
        into = L.ends[L2];
      this.#glossEl.innerHTML =
        `<b>${this.#name(L2)}</b> · ${out} word${out === 1 ? "" : "s"} start here · ` +
        `${into} end here · ${L.out[L2].length} arc${L.out[L2].length === 1 ? "" : "s"} out, ` +
        `${L.into[L2].length} in`;
      return;
    }
    this.#glossEl.innerHTML =
      `<b>${L.words}</b> words over <b>${L.live.length}</b> letters, drawn as ` +
      `<b>${L.pairs}</b> arcs${L.loops ? `, ${L.loops} of them back to their own letter` : ""}. ` +
      `Point at an arc to read the words on it.`;
  }

  /* Every arc the disc draws, in the column beside it.
   *
   * The whole set at rest, heaviest first, which is what says at once which
   * letter pairs the category is actually made of; one letter's arcs once a
   * click has drilled into it, leaving ones first and then arriving. It is
   * only ever rebuilt by a click, never by a hover, so nothing moves under a
   * pointer travelling to a row.
   *
   * Only the landscape layout has room for it, so nothing is built otherwise —
   * on a phone the resting list would be 344 elements behind display:none. */
  #showList() {
    if (!this.#ready) return;
    if (!this.#frame.classList.contains("wide")) {
      if (this.#listEl.childElementCount) this.#listEl.replaceChildren();
      this.#rows = [];
      this.#listed = 0;
      return;
    }
    const L = this.#L;
    const lead = document.createElement("span");
    const key = document.createElement("b");
    if (this.#letter < 0) {
      this.#rows = L.edges
        .map((_, k) => k)
        .sort((x, y) => L.edges[y].n - L.edges[x].n || L.edges[x].from - L.edges[y].from);
      lead.textContent = `${L.pairs} arcs · heaviest first`;
    } else {
      const me = this.#letter;
      this.#rows = [...L.out[me], ...L.into[me].filter(k => L.edges[k].from !== me)];
      key.textContent = this.#name(me);
      lead.textContent = `${L.out[me].length} out, ${L.into[me].length} in · `;
    }
    this.#whyEl.replaceChildren(key, lead);
    this.#listed = 0;
    this.#listEl.replaceChildren();
    this.#listEl.scrollTop = 0;
    this.#page();
  }

  /* The next page of rows, appended. Nothing already placed is thrown away as
     it goes out of view, which is what makes this an append rather than a
     windowing scheme: scrolling back up is free and the scroll position never
     has to be guessed at. */
  #page() {
    const to = Math.min(this.#rows.length, this.#listed + ARCS_PAGE);
    if (to === this.#listed) return;
    const L = this.#L;
    const out = [];
    for (let i = this.#listed; i < to; i++) {
      const k = this.#rows[i];
      const e = L.edges[k];
      const li = document.createElement("li");
      li.dataset.k = k;
      // Arriving reads apart from leaving, as the ring band has it: this row
      // is dimmed where the letter the column is listing is the arc's target.
      if (this.#letter >= 0 && e.to === this.#letter && e.from !== this.#letter) {
        li.classList.add("in");
      }
      const pair = document.createElement("span");
      const arrow = document.createElement("span");
      arrow.className = "d";
      arrow.textContent = " → ";
      pair.append(this.#name(e.from), arrow, this.#name(e.to));
      const n = document.createElement("span");
      n.className = "w";
      n.textContent = String(e.n);
      li.append(pair, n);
      out.push(li);
    }
    this.#listEl.append(...out);
    this.#listed = to;
    // A page that did not fill the column leaves no scrollbar to ask for the
    // next one, so it asks here instead. Bounded by the list.
    if (this.#listEl.scrollHeight <= this.#listEl.clientHeight) this.#page();
    this.#markRow();
  }

  /* The row for the arc the pointer is on, marked so the column and the disc
     say the same thing. Written only where it moves. */
  #markRow() {
    const want = this.#kind === 2 ? this.#on : -1;
    for (const li of this.#listEl.children) {
      const on = +li.dataset.k === want;
      if (on !== li.classList.contains("on")) li.classList.toggle("on", on);
    }
  }

  #onQuery = () => {
    if (!this.#ready || !this.#words.length) return;
    this.#search ??= new Search(this.#words);
    this.#sug = this.#search.query(this.#q.value, 12);
    this.#pick = -1;
    this.#drawHits();
    this.#setPick(this.#sug.length ? 0 : -1);
  };

  #onFindKey = ev => {
    const n = this.#sug.length;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (!n) return;
      ev.preventDefault();
      this.#setPick((this.#pick + (ev.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (ev.key === "Enter") {
      if (this.#pick < 0) return;
      ev.preventDefault();
      this.#go(this.#sug[this.#pick].i);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      if (n) this.#closeFind();
      else {
        this.#q.value = "";
        this.#preview(0, -1);
      }
    }
  };

  /* The arc a word sits on. A word is not drawn here — its letter pair is — so
     searching for one reaches the arc it is one of, which is the whole of what
     this disc can say about a word and exactly what makes it worth searching
     for: it answers "where does cat sit in this picture". */
  #arcOfWord(i) {
    const w = this.#words[i];
    if (!w) return -1;
    const from = w.charCodeAt(0) - 97,
      to = w.charCodeAt(w.length - 1) - 97;
    return this.#L.edges.findIndex(e => e.from === from && e.to === to);
  }

  #go(i) {
    this.#closeFind();
    const k = this.#arcOfWord(i);
    if (k >= 0) this.#drill(2, k);
  }

  #drawHits() {
    const q = this.#q.value.trim().toLowerCase();
    this.#hits.replaceChildren(
      ...this.#sug.map((hit, k) => {
        const li = document.createElement("li");
        li.id = `hit-${k}`;
        li.dataset.k = k;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const name = document.createElement("span");
        name.className = "n";
        const at = hit.name.toLowerCase().indexOf(q);
        if (at < 0) name.textContent = hit.name;
        else {
          const b = document.createElement("b");
          b.textContent = hit.name.slice(at, at + q.length);
          name.append(hit.name.slice(0, at), b, hit.name.slice(at + q.length));
        }
        // The arc it sits on, which is the only thing about a word this disc
        // draws at all.
        const pair = document.createElement("span");
        pair.className = "p";
        pair.textContent = `${hit.name[0].toUpperCase()} → ${hit.name.at(-1).toUpperCase()}`;
        li.append(name, pair);
        return li;
      }),
    );
    this.#hits.hidden = this.#sug.length === 0;
    this.#arcsEl.hidden = this.#sug.length > 0;
    this.#q.setAttribute("aria-expanded", String(this.#sug.length > 0));
  }

  #setPick(k) {
    this.#pick = k;
    for (const [j, li] of [...this.#hits.children].entries())
      li.setAttribute("aria-selected", String(j === k));
    if (k < 0) {
      this.#q.removeAttribute("aria-activedescendant");
      this.#preview(0, -1);
      return;
    }
    this.#q.setAttribute("aria-activedescendant", `hit-${k}`);
    this.#hits.children[k].scrollIntoView({ block: "nearest" });
    const arc = this.#arcOfWord(this.#sug[k].i);
    if (arc >= 0) this.#preview(2, arc);
  }

  #closeFind = () => {
    this.#sug = [];
    this.#pick = -1;
    this.#hits.replaceChildren();
    this.#hits.hidden = true;
    this.#arcsEl.hidden = false;
    this.#q.setAttribute("aria-expanded", "false");
    this.#q.removeAttribute("aria-activedescendant");
  };

  /* The category and, once a click has drilled into one, the letter the column
     is listing. The category is a label rather than a step — it is where the
     letters came from rather than one of them — which is <word-disc>'s
     treatment and its reason: drawn alike, it read as the first thing on the
     path. */
  #crumbs() {
    if (this.#failed) return;
    const root = this.#category || "the letters";
    this.#headEl.innerHTML =
      this.#letter >= 0
        ? `<button type="button" class="root" data-l="-1">${root}</button>` +
          `<span class="now">${this.letter}</span>`
        : `<span class="root">${root}</span>`;
    this.#showTail();
  }

  /* What the pointer is on, carried past the crumb the way a click would leave
     it. Muted, so what has been clicked into still reads as where the disc is
     and this as a pointer passing over. */
  #showTail() {
    if (this.#failed) return;
    if (!this.#kind) {
      this.#tailEl.innerHTML = "";
      return;
    }
    const gap = this.#letter >= 0 ? "<i>›</i>" : "";
    if (this.#kind === 1) {
      this.#tailEl.innerHTML =
        this.#on === this.#letter ? "" : `${gap}<em>${this.#name(this.#on)}</em>`;
      return;
    }
    const e = this.#L.edges[this.#on];
    this.#tailEl.innerHTML = `${gap}<em>${this.#name(e.from)} → ${this.#name(e.to)}</em>`;
  }
}
customElements.define("letter-disc", LetterDisc);
