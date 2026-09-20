/* <balance-flow> — the transshipment under the longest chain, drawn as it runs.
 *
 * Data is {category, words: ["cat", …], zipf: [4.7, …]}, the file
 * tools/export_words.py writes for <word-disc>, so a page carrying this and
 * either disc fetches one file between them.
 *
 *   <balance-flow src="words-animal.json"></balance-flow>
 *   <balance-flow> wrapping an application/json script child holding {…}
 *   document.querySelector("balance-flow").data = {category, words};
 *
 * <word-disc> plays the game, <letter-disc> draws the graph under it, and this
 * draws the arithmetic that says how far the game can run. A chain is a trail on
 * 26 letters, so the words that can be kept are the ones left once every letter
 * has as many words leaving it as arriving; word-longest.js finds the cheapest
 * way to that by successive shortest paths, and each of those paths is a band
 * here, as wide as the words it discards.
 *
 * The balancing solve is the one `chain` already does — `trace` reads the paths
 * off it rather than running a second solve — so nothing drawn here is a
 * different answer from the one the disc prices play with. It is 0.46 ms on
 * animal against `chain`'s own 0.64, which is why there is no worker; and the
 * 144 augmentations it comes back with are laid out and drawn in one pass, so a
 * scrub is a redraw rather than a solve.
 *
 * Attributes: src, index-src (words-index.json, which turns the picker on),
 *             readout="off", fit
 * Properties: data, stats, step, frames. Methods: seek(k), play(), pause(),
 *             repaint().
 * Events: balance-step {step, frames, push, cost, from, to, shipped, need},
 *         balance-render {category, words, frames, need, paid, settled,
 *                         solveMs, drawMs}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-sat --disc-val --disc-font --disc-mono
 */
import { ALPHA, banks, bands, route, shipped, thin, walk } from "./balance-bank.js";
import { hsv } from "./disc-colour.js";
import { watch } from "./disc-idle.js";
import { href, label as catLabel } from "./disc-index.js";
import { ratio } from "./disc-ratio.js";
import { LETTERS } from "./letter-graph.js";
import { trace } from "./word-longest.js";

// The picture, as fractions of the box it is given. The banks sit a quarter of
// the way in from each side, which leaves the letters beside them room to be
// read at the widths a host is likely to give this.
const SIDE = 0.24,
  COL = 0.035,
  COL_MIN = 6;
// Room above and below for the two column headings, which sit outside the span
// so they cannot take height off a slot.
const PAD = 0.09,
  PAD_MIN = 26;
// Between one letter's slot and the next, so a column reads as letters rather
// than as one bar. Capped in pixels as well as taken as a share of the span: a
// column can be cut into as many as 26 slots, and at a share alone the 25 gaps
// between animal's take a sixth of the height from the slots themselves.
const SLOT_GAP = 0.012,
  GAP_MAX = 4;

// A bank is the ground its bands are measured against, so it is drawn behind
// them rather than beside them.
const BANK_ALPHA = 0.22;
// The band the readout names, against the ones already laid.
const LIT = 0.95;
/* And an edge around it, since an alpha has nothing to raise on a band that is
   not a pixel tall. The element opens at the balanced step, and successive
   shortest paths leave the smallest pushes for last, so the band lit on arrival
   is the thinnest there is: 0.96 px on animal and 0.56 px on food against a
   426 px span. The fill was never the trouble — the ink under it comes to 0.26
   on animal and 0.38 on furniture, so 0.95 is three times its own ground, with
   half a pixel to say it in. So the lit band's outline is stroked once the fill
   is down, in the band's own ink at the alpha it was filled at, the last 5%
   being worth less than a line of its own. In pixels rather than in units,
   because what it carries is which band the readout means rather than how much
   that band shipped, and the fill keeps every bit of that. */
const LIT_EDGE = 1.5;

/* One band, as a ribbon `h` tall along `pts`: the top edge through them and the
   bottom edge back through them offset by h, every leg a cubic whose control
   points sit on that leg's own midline. Two points is the plain sweep every band
   but the lit one draws; more than two is `route`'s line through the letters the
   path walked, where a leg running right to left is a step that recovered a
   word. An `edge` strokes that outline once the fill is down, in the band's own
   ink at the alpha it was filled at, which is the whole of how the lit band is
   lit at the heights these bands come out at. */
/** @param {CanvasRenderingContext2D} g
   @param {import("./balance-bank.js").Point[]} pts @param {number} h
   @param {number} [edge]
   @returns {void} */
function ribbon(g, pts, h, edge = 0) {
  /** @param {import("./balance-bank.js").Point} from
     @param {import("./balance-bank.js").Point} to @param {number} dy */
  const leg = (from, to, dy) => {
    const mx = (from.x + to.x) / 2;
    g.bezierCurveTo(mx, from.y + dy, mx, to.y + dy, to.x, to.y + dy);
  };
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) leg(pts[i - 1], pts[i], 0);
  const end = pts[pts.length - 1];
  g.lineTo(end.x, end.y + h);
  for (let i = pts.length - 1; i > 0; i--) leg(pts[i], pts[i - 1], h);
  g.closePath();
  g.fill();
  if (edge > 0) {
    // Round, because the reverse leg turns back on itself and a mitre there is a
    // spike pointing out of the picture.
    g.lineJoin = "round";
    g.lineWidth = edge;
    g.strokeStyle = g.fillStyle;
    g.stroke();
  }
}

// The whole run plays in about this, held either side so a small category does
// not crawl and a large one does not blur. animal's 144 augmentations come out
// at 62 ms each and furniture's 36 at the 160 ms ceiling.
const RUN_MS = 9000,
  STEP_MIN = 60,
  STEP_MAX = 160;

const RESIZE_HOLD = 60;

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
  /* No column beside the picture at any width, where the three discs grow one:
     this is already a wide figure, and the rail and the readout under it are
     the whole of what would go there. */
  :host([fit]) .stage{flex:1;min-height:0;width:100%;aspect-ratio:auto}
  .pick{margin-bottom:8px}
  .pick[hidden]{display:none}
  .pick select{width:100%;font-family:var(--_font);font-size:12.5px;line-height:1.5;
    color:var(--_ink);background:var(--_panel);border:1px solid var(--_edge);
    border-radius:2px;padding:5px 9px}
  .pick select:focus-visible{outline:2px solid var(--_accent);outline-offset:-1px}
  .stage{position:relative;width:100%;aspect-ratio:16/9}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .rail{display:flex;align-items:center;gap:12px;margin-top:9px}
  .keys{display:flex;gap:4px}
  .keys button{font-family:var(--_mono);font-size:12px;line-height:1;color:var(--_ink);
    background:var(--_panel);border:1px solid var(--_edge);border-radius:2px;
    padding:6px 9px;min-width:30px;cursor:pointer}
  .keys button:hover{border-color:var(--_muted)}
  .keys button:focus-visible{outline:2px solid var(--_accent);outline-offset:1px}
  .scrub{flex:1;min-width:0;height:20px;accent-color:var(--_accent)}
  .scrub:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}
  :host([readout="off"]) .gloss{display:none}
  /* Held to a height whatever it holds, so the picture above it cannot move
     under the pointer as the readout changes length. */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow:hidden}
  .gloss b{font-family:var(--_mono);font-weight:600}
  /* The path the step took, which is the one thing here that is about arcs. */
  .gloss .path{display:block;font-family:var(--_mono);font-size:12.5px;
    color:var(--_muted);letter-spacing:.06em;white-space:nowrap;overflow:hidden}
  .gloss .fwd{color:var(--_accent)}
  .gloss .rev{color:var(--_muted)}
</style>
<div class="frame">
  <div class="pick" hidden><select class="cat" aria-label="category"></select></div>
  <div class="stage"><canvas class="base" aria-hidden="true"></canvas></div>
  <div class="rail">
    <div class="keys">
      <button class="first" type="button" aria-label="first step">|&lt;</button>
      <button class="prev" type="button" aria-label="previous step">&lt;</button>
      <button class="play" type="button" aria-label="play">&#9654;</button>
      <button class="next" type="button" aria-label="next step">&gt;</button>
      <button class="last" type="button" aria-label="last step">&gt;|</button>
    </div>
    <input class="scrub" type="range" min="0" max="0" value="0" step="1"
           aria-label="augmentation">
  </div>
  <div class="gloss"></div>
</div>`;

class BalanceFlow extends HTMLElement {
  static observedAttributes = ["src", "index-src"];

  /** @type {ShadowRoot} */ #sr;
  /** @type {HTMLCanvasElement} */ #base;
  /** @type {HTMLElement} */ #glossEl;
  /** @type {HTMLElement} */ #pickEl;
  /** @type {HTMLSelectElement} */ #catEl;
  /** @type {HTMLElement} */ #stage;
  /** @type {HTMLInputElement} */ #scrub;
  /** @type {HTMLElement} */ #playEl;
  /** @type {ResizeObserver | null} */ #ro = null;
  /** @type {{disconnect: () => void} | null} */ #idle = null;
  /** @type {MediaQueryList | null} */ #mq = null;
  /** @type {MediaQueryList | null} */ #dq = null;

  #category = "";
  /** @type {string[]} */ #words = [];
  /** @type {import("./word-longest.js").Trace | null} */ #trace = null;
  /** @type {import("./word-longest.js").Augmentation[]} */ #frames = [];

  /* How many augmentations have run. The bands drawn are the ones below it, and
     the readout names the last of them, so the line and the marked band can
     never be of different steps. */
  #step = 0;
  #said = -1;
  /** @type {ReturnType<typeof setInterval> | 0} */ #timer = 0;

  #ready = false;
  /** @type {string | null} */ #loadedSrc = null;
  /** @type {string | null} */ #indexSrc = null;

  // Set while the element is more than a screen away and its canvas has been
  // given back. #pw is 0 with it, which is what every draw path already tests.
  #asleep = false;
  #dpr = 1;
  #pw = 0;
  #ph = 0;
  #alpha = ALPHA;
  #solveMs = 0;
  #drawMs = 0;
  /** @type {Map<string, string>} */ #toks = new Map();
  /** @type {{w: number, h: number, dpr: number, pw: number, ph: number} | null} */ #box = null;
  #resized = -Infinity;
  /** @type {ReturnType<typeof setTimeout> | 0} */ #fitTimer = 0;

  constructor() {
    super();
    this.#sr = this.attachShadow({ mode: "open" });
    this.#sr.append(TPL.content.cloneNode(true));
    const find = /** @param {string} sel */ sel => {
      const el = this.#sr.querySelector(sel);
      if (!el) throw new Error(`balance-flow's template has no ${sel}`);
      return el;
    };
    this.#base = /** @type {HTMLCanvasElement} */ (find(".base"));
    this.#glossEl = /** @type {HTMLElement} */ (find(".gloss"));
    this.#pickEl = /** @type {HTMLElement} */ (find(".pick"));
    this.#catEl = /** @type {HTMLSelectElement} */ (find(".cat"));
    this.#stage = /** @type {HTMLElement} */ (find(".stage"));
    this.#scrub = /** @type {HTMLInputElement} */ (find(".scrub"));
    this.#playEl = /** @type {HTMLElement} */ (find(".play"));
  }

  connectedCallback() {
    this.#catEl.addEventListener("change", this.#onCat);
    this.#scrub.addEventListener("input", this.#onScrub);
    /** @type {[string, () => void][]} */
    const keys = [
      [".first", () => this.seek(0)],
      [".prev", () => this.seek(this.#step - 1)],
      [".next", () => this.seek(this.#step + 1)],
      [".last", () => this.seek(this.#frames.length)],
    ];
    for (const [sel, go] of keys) {
      this.#sr.querySelector(sel)?.addEventListener("click", () => {
        this.pause();
        go();
      });
    }
    this.#playEl.addEventListener("click", this.#onPlay);
    this.#ro = new ResizeObserver(() => this.#fit());
    /* The stage alone, where the discs watch their frame as well: nothing here
       changes layout with the frame's shape, so the stage's own box moving is
       the whole of what a resize means. */
    this.#ro.observe(this.#stage);
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    this.#onRatio();
    /* Canvas text is measured rather than laid out, so a face landing later
       reflows nothing and the labels keep a width solved for the fallback. */
    document.fonts?.ready?.then(() => {
      if (this.#box) this.repaint();
    });
    if (!this.#ready) this.#load();
    this.#loadIndex();
    this.#idle = watch(this, this.#sleep, this.#wake);
  }

  disconnectedCallback() {
    this.pause();
    this.#ro?.disconnect();
    this.#idle?.disconnect();
    this.#idle = null;
    this.#mq?.removeEventListener("change", this.#onScheme);
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = null;
  }

  /** @param {string} n @param {string | null} was @param {string | null} now */
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
        this.data = JSON.parse(inline.textContent ?? "");
      }
    } catch (err) {
      this.#say(`<b>Could not load the words.</b> ${err instanceof Error ? err.message : err}`);
    }
  }

  /* The picker, built only where the host names an index: a page embedding one
     category names one file and needs no control at all. */
  async #loadIndex() {
    const src = this.getAttribute("index-src");
    if (!src || src === this.#indexSrc) return;
    this.#indexSrc = src;
    /** @type {import("./disc-index.js").IndexRow[]} */
    let rows;
    try {
      rows = await (await fetch(src)).json();
    } catch (err) {
      // Where the words arrived from `src`, only the picker is missing, which
      // is not worth taking the readout for.
      if (!this.#ready) {
        this.#say(
          `<b>Could not load the categories.</b> ${err instanceof Error ? err.message : err}`,
        );
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
    this.#pickEl.hidden = rows.length < 2;
    this.#mark();
    // An index alone opens the first category rather than an empty picture.
    // #load has already run by now, so a src written by hand still wins.
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

  /** @param {{category?: string, words?: string[]} | null} d */
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

  /** How many augmentations have run, of how many there are. */
  get step() {
    return this.#step;
  }
  get frames() {
    return this.#frames.length;
  }
  get stats() {
    return {
      category: this.#category,
      words: this.#words.length,
      frames: this.#frames.length,
      need: this.#trace?.need ?? 0,
      paid: this.#trace?.paid ?? 0,
      settled: this.#trace?.settled ?? false,
      step: this.#step,
      shipped: shipped(this.#frames, this.#step),
      alpha: this.#alpha,
      solveMs: this.#solveMs,
      drawMs: this.#drawMs,
    };
  }

  /** @param {number} L @returns {string} */
  #name(L) {
    return String.fromCharCode(65 + L);
  }

  #build() {
    this.pause();
    const t0 = performance.now();
    this.#trace = trace(this.#words);
    this.#solveMs = performance.now() - t0;
    this.#frames = this.#trace.frames;
    this.#alpha = thin(ALPHA, this.#frames.length);
    // Opening on the balanced state, so a page nobody touches still shows the
    // whole transport rather than an empty pair of columns.
    this.#step = this.#frames.length;
    this.#said = -1;
    this.#scrub.max = String(this.#frames.length);
    this.#scrub.value = String(this.#step);
    this.#scrub.disabled = this.#frames.length === 0;
    if (this.#pw) this.#draw();
  }

  /* Zoom moves devicePixelRatio and leaves the CSS box alone, so a sized
     element sees no resize. Re-armed each time, since the query only reports
     leaving the one ratio it names. */
  #onRatio = () => {
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.#dq.addEventListener("change", this.#onRatio);
    this.#fit();
  };

  #fit() {
    if (!this.#ready || this.#asleep) return;
    const box = this.#stage.getBoundingClientRect();
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
    // The first change goes through outright and the rest are coalesced; the
    // canvas stretches until the drag stops.
    if (performance.now() - this.#resized > RESIZE_HOLD) return this.#resize();
    clearTimeout(this.#fitTimer);
    this.#fitTimer = setTimeout(this.#resize, RESIZE_HOLD);
  }

  /* More than a screen away, the canvas goes back. Nothing is held beside it —
     the bands are drawn straight onto it and cost a fraction of a millisecond —
     so this is the one canvas and nothing else. Playing stops with it, since a
     run nobody can see is a timer spending frames on nothing.

     Nothing is dropped before the first fit: an element that starts below the
     fold never allocates rather than allocating and giving back. */
  #sleep = () => {
    if (this.#asleep) return;
    this.#asleep = true;
    this.pause();
    if (!this.#pw) return;
    this.#base.width = 0;
    this.#base.height = 0;
    this.#pw = this.#ph = 0;
  };

  /* And takes it back a screen before it is read. Waking does not resume: what
     was playing was left behind, and a picture that starts moving as it comes
     into view is not what the reader asked for. */
  #wake = () => {
    if (!this.#asleep) return;
    this.#asleep = false;
    this.#resized = 0;
    this.#fit();
  };

  #resize = () => {
    clearTimeout(this.#fitTimer);
    this.#fitTimer = 0;
    this.#resized = performance.now();
    const b = this.#box;
    if (!b) return;
    this.#dpr = b.dpr;
    this.#pw = b.pw;
    this.#ph = b.ph;
    this.#base.width = b.pw;
    this.#base.height = b.ph;
    this.#toks.clear();
    this.#draw();
  };

  /** @param {string} n @param {string} f @returns {string} */
  #tok(n, f) {
    let v = this.#toks.get(n);
    if (v === undefined) {
      v = getComputedStyle(this).getPropertyValue(n).trim() || f;
      this.#toks.set(n, v);
    }
    return v;
  }
  /* The letter wheel palette.py spreads over the circle, which both discs
     colour with as well. */
  /** @param {number} letter @returns {string} */
  #hue(letter) {
    return hsv(letter / LETTERS, +this.#tok("--_sat", ".55"), +this.#tok("--_val", ".88"));
  }

  /** How long one step is held while playing. The run is given a budget rather
     than the step a fixed rate, so a category of 36 augmentations and one of 144
     both take a time worth watching; the two bounds are what stop a very small
     one crawling and a very large one blurring.
     @returns {number} */
  #rate() {
    const n = this.#frames.length || 1;
    return Math.min(STEP_MAX, Math.max(STEP_MIN, RUN_MS / n));
  }

  #tick = () => {
    if (this.#step >= this.#frames.length) return this.pause();
    this.seek(this.#step + 1);
  };

  #onPlay = () => {
    if (this.#timer) this.pause();
    else this.play();
  };

  /** Run from where it stands, rewinding first where it is already balanced.
     @returns {void} */
  play() {
    if (this.#timer || !this.#frames.length) return;
    if (this.#step >= this.#frames.length) this.seek(0);
    this.#timer = setInterval(this.#tick, this.#rate());
    this.#playEl.textContent = "❚❚";
    this.#playEl.setAttribute("aria-label", "pause");
  }

  /** @returns {void} */
  pause() {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = 0;
    this.#playEl.textContent = "▶";
    this.#playEl.setAttribute("aria-label", "play");
  }

  get playing() {
    return this.#timer !== 0;
  }

  #onScrub = () => {
    this.pause();
    this.seek(Number(this.#scrub.value));
  };

  /** Hold the picture at `k` augmentations, 0 for the opening imbalance and the
     frame count for the balanced answer. The public way in.
     @param {number} k @returns {void} */
  seek(k) {
    const n = this.#frames.length;
    const want = Math.max(0, Math.min(n, Math.round(k)));
    this.#step = want;
    this.#scrub.value = String(want);
    this.#draw();
    if (want === this.#said) return;
    this.#said = want;
    const f = want > 0 ? this.#frames[want - 1] : null;
    this.#emit("balance-step", {
      step: want,
      frames: n,
      push: f ? f.push : 0,
      cost: f ? f.cost : 0,
      from: f ? this.#name(f.from) : "",
      to: f ? this.#name(f.to) : "",
      shipped: shipped(this.#frames, want),
      need: this.#trace?.need ?? 0,
    });
  }

  /* The whole picture: the two banks, the bands that have run, and the last of
     them marked, which is the one the readout names. */
  #draw() {
    if (!this.#ready || !this.#pw) return;
    const t = this.#trace;
    const g = this.#base.getContext("2d");
    if (!t || !g) return;
    const t0 = performance.now();
    const w = this.#pw / this.#dpr,
      h = this.#ph / this.#dpr;
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.#showRead();

    const padY = Math.max(PAD_MIN, h * PAD);
    const span = h - padY * 2;
    if (span <= 0) return;
    const colW = Math.max(COL_MIN, w * COL);
    const lx = w * SIDE,
      rx = w * (1 - SIDE);
    const bank = banks(t.excess, span, Math.min(GAP_MAX, span * SLOT_GAP));

    const muted = this.#tok("--_muted", "#90a1a1");
    g.globalAlpha = BANK_ALPHA;
    for (const slot of bank.left) {
      g.fillStyle = this.#hue(slot.letter);
      g.fillRect(lx - colW, padY + slot.y0, colW, slot.h);
    }
    // The deficit side is left uncoloured: a band takes the hue of the letter it
    // leaves, so colouring where it lands as well would say the two were the
    // same letter's ink.
    g.fillStyle = muted;
    for (const slot of bank.right) g.fillRect(rx, padY + slot.y0, colW, slot.h);

    const drawn = bands(this.#frames, bank, this.#step);
    /* Only the band the readout names is routed through the letters its path
       walked. 57 of animal's 144 paths take more than one arc, and zigzagging
       all of them would put three crossings in the middle where there is now
       one; the readout already speaks for the step it stands at alone, so the
       working shows exactly where the line is pointing. The rest are the plain
       sweep, and their two points are written in place rather than allocated
       144 times a redraw. */
    const plain = [
      { x: lx, y: 0 },
      { x: rx, y: 0 },
    ];
    for (const b of drawn) {
      const last = b.step === this.#step - 1;
      g.globalAlpha = last ? LIT : this.#alpha;
      g.fillStyle = this.#hue(b.from);
      if (last) {
        ribbon(g, route(this.#frames[b.step], b, bank, lx, rx, padY), b.h, LIT_EDGE);
      } else {
        plain[0].y = padY + b.a;
        plain[1].y = padY + b.b;
        ribbon(g, plain, b.h);
      }
    }
    g.globalAlpha = 1;

    this.#labels(g, bank, w, padY, colW, lx, rx);
    this.#drawMs = performance.now() - t0;
    this.#emit("balance-render", {
      category: this.#category,
      words: this.#words.length,
      frames: this.#frames.length,
      need: t.need,
      paid: t.paid,
      settled: t.settled,
      solveMs: this.#solveMs,
      drawMs: this.#drawMs,
    });
  }

  /* The letters beside their slots, and what each column is. A slot shorter than
     the type is left unnamed rather than overprinted — the readout says which
     letters a step ran between. */
  /** @param {CanvasRenderingContext2D} g
     @param {import("./balance-bank.js").Bank} bank
     @param {number} w @param {number} padY @param {number} colW
     @param {number} lx @param {number} rx @returns {void} */
  #labels(g, bank, w, padY, colW, lx, rx) {
    const px = Math.max(8, Math.min(15, w * 0.022));
    const mono = this.#tok("--_mono", "monospace");
    const muted = this.#tok("--_muted", "#90a1a1");
    g.font = `500 ${px}px ${mono}`;
    g.textBaseline = "middle";
    g.fillStyle = muted;
    for (const [slots, x, align] of /** @type {[typeof bank.left, number, CanvasTextAlign][]} */ ([
      [bank.left, lx - colW - px * 0.45, "right"],
      [bank.right, rx + colW + px * 0.45, "left"],
    ])) {
      g.textAlign = align;
      for (const slot of slots) {
        if (slot.h < px) continue;
        g.fillText(this.#name(slot.letter), x, padY + slot.y0 + slot.h / 2);
      }
    }
    g.textBaseline = "alphabetic";
    g.textAlign = "center";
    g.fillText("surplus", lx - colW / 2, padY - px * 0.7);
    g.fillText("deficit", rx + colW / 2, padY - px * 0.7);
  }

  /** Call after the host changes theme by any means other than
     prefers-color-scheme, which the element already watches.
     @returns {void} */
  repaint() {
    this.#toks.clear();
    this.#draw();
  }

  /** @param {string} name @param {object} detail @returns {void} */
  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** A failed fetch, written where the readout would otherwise be. #showRead
     returns on #ready, so a words failure holds this line for good.
     @param {string} html @returns {void} */
  #say(html) {
    this.#glossEl.innerHTML = html;
  }

  /* One line about the step the picture stands at, and the path that step took
     under it. Both come off #step, so the line and the marked band can never be
     of different augmentations. */
  #showRead() {
    if (!this.#ready || !this.#trace) return;
    const t = this.#trace;
    const n = this.#frames.length;
    const num = /** @param {number} x */ x => x.toLocaleString("en-GB");
    if (this.#step === 0) {
      const letters = t.excess.reduce((k, e) => k + (e === 0 ? 0 : 1), 0);
      this.#glossEl.innerHTML =
        `<b>${letters}</b> letters open <b>${num(t.need)}</b> words out of balance, ` +
        `cleared in <b>${n}</b> augmentation${n === 1 ? "" : "s"}. ` +
        `<span class="path">nothing shipped yet</span>`;
      return;
    }
    const f = this.#frames[this.#step - 1];
    const done = shipped(this.#frames, this.#step);
    const head =
      this.#step === n
        ? `<b>balanced</b> after ${n} augmentation${n === 1 ? "" : "s"} · ` +
          `<b>${num(t.paid)}</b> word${t.paid === 1 ? "" : "s"} discarded to close the circuit`
        : `step <b>${this.#step}</b> of ${n} · <b>${this.#name(f.from)} → ${this.#name(f.to)}</b>` +
          ` · <b>${num(done)}</b> of ${num(t.need)} shipped`;
    this.#glossEl.innerHTML = `${head}<span class="path">${this.#path(f)}</span>`;
  }

  /** The letters the step walked, with the arcs between them: a forward arc
     discards one more word of its pair and a reverse one recovers a word an
     earlier step had discarded, which is what lets a later path undo part of an
     earlier one at no more than it costs.
     @param {import("./word-longest.js").Augmentation} f @returns {string} */
  #path(f) {
    const seq = walk(f.steps);
    if (!seq.length) return "";
    let out = this.#name(seq[0]);
    for (const [i, s] of f.steps.entries()) {
      out += `<span class="${s > 0 ? "fwd" : "rev"}"> ${s > 0 ? "→" : "⇠"} </span>`;
      out += this.#name(seq[i + 1]);
    }
    return `push ${f.push} · cost ${f.cost} · ${out}`;
  }
}

customElements.define("balance-flow", BalanceFlow);
export { BalanceFlow };
