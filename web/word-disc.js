/* <word-disc> — the word chain game, played on the disc render.py draws.
 *
 * Data is {category, words: ["cat", …], zipf: [4.7, …]}, which
 * tools/export_words.py writes one file per category.
 *
 *   <word-disc src="words-animal.json"></word-disc>
 *   <word-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("word-disc").data = {category, words, zipf};
 *
 * Pick a word and the disc lights every word that can follow it — one whole
 * wedge less what is used, since the successors of a word are exactly the words
 * starting with the letter it ends on. The line under the disc is the chain so
 * far: its steps wind play back to themselves and its root, the category,
 * clears it.
 *
 * Every chord the SVG draws is cached to a bitmap and blitted per frame, so a
 * move blits the bundle and draws only the fan on top of it.
 *
 * word-layout.js is the placement, word-chain.js the rule and word-bundle.js
 * the resting picture; none of the three touches the DOM, so
 * tools/check_web.mjs runs them without a browser.
 *
 * A host naming an index-src gets a picker above the search box and the element
 * changes its own category, the word files sitting beside the index. Without
 * the attribute the picker is not built at all.
 *
 * Attributes: src, index-src (words-index.json, which turns the picker on),
 *             tree (the id of a <hypernym-disc>, whose node the picker then
 *             offers as a category; see disc-picker.js),
 *             group (hosts sharing it take the reader's category together),
 *             limit (0, every word the category has; a count caps it),
 *             readout="off", search="off", hint="off", fit
 * Properties: data, words, chain, stats. Methods: play(i), undo(), rewind(k),
 *             clear(), repaint().
 * Events: word-hover {index,word,replies}, word-play {index,word,chain},
 *         word-chain {chain,words,stuck},
 *         word-render {words,chords,drawMs,bundle,bundlePx,thread}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-warn --disc-sat --disc-val --disc-font --disc-mono
 */
import { hsv, TAU } from "./disc-colour.js";
import { Picker } from "./disc-picker.js";
import { band, baseline, fit, halo, HALO, HALO_MIN, HUB_DROP } from "./disc-label.js";
import { ratio } from "./disc-ratio.js";
import { Search } from "./disc-search.js";
import { Chain } from "./word-chain.js";
import { longest } from "./word-longest.js";
import { watch } from "./disc-idle.js";
import { bundle as strokeBundle, curve, release, RING, square, thin } from "./word-bundle.js";
import {
  alphabetical,
  at,
  chords,
  layout,
  LABEL_RADIUS,
  LETTERS,
  rankOrder,
  solve,
  spelling,
  spans,
  turns,
  WEDGE_BAND,
} from "./word-layout.js";

// The largest spelling place taken from data, far above the word table's
// 40,118 words and small enough that the counting sort's array stays cheap.
const SPELL_MAX = 1 << 20;
// The hub's "back" hint: its size, and the room it takes from the name above.
const HINT_PX = 11,
  HINT_H = 15;
// The sizes the hub's name steps down through, and its weight. The ladder is
// capped low deliberately: set larger the name reads as the figure rather than
// as a label on it, over the middle where the long chords cross. It is the
// weight that sets it apart, and the halo rather than the size that keeps it
// legible over the bundle.
const HUB_SIZES = [16, 14, 12, 10, 8],
  HUB_WEIGHT = 700;
// The halo, the reference band and the baseline arithmetic are disc-label.js's,
// shared by all three discs. The halo is what lets the name sit over the chords
// that cross the hub: it clears its own letters and nothing more, where a panel
// wide enough to hold the name would cover the middle of the figure.
// The search column beside the disc, and the gutter to it. Same thresholds as
// <hypernym-disc>, so the two elements break to landscape together.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
const RESIZE_HOLD = 60;
// How many rows the column puts in the DOM at a time, and how near the foot of
// it a scroll has to come before the next lot follow. Nothing is capped, and
// the page is large enough that no move set is ever paged and that one page
// always overfills the column, so the scrollbar says at once there is more.
const MOVES_PAGE = 200,
  MOVES_NEAR = 240;

// The wedge letter that sits outside the labels. Every other distance the disc
// needs is solved in word-layout.js, where it can be checked without a canvas.
const WEDGE_PX = 15;

// How far under the widest estimate a word may fall and still be measured
// whole in #measure. Over entity in Libertinus Serif a word runs from 6.3%
// narrower than its characters' sum (the fl ligature) to 1.7% wider (rv
// kerned), so the widest word is always among those measured once this is
// past 1 - 0.983/1.063, or 7.5%. At 10% entity measures 1 word whole, and none
// of the 37 categories or of every 25th node measures more than 11.
const SLACK = 0.1;

// How far off a chord the pointer may sit and still be on it. The fan is drawn
// a pixel wide, which is a line to look at rather than a line to hit.
const HIT_PX = 5;

// Where the dots give out and the disc is chords alone. #onMove reads it too,
// so what holds the anchor is the same boundary the hit test crosses.
const INNER = 0.62;

// How far a chord's control points sit towards the centre, and the tighter
// figure past 150 words. config.Geometry's pull and pull_dense.
const PULL = 0.32,
  PULL_DENSE = 0.2,
  DENSE = 150;
// The resting bundle's opacity, and what is left of it once a chain is being
// built and the fan on top is the thing to read. palette.Theme's edge_alpha.
const EDGE_ALPHA = 0.2,
  BUNDLE_DIM = 0.22;

// What the worker gets to answer in, timed from the first bundle the element
// actually wants rather than from the worker's construction. It guards against
// a worker that loads and never answers, which would otherwise leave the disc
// without its picture for good.
const WORKER_FLOOR = 400;

const TPL = document.createElement("template");
TPL.innerHTML = `
<style>
  :host{display:block;position:relative;
    --_ground:var(--disc-ground,#0c1112); --_panel:var(--disc-panel,#141b1c);
    --_ink:var(--disc-ink,#e7eded); --_muted:var(--disc-muted,#90a1a1);
    --_accent:var(--disc-accent,#59b491); --_warn:var(--disc-warn,#e8705f);
    --_sat:var(--disc-sat,.55); --_val:var(--disc-val,.88);
    --_font:var(--disc-font,system-ui,sans-serif);
    --_mono:var(--disc-mono,ui-monospace,Menlo,monospace);
    --_edge:color-mix(in srgb,var(--_muted) 38%,transparent);
    color:var(--_ink);font-family:var(--_font)}
  @media (prefers-color-scheme:light){
    :host{--_ground:var(--disc-ground,#eef1f0); --_panel:var(--disc-panel,#fbfcfc);
      --_ink:var(--disc-ink,#131a1b); --_muted:var(--disc-muted,#5d6d6e);
      --_accent:var(--disc-accent,#2c7359); --_warn:var(--disc-warn,#b8342a);
      --_sat:var(--disc-sat,.62); --_val:var(--disc-val,.60)}}
  .frame{display:block}
  :host([fit]){height:100%}
  :host([fit]) .frame{display:flex;flex-direction:column;height:100%}
  :host([fit]) .stage{flex:1;min-height:0;width:auto;max-width:100%;align-self:center}
  /* Four rows, the first of them the picker's. There is no row-gap, so with
     no index named that row measures nothing and every distance below is what
     it was before the picker existed. */
  :host([fit]) .frame.wide{display:grid;column-gap:18px;
    grid-template-columns:minmax(200px,280px) minmax(0,1fr);
    grid-template-rows:auto minmax(0,1fr) auto auto}
  /* One box around the column. The frame's own ::before placed as a grid item
     rather than an element wrapping the column, since the picker, the search
     box and the definition are three separate grid items and the stacked
     layout puts the definition under the disc instead. Generated first, so it
     paints behind them, and those three carry the padding that keeps their
     text off it. */
  :host([fit]) .frame.wide::before{content:"";grid-area:1/1/4/2;
    border:1px solid var(--_edge);border-radius:3px;pointer-events:none}
  :host([fit]) .frame.wide .pick{grid-area:1/1;padding:10px 10px 0}
  :host([fit]) .frame.wide .find{grid-area:2/1;margin-bottom:0;padding:0 10px 10px;
    display:flex;flex-direction:column;min-height:0}
  /* With no index named the picker's row measures nothing, so the top of the
     box is the search box's own top and the inset has to come from there. */
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
  /* The category picker, on where the host names an index. search="off" is
     about finding a word, so it keeps the picker a host asked for. The native
     appearance stays, since stripping it takes the arrow with it and the arrow
     is what says the control opens a list. */
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
  /* A word the chain cannot reach is dimmed on the disc, and saying so here
     as well stops a suggestion reading as a move that is available. */
  .hits li.no .n{color:var(--_muted)}
  /* A word already used reads on the list as it does on the disc. */
  .hits li.used .n{color:var(--_warn)}
  /* Every word that could be played next, in the column the search box
     otherwise leaves empty. Landscape only: the stacked layout has no column,
     and there the suggestions are a dropdown over the disc. It is the only
     place the moves can be read where the disc drops its labels. */
  .moves{display:none}
  :host([fit]) .frame.wide .moves{display:flex;flex-direction:column;
    flex:1 1 auto;min-height:0;margin-top:9px}
  :host([fit]) .frame.wide .moves[hidden]{display:none}
  .moves .why{font-family:var(--_mono);font-size:10.5px;color:var(--_muted);
    flex:none;padding-bottom:5px}
  .moves .why b{color:var(--_accent);font-weight:600}
  /* Two up, by inline blocks of half the width rather than by a grid, which
     keeps the reading order left to right and then down.

     line-height:0 on the list, and every row setting its own: an inline block's
     line box also holds the inherited strut, whose descent hangs below the rows
     as a few pixels of list that is no row and makes the hover blink as a
     pointer crosses it. Not font-size:0, under which a row that drew no text
     would still be a visible box. */
  .moves .list{margin:0;padding:3px;list-style:none;flex:1 1 auto;min-height:0;
    overflow-y:auto;scrollbar-width:thin;line-height:0;background:var(--_panel);
    border:1px solid var(--_edge);border-radius:2px}
  /* border-box because the page's own box-sizing rule does not cross into a
     shadow root, and content-box would put two halves and their padding past
     the width and wrap every second word onto a line of its own. No margin
     between the pair, which would be dead ground between two hover targets;
     they come to 2 px short of the width, so no rounding can wrap them. */
  .moves li{box-sizing:border-box;display:inline-block;vertical-align:top;
    width:calc(50% - 1px);
    color:var(--_ink);font-size:12.5px;line-height:1.5;
    padding:2px 5px;border-radius:2px;cursor:pointer;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .moves li:hover{background:color-mix(in srgb,var(--_accent) 18%,transparent)}
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  /* The arrow is the resting state and #onMove lifts it to a pointer over
     what a click would actually take: a legal word, or the hub with a chain
     to wind back. A word already used looks like any other to the cursor. */
  canvas.over{cursor:default;touch-action:none}
  :host([readout="off"]) .gloss,:host([readout="off"]) .crumb{display:none}
  /* Both are held to a height whatever they hold, which is what stops the disc
     moving under the pointer: with the fit attribute set the frame is a flex
     column and the stage takes what these two leave, so a block that grows by
     a line takes a line off the disc's height and, the stage being square, as
     much off its width. Both show blank rather than hiding while empty, for
     the same reason. A host that wants neither has readout="off". */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .gloss .warn{color:var(--_warn)}
  /* The word's own last letter, which is what decides what can follow it: a
     rule as well as a colour, since colour alone says nothing to a reader who
     cannot see it. */
  .gloss .last{color:var(--_accent);text-decoration:underline;
    text-underline-offset:3px;text-decoration-thickness:2px}
  .crumb{font-family:var(--_mono);font-size:11px;color:var(--_muted);line-height:1.6;
    min-height:1.6em;margin-top:3px;white-space:nowrap;overflow-x:auto;
    scrollbar-width:none}
  .crumb::-webkit-scrollbar{display:none}
  .crumb button{font:inherit;color:var(--_accent);background:none;border:0;padding:0;
    cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .crumb .now{color:var(--_ink)}
  .crumb em{font-style:normal}
  .crumb i{font-style:normal;color:var(--_muted);opacity:.5;padding:0 4px}
  .crumb b{color:var(--_ink);font-weight:600}
  /* The category the words came from, which is not one of them: outside the
     chevrons, in the body face against their monospace, with a rule rather
     than a separator, since reading as a step in the chain is the one thing it
     must not do. Kept at the line's own size, so its line box cannot be the
     taller one and give the crumb a height that depends on what is in it. */
  .crumb .root{font-family:var(--_font);font-style:italic;color:var(--_muted);
    border-right:1px solid var(--_edge);padding-right:9px;margin-right:9px}
  /* Muted until pointed at, so it offers itself as a way back without
     competing with the steps, which are the path. */
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
    <div class="moves"><div class="why"></div><ul class="list"></ul></div>
  </div>
  <div class="stage">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" aria-hidden="true"></canvas>
  </div>
  <div class="gloss"></div>
  <div class="crumb"><span class="head"></span><span class="tail"></span></div>
</div>`;

class WordDisc extends HTMLElement {
  static observedAttributes = ["src", "index-src", "tree", "limit"];

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
  #movesEl;
  #whyEl;
  #listEl;
  // The picker and its select, built only where the host names an index.
  #pickEl;
  #catEl;
  // Every move, sorted, and how many of them are in the DOM. The rest follow
  // as the column is scrolled.
  #moves = [];
  #listed = 0;
  #ro;
  #mq;

  #category = "";
  #all = [];
  #zipf = [];
  // Each of #all's places in alphabetical order, which is what every sort by
  // spelling compares instead of the strings.
  #allSpell = new Int32Array(0);
  // The words actually drawn, commonest first, the same places for them, and
  // the layout over them.
  #words = [];
  #spell = new Int32Array(0);
  // The drawn words in alphabetical order, which the column of moves filters.
  #alpha = new Int32Array(0);
  // Bumped by every build, so work #later put off for a word set that has
  // since gone is dropped. #settled is clear while that work is waiting.
  #builds = 0;
  #settled = true;
  #L = null;
  #chain = null;
  // Turns clockwise from the top for each word in placement order, which is
  // what the hit test binary-searches. Strictly increasing by construction.
  #turn = null;
  #search = null;
  #sug = [];
  #pick = -1;
  #hover = -1;
  // Where the search left the highlight, and -1 when nothing holds it.
  // What perfect play still allows, held per word: a pointer crossing the
  // disc asks about the same word many times over, and the answer only moves
  // when the chain does. #bestRun is the same question of the whole word set.
  #reachOf = new Map();
  #bestRun = -1;
  #cursor = -1;
  #crumbSel = -2;
  #failed = false;
  #ready = false;
  #loadedSrc = null;
  #picker;

  /* The bundle, drawn once per word set and blitted per frame. Held in its own
     square rather than the frame's, so a resize scales the blit and only a
     crossed size step rebuilds; the old bitmap goes on being drawn until the
     new one lands, so a rebuild has no blank in it. */
  #cache = null;
  #cachePx = 0;
  // What the held bitmap is of, and what has been asked for: the word set and
  // the colours through #gen, the square through the size step.
  #cacheKey = "";
  #asked = "";
  #gen = 0;
  #chordCount = 0;
  #drawMs = 0;

  // Where the bundle is built: undefined until the element connects, "wait"
  // while the worker is answering, then "worker" or "main" for the rest of the
  // element's life.
  #route = undefined;
  #worker = null;
  // The worker before it has answered, and the deadline it is answering
  // against, which #armFloor starts only once a bundle is wanted.
  #pending = null;
  #settle = null;
  #floor = 0;

  // Set while the disc is more than a screen away and its canvases have been
  // given back. #pw is 0 with it, which is what every draw path already tests.
  #asleep = false;
  #idle = null;
  // A bundle wanted while the worker is still answering, sent when it does.
  #queued = null;
  // Whether a draw is on the stack, so a bundle built on this thread is blitted
  // by the draw that asked for it rather than starting a second one.
  #drawing = false;

  #cx = 0;
  #cy = 0;
  #r = 1;
  #rHub = 1;
  #labelPx = 0;
  // Where the labels end: the wedge letter sits outside it and the hit test
  // reaches to it.
  #outer = 1;
  #dpr = 1;
  #pw = 0;
  #ph = 0;
  // Width of the widest word per pixel of font size, which is what the sizing
  // solves against. Measured once per word set and per face.
  #widest = 0;
  #toks = new Map();
  #fits = new Map();
  // The ink band per font, held beside the fitted lines and cleared with them,
  // since a resize or a restyle can change the face as well as the size.
  #bands = new Map();
  // Whether the cursor is currently a pointer and whether the pointer is over
  // the hub, both held so the cursor can be recomputed after a move as well as
  // after a pointer event.
  #points = false;
  #inHub = false;
  /* The word the pointer was on when it crossed into the chords, held until it
     comes back out. Only at rest: where play stands there is one fan drawn and
     it is the chain's own, so #anchor answers off the chain instead. */
  #held = -1;
  #box = null;
  #resized = -Infinity;
  #fitTimer = 0;
  // The resolution query, re-armed on every change; see #onRatio.
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
    this.#movesEl = this.#sr.querySelector(".moves");
    this.#whyEl = this.#movesEl.querySelector(".why");
    this.#listEl = this.#movesEl.querySelector(".list");
    this.#pickEl = this.#sr.querySelector(".pick");
    this.#catEl = this.#sr.querySelector(".cat");
    this.#picker = new Picker(this, this.#pickEl, this.#catEl, {
      open: src => {
        // Opened even where it is the file already held, since the tree's
        // words may be drawn over it.
        this.#loadedSrc = null;
        if (this.getAttribute("src") === src) this.#load();
        else this.setAttribute("src", src);
      },
      apply: d => {
        this.data = d;
      },
      ready: () => this.#ready,
      category: () => this.#category,
      fail: msg => {
        if (!this.#ready) {
          this.#say(msg);
          this.#failed = true;
        }
      },
    });
  }

  connectedCallback() {
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerleave", this.#onLeave);
    this.#over.addEventListener("click", this.#onClick);
    this.#crumb.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) this.rewind(+b.dataset.k + 1);
    });
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
    // The list does exactly what the disc does: hovering an entry is hovering
    // its dot, and clicking one is clicking it. Delegated, since the list is
    // rebuilt on every move.
    this.#listEl.addEventListener("pointermove", e => {
      /* A move landing on no row holds what the last one set rather than
         clearing the preview: a pointer is over the list and over no row at
         every seam — the list's padding, the slack at the end of a line, a
         hairline between two rows abutting at a fractional width — so clearing
         here makes the highlight blink all the way down the column. Leaving
         the list is what clears it, which is what pointerleave is for. */
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      const i = +li.dataset.i;
      if (i !== this.#hover) this.#preview(i);
    });
    this.#listEl.addEventListener("pointerleave", () => this.#preview(-1));
    this.#listEl.addEventListener("click", e => {
      const li = e.target.closest("li[data-i]");
      if (li) this.play(+li.dataset.i);
    });
    this.#listEl.addEventListener("scroll", () => {
      const el = this.#listEl;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - MOVES_NEAR) this.#page();
    });
    this.#ro = new ResizeObserver(() => this.#fit());
    /* Both boxes, because they do not move together: the stage is what the
       canvases are sized from and the frame's shape is what decides the
       layout. Stacked, the stage is a square of the height the flex column
       leaves it, so a frame dragged wider leaves its box exactly where it was
       and an element observing the stage alone would stay stacked for good. */
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#ro.observe(this.#frame);
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    this.#onRatio();
    // Canvas text is measured rather than laid out, so a face swapping in has
    // to be remeasured. #resize rather than repaint(), because the label size
    // is solved from #widest, which repaint() leaves alone. #box is null until
    // the first fit, and a face landing before that needs nothing.
    document.fonts?.ready?.then(() => {
      if (this.#box) this.#resize();
    });
    // Before the fetch, not after the first draw asks for a bundle, so the
    // worker's module fetch runs alongside the word file's. The deadline is
    // #armFloor's and is not started here.
    if (this.#route === undefined) this.#openBundler();
    if (!this.#ready) this.#load();
    this.#picker.connect();
    this.#idle = watch(this, this.#sleep, this.#wake);
  }
  disconnectedCallback() {
    this.#picker.disconnect();
    this.#ro?.disconnect();
    this.#idle?.disconnect();
    this.#idle = null;
    this.#mq?.removeEventListener("change", this.#onScheme);
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = null;
    // Terminated, where the nested disc's is not: this one holds no canvas of
    // the element's, so there is nothing that could only be handed over once.
    clearTimeout(this.#floor);
    this.#floor = 0;
    this.#pending?.terminate();
    this.#worker?.terminate();
    this.#pending = this.#worker = null;
    this.#route = undefined;
    this.#settle = null;
    this.#queued = null;
    this.#asked = this.#cacheKey;
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "index-src") this.#picker.index();
    if (n === "tree") this.#picker.tree();
    // A different limit is a different word list, so the layout, the chain and
    // the bundle all go: a chain over words no longer drawn has nothing to
    // stand on.
    if (n === "limit" && this.#ready) this.#build();
  }
  #onScheme = () => this.repaint();

  async #load() {
    const src = this.getAttribute("src");
    try {
      if (src) {
        if (src === this.#loadedSrc) return;
        this.#loadedSrc = src;
        this.#picker.release();
        const d = await (await fetch(src)).json();
        // The reader chose the tree's node while the file was on its way.
        if (this.#picker.following) return;
        this.data = d;
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

  set data(d) {
    if (!d?.words) return;
    this.#category = d.category ?? "";
    this.#picker.mark(this.#category);
    this.#all = Array.from(d.words);
    // Without frequencies the file's own order stands, which is what a host
    // building a list by hand would mean by it.
    this.#zipf = d.zipf ? Array.from(d.zipf) : this.#all.map((_, i) => -i);
    // A source that knows the order already hands it over (word-source.js
    // does, from one sort of its whole table); anything else is sorted here.
    this.#allSpell = places(d.spell, this.#all.length) ?? spelling(this.#all);
    this.#build();
    this.#ready = true;
    this.#fit();
  }
  get data() {
    return { category: this.#category, words: this.#all, zipf: this.#zipf };
  }
  get words() {
    return this.#words.slice();
  }
  /* The chain as words, which is what a host wants and never the indices. */
  get chain() {
    return this.#chain ? this.#chain.steps.map(i => this.#words[i]) : [];
  }
  get stats() {
    return {
      category: this.#category,
      words: this.#words.length,
      of: this.#all.length,
      chords: this.#chordCount,
      bundle: this.#cache !== null,
      // The square the bundle is held at and the thread it was drawn on.
      bundlePx: this.#cachePx,
      thread: this.#route === "worker" ? "worker" : "main",
      labelPx: this.#labelPx,
      drawMs: this.#drawMs,
      chain: this.#chain?.length ?? 0,
    };
  }

  /* Every word the category has, unless the host names a count. Zero is no
     limit rather than a blank disc, the way it reads in a head or a tail.

     `build` draws 110 instead, and the two differ for a reason: the SVG grows
     its canvas until the labels clear each other and shrinks the type when it
     runs out, where the element has whatever frame the host gave it and drops
     the labels instead, the hub then naming what the pointer is on. */
  #limit() {
    const want = this.getAttribute("limit");
    if (want === null) return 0;
    const n = Math.round(+want);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  #build() {
    const ranked = rankOrder(this.#all, this.#zipf, this.#allSpell);
    const n = this.#limit();
    const kept = n ? ranked.slice(0, n) : ranked;
    this.#words = kept.map(i => this.#all[i]);
    this.#spell = Int32Array.from(kept, i => this.#allSpell[i]);
    this.#L = layout(this.#words, this.#spell);
    this.#alpha = alphabetical(this.#spell);
    this.#chain = new Chain(this.#L.head, this.#L.tail);
    this.#chordCount = chords(this.#L);
    this.#reachOf.clear();
    this.#bestRun = -1;
    this.#hover = -1;
    this.#cursor = -1;
    this.#held = -1;
    this.#search = null;
    this.#widest = 0;
    // A different word set, so the held bundle is of words no longer on the
    // disc and goes rather than being blitted until a replacement lands. A
    // resize keeps its bundle; this cannot.
    release(this.#cache);
    this.#cache = null;
    this.#cacheKey = "";
    this.#asked = "";
    this.#gen++;
    // Whatever is in the box is now a query about words that are no longer
    // drawn, so it goes with the suggestions.
    this.#q.value = "";
    this.#closeFind();
    this.#q.disabled = this.#words.length === 0;
    if (!this.#q.disabled) this.#q.placeholder = "Search words…";

    this.#turn = turns(this.#L);

    this.#crumbs();
    // The old column names words that are no longer drawn, and a row clicked
    // now would play whatever word took its index, so it goes at once.
    this.#listEl.replaceChildren();
    this.#whyEl.replaceChildren();
    this.#moves = [];
    this.#listed = 0;
    this.#later();
    if (this.#pw) {
      this.#measure();
      this.#geometry();
      this.#draw();
      this.#overlay();
    }
  }

  /* What the disc can do without for a frame, run once it has painted. For
     entity's 40,117 words the column of moves took 16 ms and the longest
     chain 7 ms, both in the task that drew the disc, which held the new
     picture back by as much. A hidden page runs no frames, so there it waits
     for a task alone. */
  #later() {
    const b = ++this.#builds;
    this.#settled = false;
    const run = () => {
      if (b !== this.#builds) return;
      this.#settled = true;
      this.#showMoves();
      this.#showRead();
    };
    if (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden")
      requestAnimationFrame(() => setTimeout(run, 0));
    else setTimeout(run, 0);
  }

  #shape() {
    const f = this.#frame.getBoundingClientRect();
    const want = this.hasAttribute("fit") && f.width - f.height >= ASIDE_MIN + ASIDE_GAP;
    if (want === this.#frame.classList.contains("wide")) return false;
    this.#frame.classList.toggle("wide", want);
    // Built on the way into the wide layout and dropped on the way out, since
    // the column exists only there. A build still waiting on its frame builds
    // the column then.
    if (this.#ready && this.#settled) this.#showMoves();
    return true;
  }

  /* Browser zoom moves devicePixelRatio and leaves the CSS box alone, so an
     element a host sized in pixels sees no observation and would go on
     painting at the resolution before the zoom. A query naming the current
     ratio has to be re-armed on every change, since it can only report leaving
     the one value it names. */
  #onRatio = () => {
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.#dq.addEventListener("change", this.#onRatio);
    this.#fit();
  };

  #fit() {
    if (!this.#ready || this.#asleep) return;
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
    // The dots, the labels and the sizing solved against them are a frame's
    // work on a large category, so the first change goes through outright and
    // the rest are coalesced; the canvases stretch until the drag stops.
    if (performance.now() - this.#resized > RESIZE_HOLD) return this.#resize();
    clearTimeout(this.#fitTimer);
    this.#fitTimer = setTimeout(this.#resize, RESIZE_HOLD);
  }

  /* A disc more than a screen away gives its pixels back: two canvases and the
     resting bundle. #pw going to 0 is what stops every draw path, since each
     already refuses an unsized stage, and #asleep is what stops #fit sizing
     them again under the resize observer, which goes on firing at an element
     nobody can see. Nothing is dropped before the first fit, so a disc that
     starts below the fold never allocates at all. */
  #sleep = () => {
    if (this.#asleep) return;
    this.#asleep = true;
    if (!this.#pw) return;
    release(this.#cache);
    this.#cache = null;
    this.#cachePx = 0;
    this.#cacheKey = "";
    this.#asked = "";
    for (const c of [this.#base, this.#over]) {
      c.width = 0;
      c.height = 0;
    }
    this.#pw = this.#ph = 0;
  };

  /* And takes them back a screen before it is read. The fit sizes both
     canvases and draws, and the draw asks for the bundle again. */
  #wake = () => {
    if (!this.#asleep) return;
    this.#asleep = false;
    // Coming back into view is not a drag, and the disc is about to be read,
    // so the fit goes through outright rather than on the trailing timer.
    this.#resized = 0;
    this.#fit();
  };

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
    this.#widest = 0;
    // The bundle is not dropped here: it is held in its own square, so the
    // blit scales it and only a crossed size step asks for another.
    this.#measure();
    this.#geometry(Math.min(b.w, b.h));
    this.#draw();
    this.#overlay();
  };

  /* The widest word, in pixels per pixel of font size, the labels being set in
     the host's proportional face. Once per word set and per face.

     Measuring every word cost 74 ms of a 181 ms switch to entity's 40,117, so
     each word is first estimated as the sum of its characters' advances, each
     character measured once. Kerning and ligatures move a word off that sum,
     so the words within SLACK of the widest estimate are measured whole, and
     the answer is the widest of those. */
  #measure() {
    if (this.#widest || !this.#words.length) return;
    const g = this.#over.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = `100px ${this.#tok("--_font", "sans-serif")}`;
    const words = this.#words;
    // ASCII in a table, which covers every word an export writes, and anything
    // a host hands over beyond it in a map.
    const ascii = new Float64Array(128).fill(-1);
    /** @type {Map<number, number>} */
    const rest = new Map();
    const est = new Float64Array(words.length);
    let top = 0;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let sum = 0;
      for (let k = 0; k < word.length; k++) {
        const c = word.charCodeAt(k);
        let a = c < 128 ? ascii[c] : (rest.get(c) ?? -1);
        if (a < 0) {
          a = g.measureText(word[k]).width;
          if (c < 128) ascii[c] = a;
          else rest.set(c, a);
        }
        sum += a;
      }
      est[i] = sum;
      if (sum > top) top = sum;
    }
    const floor = top * (1 - SLACK);
    let w = 0;
    for (let i = 0; i < words.length; i++)
      if (est[i] >= floor) w = Math.max(w, g.measureText(words[i]).width);
    this.#widest = w / 100;
  }

  /* Everything the disc measures, off the square the host left it. `solve` is
     the whole of it and lives in word-layout.js, since a sizing that comes back
     with a negative radius is what nothing downstream tests for. */
  #geometry(size) {
    const s = size ?? Math.min(this.#pw, this.#ph) / this.#dpr;
    const got = solve(this.#L.span, this.#widest, s);
    this.#r = got.r;
    this.#labelPx = got.labelPx;
    this.#rHub = got.hub;
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
     custom properties the host sets. */
  #hue(letter) {
    return hsv(letter / LETTERS, +this.#tok("--_sat", ".55"), +this.#tok("--_val", ".88"));
  }
  #x(i, at = 1) {
    return this.#cx + Math.cos(this.#L.ang[i]) * this.#r * at;
  }
  #y(i, at = 1) {
    return this.#cy - Math.sin(this.#L.ang[i]) * this.#r * at;
  }

  /* The fan and the chain, in the frame's own coordinates. `curve` is shared
     with word-bundle.js, so the live chords and the resting ones underneath
     them are the same shape drawn at two scales. */
  #chord(g, i, j, pull) {
    curve(g, this.#cx, this.#cy, this.#x(i), this.#y(i), this.#x(j), this.#y(j), pull);
  }

  /* Ask for the bundle the disc as it stands wants, and say nothing if that is
     the one already held or already asked for. Nothing here waits: the held
     bitmap goes on being blitted, stretched to the new radius, until a newer
     one arrives, which is why a rebuild has no blank in it. */
  #wantBundle() {
    if (!this.#words.length) return;
    const px = square(this.#r, this.#dpr);
    const key = `${this.#gen}:${px}`;
    if (key === this.#cacheKey || key === this.#asked) return;
    this.#asked = key;
    const spec = {
      id: key,
      px,
      ang: Float64Array.from(this.#L.ang),
      byHead: this.#L.byHead,
      tail: this.#L.tail,
      live: this.#L.live,
      // Resolved here rather than in the worker, which has no element to read
      // a custom property off.
      colours: Array.from({ length: LETTERS }, (_, L) => this.#hue(L)),
      pull: this.#words.length > DENSE ? PULL_DENSE : PULL,
      alpha: thin(this.#words.length > DENSE ? EDGE_ALPHA * 0.55 : EDGE_ALPHA, this.#chordCount),
      // Half a CSS pixel once the square has been blitted down onto the ring,
      // which is the weight the figure was tuned at.
      lineWidth: (0.5 * px * RING) / this.#r,
    };
    // Opened at connect, so this is only the path a disconnect left behind.
    if (this.#route === undefined) this.#openBundler();
    if (this.#route === "wait") {
      this.#queued = spec;
      this.#armFloor();
    } else if (this.#route === "worker") this.#worker.postMessage(spec);
    else this.#here(spec);
  }

  /* The same module the worker runs, against a canvas of this document's: the
     fallback where there is no OffscreenCanvas or Worker, and what
     tools/check_web.mjs drives, so it cannot drift from the fast path. */
  #here(spec) {
    const c = document.createElement("canvas");
    c.width = spec.px;
    c.height = spec.px;
    const g = c.getContext("2d");
    if (!g) return;
    strokeBundle(g, spec);
    this.#gotBundle({ id: spec.id, px: spec.px, bitmap: c });
  }

  /* A bundle that has landed, from either thread. A stale one is dropped, the
     word set or the colours having moved on while it was drawn. The redraw is
     skipped where this thread built it, since the draw that asked for it is
     still running and blits it a line further down. */
  #gotBundle(m) {
    if (!m.bitmap) return;
    // One that arrived after the disc moved on. It is nobody's picture now, so
    // it goes the way a replaced one does rather than being left to a
    // collector that cannot see its pixels.
    if (m.id !== this.#asked) return release(m.bitmap);
    release(this.#cache);
    this.#cache = m.bitmap;
    this.#cachePx = m.px;
    this.#cacheKey = m.id;
    if (!this.#drawing) this.#draw();
  }

  /* Where the bundle gets built. Nothing is handed over, unlike the nested
     disc — the worker makes its own canvas and transfers a bitmap back — so
     there is no canvas that can only be given away once. Opened when the
     element connects rather than when a bundle is first wanted, so its module
     fetch runs alongside the word file's rather than after it. */
  #openBundler() {
    this.#route = "wait";
    this.#settle = here => {
      if (this.#route !== "wait") return;
      clearTimeout(this.#floor);
      this.#floor = 0;
      this.#pending = null;
      this.#route = here ? "main" : "worker";
      const spec = this.#queued;
      this.#queued = null;
      if (!spec) return;
      if (here) this.#here(spec);
      else this.#worker.postMessage(spec);
    };
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined")
      return this.#settle(true);
    let w;
    try {
      w = new Worker(new URL("./word-bundle-worker.js", import.meta.url), { type: "module" });
    } catch {
      return this.#settle(true);
    }
    this.#pending = w;
    w.onerror = () => {
      w.terminate();
      if (this.#route === "wait") return this.#settle(true);
      // One that answered and then threw: back to this thread, with the bundle
      // that was in flight asked for again.
      this.#route = "main";
      this.#worker = null;
      this.#asked = "";
      this.#draw();
    };
    w.onmessage = ev => {
      if (!ev.data.ready) return this.#gotBundle(ev.data);
      this.#worker = w;
      this.#settle(false);
    };
  }

  /* Started with the first bundle actually wanted rather than with the
     worker's construction, which would spend the budget on the network and
     read a slow link as a device with no worker. */
  #armFloor() {
    if (this.#route !== "wait" || this.#floor) return;
    this.#floor = setTimeout(() => {
      this.#pending?.terminate();
      this.#settle(true);
    }, WORKER_FLOOR);
  }

  /* The disc as it stands: the bundle, the fan out of the chain end, the chain
     itself, the dots and the labels. It moves on a move rather than on a
     pointer, so the overlay above it is the only thing a hover repaints. */
  #draw() {
    if (!this.#ready || !this.#pw) return;
    const t0 = performance.now();
    this.#drawing = true;
    this.#wantBundle();
    this.#drawing = false;
    const g = this.#base.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#pw / this.#dpr, this.#ph / this.#dpr);

    const live = this.#chain.length > 0;
    if (this.#cache) {
      // The square holds its ring at RING of itself, so inverting that puts the
      // bundle's ring on this one whatever size either was drawn at.
      const side = this.#r / RING;
      g.globalAlpha = live ? BUNDLE_DIM : 1;
      g.drawImage(this.#cache, this.#cx - side / 2, this.#cy - side / 2, side, side);
      g.globalAlpha = 1;
    }

    const pull = this.#words.length > DENSE ? PULL_DENSE : PULL;
    const ink = this.#tok("--_ink", "#e7eded"),
      muted = this.#tok("--_muted", "#90a1a1"),
      warn = this.#tok("--_warn", "#e8705f");

    // The fan: every move available from where play stands. They all start
    // with one letter, so the wedge's own colour is what says where to go.
    const end = this.#chain.end;
    if (end >= 0) {
      const to = this.#chain.letter;
      g.strokeStyle = this.#hue(to);
      g.lineWidth = 1;
      g.globalAlpha = 0.7;
      g.beginPath();
      for (const j of this.#L.byHead[to]) if (j !== end) this.#chord(g, end, j, pull);
      g.stroke();
      g.globalAlpha = 1;
    }

    // The chain itself, over the top of everything. One colour, since a step
    // repeating an earlier word is not a step that can be played.
    const steps = this.#chain.steps;
    g.strokeStyle = ink;
    g.lineWidth = 2;
    for (let k = 1; k < steps.length; k++) {
      g.beginPath();
      this.#chord(g, steps[k - 1], steps[k], pull);
      g.stroke();
    }

    // Four states, painted in the order they win: everything else, a move
    // available, a word already used, the word play stands on. A dot per fill
    // held entity's 40,117 words at 31 ms a draw, twice per category, so each
    // opaque state is one path per colour, filled once. The dimmed dots keep a
    // fill apiece: overlapping, each one darkens those beneath it, and one path
    // would fill their union once at 0.3.
    //
    // Every dot sits on the one ring, so entity puts 16 of them on each pixel
    // of it, and adding the arcs to the paths still cost 11 ms. Walked in ring
    // order, an opaque dot within a third of a pixel of the last one its path
    // took is skipped, which moves the edge of the band they make by under a
    // hundredth of a pixel.
    const hues = Array.from({ length: LETTERS }, (_, l) => this.#hue(l));
    const lit = hues.map(() => new Path2D()),
      used = new Path2D();
    const litRad = live ? 3.4 : 2;
    /** @param {Path2D | CanvasRenderingContext2D} p @param {number} i @param {number} rad */
    const dot = (p, i, rad) => {
      const x = this.#x(i),
        y = this.#y(i);
      p.moveTo(x + rad, y);
      p.arc(x, y, rad, 0, TAU);
    };
    // The last angle each path took, the used dots' path after the letters'.
    const last = new Float64Array(LETTERS + 1).fill(Number.POSITIVE_INFINITY);
    const near = 1 / 3 / this.#r;
    /** @param {number} slot @param {number} i */
    const fresh = (slot, i) => {
      const a = this.#L.ang[i];
      if (Math.abs(a - last[slot]) < near) return false;
      last[slot] = a;
      return true;
    };
    g.globalAlpha = 0.3;
    for (let k = 0; k < this.#words.length; k++) {
      const i = this.#L.order[k];
      if (i === end) continue;
      if (this.#chain.played(i)) {
        if (fresh(LETTERS, i)) dot(used, i, 3);
      } else if (!live || this.#chain.legal(i)) {
        const l = this.#L.head[i];
        if (fresh(l, i)) dot(lit[l], i, litRad);
      } else {
        g.fillStyle = hues[this.#L.head[i]];
        g.beginPath();
        dot(g, i, 1.6);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    for (let l = 0; l < LETTERS; l++) {
      g.fillStyle = hues[l];
      g.fill(lit[l]);
    }
    g.fillStyle = warn;
    g.fill(used);
    if (end >= 0) {
      g.fillStyle = ink;
      g.beginPath();
      dot(g, end, 4);
      g.fill();
    }

    if (this.#labelPx) {
      g.font = `${this.#labelPx}px ${this.#tok("--_font", "sans-serif")}`;
      g.textBaseline = "middle";
      for (let i = 0; i < this.#words.length; i++) {
        const played = this.#chain.played(i),
          can = live && this.#chain.legal(i);
        g.fillStyle = played ? warn : !live || can || i === end ? ink : muted;
        g.globalAlpha = live && !can && !played && i !== end ? 0.4 : 1;
        this.#label(g, i, this.#words[i], LABEL_RADIUS);
      }
      g.globalAlpha = 1;
    }

    // The wedge letters, with the one play has to reach lifted out of them.
    const reach = this.#outer + WEDGE_BAND / 2;
    const to = this.#chain.letter;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const { letter, mid } of this.#L.wedge) {
      const on = letter === to;
      g.font = `${on ? 700 : 600} ${on ? WEDGE_PX + 3 : WEDGE_PX}px ${this.#tok("--_mono", "monospace")}`;
      g.fillStyle = this.#hue(letter);
      g.globalAlpha = !live || on ? 1 : 0.45;
      g.fillText(
        String.fromCharCode(65 + letter),
        this.#cx + Math.cos(mid) * reach,
        this.#cy - Math.sin(mid) * reach,
      );
    }
    g.globalAlpha = 1;
    this.#drawMs = performance.now() - t0;
    this.#emit("word-render", { ...this.stats });
  }

  /* One label, running outward along its own radius and turned back over on
     the left of the disc so it still reads left to right. */
  #label(g, i, text, at) {
    const ang = this.#L.ang[i];
    const deg = ((((ang * 180) / Math.PI) % 360) + 360) % 360;
    const flip = deg > 90 && deg < 270;
    g.save();
    g.translate(this.#x(i, at), this.#y(i, at));
    g.rotate(-ang + (flip ? Math.PI : 0));
    g.textAlign = flip ? "right" : "left";
    g.fillText(text, 0, 0);
    g.restore();
  }

  /* The pointer's layer: the hub, and a ring on whatever it is over. Nothing
     here is on the base, so crossing a wedge repaints two circles and a name
     rather than the whole disc. */
  #overlay() {
    if (!this.#ready || !this.#pw) return;
    this.#showRead();
    this.#showTail();
    const g = this.#over.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#pw / this.#dpr, this.#ph / this.#dpr);

    const sel = this.#focus();
    /* The fan is drawn from the held word rather than from what the pointer is
       on, so that following a chord inwards leaves the fan where it was: the
       chord under the pointer is one of the held word's, and redrawing from the
       word it lands on would take it out from under the pointer. Outside the
       chords nothing is held and the two are the same word. */
    const fan = this.#held >= 0 ? this.#held : sel;
    // What that word would open up. Only where it is a move: a word the chain
    // cannot reach leads nowhere from here.
    if (fan >= 0 && this.#chain.legal(fan)) {
      const to = this.#L.tail[fan];
      g.strokeStyle = this.#hue(to);
      g.lineWidth = 1;
      g.globalAlpha = 0.5;
      g.beginPath();
      const pull = this.#words.length > DENSE ? PULL_DENSE : PULL;
      for (const j of this.#L.byHead[to]) if (j !== fan) this.#chord(g, fan, j, pull);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (sel >= 0) {
      g.strokeStyle = this.#tok("--_ink", "#e7eded");
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(this.#x(sel), this.#y(sel), 6, 0, TAU);
      g.stroke();
    }
    this.#hub(g);
  }

  /* disc-label.js's reference band, held per font: g.font is the one thing that
     changes the answer, and a pointer asks for the same few over and over. */
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

  /* The hub names the word under the pointer, and otherwise where play stands.
     Before the first move it names the category, muted. Under the name sits the
     way back, and only where there is one: never before the first move, and
     never with the pointer on a word, where the room is wanted for its name.

     Nothing is drawn behind it. The text carries its own ground instead, ringed
     copies of the fill laid under it, so the only thing hidden is the shape of
     its own letters rather than the middle of the figure. */
  #hub(g) {
    const sel = this.#focus();
    const end = this.#chain.end;
    const named = sel >= 0 ? sel : end;
    const way = sel < 0 && end >= 0;
    const text = named >= 0 ? this.#words[named] : this.#category || "pick a word";

    const { lines, lh, px } = this.#fitted(g, text, this.#rHub - 6 - (way ? HINT_H : 0));
    let ink = this.#tok("--_ink", "#e7eded");
    if (named < 0) ink = this.#tok("--_muted", "#90a1a1");
    else if (named !== end && this.#chain.played(named)) ink = this.#tok("--_warn", "#e8705f");

    g.textAlign = "center";
    // Alphabetic and placed by hand: "middle" centres the em square, whose
    // descender space is empty for most words, so the type sits a little low.
    g.textBaseline = "alphabetic";

    /* The band the name is centred on and the baseline that falls out of it,
       both disc-label.js's. Measured off the face rather than off the word:
       centring each word's own ink moves the name up and down as the pointer
       crosses the disc, "iris" stopping at the dot where "guppy" descends. */
    const first = baseline(this.#cy, this.#band(g), lines.length, lh, way ? HINT_H / 2 : 0);
    this.#ground(g, lines, first, lh, Math.max(HALO_MIN, px * HALO));
    g.fillStyle = ink;
    for (const [k, line] of lines.entries()) g.fillText(line, this.#cx, first + k * lh);

    if (!way) return;
    // Off the last baseline and a notional descender rather than off the last
    // line's own ink, so the hint sits at one distance under every name.
    const y = first + (lines.length - 1) * lh + px * HUB_DROP + HINT_PX;
    g.font = `${HUB_WEIGHT} ${HINT_PX}px ${this.#tok("--_mono", "monospace")}`;
    this.#ground(g, ["↑ back"], y, 0, Math.max(HALO_MIN, HINT_PX * HALO));
    g.fillStyle = this.#tok("--_accent", "#59b491");
    g.fillText("↑ back", this.#cx, y);
  }

  /* disc-label.js's halo, against this element's own ground token. */
  #ground(g, lines, first, lh, r) {
    halo(g, lines, this.#cx, first, lh, r, this.#tok("--_ground", "#0c1112"));
  }

  /* What the pointer is on, or what the search left the highlight on. */
  #focus() {
    if (this.#hover >= 0) return this.#hover;
    return this.#cursor >= 0 && this.#cursor !== this.#chain?.end ? this.#cursor : -1;
  }

  /* Angles run clockwise from the top and never wrap, so a point maps to a word
     by radius and then one binary search, with no spatial index. */
  #hit(px, py) {
    const dx = px - this.#cx,
      dy = py - this.#cy,
      r = Math.hypot(dx, dy);
    // Out to the end of the labels, which is what makes one clickable, and a
    // small band in its place where the labels were dropped.
    if (r > this.#outer + (this.#labelPx ? 0 : 10)) return -1;
    if (r < this.#r * INNER) return this.#fanHit(px, py, Math.atan2(-dy, dx), r);
    const t = Math.PI / 2 - Math.atan2(-dy, dx);
    return at(this.#L, this.#turn, ((t % TAU) + TAU) % TAU);
  }

  /* The word whose fan the chords answer on, which is the one fan drawn from a
     word: where play stands that is the chain's end, and at rest the word the
     pointer was on when it crossed in. Held rather than followed, since a chord
     answers as the word it lands on and following that would swing the fan away
     from the pointer at the moment it arrived on one. */
  #anchor() {
    const end = this.#chain?.end ?? -1;
    return end >= 0 ? end : this.#held;
  }

  /* Inside the dot ring, where a chord answers as the word it lands on. The
     anchor's fan alone is asked, since it is the one set of chords that is a
     set of moves: the bundle under it is 96,470 chords on animal, each a pair
     of words rather than a move, and no pointer rate hit-tests that.

     The hub is no bar. Nothing is drawn behind the name, so the middle is where
     the fan crosses and the way back is what answers where no chord does.

     `spans` refuses most of the fan before a path is built, the same prune
     letter-graph.js's `near` is, and the transform is dropped because
     isPointInStroke takes its point in the canvas's own space. */
  #fanHit(px, py, th, r) {
    // Before any data, and before the pointer has been on a word, there is no
    // fan and the middle is nothing to be on.
    const end = this.#anchor();
    if (end < 0) return -1;
    const g = this.#over.getContext("2d");
    if (!g.isPointInStroke) return -1;
    const pull = this.#words.length > DENSE ? PULL_DENSE : PULL;
    /* What HIT_PX is worth in angle here, which is the whole turn at the centre
       and less the further out the pointer is. The chord lies in a cone out of
       the centre, so a point `r` from it and `d` off the nearest edge of that
       cone is `r * sin(d)` from the cone and no nearer the chord: the pad is
       that read backwards, and it is a bound rather than a guess. */
    const pad = r <= HIT_PX ? Math.PI : Math.asin(HIT_PX / r);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.lineWidth = HIT_PX * 2;
    let got = -1;
    for (const j of this.#L.byHead[this.#L.tail[end]]) {
      if (j === end || !spans(this.#L.ang[end], this.#L.ang[j], th, pad)) continue;
      g.beginPath();
      this.#chord(g, end, j, pull);
      if (g.isPointInStroke(px, py)) {
        got = j;
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
    const d = Math.hypot(px - this.#cx, py - this.#cy);
    /* The anchor is taken before the hit, so the word held is the one the
       pointer was on outside rather than whatever the chords answer. It is let
       go the moment the pointer is back among the dots, and never taken where
       play stands, the chain's own fan being the one drawn there. */
    if (d >= this.#r * INNER || this.#chain?.end >= 0) this.#held = -1;
    else if (this.#held < 0) this.#held = this.#focus();
    const h = this.#hit(px, py);
    // The hub answers last, so the cursor over a chord crossing it says what
    // clicking would really do.
    this.#inHub = h < 0 && d < this.#rHub;
    this.#showCursor();
    if (h === this.#hover) return;
    this.#preview(h);
  };
  #onLeave = () => {
    this.#inHub = false;
    this.#held = -1;
    this.#preview(-1);
    this.#showCursor();
  };

  /* The cursor says what a click would do, which is one of the three ways a
     word already played reports the refusal. It answers off where the pointer
     last was rather than off the event, so a move recomputes it too: playing a
     word makes it used with the pointer still on it. Written only when it turns
     over, since a pointer move fires several times a wedge. */
  #showCursor() {
    const on = this.#inHub
      ? this.#chain.length > 0
      : this.#hover >= 0 && this.#chain.legal(this.#hover);
    if (on === this.#points) return;
    this.#points = on;
    this.#over.style.cursor = on ? "pointer" : "default";
  }
  /* Everything a pointer over word i does and nothing else, so a suggestion
     picked in the search box looks exactly like a hover. */
  #preview(i) {
    this.#hover = i;
    this.#overlay();
    if (i >= 0)
      this.#emit("word-hover", {
        index: i,
        word: this.#words[i],
        legal: this.#chain.legal(i),
        played: this.#chain.played(i),
        replies:
          this.#L.byHead[this.#L.tail[i]].length - (this.#L.tail[i] === this.#L.head[i] ? 1 : 0),
      });
  }
  #onClick = ev => {
    const [px, py] = this.#at(ev);
    const h = this.#hit(px, py);
    if (h >= 0) return this.play(h);
    // The way back is the empty middle rather than the whole circle: a chord
    // drawn across it is still a move.
    if (Math.hypot(px - this.#cx, py - this.#cy) < this.#rHub) this.undo();
  };

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
        this.#cursor = -1;
        this.#preview(-1);
      }
    }
  };

  /* Enter, for a word reached by name. A legal word is played, as a click
     would. One the chain cannot reach is left highlighted instead, the line
     under the disc saying why: refusing silently reads as a broken key. */
  #go(i) {
    this.#closeFind();
    if (this.#chain.legal(i)) return this.play(i);
    this.#cursor = i;
    this.#hover = -1;
    this.#overlay();
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
        if (this.#chain.played(hit.i)) li.classList.add("used");
        else if (!this.#chain.legal(hit.i)) li.classList.add("no");
        const name = document.createElement("span");
        name.className = "n";
        const at = hit.name.toLowerCase().indexOf(q);
        if (at < 0) name.textContent = hit.name;
        else {
          const b = document.createElement("b");
          b.textContent = hit.name.slice(at, at + q.length);
          name.append(hit.name.slice(0, at), b, hit.name.slice(at + q.length));
        }
        // The letter it hands over, which is what decides what can come next.
        const to = document.createElement("span");
        to.className = "p";
        to.textContent = `→ ${String.fromCharCode(65 + this.#L.tail[hit.i])}`;
        li.append(name, to);
        return li;
      }),
    );
    this.#hits.hidden = this.#sug.length === 0;
    this.#movesEl.hidden = this.#sug.length > 0;
    this.#q.setAttribute("aria-expanded", String(this.#sug.length > 0));
  }

  #setPick(k) {
    this.#pick = k;
    for (const [j, li] of [...this.#hits.children].entries())
      li.setAttribute("aria-selected", String(j === k));
    if (k < 0) {
      this.#q.removeAttribute("aria-activedescendant");
      this.#preview(-1);
      return;
    }
    this.#q.setAttribute("aria-activedescendant", `hit-${k}`);
    this.#hits.children[k].scrollIntoView({ block: "nearest" });
    this.#preview(this.#sug[k].i);
  }

  #closeFind = () => {
    if (this.#pick >= 0) this.#preview(-1);
    this.#sug = [];
    this.#pick = -1;
    this.#hits.replaceChildren();
    this.#hits.hidden = true;
    this.#movesEl.hidden = false;
    this.#q.setAttribute("aria-expanded", "false");
    this.#q.removeAttribute("aria-activedescendant");
  };

  play(i) {
    const step = this.#chain?.play(i);
    if (!step) return false;
    this.#cursor = -1;
    this.#after();
    this.#emit("word-play", { index: i, word: this.#words[i], chain: this.chain });
    return true;
  }
  undo() {
    if (!this.#chain?.length) return;
    this.#chain.undo();
    this.#after();
  }
  rewind(k) {
    if (!this.#chain) return;
    this.#chain.rewind(k);
    this.#after();
  }
  clear() {
    if (!this.#chain) return;
    this.#chain.clear();
    this.#after();
  }
  /* Call after the host changes theme by any means other than
     prefers-color-scheme, which the element already watches. */
  repaint() {
    this.#toks.clear();
    this.#fits.clear();
    this.#bands.clear();
    // The letter wheel is read off two custom properties, so a theme is a
    // different bundle. The old one stays on screen while the new one is drawn.
    this.#gen++;
    this.#draw();
    this.#overlay();
  }

  /* Every move goes through here, so the disc, the line under it and the
     event can never describe different chains. */
  #after() {
    this.#reachOf.clear();
    // The fan has moved, so the word held against it is no longer what is
    // drawn. The next move takes the anchor again.
    this.#held = -1;
    this.#draw();
    this.#crumbs();
    this.#overlay();
    this.#showMoves();
    this.#showCursor();
    this.#emit("word-chain", {
      chain: this.chain,
      words: this.#words.length,
      stuck: this.#chain.stuck(this.#L.byHead),
    });
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #say(html) {
    this.#headEl.innerHTML = html;
    this.#tailEl.replaceChildren();
  }

  /* Whether the perfect-play figures are wanted. Off is for a host that has
     no use for them: every one costs a solve, and a page that never shows them
     should not pay for them. */
  #hinting() {
    return this.getAttribute("hint") !== "off";
  }

  /* How many more words play could make if word `i` were taken now, which is
     word-longest.js's answer over the words still unplayed rather than a guess
     off the count of replies. Asking about the word play already stands on
     gives the same thing, since a played word is out of the reckoning either
     way and the walk opens on the letter it left behind. */
  #reach(i) {
    const held = this.#reachOf.get(i);
    if (held !== undefined) return held;
    const m = new Int32Array(LETTERS * LETTERS);
    for (let k = 0; k < this.#words.length; k++)
      if (k !== i && !this.#chain.played(k)) m[this.#L.head[k] * LETTERS + this.#L.tail[k]]++;
    const walk = longest(m, this.#L.tail[i]);
    const n = Math.max(0, walk.letters.length - 1);
    this.#reachOf.set(i, n);
    return n;
  }

  /* The longest chain the word set allows at all, which is what the disc says
     before a chain is opened. One solve per word set, since `limit` and the
     category are the only things that move it. */
  #run() {
    if (this.#bestRun < 0) {
      const m = new Int32Array(LETTERS * LETTERS);
      for (let k = 0; k < this.#words.length; k++) m[this.#L.head[k] * LETTERS + this.#L.tail[k]]++;
      this.#bestRun = Math.max(0, longest(m).letters.length - 1);
    }
    return this.#bestRun;
  }

  /* One line saying what the state is, for whatever the hub names. It answers
     off #focus like the hub does, so the name in the middle and the sentence
     below it are always of the same word. */
  #showRead() {
    if (!this.#ready) return;
    const sel = this.#focus();
    const i = sel >= 0 ? sel : this.#chain.end;
    if (i < 0) {
      const n = this.#words.length;
      // Put off until the disc has painted; #later comes back for it.
      const best =
        this.#hinting() && this.#settled
          ? ` The longest chain here runs <b>${this.#run()}</b> of them.`
          : "";
      this.#glossEl.innerHTML =
        `${n} word${n === 1 ? "" : "s"} in ${this.#category || "the category"}. ` +
        `Pick any one to open the chain.${best}`;
      return;
    }
    const word = this.#words[i];
    const to = this.#L.tail[i];
    const letter = String.fromCharCode(65 + to);
    // What is left, and what there ever was: a letter can run out because the
    // category holds nothing starting with it or because the chain has spent
    // them all, and only the first is a fact about the category.
    const left = this.#chain.replies(i, this.#L.byHead);
    const ever = this.#L.byHead[to].length - (this.#L.head[i] === to ? 1 : 0);
    // The letter the next word must start with is this word's last, so it is
    // marked in place rather than named again after it.
    const parts = [
      `<b>${word.slice(0, -1)}<span class="last">${word.slice(-1)}</span></b>`,
      left
        ? `${left} possible next word${left === 1 ? "" : "s"}`
        : `<span class="warn">no possible next words: ` +
          `${ever ? `every ${letter} word is used` : `nothing starts with ${letter}`}</span>`,
    ];
    // What perfect play still allows, which the count of replies cannot say:
    // a letter with forty replies can still be the shorter road. Only where
    // there is a reply to make, since the line above already says there is not.
    if (left && this.#hinting()) {
      const rest = this.#reach(i);
      parts.push(
        sel >= 0 && sel !== this.#chain.end
          ? `playing it leaves ${rest} more`
          : `perfect play reaches ${rest} more`,
      );
    }
    // Why the pointer's word cannot be played, where it cannot. Never for the
    // word play is standing on, which those same two tests refuse.
    const at = sel >= 0 && sel !== this.#chain.end;
    if (at && this.#chain.played(sel))
      parts.push('<span class="warn">already played, so not a move</span>');
    else if (at && !this.#chain.legal(sel))
      parts.push(
        `<span class="warn">not a move: the next word starts with ` +
          `${String.fromCharCode(65 + this.#chain.letter)}</span>`,
      );
    this.#glossEl.innerHTML = parts.join(" · ");
  }

  /* Every word that could be played next, listed in the column beside the disc
     in alphabetical order, which is how one is found by eye in a list that runs
     past the column. Rendered as nodes rather than as markup, since a word is
     arbitrary text. Landscape only: nothing is built in the stacked layout,
     where it would be several hundred elements behind display:none. */
  #showMoves() {
    if (!this.#ready) return;
    if (!this.#frame.classList.contains("wide")) {
      if (this.#listEl.childElementCount) this.#listEl.replaceChildren();
      this.#moves = [];
      this.#listed = 0;
      return;
    }
    const letter = this.#chain.letter;
    const all = [];
    for (const j of this.#alpha) if (letter < 0 || this.#chain.legal(j)) all.push(j);

    const lead = document.createElement("span");
    const key = document.createElement("b");
    if (letter < 0) lead.textContent = `${all.length} words · any one opens`;
    else {
      key.textContent = String.fromCharCode(65 + letter);
      lead.textContent = all.length ? "must start with " : "nothing left starting with ";
    }
    this.#whyEl.replaceChildren(lead, key);

    this.#moves = all;
    this.#listed = 0;
    this.#listEl.replaceChildren();
    this.#listEl.scrollTop = 0;
    this.#page();
  }

  /* The next page of rows, appended. Nothing already placed is thrown away as
     it goes out of view, so this is an append rather than a windowing scheme
     and the scroll position never has to be guessed at. */
  #page() {
    const to = Math.min(this.#moves.length, this.#listed + MOVES_PAGE);
    if (to === this.#listed) return;
    const rows = [];
    for (let k = this.#listed; k < to; k++) {
      const li = document.createElement("li");
      li.dataset.i = this.#moves[k];
      li.textContent = this.#words[this.#moves[k]];
      rows.push(li);
    }
    this.#listEl.append(...rows);
    this.#listed = to;
    // A page that did not fill the column leaves no scrollbar to ask for the
    // next one, so it asks here instead. Bounded by the move count.
    if (this.#listEl.scrollHeight <= this.#listEl.clientHeight) this.#page();
  }

  /* The chain, each step a button that winds play back to just after it, and
     before them the category, which clears it. That root is the only way to
     open on a different first word, since the one step of a one-step chain
     renders as the name you are at rather than as a button. It is drawn as a
     label rather than as a step because it was not played, so the chevrons
     separate words from words only. */
  #crumbs() {
    if (this.#failed) return;
    const steps = this.#chain?.steps ?? [];
    const root = this.#category || "the category";
    const parts = [
      steps.length
        ? `<button type="button" class="root" data-k="-1">${root}</button>`
        : `<span class="root">${root}</span>`,
    ];
    for (const [k, i] of steps.entries()) {
      const gap = k ? "<i>›</i>" : "";
      parts.push(
        k === steps.length - 1
          ? `${gap}<span class="now">${this.#words[i]}</span>`
          : `${gap}<button type="button" data-k="${k}">${this.#words[i]}</button>`,
      );
    }
    this.#headEl.innerHTML = parts.join("");
    this.#crumbSel = -2;
    this.#showTail();
  }

  /* The move the pointer is offering, carried on past the chain the way playing
     it would leave the line. Muted, so the chain still reads as the chain. */
  #showTail() {
    if (this.#failed) return;
    const sel = this.#focus();
    const show = sel >= 0 && this.#chain.legal(sel) ? sel : -1;
    if (show === this.#crumbSel) return;
    this.#crumbSel = show;
    // A chevron only where a word comes before it: against the root label the
    // rule beside it is already the separator.
    this.#tailEl.innerHTML =
      show < 0 ? "" : `${this.#chain.length ? "<i>›</i>" : ""}<em>${this.#words[show]}</em>`;
  }
}
/* A spelling handed in with the data, if it fits it: one place per word, each
   a whole number below SPELL_MAX, which bounds what alphabetical allocates. */
function places(spell, n) {
  if (spell?.length !== n) return null;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = spell[i];
    if (!Number.isInteger(r) || r < 0 || r >= SPELL_MAX) return null;
    out[i] = r;
  }
  return out;
}

customElements.define("word-disc", WordDisc);
