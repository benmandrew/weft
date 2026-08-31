/* <hypernym-disc> — a zoomable nested-arc view of any rooted tree.
 *
 * Data is {names: "a\nb\n…", par: [-1, 0, 0, …]} where par[i] is the index of
 * i's parent and every parent precedes its children, so each pass below is a
 * single loop rather than a traversal.
 *
 *   <hypernym-disc src="wordnet-tree.json"
 *                   names-src="wordnet-names.txt"></hypernym-disc>
 *   <hypernym-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("hypernym-disc").data = {names, par};
 *
 * The disc lays out and paints without a single name, so `src` carries the
 * structure alone and `names-src` is fetched after the first paint. Until it
 * lands, a node answers to `#index`. `glosses-src` trails the names, being much
 * the largest of the three and read by one line of text: the definition of
 * whatever the hub names, the node under the pointer or the current root.
 *
 * The paint runs off this thread. disc-paint.js is the pipeline, disc-worker.js
 * hosts it against an OffscreenCanvas, and the element calls the same class
 * here where a worker cannot be had. The element keeps the layout either way,
 * because hit testing and the crumbs both answer without a round trip.
 *
 * Only `rings` depths below the root are drawn. A deep tree's last rings hold
 * almost nothing — WordNet is 20 deep and its depth 19 is a single node — so
 * dividing the radius by every depth spends a quarter of it on a fringe too
 * sparse to see. Capping it fills the frame, and what falls off the edge is one
 * zoom away, since zooming makes the node the new root and re-counts from it.
 *
 * The search box takes the same two steps as the pointer. Picking a suggestion
 * previews it, which is the hover path and nothing else, and Enter is the
 * click: it zooms. A leaf has nothing to zoom into, so Enter on one goes to its
 * parent and leaves the cursor on the leaf, which is where clicking cannot take
 * you and is the whole reason to search for a word.
 *
 * Attributes: src, names-src, glosses-src, readout="off", search="off", fit,
 *             hue-depth (default 8), rings (default 14), start,
 *             merge: "density" (default) splits merged runs at pixel
 *             boundaries and shades each by how many wedges it holds, "on"
 *             merges each run flat, "off" draws every wedge separately.
 * Properties: data, index, names, glosses. Methods: zoomTo(i), up(), reset(), repaint(), path(i).
 * Events: disc-hover {index,name,depth,leaves}, disc-zoom {index,name,path},
 *         disc-render {nodes,drawn,buildMs,drawMs,hitUs,name} after every repaint,
 *         disc-names {count,ms} once the names arrive.
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-sat --disc-val --disc-font --disc-mono
 */
import { Painter, TAU } from "./disc-paint.js";
import { Search } from "./disc-search.js";
import { fit } from "./disc-label.js";

// The "up" hint under the hub's name: its size, and the room it takes from the
// name above it.
const HINT_PX = 9,
  HINT_H = 12;
// The search column beside the disc, and the gutter to it. Landscape is worth
// taking only once the frame is this much wider than a disc filling its height.
const ASIDE_MIN = 200,
  ASIDE_GAP = 18;
// How long a resize is held open. A drag fires the observer every frame and
// each frame costs the painter a whole remerge, since the merge is measured in
// pixels and the radius moved.
const RESIZE_HOLD = 60;
// What the worker gets to answer in, timed from the first paint the element
// actually wants rather than from the worker's construction.
const WORKER_FLOOR = 400;

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
  /* Under the fit attribute the element fills the box it is given and the
     stage takes whatever height the search box and crumbs leave, so the disc
     is as large as both dimensions allow rather than as large as a page's
     guess at the chrome. Off by default, since a host that gives the element
     no height would collapse the stage to nothing. */
  :host([fit]){height:100%}
  :host([fit]) .frame{display:flex;flex-direction:column;height:100%}
  :host([fit]) .stage{flex:1;min-height:0;width:auto;max-width:100%;align-self:center}
  /* Side by side once the frame is wider than a square disc needs. The
     suggestions then sit beside the disc rather than over it, and the disc gets
     back the height the search box was taking. Under fit only: without a height
     there is no landscape to find. The class is set from the resize observer,
     since the test is the frame's own shape and a container cannot query
     itself. */
  :host([fit]) .frame.wide{display:grid;column-gap:18px;
    grid-template-columns:minmax(200px,280px) minmax(0,1fr);
    grid-template-rows:minmax(0,1fr) auto auto}
  :host([fit]) .frame.wide .find{grid-area:1/1;margin-bottom:0;
    display:flex;flex-direction:column;min-height:0}
  :host([fit]) .frame.wide .hits{position:static;margin-top:6px;box-shadow:none;
    flex:0 1 auto;min-height:0;max-height:none}
  /* A 240 px column has no room for a name and its parent on one line. */
  :host([fit]) .frame.wide .hits li{display:block}
  :host([fit]) .frame.wide .hits .p{display:block;margin-left:0}
  :host([fit]) .frame.wide .stage{grid-area:1/2/3/3;height:100%;min-height:0;
    justify-self:center}
  /* The definition moves to the foot of the search column, so the only thing
     under the disc is the crumb line and the disc keeps the 41 px the two
     lines were taking. The stage spans both rows, so a longer definition
     costs the suggestions their room rather than the disc its height, and it
     is free to run past two lines here. */
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
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  canvas.over{cursor:pointer;touch-action:none}
  :host([readout="off"]) .gloss,:host([readout="off"]) .crumb{display:none}
  /* The gloss and the crumb are children of the frame rather than a block of
     their own, since grid placement is what moves the gloss into the search
     column and it can only place a child of the grid.

     Stacked under the disc it is two lines, always, so zooming to a longer
     definition never resizes the disc under the pointer. Nothing is reserved
     before the file lands. */
  .gloss{color:var(--_ink);font-size:14px;line-height:1.45;height:2.9em;
    margin-top:7px;overflow:hidden;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .gloss:empty{display:none}
  .crumb{font-family:var(--_mono);font-size:11px;color:var(--_muted);line-height:1.6;
    margin-top:3px;white-space:nowrap;overflow-x:auto;scrollbar-width:none}
  .gloss:empty + .crumb{margin-top:7px}
  .crumb::-webkit-scrollbar{display:none}
  .crumb button{font:inherit;color:var(--_accent);background:none;border:0;padding:0;
    cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .crumb .now{color:var(--_ink)}
  .crumb em{font-style:normal}
  .crumb i{font-style:normal;color:var(--_muted);opacity:.5;padding:0 4px}
  .crumb .head i:first-child{padding-left:0}
  .crumb b{color:var(--_ink);font-weight:600}
</style>
<div class="frame">
  <div class="find">
    <input class="q" type="search" role="combobox" autocomplete="off"
           spellcheck="false" aria-controls="hits" aria-expanded="false"
           aria-autocomplete="list" placeholder="Waiting for names…" disabled>
    <ul class="hits" id="hits" role="listbox" hidden></ul>
  </div>
  <div class="stage">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" aria-hidden="true"></canvas>
  </div>
  <div class="gloss"></div>
  <div class="crumb"><span class="head"></span><span class="tail"></span></div>
</div>`;

class HypernymDisc extends HTMLElement {
  static observedAttributes = [
    "src",
    "names-src",
    "glosses-src",
    "start",
    "hue-depth",
    "merge",
    "rings",
  ];

  #sr;
  #base;
  #over;
  #crumb;
  #ro;
  #q;
  #hits;
  #frame;
  #glossEl;
  // Built on the first query rather than when the names land, so a page that
  // never searches never pays for the lowercased copy.
  #search = null;
  #sug = [];
  #pick = -1;
  #names = [];
  #glosses = [];
  #par = [];
  // Where i's children start in the flat child list, which is the build's
  // own and goes no further: #kidOff[i + 1] - #kidOff[i] is the child count,
  // and nothing outside #build walks the children themselves. The 82,115
  // separate arrays this replaces held 4.8 MB, two thirds of them the empty
  // one a leaf never reads.
  #kidOff;
  #depth;
  #leaves;
  #a0;
  #a1;
  #byDepth = [];
  #maxDepth = 0;
  #root = 0;
  #hover = -1;
  #cursor = 0;
  // The crumb path in two written parts: the head is the way out and moves
  // only on a zoom, the tail follows the pointer, and each has an element of
  // its own so writing one does not re-parse the other. #crumbSel is the
  // tail's node, so the pointer crossing a wedge writes to the DOM once rather
  // than per pixel, and #failed holds a load error in the crumb until a zoom,
  // as it did when the line was written whole.
  #headEl;
  #tailEl;
  #crumbSel = -2;
  #failed = false;
  #buildMs = 0;
  #drawMs = 0;
  #drawn = 0;
  #hitUs = 0;
  #structureMs = 0;
  #namesMs = 0;
  // Which URLs have been fetched, so the upgrade and the connect that follow
  // it do not each start the same request.
  #loadedSrc = null;
  #loadedNames = null;
  #loadedGlosses = null;
  #prepMs = 0;
  #segments = 0;
  #colours = 0;
  // Where the paint goes: undefined until asked for, "wait" while the worker
  // is answering, then "worker" or "main" for the rest of the element's life.
  #route;
  #worker = null;
  // The worker before it has answered, and the deadline it is answering
  // against, which #armFloor starts only once a paint is wanted.
  #pending = null;
  #settle = null;
  #floor = 0;
  #painter = null;
  #sent = -1;
  #layoutKey = 0;
  #hd = -1;
  #cx = 0;
  #cy = 0;
  #r0 = 0;
  #rw = 1;
  #rmax = 1;
  #dpr = 1;
  #ready = false;
  #pw = 0;
  #ph = 0;
  // The custom properties and the fitted labels, both read on every pointer
  // move and both dropped whenever the ground under them could have moved.
  #toks = new Map();
  #fits = new Map();
  // The box the next resize will apply, when it was last applied, and the
  // timer coalescing a drag.
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
    this.#q = this.#sr.querySelector(".q");
    this.#hits = this.#sr.querySelector(".hits");
    this.#frame = this.#sr.querySelector(".frame");
    this.#glossEl = this.#sr.querySelector(".gloss");
  }

  connectedCallback() {
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerleave", this.#onLeave);
    this.#over.addEventListener("click", this.#onClick);
    this.#crumb.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) this.zoomTo(+b.dataset.i);
    });
    this.#q.addEventListener("input", this.#onQuery);
    this.#q.addEventListener("keydown", this.#onFindKey);
    this.#q.addEventListener("blur", this.#closeFind);
    // Taking the pointer down inside the list would blur the input and close
    // the list out from under the click, so the list never takes focus.
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
    this.#mq.addEventListener("change", this.#repaint);
    // Canvas text is measured rather than laid out, so a face landing after the
    // first frame repaints nothing on its own: the DOM reflows on a font swap
    // and a drawn pixel cannot. The fit is cached on radius and text, carrying
    // the font string it settled on, so the name is drawn in the face that
    // arrived at a size and a line break solved against the fallback, and a
    // narrower fallback then runs the fitted line past the hub radius. A host
    // serving its monospace unpreloaded under `font-display: swap` paints
    // exactly that. repaint() drops #fits and #toks and draws again, which is
    // the whole of the fix here.
    document.fonts?.ready?.then(() => this.repaint());
    // Before the fetch, not after the first draw asks for it. The worker's own
    // module fetch then runs alongside the tree's, so a slow link no longer
    // spends the whole deadline on the network and reads as a device with no
    // worker at all.
    if (this.#route === undefined) this.#openPainter();
    if (!this.#ready) this.#load();
  }
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#mq?.removeEventListener("change", this.#repaint);
    // The worker is left running on purpose. It holds the only handle to the
    // base canvas, which cannot be handed over twice, so terminating it here
    // would leave a reattached element with nothing to paint on.
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "names-src" && this.#ready) this.#loadNames();
    if (n === "glosses-src" && this.#ready) this.#loadGlosses();
    if (n === "start" && this.#ready) this.#applyStart();
    if (n === "hue-depth" && this.#ready) {
      this.#draw();
      this.#overlay();
    }
    // The painter keys its prepare on the mode, so there is nothing to clear.
    if (n === "merge" && this.#ready) {
      this.#draw();
      this.#overlay();
    }
    if (n === "rings" && this.#ready) {
      this.#draw();
      this.#overlay();
    }
  }
  #mq;
  #repaint = () => this.repaint();

  async #load() {
    const src = this.getAttribute("src");
    try {
      if (src) {
        if (src === this.#loadedSrc) return;
        this.#loadedSrc = src;
        const t0 = performance.now();
        this.data = await (await fetch(src)).json();
        this.#structureMs = performance.now() - t0;
      } else {
        if (this.#ready) return;
        const inline = this.querySelector('script[type="application/json"]');
        if (!inline) return;
        this.data = JSON.parse(inline.textContent);
      }
    } catch (err) {
      this.#say(`<b>Could not load the tree.</b> ${err.message}`);
      this.#failed = true;
      return;
    }
    this.#loadNames();
  }

  /* Deliberately after the first paint: the disc is already on screen and
     interactive by the time this lands, and nothing in the layout wants it. */
  async #loadNames() {
    const src = this.getAttribute("names-src");
    if (!src || src === this.#loadedNames) return;
    this.#loadedNames = src;
    try {
      const t0 = performance.now();
      const text = await (await fetch(src)).text();
      this.#namesMs = performance.now() - t0;
      this.names = text;
    } catch (err) {
      this.#say(`<b>Could not load the names.</b> ${err.message}`);
      this.#failed = true;
    }
    this.#loadGlosses();
  }

  /* Last of the three, and the only one nothing on the disc depends on: the
     definition of whatever the crumb path ends at. Blank for a node with no
     children, which cannot be a root and so never reaches this. */
  async #loadGlosses() {
    const src = this.getAttribute("glosses-src");
    if (!src || src === this.#loadedGlosses) return;
    this.#loadedGlosses = src;
    try {
      this.glosses = await (await fetch(src)).text();
    } catch {
      // A missing definition is worth no message: the disc is unaffected and
      // the crumb below says what the view is.
    }
  }

  set data(d) {
    if (!d?.par) return;
    if (d.names !== undefined) this.#setNames(d.names);
    this.#par = d.par;
    this.#build();
    this.#ready = true;
    this.#applyStart();
    this.#fit();
  }
  get data() {
    return { names: this.#names, par: this.#par };
  }
  get index() {
    return this.#root;
  }
  /* What the last build and the last repaint cost, and how many arcs that
     repaint actually put on the canvas. Zooming in draws far fewer. */
  get stats() {
    return {
      nodes: this.#par.length,
      drawn: this.#drawn,
      buildMs: this.#buildMs,
      drawMs: this.#drawMs,
      hitUs: this.#hitUs,
      prepMs: this.#prepMs,
      segments: this.#segments,
      mode: this.#mode(),
      colours: this.#colours,
      thread: this.#route === "worker" ? "worker" : "main",
      structureMs: this.#structureMs,
      namesMs: this.#namesMs,
      named: this.#names.length > 0,
    };
  }
  get names() {
    return this.#names;
  }
  /* Names can arrive at any point, including never. Setting them re-resolves
     `start`, which can only be matched by name, and refreshes what is on
     screen; the geometry is untouched. */
  set names(v) {
    this.#setNames(v);
    if (!this.#ready) return;
    this.#applyStart();
    this.#draw();
    this.#overlay();
    this.#emit("disc-names", { count: this.#names.length, ms: this.#namesMs });
  }
  get glosses() {
    return this.#glosses;
  }
  set glosses(v) {
    this.#glosses = typeof v === "string" ? v.split("\n") : Array.from(v);
    if (this.#ready) this.#showGloss();
  }

  #setNames(v) {
    this.#names = typeof v === "string" ? v.split("\n") : Array.from(v);
    this.#search = null;
    this.#closeFind();
    this.#q.disabled = this.#names.length === 0;
    if (!this.#q.disabled) this.#q.placeholder = "Search names…";
  }
  #label(i) {
    return this.#names[i] ?? `#${i}`;
  }
  #isLeaf(i) {
    return this.#kidOff[i] === this.#kidOff[i + 1];
  }
  /* The crumb line, when there is a message to put there instead of a path. */
  #say(html) {
    this.#headEl.innerHTML = html;
    this.#tailEl.replaceChildren();
  }

  #applyStart() {
    const want = this.getAttribute("start");
    const i = want && this.#names.length ? this.#names.indexOf(want) : 0;
    this.#root = i >= 0 ? i : 0;
    this.#cursor = this.#root;
    this.#crumbs();
  }

  /* Every pass is one forward or one backward loop, because a parent's index
     is always lower than its children's. */
  #build() {
    const t0 = performance.now();
    const N = this.#par.length,
      par = this.#par;
    // Counting sort into one flat array. Children come out in index order
    // within each parent, which is the order the angles below are laid in.
    const off = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) if (par[i] >= 0) off[par[i] + 1]++;
    for (let i = 0; i < N; i++) off[i + 1] += off[i];
    const at = Int32Array.from(off.subarray(0, N));
    const idx = new Int32Array(off[N]);
    for (let i = 0; i < N; i++) if (par[i] >= 0) idx[at[par[i]]++] = i;
    this.#kidOff = off;

    this.#depth = new Int16Array(N);
    this.#leaves = new Int32Array(N);
    for (let i = 0; i < N; i++) this.#depth[i] = par[i] < 0 ? 0 : this.#depth[par[i]] + 1;
    for (let i = N - 1; i >= 0; i--) {
      if (off[i] === off[i + 1]) this.#leaves[i] = 1;
      if (par[i] >= 0) this.#leaves[par[i]] += this.#leaves[i];
    }
    this.#a0 = new Float64Array(N);
    this.#a1 = new Float64Array(N);
    this.#a1[0] = TAU;
    for (let i = 0; i < N; i++) {
      let a = this.#a0[i];
      const w = (this.#a1[i] - this.#a0[i]) / this.#leaves[i];
      for (let k = off[i]; k < off[i + 1]; k++) {
        const c = idx[k];
        this.#a0[c] = a;
        a += this.#leaves[c] * w;
        this.#a1[c] = a;
      }
    }
    this.#maxDepth = 0;
    for (let i = 0; i < N; i++)
      if (this.#depth[i] > this.#maxDepth) this.#maxDepth = this.#depth[i];
    const rings = Array.from({ length: this.#maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) rings[this.#depth[i]].push(i);
    for (const arr of rings) arr.sort((x, y) => this.#a0[x] - this.#a0[y]);
    // Typed, because these cross to the worker whole and a nested plain array
    // of 82,115 numbers is the slowest thing structured clone can be handed.
    this.#byDepth = rings.map(arr => Int32Array.from(arr));
    this.#layoutKey++;
    this.#buildMs = performance.now() - t0;
  }

  /* density (the default) splits a merged run at pixel boundaries and shades
     each piece by how many wedges fell in it; on merges each run flat; off
     draws every node. */
  #mode() {
    const m = this.getAttribute("merge");
    return m === "off" || m === "on" ? m : "density";
  }
  /* 14 by default, which is where WordNet's rings stop covering enough of the
     turn to read: depth 13 spans 4.5% of it and depth 19 is one node. */
  #rings() {
    const want = Math.max(1, Math.round(+(this.getAttribute("rings") ?? 14)) || 14);
    return Math.min(want, this.#maxDepth - this.#depth[this.#root] + 1);
  }

  /* Whether the suggestions get a column of their own. Measured off the frame
     rather than the stage, so toggling the class cannot change the answer and
     the observer settles in one more pass. True says the class moved, which
     leaves the stage box just read stale: the observation that follows carries
     the right one. */
  #shape() {
    const f = this.#frame.getBoundingClientRect();
    const want = this.hasAttribute("fit") && f.width - f.height >= ASIDE_MIN + ASIDE_GAP;
    if (want === this.#frame.classList.contains("wide")) return false;
    this.#frame.classList.toggle("wide", want);
    return true;
  }

  #fit() {
    if (!this.#ready) return;
    // Only once something is drawn: the first fit goes ahead on the box it
    // has, since a toggle that left the stage the same size would fire no
    // further observation and there would be nothing on screen to correct.
    if (this.#shape() && this.#pw) return;
    const box = this.#sr.querySelector(".stage").getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(box.width * dpr),
      ph = Math.round(box.height * dpr);
    // Back to the size already drawn, so a box held from part way through the
    // drag has to be dropped rather than applied when the timer comes round.
    if (pw === this.#pw && ph === this.#ph && dpr === this.#dpr) {
      clearTimeout(this.#fitTimer);
      this.#fitTimer = 0;
      return;
    }
    this.#box = { w: box.width, h: box.height, dpr, pw, ph };
    // The merge is in pixels and the radius has moved, so every frame of a
    // drag would cost the painter a whole remerge. The first change is taken
    // outright, so a load or a rotation is not held up, and the rest are
    // coalesced: the canvases stretch to the new box until the drag stops.
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
    // Only the overlay is sized here. The base canvas may belong to the
    // worker by now, where setting a dimension throws, so the painter sizes it.
    this.#pw = b.pw;
    this.#ph = b.ph;
    this.#over.width = b.pw;
    this.#over.height = b.ph;
    const s = Math.min(b.w, b.h);
    this.#cx = b.w / 2;
    this.#cy = b.h / 2;
    this.#r0 = s * 0.075;
    this.#rmax = s * 0.485;
    // The labels are keyed on a radius that just moved, and a host's tokens
    // can follow a width-driven media query.
    this.#toks.clear();
    this.#fits.clear();
    this.#draw();
    this.#overlay();
  };

  /* Read once and held. getComputedStyle flushes pending style, and the
     overlay wants three of these on every pointer move, which is what turned a
     hover into a style recalculation per event. The cache is dropped wherever
     the ground under it could have moved: a resize, the colour-scheme query,
     and the repaint() a host calls after restyling by any other means. */
  #tok(n, f) {
    let v = this.#toks.get(n);
    if (v === undefined) {
      v = getComputedStyle(this).getPropertyValue(n).trim() || f;
      this.#toks.set(n, v);
    }
    return v;
  }
  #under(i) {
    return (
      this.#depth[i] >= this.#depth[this.#root] &&
      this.#a0[i] >= this.#a0[this.#root] - 1e-9 &&
      this.#a1[i] <= this.#a1[this.#root] + 1e-9
    );
  }
  /* Under the root and inside the rings being drawn. The hub asks #under
     instead, so a node the search reached below the last ring is still named
     even though there is no wedge on screen to outline. */
  #inView(i) {
    return this.#under(i) && this.#depth[i] - this.#depth[this.#root] < this.#rings();
  }
  /* Zooming is a change of angular scale, not a re-layout: node k's span is
     stretched to a full turn and its depth becomes ring zero. */
  #geom(i) {
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const s = (this.#a0[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const e = (this.#a1[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const d = this.#depth[i] - this.#depth[this.#root];
    return [s, e, this.#r0 + d * this.#rw, this.#r0 + (d + 1) * this.#rw];
  }

  /* One view, either posted or painted here. The layout goes over once per
     tree and the hue depth only when it changes, so a repaint is a small
     message however large the tree. */
  #draw() {
    if (!this.#ready) return;
    this.#rw = (this.#rmax - this.#r0) / this.#rings();
    if (this.#route === undefined) return this.#openPainter();
    if (this.#route === "wait") return this.#armFloor();
    const hd = Math.max(0, +(this.getAttribute("hue-depth") ?? 8));
    const msg = {};
    if (this.#sent !== this.#layoutKey) {
      this.#sent = this.#layoutKey;
      msg.hd = this.#hd = hd;
      msg.layout = {
        par: Int32Array.from(this.#par),
        depth: this.#depth,
        a0: this.#a0,
        a1: this.#a1,
        byDepth: this.#byDepth,
        maxDepth: this.#maxDepth,
      };
    } else if (hd !== this.#hd) msg.hd = this.#hd = hd;
    msg.view = {
      root: this.#root,
      w: this.#pw,
      h: this.#ph,
      dpr: this.#dpr,
      cx: this.#cx,
      cy: this.#cy,
      r0: this.#r0,
      rmax: this.#rmax,
      rw: this.#rw,
      rings: this.#rings(),
      mode: this.#mode(),
      sat: this.#tok("--_sat", ".55"),
      val: this.#tok("--_val", ".88"),
      panel: this.#tok("--_panel", "#141b1c"),
    };
    if (this.#route === "worker") return this.#worker.postMessage(msg);
    if (msg.layout) this.#painter.layout(msg.layout, msg.hd);
    else if (msg.hd !== undefined) this.#painter.hueDepth(msg.hd);
    this.#painted(this.#painter.paint(this.#base.getContext("2d"), msg.view));
  }

  /* A canvas can be handed to a worker only once, and only before anything has
     taken a context on it, so the choice cannot be made by painting here and
     handing over afterwards: the element waits for the worker to answer, and a
     worker that errors or never answers leaves the draw on this thread.

     Opened when the element connects rather than when the first draw wants a
     painter, so fetching and evaluating the worker's two modules runs
     alongside the fetch of the tree instead of after it. */
  #openPainter() {
    this.#route = "wait";
    this.#settle = here => {
      if (this.#route !== "wait") return;
      clearTimeout(this.#floor);
      this.#floor = 0;
      this.#pending = null;
      this.#route = here ? "main" : "worker";
      if (here) this.#painter = new Painter();
      this.#sent = -1;
      this.#draw();
    };
    if (!this.#base.transferControlToOffscreen || typeof Worker === "undefined")
      return this.#settle(true);
    let w;
    try {
      w = new Worker(new URL("./disc-worker.js", import.meta.url), { type: "module" });
    } catch {
      return this.#settle(true);
    }
    this.#pending = w;
    w.onerror = () => {
      if (this.#route !== "wait") return;
      w.terminate();
      this.#settle(true);
    };
    w.onmessage = ev => {
      if (!ev.data.ready) return this.#painted(ev.data.stats);
      let off;
      try {
        off = this.#base.transferControlToOffscreen();
      } catch {
        w.terminate();
        return this.#settle(true);
      }
      this.#worker = w;
      w.postMessage({ canvas: off }, [off]);
      this.#settle(false);
    };
    if (this.#ready) this.#armFloor();
  }

  /* The deadline, started the first time a paint is actually wanted. Timing it
     from the worker's construction spent it on the network, so a slow link
     read as a device with no worker and painted here for the rest of the
     element's life. What it guards now is a worker that loads and never
     answers, and what it costs is a blank disc for that long. */
  #armFloor() {
    if (this.#route !== "wait" || this.#floor) return;
    this.#floor = setTimeout(() => {
      this.#pending?.terminate();
      this.#settle(true);
    }, WORKER_FLOOR);
  }

  /* What the painter reports, whichever thread it ran on. */
  #painted(st) {
    if (!st) return;
    this.#drawn = st.drawn;
    this.#drawMs = st.drawMs;
    this.#prepMs = st.prepMs;
    this.#segments = st.segments;
    this.#colours = st.colours;
    this.#emit("disc-render", { ...this.stats, name: this.#label(this.#root) });
  }

  /* What the pointer is on, or what the search left the cursor on, and -1 when
     neither is in the view and the root speaks for itself. The hub's name and
     the gloss both come off this, so the two cannot describe different nodes. */
  #focus() {
    const sel = this.#hover >= 0 ? this.#hover : this.#cursor !== this.#root ? this.#cursor : -1;
    return sel >= 0 && this.#under(sel) ? sel : -1;
  }

  #overlay() {
    if (!this.#ready) return;
    this.#showGloss();
    this.#showTail();
    const g = this.#over.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#over.width, this.#over.height);
    this.#hub(g);
    let mark = this.#hover >= 0 ? this.#hover : this.#cursor;
    while (mark >= 0 && this.#under(mark) && !this.#inView(mark)) mark = this.#par[mark];
    if (mark < 0 || !this.#inView(mark)) return;
    g.strokeStyle = this.#tok("--_ink", "#e7eded");
    g.lineWidth = 1.4;
    let cur = mark;
    while (cur >= 0 && this.#depth[cur] >= this.#depth[this.#root]) {
      const [s, e, r0, r1] = this.#geom(cur);
      g.beginPath();
      g.arc(this.#cx, this.#cy, r1, s, e);
      g.arc(this.#cx, this.#cy, r0, e, s, true);
      g.closePath();
      if (cur === mark) {
        g.globalAlpha = 0.22;
        g.fill();
        g.globalAlpha = 1;
      }
      g.stroke();
      if (cur === this.#root) break;
      cur = this.#par[cur];
    }
  }

  /* The hub names the node under the pointer, or the one the search left the
     cursor on, and falls back to the root: what you are looking at, at every
     level rather than only at the top. Muted when it is the fallback, so the
     name of the view never reads as a selection. Drawing it on the overlay is
     what makes it free to follow the pointer, since the base holds every arc
     and the overlay only the path being highlighted.

     Under the name sits the way out, in the accent the crumb buttons use, and
     only when there is one: at the root a click on the hub does nothing, and
     with the pointer on a wedge the hub is naming that instead and the room is
     wanted for the name. The name is fitted to a radius short of the hint so
     the two cannot collide however long the name runs. */
  /* Fitting a name costs 9.5 measureText calls at the median and 539 for the
     longest in WordNet, and the pointer crossing wedges asks for the same few
     names over and over. The radius is in the key because the hint under the
     name takes room from it; the face is not, since the map is dropped when
     the tokens are. */
  #fitted(g, text, r) {
    const key = `${r}|${text}`;
    const had = this.#fits.get(key);
    if (had) {
      g.font = had.font;
      return had;
    }
    const got = fit(g, text, r, this.#tok("--_mono", "monospace"));
    // Bounded, since a pointer crossing the whole disc would otherwise hold
    // every name it touched.
    if (this.#fits.size > 4096) this.#fits.clear();
    this.#fits.set(key, got);
    return got;
  }

  #hub(g) {
    const sel = this.#focus();
    const named = sel >= 0;
    const way = !named && this.#root !== 0;
    const { lines, lh } = this.#fitted(
      g,
      this.#label(named ? sel : this.#root),
      this.#r0 - 5 - (way ? HINT_H : 0),
    );
    g.fillStyle = named ? this.#tok("--_ink", "#e7eded") : this.#tok("--_muted", "#90a1a1");
    g.textAlign = "center";
    g.textBaseline = "middle";
    const top = this.#cy - ((lines.length - 1) * lh) / 2 - (way ? HINT_H / 2 : 0);
    lines.forEach((line, k) => {
      g.fillText(line, this.#cx, top + k * lh);
    });
    if (!way) return;
    g.font = `500 ${HINT_PX}px ${this.#tok("--_mono", "monospace")}`;
    g.fillStyle = this.#tok("--_accent", "#59b491");
    g.fillText("\u2191 up", this.#cx, top + (lines.length - 1) * lh + HINT_H);
  }

  /* Angles nest, so a point maps to a ring by radius and to one node in that
     ring by binary search — no spatial index. */
  #hit(px, py) {
    const t0 = performance.now();
    const dx = px - this.#cx,
      dy = py - this.#cy,
      r = Math.hypot(dx, dy);
    if (r < this.#r0 || r > this.#rmax) return -1;
    const d = this.#depth[this.#root] + Math.floor((r - this.#r0) / this.#rw);
    if (d > this.#maxDepth || d >= this.#depth[this.#root] + this.#rings()) return -1;
    let ang = Math.atan2(dy, dx) + Math.PI / 2;
    if (ang < 0) ang += TAU;
    const A = this.#a0[this.#root] + ang / (TAU / (this.#a1[this.#root] - this.#a0[this.#root]));
    const arr = this.#byDepth[d];
    let lo = 0,
      hi = arr.length - 1,
      best = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.#a0[arr[m]] <= A) {
        best = arr[m];
        lo = m + 1;
      } else hi = m - 1;
    }
    this.#hitUs = (performance.now() - t0) * 1000;
    return best >= 0 && this.#a1[best] >= A && this.#inView(best) ? best : -1;
  }

  /* The canvas has no border and no padding, so offsetX and offsetY are the
     rect arithmetic they replace. Reading a rect here forced a layout on every
     pointer move, and the crumb line's write on the move before had just
     dirtied one. */
  #at(ev) {
    return [ev.offsetX, ev.offsetY];
  }
  #onMove = ev => {
    const h = this.#hit(...this.#at(ev));
    if (h === this.#hover) return;
    this.#preview(h);
  };
  #onLeave = () => this.#preview(-1);
  /* Everything a pointer over node i does, and nothing else: the highlighted
     path, the hub, the readout, the event. The search box calls this so a
     picked suggestion looks exactly like a hover, -1 to put it back. */
  #preview(i) {
    this.#hover = i;
    this.#overlay();
    if (i >= 0)
      this.#emit("disc-hover", {
        index: i,
        name: this.#label(i),
        depth: this.#depth[i],
        leaves: this.#leaves[i],
      });
  }
  #onClick = ev => {
    const [px, py] = this.#at(ev);
    if (Math.hypot(px - this.#cx, py - this.#cy) < this.#r0) return this.up();
    const h = this.#hit(px, py);
    if (h >= 0 && !this.#isLeaf(h)) this.zoomTo(h);
  };

  /* Straight through, not deferred to a frame. The scan is 1.2 ms at worst over
     82,115 names, and 0.2 for most queries, so coalescing keystrokes through
     requestAnimationFrame would save a fraction of one frame and buy a stall
     everywhere that callback is throttled, which is where a hidden or
     background tab leaves it. Nobody types faster than a frame in any case. */
  #onQuery = () => {
    if (!this.#ready || !this.#names.length) return;
    this.#search ??= new Search(this.#names);
    this.#sug = this.#search.query(this.#q.value, 12);
    this.#pick = -1;
    this.#drawHits();
    // The top hit is picked outright, so typing highlights and Enter needs no
    // arrow key first.
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
        this.#preview(-1);
      }
    }
  };

  /* The click, for a node reached by name. Zooming into a leaf would show an
     empty disc, so a leaf goes to its parent with the cursor left on the leaf:
     the word stays highlighted and named in the hub. Focus stays in the box,
     so the next search is one keystroke away. */
  #go(i) {
    this.#closeFind();
    if (!this.#isLeaf(i)) this.zoomTo(i);
    else if (this.#par[i] >= 0) {
      this.zoomTo(this.#par[i]);
      this.#cursor = i;
      this.#overlay();
    }
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
        // Marks the run the query matched outright. A fuzzy hit has no such run,
        // and is left plain rather than marked letter by letter.
        const at = hit.name.toLowerCase().indexOf(q);
        if (at < 0) name.textContent = hit.name;
        else {
          const b = document.createElement("b");
          b.textContent = hit.name.slice(at, at + q.length);
          name.append(hit.name.slice(0, at), b, hit.name.slice(at + q.length));
        }
        // The parent, because a WordNet name is not unique: four synsets are
        // called "bank" and only their parents tell them apart.
        const par = document.createElement("span");
        par.className = "p";
        par.textContent = this.#par[hit.i] >= 0 ? this.#label(this.#par[hit.i]) : "";
        li.append(name, par);
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

  zoomTo(i) {
    if (!(i >= 0) || i >= this.#par.length) return;
    this.#root = i;
    this.#cursor = i;
    this.#hover = -1;
    this.#draw();
    this.#overlay();
    this.#crumbs();
    this.#emit("disc-zoom", { index: i, name: this.#label(i), path: this.path(i) });
  }
  up() {
    if (this.#root !== 0) this.zoomTo(Math.max(0, this.#par[this.#root]));
  }
  reset() {
    this.zoomTo(0);
  }
  /* Call after the host page changes theme by any means other than
     prefers-color-scheme, which the element already watches. */
  repaint() {
    this.#toks.clear();
    this.#fits.clear();
    this.#draw();
    this.#overlay();
  }
  path(i) {
    const out = [];
    for (let c = i; c >= 0; c = this.#par[c]) out.unshift(this.#label(c));
    return out;
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  /* The definition of whatever the hub names: the node under the pointer, or
     what the search left the cursor on, and the current root when the pointer
     is off the disc, which is what the crumb path ends at.

     WordNet writes its glosses lowercase, so the first letter is raised, on
     75,110 of the 82,115. Two kinds are left as they are: the 2,959 that open
     on a parenthetical label such as "(mathematics)", where the first character
     is not a letter and the label is conventionally lowercase, and the 4 whose
     second letter is a capital, which is what stops "cDNA copy of the RNA
     genome" becoming "CDNA". The other 4,042 already start on a proper noun. */
  #showGloss() {
    const sel = this.#focus();
    const g = this.#glosses[sel >= 0 ? sel : this.#root] ?? "";
    this.#glossEl.textContent = /^[a-z](?![A-Z])/.test(g) ? g[0].toUpperCase() + g.slice(1) : g;
  }
  #crumbs() {
    const path = [];
    for (let c = this.#root; c >= 0; c = this.#par[c]) path.unshift(c);
    // A separator before every step, the first included, so the path reads as
    // a path rather than as a name with a trail after it.
    this.#headEl.innerHTML = path
      .map(
        i =>
          "<i>›</i>" +
          (i === this.#root
            ? `<span class="now">${this.#label(i)}</span>`
            : `<button type="button" data-i="${i}">${this.#label(i)}</button>`),
      )
      .join("");
    this.#failed = false;
    this.#crumbSel = -2;
    this.#showTail();
  }

  /* The chain of whatever the hub is naming, carried on past the root the way
     clicking it would leave the path. It is muted where the path to the root
     is not, so what you are looking at still reads as the view and the rest as
     a pointer passing over. #focus is what answers, so the name in the hub,
     the definition and this can never be of different nodes. */
  #showTail() {
    if (this.#failed) return;
    const sel = this.#focus();
    if (sel === this.#crumbSel) return;
    this.#crumbSel = sel;
    const tail = [];
    for (let c = sel; c >= 0 && c !== this.#root; c = this.#par[c]) tail.unshift(c);
    // Its own element, so a pointer crossing wedges rewrites the tail alone
    // and the head is not re-parsed behind it.
    this.#tailEl.innerHTML = tail.map(i => `<i>›</i><em>${this.#label(i)}</em>`).join("");
  }
}
customElements.define("hypernym-disc", HypernymDisc);
