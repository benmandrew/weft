/* <letter-disc> — the letter graph as a chord diagram.
 *
 * Data is {category, words: ["cat", …], zipf: [4.7, …]}, the file
 * tools/export_words.py writes for <word-disc>, so a page carrying both discs
 * fetches one file for the pair.
 *
 *   <letter-disc src="words-animal.json"></letter-disc>
 *   <letter-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("letter-disc").data = {category, words};
 *
 * Where <word-disc> answers "which word", this answers "which letters, and how
 * heavily". letter-graph.js holds all of the geometry and none of the DOM.
 *
 * No worker and no cached bitmap: a few hundred filled ribbons is a frame's
 * work, so a resize redraws rather than blitting a picture already built.
 *
 * Attributes: src, index-src (words-index.json, which turns the picker on),
 *             tree (the id of a <hypernym-disc>, whose node the picker then
 *             offers as a category; see disc-picker.js),
 *             group (hosts sharing it take the reader's category together),
 *             readout="off", fit
 * Properties: data, stats, letter, arc. Methods: show(letter), repaint().
 * Keyboard: the letter and arc selects under the disc reach everything the
 *           pointer does; Escape returns to the whole category.
 * Events: letter-hover {kind:"arc",from,to,words}
 *                  or {kind:"letter",letter,starts,ends,arcs},
 *         letter-pick {letter,arcs},
 *         letter-render {category,words,letters,pairs,loops,labelPx,alpha,
 *                        drawMs}
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-edge --disc-sat --disc-val --disc-font --disc-mono
 */
import { hsv, TAU } from "./disc-colour.js";
import { Picker } from "./disc-picker.js";
import { band, baseline, fit, halo, HALO, HALO_MIN } from "./disc-label.js";
import { watch } from "./disc-idle.js";
import { ratio } from "./disc-ratio.js";
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

// The hub's name, as <word-disc> sets it: the weight rather than the size
// marks it out, and the bottom rungs degrade a frame too small for the hub.
const HUB_SIZES = [16, 14, 12, 10, 8],
  HUB_WEIGHT = 700;

// The column beside the disc and its gutter, at the thresholds the other two
// discs break to landscape at, so all three do it together.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
const RESIZE_HOLD = 60;

// How much of the picture is left where something is highlighted, and what the
// lit arcs are drawn at. Dimming is one scrim fill over the whole frame.
const SCRIM = 0.74,
  LIT = 0.92;
// The arriving half of a letter's ring band, against the leaving half's full
// weight: bright is where play sets out from and dim where it lands.
const IN_DIM = 0.38;
// Words named in the readout before it says how many are left instead. An arc
// picked from the keyboard or by a tap names all of them, since the reader
// asked for that arc and the readout scrolls.
const NAMED = 14;
// Letters the text alternative names as the busiest.
const BUSIEST = 3;

/** @param {string} s */
const esc = s => s.replace(/[&<>]/g, c => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
/** The readout as a sentence for the live region: no markup, and the arrow
   spelt out, since a screen reader names the glyph rather than reading it.
   @param {string} html */
const spoken = html =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/ → /g, " to ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

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
    /* 3:1 or better against both the ground and the panel, which a control's
       edge needs (WCAG 1.4.11): 3.6 at worst, on the light defaults. */
    --_edge:var(--disc-edge,color-mix(in srgb,var(--_muted) 85%,transparent));
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
  /* Three rows, the picker's first and the readout's last. No row-gap, so
     with no index named the picker's row measures nothing. */
  :host([fit]) .frame.wide{display:grid;column-gap:18px;
    grid-template-columns:minmax(200px,280px) minmax(0,1fr);
    grid-template-rows:auto auto minmax(0,1fr)}
  /* No box around this column, where both other discs draw one: a border
     round a picker and one paragraph is a tall empty rectangle. */
  :host([fit]) .frame.wide .pick{grid-area:1/1;margin-bottom:0}
  :host([fit]) .frame.wide .stage{grid-area:1/2/4/3;height:100%;min-height:0;
    justify-self:center}
  :host([fit]) .frame.wide .tour{grid-area:2/1;margin-top:0}
  /* The column's foot, as long as it needs and no longer than the column: the
     stage spans every row, so this one growing cannot move the disc. */
  :host([fit]) .frame.wide .gloss{grid-area:3/1;align-self:end;height:auto;
    max-height:100%;margin-top:0}
  .pick{margin-bottom:8px}
  .pick[hidden]{display:none}
  .pick select,.tour select{width:100%;font-family:var(--_font);font-size:12.5px;
    line-height:1.5;color:var(--_ink);background:var(--_panel);
    border:1px solid var(--_edge);border-radius:2px;padding:5px 9px}
  .pick select:focus-visible,.tour select:focus-visible{outline:2px solid var(--_accent);
    outline-offset:-1px}
  /* The keyboard's way to everything the pointer reads off the disc: a letter,
     then any arc touching it. Visible, since a pointer reader can use it too. */
  .tour{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:8px}
  /* The letter select as wide as a letter, so the arc beside it has the room
     its options need to be read closed. */
  .tour label{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0;
    color:var(--_muted);font-size:12.5px}
  .tour label:last-child{flex:1 1 150px}
  .tour select{flex:1;min-width:0}
  .tour select:disabled{color:var(--_muted)}
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  /* The arrow throughout: pointing highlights and a click does nothing. A
     vertical swipe still scrolls the page and a pinch still zooms it; a
     sideways drag is left to the pointer, which reads arcs as it goes. */
  canvas.over{cursor:default;touch-action:pan-y pinch-zoom}
  :host([readout="off"]) .gloss{display:none}
  /* Held to a height whatever it holds, which stops the disc moving under the
     pointer: with fit set the stage takes what this leaves. What does not fit
     scrolls rather than being cut, so a long arc's words and text spaced out
     by the reader (WCAG 1.4.12) can still be read; #scrollable makes it a
     focusable region whenever it overflows. */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow-y:auto}
  .gloss:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}
  .gloss b{font-family:var(--_mono);font-weight:600}
  .gloss .w{color:var(--_muted);font-size:13px}
  .announce{position:absolute;width:1px;height:1px;overflow:hidden;
    clip-path:inset(50%);white-space:nowrap}
</style>
<div class="frame">
  <div class="pick" hidden><select class="cat" aria-label="category"></select></div>
  <div class="stage" role="img" aria-label="Letter graph">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" aria-hidden="true"></canvas>
  </div>
  <div class="tour">
    <label>letter <select class="letter"></select></label>
    <label>arc <select class="pair" disabled></select></label>
  </div>
  <div class="gloss"></div>
  <div class="announce" role="status" aria-live="polite" aria-atomic="true"></div>
</div>`;

class LetterDisc extends HTMLElement {
  static observedAttributes = ["src", "index-src", "tree"];

  #sr;
  #base;
  #over;
  #glossEl;
  #frame;
  #pickEl;
  #catEl;
  #stage;
  #letterEl;
  #pairEl;
  #announceEl;
  #ro;
  // Set while the disc is more than a screen away and its canvases have been
  // given back. #pw is 0 with it, which is what every draw path already tests.
  #asleep = false;
  #idle = null;
  #mq;

  #category = "";
  #words = [];
  #M = null;
  #L = null;

  /* The letter show() has drilled into: what the hub names at rest and what
     the readout describes there. -1 is the whole category. */
  #letter = -1;
  /* What the pointer is on: 1 for a letter, 2 for an arc, 0 for nothing. A
     hover moves this and never #letter. */
  #kind = 0;
  #on = -1;
  /* The arc picked from the arc select or by a tap, -1 for none. It outlives
     the pointer leaving, which is what a hover never does, and is always an arc
     touching #letter. */
  #held = -1;
  #ready = false;
  #loadedSrc = null;
  #picker;

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
    this.#glossEl = this.#sr.querySelector(".gloss");
    this.#frame = this.#sr.querySelector(".frame");
    this.#pickEl = this.#sr.querySelector(".pick");
    this.#catEl = this.#sr.querySelector(".cat");
    this.#stage = this.#sr.querySelector(".stage");
    this.#letterEl = this.#sr.querySelector(".letter");
    this.#pairEl = this.#sr.querySelector(".pair");
    this.#announceEl = this.#sr.querySelector(".announce");
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
        // Where the words arrived from `src`, only the picker is missing, which
        // is not worth taking the readout for.
        if (!this.#ready) this.#say(msg);
      },
    });
  }

  connectedCallback() {
    // Named as one thing, unless the page has named it already.
    if (!this.hasAttribute("role")) this.setAttribute("role", "group");
    if (!this.hasAttribute("aria-label") && !this.hasAttribute("aria-labelledby")) {
      this.setAttribute("aria-label", "Letter graph");
    }
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerup", this.#onTap);
    /* Off the whole element rather than the canvas, so the pointer can leave
       the disc for the readout and still read it (WCAG 1.4.13). */
    this.addEventListener("pointerleave", this.#onLeave);
    this.#letterEl.addEventListener("change", this.#onLetter);
    this.#pairEl.addEventListener("change", this.#onPair);
    // The document's, since Escape has to clear a hover with focus anywhere.
    // The stub DOM in check_web.mjs has no document listeners, hence the `?.`.
    document.addEventListener?.("keydown", this.#onKey);
    this.#ro = new ResizeObserver(() => {
      this.#fit();
      this.#scrollable();
    });
    /* Watch the stage, whose box sizes the canvases, and the frame too: the
       stacked stage's box does not move when the frame is dragged wider, so
       the way out of the stacked layout would never be heard of. */
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#ro.observe(this.#frame);
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#onScheme);
    this.#onRatio();
    /* Canvas text is measured rather than laid out, so a face landing later
       reflows nothing and the hub keeps a fit solved for the fallback. */
    document.fonts?.ready?.then(() => {
      if (this.#box) this.repaint();
    });
    if (!this.#ready) this.#load();
    this.#picker.connect();
    this.#idle = watch(this, this.#sleep, this.#wake);
  }
  disconnectedCallback() {
    this.#picker.disconnect();
    document.removeEventListener?.("keydown", this.#onKey);
    this.#ro?.disconnect();
    this.#idle?.disconnect();
    this.#idle = null;
    this.#mq?.removeEventListener("change", this.#onScheme);
    this.#dq?.removeEventListener("change", this.#onRatio);
    this.#dq = null;
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "index-src") this.#picker.index();
    if (n === "tree") this.#picker.tree();
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
    }
  }

  set data(d) {
    if (!d?.words) return;
    this.#category = d.category ?? "";
    this.#picker.mark(this.#category);
    this.#words = Array.from(d.words);
    this.#build();
    this.#ready = true;
    this.#fit();
  }
  get data() {
    return { category: this.#category, words: this.#words };
  }
  /* The letter show() has drilled into, and the arc shown (hovered, else
     held), both as the host would name them rather than as indices. */
  get letter() {
    return this.#letter < 0 ? "" : String.fromCharCode(65 + this.#letter);
  }
  get arc() {
    const [kind, on] = this.#shown();
    if (kind !== 2 || !this.#L) return null;
    const e = this.#L.edges[on];
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
    this.#held = -1;
    this.#tour();
    this.#describe();
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
    return true;
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
    // The first change goes through outright and the rest are coalesced; the
    // canvases stretch until the drag stops.
    if (performance.now() - this.#resized > RESIZE_HOLD) return this.#resize();
    clearTimeout(this.#fitTimer);
    this.#fitTimer = setTimeout(this.#resize, RESIZE_HOLD);
  }

  /* A disc more than a screen away gives back its two canvases, which is all
     it holds: the ribbons go straight onto the base, with no resting picture
     kept beside them as <word-disc> keeps its bundle. #pw at 0 stops every draw
     path, and #asleep stops #fit sizing them again while the resize observer
     goes on firing. Nothing is dropped before the first fit, so a disc that
     starts below the fold never allocates. */
  #sleep = () => {
    if (this.#asleep) return;
    this.#asleep = true;
    if (!this.#pw) return;
    for (const c of [this.#base, this.#over]) {
      c.width = 0;
      c.height = 0;
    }
    this.#pw = this.#ph = 0;
  };

  /* And takes them back a screen before it is read. */
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
  /* The letter wheel palette.py spreads over the circle, and the one
     <word-disc> colours its wedges with. */
  #hue(letter) {
    return hsv(letter / LETTERS, +this.#tok("--_sat", ".55"), +this.#tok("--_val", ".88"));
  }

  /* The resting picture: the arcs, the ring bands, the letters. It moves with
     the data or the geometry and never on a pointer. */
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
     read over the hairlines. */
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

  /* The band at the ring, the leaving half at the letter's own weight and the
     arriving half dimmed. Direction reads off it, so it is drawn over the
     scrim as well as under it. */
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

  /* The letters outside the ring, dropped where the arc is narrower than the
     glyph — the hub names what the pointer is on instead. `force` is drawn
     whatever its arc. */
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

  /* The pointer's layer: the picture dimmed to whatever it is on, and the
     hub. */
  #overlay() {
    if (!this.#ready || !this.#pw) return;
    this.#showRead();
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
      const [kind, on] = this.#shown();
      this.#letters(g, 1, kind === 1 ? on : -1);
    }
    this.#hub(g);
  }

  /* What the picture, the hub and the readout are of: the pointer's letter or
     arc while it is on one, otherwise the held arc, otherwise the drilled-into
     letter, otherwise nothing. As [kind, on], kind as #kind counts it. */
  #shown() {
    if (this.#kind) return [this.#kind, this.#on];
    if (this.#held >= 0) return [2, this.#held];
    if (this.#letter >= 0) return [1, this.#letter];
    return [0, -1];
  }

  /* Which arcs are lit, and null for the resting picture: a letter lights
     everything touching it in either direction, an arc lights itself. */
  #lit() {
    const [kind, on] = this.#shown();
    if (kind === 1) return new Set(this.#L.byLetter[on]);
    if (kind === 2) return new Set([on]);
    return null;
  }

  /* disc-label.js's reference band, held per font, since g.font is the one
     thing that changes the answer. */
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

  /* The hub names what the pointer is on, otherwise the drilled-into letter,
     otherwise the category, muted. Nothing is drawn behind it — the middle is
     where the long arcs cross — so the text carries its own ground. */
  #hub(g) {
    const named = this.#named();
    const { lines, lh, px } = this.#fitted(g, named.text, this.#rHub - 6);

    g.textAlign = "center";
    // Alphabetic and placed by hand, because "middle" centres the em square
    // and its descender space is empty for most names, so the type sits low.
    g.textBaseline = "alphabetic";
    // The band is off the face rather than the name, so all names share a
    // baseline.
    const first = baseline(this.#cy, this.#band(g), lines.length, lh);
    this.#ground(g, lines, first, lh, Math.max(HALO_MIN, px * HALO));
    g.fillStyle = named.ink;
    for (const [k, line] of lines.entries()) g.fillText(line, this.#cx, first + k * lh);
  }

  /* disc-label.js's halo, against this element's own ground token. */
  #ground(g, lines, first, lh, r) {
    halo(g, lines, this.#cx, first, lh, r, this.#tok("--_ground", "#0c1112"));
  }

  /* What the hub says and in what colour. One method, so the name in the
     middle and the readout below can never be of different things. */
  #named() {
    const ink = this.#tok("--_ink", "#e7eded");
    const [kind, on] = this.#shown();
    if (kind === 2) {
      const e = this.#L.edges[on];
      return { text: `${this.#name(e.from)}→${this.#name(e.to)}`, ink };
    }
    if (kind === 1) return { text: this.#name(on), ink };
    return { text: this.#category || "the letters", ink: this.#tok("--_muted", "#90a1a1") };
  }

  /* A point on the disc, as a letter, an arc, or nothing. Inside the ring the
     path itself has to be asked, topmost first. The transform is dropped,
     because isPointInPath takes its point in the canvas's own space.

     The hub is no bar. The long arcs are bowed through the middle and nothing
     is drawn behind the name, so an arc crossing the hub is as much under the
     pointer as one anywhere else. */
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
    const [kind, on] = this.#hit(px, py);
    if (kind === this.#kind && on === this.#on) return;
    this.#preview(kind, on);
  };
  #onLeave = () => {
    if (this.#kind) this.#preview(0, -1);
  };
  /* A touch has no hover, and the readout a finger raised would clear as it
     lifted, so a tap pins what it landed on as the selects would. A mouse
     click still does nothing: the mouse has the hover. */
  #onTap = ev => {
    if (ev.pointerType === "mouse" || !this.#ready || !this.#pw) return;
    const [kind, on] = this.#hit(...this.#at(ev));
    this.#pin(kind, on);
  };
  #onLetter = () => {
    const v = this.#letterEl.value;
    this.#pin(v === "" ? 0 : 1, v === "" ? -1 : Number(v));
  };
  #onPair = () => {
    const v = this.#pairEl.value;
    if (v === "") this.#pin(1, this.#letter);
    else this.#pin(2, Number(v));
  };
  /* Escape takes a hover off first, so the pointer's readout can be dismissed
     without moving the pointer, and otherwise, with focus in here, puts the
     disc back on the whole category. */
  #onKey = ev => {
    if (ev.key !== "Escape") return;
    if (this.#kind) {
      this.#preview(0, -1);
      return;
    }
    if (document.activeElement !== this) return;
    if (this.#letter >= 0 || this.#held >= 0) this.#pin(0, -1);
  };

  /* A committed choice, from a select or a tap: a letter drills into it, an arc
     drills into the letter it leaves and holds the arc, nothing goes back to
     the whole category. Unlike a hover it is announced and it stays. */
  #pin(kind, on) {
    if (!this.#L) return;
    const was = `${this.#letter}/${this.#held}`;
    if (kind === 2) {
      const e = this.#L.edges[on];
      // Kept on the letter the reader was on where the arc touches it, so
      // picking an arriving arc does not move the letter select under them.
      const at = this.#letter === e.to ? e.to : e.from;
      this.show(at);
      this.#held = on;
    } else {
      this.show(kind === 1 ? on : -1);
    }
    this.#syncTour();
    this.#overlay();
    // A tap on nothing with nothing pinned changes nothing, and says nothing.
    if (`${this.#letter}/${this.#held}` !== was) this.#announce(spoken(this.#readout(NAMED)));
  }

  /* The live region. Polite, and only ever written after a committed choice.
     The same text twice is cleared and set a frame later, since a region that
     does not change says nothing. */
  #announce(text) {
    const el = this.#announceEl;
    if (!el) return;
    if (el.textContent !== text) {
      el.textContent = text;
      return;
    }
    el.textContent = "";
    (globalThis.requestAnimationFrame ?? setTimeout)(() => {
      el.textContent = text;
    });
  }

  /* The letter select: one option a letter some word touches, after one for
     the whole category. The letter alone, since the readout gives its counts.
     Rebuilt with the words, as is the arc select under it. */
  #tour() {
    const L = this.#L;
    if (!this.#letterEl || !L) return;
    const opt = (value, text) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      return o;
    };
    this.#letterEl.replaceChildren(
      opt("", "all"),
      ...L.live.map(k => opt(String(k), this.#name(k))),
    );
    this.#syncTour();
  }

  /* Both selects onto #letter and #held, and the arc select's options onto the
     letter's arcs: its loop, the arcs leaving it, then the arcs arriving, each
     run in alphabetical order of the letter at the far end. */
  #syncTour() {
    const L = this.#L;
    if (!this.#letterEl || !L) return;
    this.#letterEl.value = this.#letter < 0 ? "" : String(this.#letter);
    const at = this.#letter;
    const opts = [];
    const opt = (value, text) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      opts.push(o);
    };
    if (at < 0) opt("", "pick a letter first");
    else {
      opt("", `all ${L.byLetter[at].length} arcs`);
      const words = n => `${n} word${n === 1 ? "" : "s"}`;
      const byFar = (k, far) => [k, far(L.edges[k])];
      const ways = [
        ...L.out[at].filter(k => L.edges[k].to === at).map(k => [k, "loop back to"]),
        ...L.out[at]
          .filter(k => L.edges[k].to !== at)
          .map(k => byFar(k, e => e.to))
          .sort((x, y) => x[1] - y[1])
          .map(([k]) => [k, "to"]),
        ...L.into[at]
          .filter(k => L.edges[k].from !== at)
          .map(k => byFar(k, e => e.from))
          .sort((x, y) => x[1] - y[1])
          .map(([k]) => [k, "from"]),
      ];
      for (const [k, way] of ways) {
        const e = L.edges[k];
        const far = way === "from" ? e.from : e.to;
        opt(String(k), `${way} ${this.#name(far)} · ${words(e.n)}`);
      }
    }
    // Disabling the focused control drops focus on the page, so it goes back
    // to the letter select, the one that can be used next.
    const held = this.#sr.activeElement === this.#pairEl;
    this.#pairEl.replaceChildren(...opts);
    this.#pairEl.disabled = at < 0;
    if (held && at < 0) this.#letterEl.focus();
    this.#pairEl.value = this.#held < 0 ? "" : String(this.#held);
  }

  /* The drawing's text alternative, the counts the resting readout gives and
     the letters doing the most, since the picture says that at a glance. */
  #describe() {
    const L = this.#L;
    if (!this.#stage || !L) return;
    const busy = [...L.live]
      .sort((x, y) => L.starts[y] + L.ends[y] - (L.starts[x] + L.ends[x]) || x - y)
      .slice(0, BUSIEST)
      .map(k => this.#name(k));
    const list =
      busy.length > 1 ? `${busy.slice(0, -1).join(", ")} and ${busy[busy.length - 1]}` : busy[0];
    this.#stage.setAttribute(
      "aria-label",
      `Letter graph${this.#category ? ` of ${this.#category}` : ""}: ${L.words.toLocaleString("en-GB")} words over ` +
        `${L.live.length} letters, drawn as ${L.pairs.toLocaleString("en-GB")} arcs from first letter to last` +
        (busy.length ? `; the busiest letter${busy.length > 1 ? "s are" : " is"} ${list}.` : "."),
    );
  }

  /* The readout as a keyboard reader reaches it: focusable and named only while
     it holds more than it shows, so a short one is not a tab stop for nothing. */
  #scrollable() {
    const g = this.#glossEl;
    if (!g) return;
    if (g.scrollHeight > g.clientHeight + 1) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "region");
      g.setAttribute("aria-label", "letter graph readout");
    } else {
      g.removeAttribute("tabindex");
      g.removeAttribute("role");
      g.removeAttribute("aria-label");
    }
  }

  /* Everything pointing at a thing does and nothing else. It never touches
     #letter, so a hover cannot move what show() drilled into. */
  #preview(kind, on) {
    this.#kind = kind;
    this.#on = on;
    this.#overlay();
    if (!kind) return;
    /* A letter carries `starts` and `ends` rather than one total, since
       adding the two counts a word that begins and ends on it twice. */
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

  /* The letter the disc is drilled into, as a letter or an index, and -1 for
     the whole category. The only way in: a mouse click on the disc does
     nothing, and the selects and a tap come here through #pin. */
  show(letter) {
    if (!this.#L) return;
    const L = typeof letter === "string" ? letter.toLowerCase().charCodeAt(0) - 97 : letter;
    const want = Number.isInteger(L) && L >= 0 && L < LETTERS ? L : -1;
    // A held arc belongs to the letter it was picked under.
    this.#held = -1;
    if (want === this.#letter) {
      this.#syncTour();
      this.#overlay();
      return;
    }
    this.#letter = want;
    this.#syncTour();
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

  /* A failed fetch, written where the readout would otherwise be. #showRead
     returns on #ready, so a words failure holds this line for good. */
  #say(html) {
    this.#glossEl.innerHTML = html;
  }

  /* One line saying what the middle names, off the state the hub reads, so
     the two cannot differ. For an arc it names the words rather than counting
     them: all of them for a held arc, NAMED of them for a hover. */
  #showRead() {
    if (!this.#ready) return;
    this.#glossEl.innerHTML = this.#readout(!this.#kind && this.#held >= 0 ? Infinity : NAMED);
    this.#scrollable();
  }

  /* What #showRead writes, naming at most `cap` of an arc's words. */
  #readout(cap) {
    const L = this.#L;
    const [kind, on] = this.#shown();
    if (kind === 2) {
      const e = L.edges[on];
      const words = this.#words.filter(
        w => w && w.charCodeAt(0) - 97 === e.from && w.charCodeAt(w.length - 1) - 97 === e.to,
      );
      words.sort();
      const shown = esc(words.slice(0, cap).join(", "));
      const rest = words.length - Math.min(words.length, cap);
      return (
        `<b>${this.#name(e.from)} → ${this.#name(e.to)}</b> · ${e.n} word${e.n === 1 ? "" : "s"}` +
        `${e.from === e.to ? " back to the letter they started on" : ""} · ` +
        `<span class="w">${shown}${rest ? ` and ${rest} more` : ""}</span>`
      );
    }
    if (kind === 1) {
      const L2 = on;
      const out = L.starts[L2],
        into = L.ends[L2];
      return (
        `<b>${this.#name(L2)}</b> · ${out} word${out === 1 ? "" : "s"} start here · ` +
        `${into} end here · ${L.out[L2].length} arc${L.out[L2].length === 1 ? "" : "s"} out, ` +
        `${L.into[L2].length} in`
      );
    }
    return (
      `<b>${L.words}</b> words over <b>${L.live.length}</b> letters, drawn as ` +
      `<b>${L.pairs}</b> arcs${L.loops ? `, ${L.loops} of them back to their own letter` : ""}. ` +
      `Point at an arc, or pick a letter, to read the words on it.`
    );
  }
}
customElements.define("letter-disc", LetterDisc);
