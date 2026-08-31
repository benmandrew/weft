/* <word-disc> — the word chain game, played on the disc render.py draws.
 *
 * Data is {category, words: ["cat", …], zipf: [4.7, …]}, which
 * tools/export_words.py writes one file per category.
 *
 *   <word-disc src="words-animal.json"></word-disc>
 *   <word-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("word-disc").data = {category, words, zipf};
 *
 * Pick a word and the disc lights every word that can follow it — which is one
 * whole wedge less what is used, because the successors of a word are exactly
 * the words starting with the letter it ends on. Pick one of those and the
 * chain carries on, and the line under the disc is the chain so far: its steps
 * wind play back to themselves and its root, the category, clears it, which is
 * the way to open on a different word.
 *
 * A word already played is not a move. It keeps a warning colour wherever it
 * appears, the readout names it as used, and the cursor drops back to an arrow
 * over it, so the refusal is legible three ways before the click rather than
 * being a click that does nothing.
 *
 * The static figure is still underneath. Every chord the SVG draws is cached
 * to a bitmap and blitted per frame, so a click blits the bundle and draws
 * only the fan on top of it, which is what keeps a move a single frame at any
 * word count. That bitmap is held in a square of its own rather than the
 * frame's and is built on a worker, so a resize scales the blit instead of
 * paying a stroke for each of up to 96,470 chords on this thread.
 *
 * word-layout.js is the placement, word-chain.js the rule, word-bundle.js the
 * resting picture, and none of the three touches the DOM, so
 * tools/check_web.mjs runs all of them without a browser.
 *
 * Beside the disc, where the frame is wide enough for a column, every word
 * that could be played next is listed under the search box. It is where the
 * moves can be read rather than found among the dots, which is what the larger
 * categories need now that they are drawn unlabelled.
 *
 * A host naming an index-src gets a picker above the search box and the
 * element changes its own category: the word files sit beside the index, so
 * choosing one swaps `src` and play starts again on the new list. Without the
 * attribute the element is one category and one file, which is all a page
 * embedding a single disc needs, and the picker is not built at all.
 *
 * Attributes: src, index-src (words-index.json, which turns the picker on),
 *             limit (0, every word the category has; a count caps it),
 *             readout="off", search="off", fit
 * Properties: data, words, chain, stats. Methods: play(i), undo(), rewind(k),
 *             clear(), repaint().
 * Events: word-hover {index,word,replies}, word-play {index,word,chain},
 *         word-chain {chain,words,stuck},
 *         word-render {words,chords,drawMs,bundle,bundlePx,thread}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-warn --disc-sat --disc-val --disc-font --disc-mono
 */
import { hsv, TAU } from "./disc-colour.js";
import { fit } from "./disc-label.js";
import { ratio } from "./disc-ratio.js";
import { Search } from "./disc-search.js";
import { Chain } from "./word-chain.js";
import { bundle as strokeBundle, curve, RING, square, thin } from "./word-bundle.js";
import {
  at,
  chords,
  layout,
  LABEL_RADIUS,
  LETTERS,
  rank,
  solve,
  turns,
  WEDGE_BAND,
} from "./word-layout.js";

// The hub's "back" hint: its size, and the room it takes from the name above.
const HINT_PX = 11,
  HINT_H = 15;
// The sizes the hub's name steps down through, and its weight. It is the
// weight rather than the size that sets the name apart now: disc-label.js's
// own ladder tops out at 12 px and this one at 16, where it used to reach 33.
//
// 33 came in when the panel behind the name went and the room it had been
// taking came free, and taking the room was the mistake. Set that large the
// name is the figure rather than a label on it, and the figure is the disc:
// the long chords cross in the middle, which is the part worth seeing and the
// part the name sits over. 16 leaves it legible over the bundle — the halo
// does that work, not the size — and gives the chords the middle back. The
// bottom two rungs are where the shorter ladder ends, and no disc of a usable
// size reaches them: they are there so a frame too small for the hub to mean
// anything degrades rather than clips.
const HUB_SIZES = [16, 14, 12, 10, 8],
  HUB_WEIGHT = 700;
// The halo under the hub's text, as a fraction of the type size and never
// thinner than this. It is what replaces the panel: 100 to 280 of a category's
// chords pass inside the hub's radius — element is the worst — so the name has
// to clear its own ground, but only its own. A disc large enough to hold it
// took the middle of the figure out with it.
//
// It is laid as copies of the same fillText the ink uses, ringed around the
// letters, rather than as a strokeText under them. A stroke is centred on the
// glyph outline, which says the halo is centred in the geometry and not in
// what is drawn: a stroke is taken off the outline where a fill is a
// rasterised glyph, and the two are positioned by different code, so the halo
// could and did read as a shadow lying off to one side of the word. Copies
// cannot. Every one is the same call at a known offset, so whatever the fill
// does with the letters it does with their ground.
//
// HALO is how far that ground reaches past a letter, so it is half of the
// stroke width it replaces and draws the same picture. At 0.3 of the type the
// stroke had merged the letters into one slab and read as a shape behind the
// word rather than as ground around it; 0.08 is 1.3 px at the top of the
// ladder, against chords half a pixel wide. The floor takes over below 12.5
// px, which is the two degraded rungs alone. HALO_STEPS is how many directions
// the ring holds: eight leaves a scallop 0.076 of the reach deep, a tenth of a
// pixel at the largest reach the ladder asks for.
const HALO = 0.08,
  HALO_MIN = 1,
  HALO_STEPS = 8;
// What the hub's baseline is measured against: a capital and an ascender,
// which between them reach the top of anything a name can hold. Measured off
// this rather than off the name itself, so every word in a face sits on the
// same baseline. HUB_RISE and HUB_DROP are the proportions of a Latin line,
// used only where a context reports no ink metrics and to leave the hint its
// room under a name that may or may not have a descender in it.
const HUB_REF = "Hd",
  HUB_RISE = 0.72,
  HUB_DROP = 0.2;
// The search column beside the disc, and the gutter to it. Same thresholds as
// <hypernym-disc>, so the two elements break to landscape together.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
const RESIZE_HOLD = 60;
// How many rows the column puts in the DOM at a time, and how near the foot of
// it a scroll has to come before the next lot follow. Nothing is capped:
// scrolling reaches the end of any list, and the work per move is a page
// rather than a category.
//
// 200 is chosen so no move set is ever paged — the largest over the 37
// categories is animal's 187, after "mollusc" — which leaves the list before
// the first move as the only one that pages, and that one is the whole
// category rather than a set of replies to anything. A page also overfills
// the column at any size it can be, 100 lines two up against the 15 to 31 a
// column holds, so the scrollbar says at once that there is more.
const MOVES_PAGE = 200,
  MOVES_NEAR = 240;

// The wedge letter that sits outside the labels. Every other distance the disc
// needs is solved in word-layout.js, where it can be checked without a canvas.
const WEDGE_PX = 15;

// How far a chord's control points sit towards the centre, and the tighter
// figure past 150 words. config.Geometry's pull and pull_dense.
const PULL = 0.32,
  PULL_DENSE = 0.2,
  DENSE = 150;
// The resting bundle's opacity, and what is left of it once a chain is being
// built and the fan on top is the thing to read. palette.Theme's edge_alpha.
const EDGE_ALPHA = 0.2,
  BUNDLE_DIM = 0.22;
/* Chords past which no bundle is drawn at all. It used to stand at 24,000,
   which is where the stroke apiece a resize paid for stopped being worth it,
   and it cost the seven largest categories their picture: animal holds 96,470
   chords at no limit, food 57,320, job 50,275, plant 48,033, city 36,693,
   body-part 35,732 and drug 24,898. The bundle is built off the frame's size
   and off this thread now, so a resize blits rather than rebuilds and none of
   those seven pays anything on the main thread for its picture.

   What is left is a guard against a word list nothing here ships. Chords go as
   the square of the words, so it draws every category the tool has at no limit
   and refuses a list half again as large. */
const MAX_BUNDLE = 200000;

// What the worker gets to answer in, timed from the first bundle the element
// actually wants rather than from the worker's construction. A worker that
// loads and never answers otherwise leaves the disc without its picture for
// good, where the cost of finding that out is the picture arriving this late.
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
  /* One box around the column, so it reads as a thing beside the disc rather
     than as loose text next to it. It is the frame's own ::before placed as a
     grid item rather than an element wrapping the column, because the picker,
     the search box and the definition are three separate grid items and the
     stacked layout puts the definition under the disc rather than in a
     column, so there is no element that wraps them to put a border on.
     Generated first and placed explicitly, so it is painted behind what sits
     in it, and those three carry the padding that keeps their text off it —
     which is why the definition's top margin goes, the search box's bottom
     padding being the gap between the two now. */
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
  /* The category picker, on where the host names an index. It is the search
     box one scale out — that one reaches a word inside a category and this one
     reaches the category — so it takes the head of the same column. It is not
     part of that box, though, and search="off" is about finding a word: a host
     that turns the search off keeps the picker it asked for. The native
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
     and there the suggestions are a dropdown over the disc.

     It earns its room where the disc cannot label itself. Uncapped, the 7
     largest categories drop their labels, so this is the only place the moves
     can be read rather than hunted for among the dots — and it is also where
     it overflows, since animal's median word offers 60 replies and its worst
     187 against the 15 to 31 rows a column holds one-up. Two up, and read
     left to right and then down, which is what inline blocks do. */
  .moves{display:none}
  :host([fit]) .frame.wide .moves{display:flex;flex-direction:column;
    flex:1 1 auto;min-height:0;margin-top:9px}
  :host([fit]) .frame.wide .moves[hidden]{display:none}
  .moves .why{font-family:var(--_mono);font-size:10.5px;color:var(--_muted);
    flex:none;padding-bottom:5px}
  .moves .why b{color:var(--_accent);font-weight:600}
  /* Two up, by inline blocks of half the width rather than by a grid.

     A grid laid these out and, past the point where the rows overflowed the
     column, drew every box with nothing written in it — the words were in the
     DOM and the rows took a hover, so it was the layout and not the list. It
     was not reproducible here, since make web runs the modules against a
     stub with no CSS in it at all, so the fix is the construct that cannot
     fail that way rather than a patch to the one that did: a scrolling block
     of inline blocks is the oldest layout there is, and it keeps the reading
     order a ranked list needs, left to right and then down.

     Colour and leading are set on the row rather than inherited, for the same
     reason: a list that draws no text should depend on as little from outside
     as it can. A row is 12.5px over 1.5, so a column holds 15 to 31 rows one
     up and twice that across. The rows are built as elements with nothing
     between them, so there is no whitespace to collapse between two inline
     blocks and no font-size:0 on the list to swallow it — which would be a
     careless thing to add to a list that was drawing nothing. */
  /* The list carries a box of its own, drawn like the suggestions it shares
     the room with, and it takes whatever height the column has left, so the
     box runs down to the definition at the foot of the column however few
     words are in it. */
  .moves .list{margin:0;padding:3px;list-style:none;flex:1 1 auto;min-height:0;
    overflow-y:auto;scrollbar-width:thin;background:var(--_panel);
    border:1px solid var(--_edge);border-radius:2px}
  /* border-box because the page's own box-sizing rule does not cross into a
     shadow root, and content-box would put two halves and their padding past
     the width and wrap every second word onto a line of its own. The pair
     comes to 98%, so no rounding can wrap them either. */
  .moves li{box-sizing:border-box;display:inline-block;vertical-align:top;
    width:calc(50% - 5px);margin-right:8px;
    color:var(--_ink);font-size:12.5px;line-height:1.5;
    padding:2px 5px;border-radius:2px;cursor:pointer;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .moves li:nth-child(2n){margin-right:0}
  .moves li:hover{background:color-mix(in srgb,var(--_accent) 18%,transparent)}
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  /* The arrow is the resting state and #onMove lifts it to a pointer over
     what a click would actually take: a legal word, or the hub with a chain
     to wind back. A word already used looks like any other to the cursor. */
  canvas.over{cursor:default;touch-action:none}
  :host([readout="off"]) .gloss,:host([readout="off"]) .crumb{display:none}
  /* Both are held to a height whatever they hold, which is the whole of what
     stops the disc moving under the pointer: with the fit attribute set the
     frame is a flex column and the stage takes what these two leave, so a
     block below the disc that grows by a line takes a line off the disc's
     height and, the stage being square, as much off its width. The crumb is
     the one that bit. It is empty until the pointer names a word, so crossing
     onto the disc shrank it, which moved the words out from under the pointer
     and fired the resize observer, which rebuilt the bundle a stroke at a
     time. The gloss shows blank rather than hiding while empty for the same
     reason, so the disc does not jump once when the words land. A host that
     wants neither block has readout="off". */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .gloss .warn{color:var(--_warn)}
  /* The word's own last letter, which is the whole of what decides what can
     follow it. Marked where it sits rather than named again after it, and by
     a rule as well as a colour, since colour alone says nothing to a reader
     who cannot see it. */
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
  /* The category the words came from, which is not one of them. It sits
     outside the chevrons and takes the body face against their monospace,
     italic and muted, with a rule rather than a separator between it and the
     first word — reading as a step in the chain is the one thing it must not
     do. Kept at the line's own size so its line box cannot be the taller one
     and give the crumb a height that depends on what is in it. */
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
  static observedAttributes = ["src", "index-src", "limit"];

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
  // The words actually drawn, commonest first, and the layout over them.
  #words = [];
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
  #cursor = -1;
  #crumbSel = -2;
  #failed = false;
  #ready = false;
  #loadedSrc = null;
  #indexSrc = null;

  /* The bundle, drawn once per word set and blitted per frame. It is held in
     its own square rather than the frame's, so a resize scales the blit and
     only a crossed size step rebuilds; the old bitmap keeps being drawn until
     the new one lands, which is why a rebuild has no blank in it. */
  #cache = null;
  #cachePx = 0;
  // What the held bitmap is of, and what has been asked for: the word set and
  // the colours through #gen, the square through the size step.
  #cacheKey = "";
  #asked = "";
  #gen = 0;
  #chordCount = 0;
  #drawMs = 0;

  // Where the bundle is built: undefined until wanted, "wait" while the worker
  // is answering, then "worker" or "main" for the rest of the element's life.
  #route = undefined;
  #worker = null;
  #pending = null;
  #floor = 0;
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
  }

  connectedCallback() {
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerleave", this.#onLeave);
    this.#over.addEventListener("click", this.#onClick);
    this.#crumb.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) this.rewind(+b.dataset.k + 1);
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
    // The list does exactly what the disc does: hovering an entry is hovering
    // its dot, and clicking one is clicking it. Delegated, since the list is
    // rebuilt on every move.
    this.#listEl.addEventListener("pointermove", e => {
      const li = e.target.closest("li[data-i]");
      const i = li ? +li.dataset.i : -1;
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
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    this.#onRatio();
    // The same font swap hypernym-disc guards against, and #resize rather than
    // repaint() because this element also solves its label size from #widest, a
    // measureText over every word in the category, which repaint() leaves alone
    // along with the geometry solved off it. #resize is the path that drops
    // #widest, #fits, #toks and #bands, measures again and solves again, and
    // it is idempotent against a box that has not moved. It leaves the bundle
    // alone, and rightly: that is chords rather than text, so no face it is
    // drawn beside can change it. #box is null until the first fit, and a face
    // landing before that needs nothing, since the first fit measures with it.
    document.fonts?.ready?.then(() => {
      if (this.#box) this.#resize();
    });
    if (!this.#ready) this.#load();
    this.#loadIndex();
  }
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#mq?.removeEventListener("change", this.#onScheme);
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = null;
    // Terminated, where the nested disc's is not: this one holds no canvas of
    // the element's, so there is nothing that could only be handed over once
    // and nothing to lose by opening another if the element is put back.
    clearTimeout(this.#floor);
    this.#floor = 0;
    this.#pending?.terminate();
    this.#worker?.terminate();
    this.#pending = this.#worker = null;
    this.#route = undefined;
    this.#queued = null;
    this.#asked = this.#cacheKey;
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "index-src") this.#loadIndex();
    // A different limit is a different word list, so the layout, the chain and
    // the bundle all go: a chain over words that are no longer drawn has
    // nothing on the disc to stand on.
    if (n === "limit" && this.#ready) this.#build();
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

  /* Where a category's words are, given its name. tools/export_words.py writes
     the 37 files and their index flat and side by side, and web-dist stages
     them that way, so the path to one is the index's own with the last segment
     swapped. No base URL to resolve against, nothing for a host to name twice,
     and the one thing it cannot survive is a query string on the index, which
     a directory of exported files does not have. */
  #href(name) {
    const src = this.#indexSrc ?? "";
    return `${src.slice(0, src.lastIndexOf("/") + 1)}words-${name}.json`;
  }

  /* The picker, which exists only where the host names an index. It is fetched
     rather than derived because the element is handed one word file and the
     names of the other 36 are nowhere in it, and the index is 37 rows against
     the 197 KB the files come to, which is the reason it is written. */
  async #loadIndex() {
    const src = this.getAttribute("index-src");
    if (!src || src === this.#indexSrc) return;
    this.#indexSrc = src;
    let rows;
    try {
      rows = await (await fetch(src)).json();
    } catch (err) {
      /* The words may well have arrived from `src`, and then the disc is
         playable and only the picker is missing, which is not worth taking
         the readout for. It is worth it where the index was the way in. */
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
        // The count, which is what tells drug's 750 words from colour's 97
        // before the choice is made — and so whether the disc that comes back
        // is labelled or names its words in the hub instead.
        o.textContent = row.words ? `${row.name} (${row.words})` : row.name;
        return o;
      }),
    );
    // One category is not a choice.
    this.#pickEl.hidden = rows.length < 2;
    this.#mark();
    /* An index is enough to open on. A host that names one and no `src` means
       the first category rather than a blank disc, and #load has already run
       and found nothing by the time this resolves, so there is nothing to
       race: a `src` written down by hand is loading or loaded. */
    if (!this.#ready && !this.getAttribute("src")) {
      this.setAttribute("src", this.#href(rows[0].name));
    }
  }

  /* The picker follows the words rather than leading them, so it moves with a
     `src` a host set by hand as well as with its own change event. A category
     the index does not hold leaves the select showing nothing, which is what
     pointing the two attributes at different directories has asked for. */
  #mark() {
    if (this.#catEl.value !== this.#category) this.#catEl.value = this.#category;
  }

  #onCat = () => {
    this.setAttribute("src", this.#href(this.#catEl.value));
  };

  set data(d) {
    if (!d?.words) return;
    this.#category = d.category ?? "";
    this.#mark();
    this.#all = Array.from(d.words);
    // Without frequencies the file's own order stands, which is what a host
    // building a list by hand would mean by it.
    this.#zipf = d.zipf ? Array.from(d.zipf) : this.#all.map((_, i) => -i);
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
      // The square the bundle is held at and the thread it was drawn on, which
      // is the only way a host can tell a picture built beside the page from
      // one built in front of it.
      bundlePx: this.#cachePx,
      thread: this.#route === "worker" ? "worker" : "main",
      labelPx: this.#labelPx,
      drawMs: this.#drawMs,
      chain: this.#chain?.length ?? 0,
    };
  }

  /* Every word the category has, unless the host names a count. Zero is no
     limit rather than a blank disc, the way it reads in a head or a tail, and
     it is the default because a category is a word list and cutting one to its
     commonest 110 is a thing to ask for rather than to have done.

     `build` still draws 110, and the two differ for a reason: the SVG grows
     its canvas until the labels clear each other and shrinks the type when it
     runs out, where the element has whatever frame the host gave it and drops
     the labels instead. The 18 largest categories therefore come up unlabelled,
     with the hub naming what the pointer is on and the search box reaching a
     word by name. They keep their bundle: animal's 96,470 chords are drawn on
     a worker into a square of their own, so what the seven largest categories
     used to lose to the ceiling costs this thread nothing. */
  #limit() {
    const want = this.getAttribute("limit");
    if (want === null) return 0;
    const n = Math.round(+want);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  #build() {
    const ranked = rank(this.#all, this.#zipf);
    const n = this.#limit();
    this.#words = n ? ranked.slice(0, n) : ranked;
    this.#L = layout(this.#words);
    this.#chain = new Chain(this.#L.head, this.#L.tail);
    this.#chordCount = chords(this.#L);
    this.#hover = -1;
    this.#cursor = -1;
    this.#search = null;
    this.#widest = 0;
    // A different word set, so the held bundle is of words that are no longer
    // on the disc and goes rather than being blitted until its replacement
    // lands. A resize keeps its bundle; this cannot.
    this.#cache = null;
    this.#cacheKey = "";
    this.#asked = "";
    this.#gen++;
    // A different word set makes whatever is in the box a query about words
    // that are no longer drawn, so it goes with the suggestions rather than
    // sitting there describing nothing. It shows now that the picker can
    // change the category under a query typed for the last one.
    this.#q.value = "";
    this.#closeFind();
    this.#q.disabled = this.#words.length === 0;
    if (!this.#q.disabled) this.#q.placeholder = "Search words…";

    this.#turn = turns(this.#L);

    this.#crumbs();
    this.#showMoves();
    if (this.#pw) {
      this.#measure();
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
    // Built on the way in and dropped on the way out, since it exists only
    // here and #showMoves is what decides that.
    if (this.#ready) this.#showMoves();
    return true;
  }

  /* Browser zoom multiplies devicePixelRatio and leaves the CSS box alone, so
     an element a host sized in pixels sees no observation and goes on painting
     at the resolution before the zoom, which is a disc that blurs on cmd+ and
     never recovers. A media query naming the current ratio fires when it
     moves, and has to be re-armed each time, since a query can only report
     leaving the one value it names. Arming it is a fit as well: the first call
     runs before anything is drawn and #fit answers for that. */
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
    // The bundle no longer costs a drag anything, since it is blitted at the
    // new radius rather than restroked, but the dots, the labels and the sizing
    // they are solved against are still a frame's work at 1,582 words. The
    // first change goes through outright and the rest are coalesced; the
    // canvases stretch until the drag stops.
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
    this.#widest = 0;
    // The bundle is not dropped here. It is held in its own square rather than
    // this one, so the blit scales it to the new radius and only a crossed
    // size step asks for another — which is what took the build from once per
    // size to once per word set, and with it the ceiling that lost the seven
    // largest categories their picture.
    this.#measure();
    this.#geometry(Math.min(b.w, b.h));
    this.#draw();
    this.#overlay();
  };

  /* The widest word, in pixels per pixel of font size. Measured rather than
     estimated from a character count, since the labels are set in the host's
     proportional face and "milliampere" is not "wwwwwwwwwww". Once per word
     set and per face: the sizing solves against it and nothing else does. */
  #measure() {
    if (this.#widest || !this.#words.length) return;
    const g = this.#over.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = `100px ${this.#tok("--_font", "sans-serif")}`;
    let w = 0;
    for (const word of this.#words) w = Math.max(w, g.measureText(word).width);
    this.#widest = w / 100;
  }

  /* Everything the disc measures, off the square the host left it. `solve` is
     the whole of it and lives in word-layout.js, since a sizing that comes
     back with a negative radius is exactly the kind of thing nothing
     downstream tests for and `make check` can. */
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
    if (!this.#words.length || this.#chordCount > MAX_BUNDLE) return;
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
    if (this.#route === undefined) this.#openBundler();
    if (this.#route === "wait") this.#queued = spec;
    else if (this.#route === "worker") this.#worker.postMessage(spec);
    else this.#here(spec);
  }

  /* The same module the worker runs, against a canvas of this document's. What
     a browser without OffscreenCanvas or Worker falls back to, and what
     tools/check_web.mjs drives, so the fallback cannot drift from the fast
     path. */
  #here(spec) {
    const c = document.createElement("canvas");
    c.width = spec.px;
    c.height = spec.px;
    const g = c.getContext("2d");
    if (!g) return;
    strokeBundle(g, spec);
    this.#gotBundle({ id: spec.id, px: spec.px, bitmap: c });
  }

  /* A bundle that has landed, from either thread. A stale one is dropped: the
     word set or the colours may have moved on while it was being drawn, and
     the key is what says so.

     The redraw is skipped where this thread built it, since the draw that
     asked for it is still running and will blit it a line further down. From
     the worker it is a frame of its own, which is what fades the picture in
     under a disc that is already there. */
  #gotBundle(m) {
    if (!m.bitmap || m.id !== this.#asked) return;
    this.#cache = m.bitmap;
    this.#cachePx = m.px;
    this.#cacheKey = m.id;
    if (!this.#drawing) this.#draw();
  }

  /* Where the bundle gets built. Nothing is handed over, unlike the nested
     disc — the worker makes its own canvas and transfers a bitmap back — so
     there is no canvas that can only be given away once, and no reason to
     leave the worker running when the element disconnects.

     Opened when a bundle is first wanted rather than when the element
     connects, since its module fetch would otherwise race the word file's for
     a picture that cannot be drawn until that file has landed anyway. */
  #openBundler() {
    this.#route = "wait";
    const settle = here => {
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
      return settle(true);
    let w;
    try {
      w = new Worker(new URL("./word-bundle-worker.js", import.meta.url), { type: "module" });
    } catch {
      return settle(true);
    }
    this.#pending = w;
    w.onerror = () => {
      w.terminate();
      if (this.#route === "wait") return settle(true);
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
      settle(false);
    };
    /* The deadline, started with the first bundle actually wanted rather than
       with the worker's construction, which would spend it on the network and
       read a slow link as a device with no worker. What it guards is a worker
       that loads and never answers, and what it costs is a disc without its
       picture for that long. */
    this.#floor = setTimeout(() => {
      this.#pending?.terminate();
      settle(true);
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
      // bundle's ring on this one whatever size either was drawn at. That is
      // the whole of what a resize costs now.
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

    // The dots. Four states, and the order below is the order they win in: the
    // word play stands on, a word already used, a move available, everything
    // else.
    for (let i = 0; i < this.#words.length; i++) {
      const played = this.#chain.played(i),
        can = live && this.#chain.legal(i);
      let fill = this.#hue(this.#L.head[i]),
        rad = 2,
        alpha = 1;
      if (i === end) {
        fill = ink;
        rad = 4;
      } else if (played) {
        fill = warn;
        rad = 3;
      } else if (can) {
        rad = 3.4;
      } else if (live) {
        alpha = 0.3;
        rad = 1.6;
      }
      g.globalAlpha = alpha;
      g.fillStyle = fill;
      g.beginPath();
      g.arc(this.#x(i), this.#y(i), rad, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

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
    if (sel >= 0) {
      const to = this.#L.tail[sel];
      // What that word would open up, previewed the way playing it would draw
      // it. Only where it is a move: a word the chain cannot reach leads
      // nowhere from here.
      if (this.#chain.legal(sel)) {
        g.strokeStyle = this.#hue(to);
        g.lineWidth = 1;
        g.globalAlpha = 0.5;
        g.beginPath();
        const pull = this.#words.length > DENSE ? PULL_DENSE : PULL;
        for (const j of this.#L.byHead[to]) if (j !== sel) this.#chord(g, sel, j, pull);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.strokeStyle = this.#tok("--_ink", "#e7eded");
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(this.#x(sel), this.#y(sel), 6, 0, TAU);
      g.stroke();
    }
    this.#hub(g);
  }

  /* How far the face puts ink above the baseline, measured once per font off
     HUB_REF rather than off the name being drawn. A capital and an ascender,
     because between them they reach the top of anything a name can hold, and
     no descender, because what sits below the baseline hangs below the centre
     rather than moving it. A context reporting no ink metrics falls back to
     the proportions of a Latin line, which is wrong by a pixel at worst. */
  #band(g) {
    const held = this.#bands.get(g.font);
    if (held !== undefined) return held;
    const up = g.measureText(HUB_REF).actualBoundingBoxAscent;
    const band = Number.isFinite(up) && up > 0 ? up : this.#fitPx(g) * HUB_RISE;
    this.#bands.set(g.font, band);
    return band;
  }

  // The size out of a font string, for the fallback above alone.
  #fitPx(g) {
    return parseFloat(/([\d.]+)px/.exec(g.font)?.[1]) || HUB_SIZES.at(-1);
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
     Before the first move it names the category, muted, since there is nothing
     selected for it to be the name of. Under the name sits the way back, and
     only where there is one: never before the first move, and never with the
     pointer on a word, where the room is wanted for that word's name.

     Nothing is drawn behind it. A panel disc wide enough to hold the name took
     the middle of the figure with it, and the middle is where the long chords
     cross — which is the picture, not something to cover up. So the text
     carries its own ground instead, laid under the fill as ringed copies of
     it and scaled to the type: the only thing it hides is the shape of its
     own letters. */
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
    // Alphabetic and placed by hand, because "middle" centres the em square
    // and the em square is not what you see: its descender space is empty for
    // most words, so the type sits a pixel or two low.
    g.textBaseline = "alphabetic";

    /* The band the name is centred on. Measured off the face rather than off
       the word, which is the whole point: the ink of "iris" stops at the dot
       and the ink of "guppy" runs below the baseline, so centring each word's
       own ink moved the name up and down as the pointer crossed the disc. The
       band is the same for every word in a face, so the baseline is too, and
       a descender now hangs below the centre the way it does in any line of
       type instead of dragging the line up to meet it. */
    const band = this.#band(g);
    const tall = band + (lines.length - 1) * lh;
    // The baseline of the first line, so the block is centred on the hub and
    // the hint below it takes its room off the top.
    const first = this.#cy - tall / 2 - (way ? HINT_H / 2 : 0) + band;
    // Every line's ground first and the ink after, so a line's halo cannot
    // land on the letters of the line above it.
    this.#halo(g, lines, first, lh, Math.max(HALO_MIN, px * HALO));
    g.fillStyle = ink;
    for (const [k, line] of lines.entries()) g.fillText(line, this.#cx, first + k * lh);

    if (!way) return;
    // Off the last baseline and a notional descender, rather than off whatever
    // the last line's own ink happened to reach, so the hint sits at one
    // distance under every name and not lower under the ones ending in y.
    const y = first + (lines.length - 1) * lh + px * HUB_DROP + HINT_PX;
    g.font = `${HUB_WEIGHT} ${HINT_PX}px ${this.#tok("--_mono", "monospace")}`;
    this.#halo(g, ["↑ back"], y, 0, Math.max(HALO_MIN, HINT_PX * HALO));
    g.fillStyle = this.#tok("--_accent", "#59b491");
    g.fillText("↑ back", this.#cx, y);
  }

  /* The ground the hub's text carries with it, laid as `HALO_STEPS` copies of
     the same call that draws the ink, ringed at `r` around each baseline. The
     union reaches r past every letter, which is what a stroke of width 2r used
     to do, and it cannot be anywhere else, since the offsets sum to nothing
     and every copy is the fill the letters themselves are drawn with. */
  #halo(g, lines, first, lh, r) {
    g.fillStyle = this.#tok("--_ground", "#0c1112");
    for (let s = 0; s < HALO_STEPS; s++) {
      const a = (s / HALO_STEPS) * TAU,
        dx = Math.cos(a) * r,
        dy = Math.sin(a) * r;
      for (const [k, line] of lines.entries()) {
        g.fillText(line, this.#cx + dx, first + k * lh + dy);
      }
    }
  }

  /* What the pointer is on, or what the search left the highlight on. */
  #focus() {
    if (this.#hover >= 0) return this.#hover;
    return this.#cursor >= 0 && this.#cursor !== this.#chain?.end ? this.#cursor : -1;
  }

  /* Angles run clockwise from the top and never wrap, so a point maps to a
     word by radius and then one binary search — the same argument the nested
     disc makes, and the same absence of a spatial index. */
  #hit(px, py) {
    const dx = px - this.#cx,
      dy = py - this.#cy,
      r = Math.hypot(dx, dy);
    // Out to the end of the labels, which is what makes one clickable, and a
    // small band in its place where the labels were dropped.
    if (r < this.#r * 0.62 || r > this.#outer + (this.#labelPx ? 0 : 10)) return -1;
    const t = Math.PI / 2 - Math.atan2(-dy, dx);
    return at(this.#L, this.#turn, ((t % TAU) + TAU) % TAU);
  }

  #at(ev) {
    return [ev.offsetX, ev.offsetY];
  }
  #onMove = ev => {
    const [px, py] = this.#at(ev);
    this.#inHub = Math.hypot(px - this.#cx, py - this.#cy) < this.#rHub;
    const h = this.#inHub ? -1 : this.#hit(px, py);
    this.#showCursor();
    if (h === this.#hover) return;
    this.#preview(h);
  };
  #onLeave = () => {
    this.#inHub = false;
    this.#preview(-1);
    this.#showCursor();
  };

  /* The cursor says what a click would do, which a word already used needs
     said: it sits on the ring looking like any other, so without this the
     arrow is the only thing that never reports the refusal.

     It answers off where the pointer last was rather than off the event, so a
     move recomputes it too — clicking a word makes that word used, and the
     pointer is still on it. Written only when it turns over, since a pointer
     move fires several times a wedge and an inline style set per event is a
     style invalidation per event. */
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
    if (Math.hypot(px - this.#cx, py - this.#cy) < this.#rHub) return this.undo();
    const h = this.#hit(px, py);
    if (h >= 0) this.play(h);
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

  /* Enter, for a word reached by name. A legal word is played, which is what
     clicking it would do. One the chain cannot reach is left highlighted
     instead, with the line under the disc saying which letter it wanted:
     refusing silently would read as a broken key. */
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
        // The letter it hands over, which is the only thing about a word that
        // decides what can come next.
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
    // different bundle. The old one is kept on screen while the new one is
    // drawn, since a moment of the wrong colours reads better than the picture
    // going out and coming back.
    this.#gen++;
    this.#draw();
    this.#overlay();
  }

  /* Every move goes through here, so the disc, the line under it and the
     event can never describe different chains. */
  #after() {
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

  /* One line saying what the state is, for whatever the hub names. It answers
     off #focus like the hub does, so the name in the middle and the sentence
     below it are always of the same word. */
  #showRead() {
    if (!this.#ready) return;
    const sel = this.#focus();
    const i = sel >= 0 ? sel : this.#chain.end;
    if (i < 0) {
      const n = this.#words.length;
      this.#glossEl.innerHTML = `${n} word${n === 1 ? "" : "s"} in ${this.#category || "the category"}. Pick any one to open the chain.`;
      return;
    }
    const word = this.#words[i];
    const to = this.#L.tail[i];
    const letter = String.fromCharCode(65 + to);
    // What is left, and what there ever was. The two come apart now that a
    // word is spent once played: a letter can run out because the category
    // holds nothing starting with it, or because the chain has been through
    // all of them, and only the first is a fact about the category.
    const left = this.#chain.replies(i, this.#L.byHead);
    const ever = this.#L.byHead[to].length - (this.#L.head[i] === to ? 1 : 0);
    // The letter the next word has to start with is the last one of this word,
    // so it is marked in place. Naming it again after the word said the same
    // thing twice and put the count a clause further away than it needed.
    const parts = [
      `<b>${word.slice(0, -1)}<span class="last">${word.slice(-1)}</span></b>`,
      left
        ? `${left} possible next word${left === 1 ? "" : "s"}`
        : `<span class="warn">no possible next words: ` +
          `${ever ? `every ${letter} word is used` : `nothing starts with ${letter}`}</span>`,
    ];
    // Why the pointer's word cannot be played, where it cannot. Never for the
    // word play is standing on, which is used and unreachable by the same two
    // tests and is neither a mistake nor a move going begging.
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

  /* Every word that could be played next, listed in the column beside the
     disc in alphabetical order, which is how one is found by eye in a list
     that runs past the column. `byHead` holds a wedge commonest first, and
     that order is still what decides which words are shown at all when the
     whole category is longer than the cap: the sort is for reading and the
     order is for choosing.

     Before the first move every word is a move, so the list is the category:
     that is the one case the cap truncates, and the only one, since no wedge
     any category has reaches it. Rendered as nodes rather than as markup
     because a word is a word and building the list out of a string would
     invite the one bug that has no visible symptom.

     Only the landscape layout has room for it, so nothing is built otherwise
     — on a phone this would be several hundred elements behind display:none. */
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
    if (letter < 0) for (let i = 0; i < this.#words.length; i++) all.push(i);
    else for (const j of this.#L.byHead[letter]) if (this.#chain.legal(j)) all.push(j);
    all.sort((x, y) => (this.#words[x] < this.#words[y] ? -1 : 1));

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
     it goes out of view, which is what makes this an append rather than a
     windowing scheme: scrolling back up is free and the scroll position never
     has to be guessed at. */
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
    // next one, so it asks here instead. Bounded by the list.
    if (this.#listEl.scrollHeight <= this.#listEl.clientHeight) this.#page();
  }

  /* The chain, each step a button that winds play back to just after it, and
     before them the category, which winds play back to nothing.

     That last one is the only way to open on a different first word: the one
     step of a one-step chain renders as the name you are at rather than as a
     button, so without a root there is nothing before it to click. It is drawn
     as a label rather than as a step because it is not one — the words in the
     line were played and the category was not, and rendering the two alike had
     it reading as the first word of the chain. The chevrons therefore separate
     words from words only, and the rule beside the label does the rest. */
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

  /* The move the pointer is offering, carried on past the chain the way
     playing it would leave the line. Muted, so what has been played still
     reads as the chain and this as a pointer passing over. */
  #showTail() {
    if (this.#failed) return;
    const sel = this.#focus();
    const show = sel >= 0 && this.#chain.legal(sel) ? sel : -1;
    if (show === this.#crumbSel) return;
    this.#crumbSel = show;
    // Only ever a legal word, so never one already used. It takes a chevron
    // only where a word comes before it: against the label alone the rule is
    // already the separator.
    this.#tailEl.innerHTML =
      show < 0 ? "" : `${this.#chain.length ? "<i>›</i>" : ""}<em>${this.#words[show]}</em>`;
  }
}
customElements.define("word-disc", WordDisc);
