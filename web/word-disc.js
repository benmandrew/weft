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
 * to an offscreen canvas once per size, so a click blits the bundle and draws
 * only the fan on top of it. That is what keeps a move a single frame at any
 * word count the bundle is worth drawing at.
 *
 * word-layout.js is the placement, word-chain.js the rule, and neither touches
 * the DOM, so tools/check_web.mjs runs both without a browser.
 *
 * Attributes: src, limit (110, or 0 for every word), readout="off",
 *             search="off", fit
 * Properties: data, words, chain, stats. Methods: play(i), undo(), rewind(k),
 *             clear(), repaint().
 * Events: word-hover {index,word,replies}, word-play {index,word,chain},
 *         word-chain {chain,words,stuck}, word-render {words,chords,drawMs}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-warn --disc-sat --disc-val --disc-font --disc-mono
 */
import { hsv, TAU } from "./disc-colour.js";
import { fit } from "./disc-label.js";
import { Search } from "./disc-search.js";
import { Chain } from "./word-chain.js";
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
// The sizes the hub's name steps down through, and its weight. Larger and
// heavier than disc-label.js's own ladder because nothing is drawn in the
// middle of this disc but the name, and it has to carry over the bundle
// behind it rather than sit on a panel in front of it.
const HUB_SIZES = [22, 19, 16, 14, 12],
  HUB_WEIGHT = 700;
// The halo under the hub's text, as a fraction of the type size and never
// thinner than this. It is what replaces the panel: 100 to 280 of a category's
// chords pass inside the hub's radius — element is the worst — so the name has
// to clear its own ground, but only its own. A disc large enough to hold it
// took the middle of the figure out with it.
const HALO = 0.3,
  HALO_MIN = 3.5;
// The search column beside the disc, and the gutter to it. Same thresholds as
// <hypernym-disc>, so the two elements break to landscape together.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
const RESIZE_HOLD = 60;

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
// Chords past which the bundle is fog rather than a picture, and not worth the
// stroke apiece a resize would pay for it. animal at no limit holds 125,000.
const MAX_BUNDLE = 24000;

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
  :host([fit]) .frame.wide{display:grid;column-gap:18px;
    grid-template-columns:minmax(200px,280px) minmax(0,1fr);
    grid-template-rows:minmax(0,1fr) auto auto}
  :host([fit]) .frame.wide .find{grid-area:1/1;margin-bottom:0;
    display:flex;flex-direction:column;min-height:0}
  :host([fit]) .frame.wide .hits{position:static;margin-top:6px;box-shadow:none;
    flex:0 1 auto;min-height:0;max-height:none}
  :host([fit]) .frame.wide .hits li{display:block}
  :host([fit]) .frame.wide .hits .p{display:block;margin-left:0}
  :host([fit]) .frame.wide .stage{grid-area:1/2/3/3;height:100%;min-height:0;
    justify-self:center}
  :host([fit]) .frame.wide .gloss{grid-area:2/1;height:auto;-webkit-line-clamp:5;
    margin-top:12px}
  :host([fit]) .frame.wide .crumb{grid-area:3/1/4/-1;margin-top:7px}
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
  .gloss .key{font-family:var(--_mono);color:var(--_accent)}
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
  <div class="find">
    <input class="q" type="search" role="combobox" autocomplete="off"
           spellcheck="false" aria-controls="hits" aria-expanded="false"
           aria-autocomplete="list" placeholder="Waiting for words…" disabled>
    <ul class="hits" id="hits" role="listbox" hidden></ul>
  </div>
  <div class="stage">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" aria-hidden="true"></canvas>
  </div>
  <div class="gloss"></div>
  <div class="crumb"><span class="head"></span><span class="tail"></span></div>
</div>`;

class WordDisc extends HTMLElement {
  static observedAttributes = ["src", "limit"];

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

  // The bundle, drawn once per size and blitted per frame.
  #cache = null;
  #chordCount = 0;
  #drawMs = 0;

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
  // Whether the cursor is currently a pointer and whether the pointer is over
  // the hub, both held so the cursor can be recomputed after a move as well as
  // after a pointer event.
  #points = false;
  #inHub = false;
  #box = null;
  #resized = -Infinity;
  #fitTimer = 0;

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
    this.#ro = new ResizeObserver(() => this.#fit());
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    if (!this.#ready) this.#load();
  }
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#mq?.removeEventListener("change", this.#onScheme);
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
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

  set data(d) {
    if (!d?.words) return;
    this.#category = d.category ?? "";
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
      labelPx: this.#labelPx,
      drawMs: this.#drawMs,
      chain: this.#chain?.length ?? 0,
    };
  }

  /* 110 by default, the same count `build` draws, and 0 for every word the
     category has — a count being lifted reads as all of them. */
  #limit() {
    const want = this.getAttribute("limit");
    if (want === null) return 110;
    const n = Math.round(+want);
    return Number.isFinite(n) && n >= 0 ? n : 110;
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
    this.#cache = null;
    this.#closeFind();
    this.#q.disabled = this.#words.length === 0;
    if (!this.#q.disabled) this.#q.placeholder = "Search words…";

    this.#turn = turns(this.#L);

    this.#crumbs();
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
    return true;
  }

  #fit() {
    if (!this.#ready) return;
    if (this.#shape() && this.#pw) return;
    const box = this.#sr.querySelector(".stage").getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(box.width * dpr),
      ph = Math.round(box.height * dpr);
    if (pw === this.#pw && ph === this.#ph && dpr === this.#dpr) {
      clearTimeout(this.#fitTimer);
      this.#fitTimer = 0;
      return;
    }
    this.#box = { w: box.width, h: box.height, dpr, pw, ph };
    // The bundle is a stroke per chord and has to be drawn again at the new
    // radius, so a drag would pay for it every frame. The first change goes
    // through outright and the rest are coalesced; the canvases stretch until
    // the drag stops.
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
    this.#widest = 0;
    this.#cache = null;
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

  /* A cubic bowed towards the centre, which is what makes a chord read as the
     pair of letters it joins rather than as a line across the disc. Four
     control points and no sampling, the same curve `_curve` writes into the
     SVG. */
  #chord(g, i, j, pull) {
    const x0 = this.#x(i),
      y0 = this.#y(i),
      x1 = this.#x(j),
      y1 = this.#y(j);
    g.moveTo(x0, y0);
    g.bezierCurveTo(
      this.#cx + (x0 - this.#cx) * pull,
      this.#cy + (y0 - this.#cy) * pull,
      this.#cx + (x1 - this.#cx) * pull,
      this.#cy + (y1 - this.#cy) * pull,
      x1,
      y1,
    );
  }

  /* Every chord the SVG draws, onto a canvas of its own, once per size.
     A stroke apiece rather than one path per letter, because the alpha has to
     accumulate where curves overlap the way it does in the figure — batched
     into one path a bundle composites once and reads flat.

     Past MAX_BUNDLE it is fog rather than a picture and is skipped: the fan
     the chain lights is the thing to read at that density, and the resize
     would otherwise pay a stroke for each of 125,000 curves. */
  #bundle() {
    if (this.#cache || !this.#words.length) return;
    if (this.#chordCount > MAX_BUNDLE) return;
    const c = document.createElement("canvas");
    c.width = this.#pw;
    c.height = this.#ph;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.lineWidth = 0.5;
    g.globalAlpha = this.#words.length > DENSE ? EDGE_ALPHA * 0.55 : EDGE_ALPHA;
    const pull = this.#words.length > DENSE ? PULL_DENSE : PULL;
    // Grouped by the source word's letter, which is the colour, so the stroke
    // style is set 26 times rather than once per curve.
    for (const L of this.#L.live) {
      g.strokeStyle = this.#hue(L);
      for (const i of this.#L.byHead[L]) {
        for (const j of this.#L.byHead[this.#L.tail[i]]) {
          if (j === i) continue;
          g.beginPath();
          this.#chord(g, i, j, pull);
          g.stroke();
        }
      }
    }
    this.#cache = c;
  }

  /* The disc as it stands: the bundle, the fan out of the chain end, the chain
     itself, the dots and the labels. It moves on a move rather than on a
     pointer, so the overlay above it is the only thing a hover repaints. */
  #draw() {
    if (!this.#ready || !this.#pw) return;
    const t0 = performance.now();
    this.#bundle();
    const g = this.#base.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#pw / this.#dpr, this.#ph / this.#dpr);

    const live = this.#chain.length > 0;
    if (this.#cache) {
      g.globalAlpha = live ? BUNDLE_DIM : 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(this.#cache, 0, 0);
      g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
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
     carries its own ground instead, stroked under the fill and scaled to the
     type: the only thing it hides is the shape of its own letters. */
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
    g.textBaseline = "middle";
    g.strokeStyle = this.#tok("--_ground", "#0c1112");
    // Round, so the halo follows the letterforms rather than throwing spikes
    // off every corner of them.
    g.lineJoin = "round";
    const top = this.#cy - ((lines.length - 1) * lh) / 2 - (way ? HINT_H / 2 : 0);
    g.lineWidth = Math.max(HALO_MIN, px * HALO);
    for (const [k, line] of lines.entries()) g.strokeText(line, this.#cx, top + k * lh);
    g.fillStyle = ink;
    for (const [k, line] of lines.entries()) g.fillText(line, this.#cx, top + k * lh);

    if (!way) return;
    const y = top + (lines.length - 1) * lh + HINT_H;
    g.font = `${HUB_WEIGHT} ${HINT_PX}px ${this.#tok("--_mono", "monospace")}`;
    g.lineWidth = Math.max(HALO_MIN, HINT_PX * HALO);
    g.strokeText("↑ back", this.#cx, y);
    g.fillStyle = this.#tok("--_accent", "#59b491");
    g.fillText("↑ back", this.#cx, y);
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
    this.#cache = null;
    this.#draw();
    this.#overlay();
  }

  /* Every move goes through here, so the disc, the line under it and the
     event can never describe different chains. */
  #after() {
    this.#draw();
    this.#crumbs();
    this.#overlay();
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
    const to = this.#L.tail[i];
    const letter = String.fromCharCode(65 + to);
    // What is left, and what there ever was. The two come apart now that a
    // word is spent once played: a letter can run out because the category
    // holds nothing starting with it, or because the chain has been through
    // all of them, and only the first is a fact about the category.
    const left = this.#chain.replies(i, this.#L.byHead);
    const ever = this.#L.byHead[to].length - (this.#L.head[i] === to ? 1 : 0);
    const parts = [`<b>${this.#words[i]}</b> hands over on <span class="key">${letter}</span>`];
    if (left) parts.push(`${left} word${left === 1 ? "" : "s"} can follow it`);
    else if (!ever)
      parts.push(`<span class="warn">nothing starts with ${letter}: the round ends here</span>`);
    else
      parts.push(
        `<span class="warn">every word starting with ${letter} is used: ` +
          "the round ends here</span>",
      );
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
