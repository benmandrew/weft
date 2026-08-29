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
 * lands, a node answers to `#index`.
 *
 * Attributes: src, names-src, readout="off", hue-depth (default 2), start,
 *             merge: "density" (default) splits merged runs at pixel
 *             boundaries and shades each by how many wedges it holds, "on"
 *             merges each run flat, "off" draws every wedge separately.
 * Properties: data, index, names. Methods: zoomTo(i), up(), reset(), repaint(), path(i).
 * Events: disc-hover {index,name,depth,leaves}, disc-zoom {index,name,path},
 *         disc-render {nodes,drawn,buildMs,drawMs,hitUs,name} after every repaint,
 *         disc-names {count,ms} once the names arrive.
 * Styling: --disc-ground --disc-panel --disc-ink --disc-muted --disc-accent
 *          --disc-sat --disc-val --disc-font --disc-mono
 */
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
    color:var(--_ink);font-family:var(--_font)}
  @media (prefers-color-scheme:light){
    :host{--_ground:var(--disc-ground,#eef1f0); --_panel:var(--disc-panel,#fbfcfc);
      --_ink:var(--disc-ink,#131a1b); --_muted:var(--disc-muted,#5d6d6e);
      --_accent:var(--disc-accent,#2c7359);
      --_sat:var(--disc-sat,.62); --_val:var(--disc-val,.60)}}
  .frame{display:block}
  .stage{position:relative;width:100%;aspect-ratio:1}
  canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  canvas.over{cursor:pointer;outline:none;touch-action:none}
  canvas.over:focus-visible{outline:2px solid var(--_accent);outline-offset:3px;border-radius:50%}
  .bar{display:flex;flex-direction:column;gap:3px;min-height:2.9em;font-size:12px;margin-top:8px}
  :host([readout="off"]) .bar{display:none}
  .crumb{font-family:var(--_mono);font-size:11px;color:var(--_muted);line-height:1.6;
    white-space:nowrap;overflow-x:auto;scrollbar-width:none}
  .crumb::-webkit-scrollbar{display:none}
  .crumb button{font:inherit;color:var(--_accent);background:none;border:0;padding:0;
    cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .crumb span{color:var(--_ink)}
  .crumb i{font-style:normal;color:var(--_muted);opacity:.5;padding:0 4px}
  .tip{color:var(--_muted);line-height:1.4}
  .tip b{color:var(--_ink);font-weight:600}
  .tip em{font-style:normal;font-family:var(--_mono);font-size:11px;
    font-variant-numeric:tabular-nums}
</style>
<div class="frame">
  <div class="stage">
    <canvas class="base" aria-hidden="true"></canvas>
    <canvas class="over" tabindex="0" role="application"></canvas>
  </div>
  <div class="bar"><div class="crumb"></div><div class="tip"></div></div>
</div>`;

const hsv = (h, s, v) => {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6),
        p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const c = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
  return `rgb(${c[0]*255|0},${c[1]*255|0},${c[2]*255|0})`;
};
const TAU = Math.PI * 2;
// Below one pixel at its outer edge a wedge cannot be told from its neighbour.
const MERGE_PX = 1;
// Value steps the density ramp is quantised to, and how far it dips at its
// sparse end. 24 steps sits below the eye's threshold on this ramp and keeps
// the interned palette a lookup rather than a string build per piece.
const RAMP_STEPS = 24;
const RAMP_FLOOR = .62;

class HypernymDisc extends HTMLElement {
  static observedAttributes = ["src", "names-src", "start", "hue-depth", "merge"];

  #sr; #base; #over; #crumb; #tip; #ro;
  #names = []; #par = []; #kids = [];
  #depth; #leaves; #a0; #a1; #tint; #tcos; #tsin; #byDepth = []; #maxDepth = 0;
  #root = 0; #hover = -1; #cursor = 0;
  #buildMs = 0; #drawMs = 0; #drawn = 0; #hitUs = 0;
  #structureMs = 0; #namesMs = 0;
  // Which URLs have been fetched, so the upgrade and the connect that follow
  // it do not each start the same request.
  #loadedSrc = null; #loadedNames = null;
  #palette = []; #paletteKey = new Map(); #fillId = null; #seg = null;
  #prepKey = ""; #prepMs = 0; #tintKey = 0; #sat = .55; #val = .88; #hueQ = 1;
  #cx = 0; #cy = 0; #r0 = 0; #rw = 1; #rmax = 1; #dpr = 1; #ready = false;

  constructor() {
    super();
    this.#sr = this.attachShadow({ mode: "open" });
    this.#sr.append(TPL.content.cloneNode(true));
    this.#base = this.#sr.querySelector(".base");
    this.#over = this.#sr.querySelector(".over");
    this.#crumb = this.#sr.querySelector(".crumb");
    this.#tip = this.#sr.querySelector(".tip");
  }

  connectedCallback() {
    this.#over.addEventListener("pointermove", this.#onMove);
    this.#over.addEventListener("pointerleave", this.#onLeave);
    this.#over.addEventListener("click", this.#onClick);
    this.#over.addEventListener("keydown", this.#onKey);
    this.#crumb.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (b) this.zoomTo(+b.dataset.i);
    });
    this.#ro = new ResizeObserver(() => this.#fit());
    this.#ro.observe(this.#sr.querySelector(".stage"));
    this.#mq = matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", this.#repaint);
    if (!this.#ready) this.#load();
  }
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#mq?.removeEventListener("change", this.#repaint);
  }
  attributeChangedCallback(n, was, now) {
    if (was === now) return;
    if (n === "src") this.#load();
    if (n === "names-src" && this.#ready) this.#loadNames();
    if (n === "start" && this.#ready) this.#applyStart();
    if (n === "hue-depth" && this.#ready) { this.#retint(); this.#draw(); this.#overlay(); }
    if (n === "merge" && this.#ready) { this.#prepKey = ""; this.#draw(); this.#overlay(); }
  }
  #mq;
  #repaint = () => { this.#draw(); this.#overlay(); };

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
      this.#tip.innerHTML = `<b>Could not load the tree.</b> ${err.message}`;
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
      this.#tip.innerHTML = `<b>Could not load the names.</b> ${err.message}`;
    }
  }

  set data(d) {
    if (!d || !d.par) return;
    if (d.names !== undefined) this.#setNames(d.names);
    this.#par = d.par;
    this.#build();
    this.#ready = true;
    this.#applyStart();
    this.#fit();
  }
  get data() { return { names: this.#names, par: this.#par }; }
  get index() { return this.#root; }
  /* What the last build and the last repaint cost, and how many arcs that
     repaint actually put on the canvas. Zooming in draws far fewer. */
  get stats() {
    return { nodes: this.#par.length, drawn: this.#drawn,
             buildMs: this.#buildMs, drawMs: this.#drawMs, hitUs: this.#hitUs,
             prepMs: this.#prepMs, segments: this.#seg ? this.#seg.f.length : 0,
             mode: this.#mode(), colours: this.#palette.length,
             structureMs: this.#structureMs, namesMs: this.#namesMs,
             named: this.#names.length > 0 };
  }
  get names() { return this.#names; }
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
  #setNames(v) {
    this.#names = typeof v === "string" ? v.split("\n") : Array.from(v);
  }
  #label(i) { return this.#names[i] ?? `#${i}`; }

  #applyStart() {
    const want = this.getAttribute("start");
    const i = want && this.#names.length ? this.#names.indexOf(want) : 0;
    this.#root = i >= 0 ? i : 0;
    this.#cursor = this.#root;
    this.#crumbs();
    this.#say(-1);
  }

  /* Every pass is one forward or one backward loop, because a parent's index
     is always lower than its children's. */
  #build() {
    const t0 = performance.now();
    const N = this.#par.length, par = this.#par;
    this.#kids = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) if (par[i] >= 0) this.#kids[par[i]].push(i);

    this.#depth = new Int16Array(N);
    this.#leaves = new Int32Array(N);
    for (let i = 0; i < N; i++) this.#depth[i] = par[i] < 0 ? 0 : this.#depth[par[i]] + 1;
    for (let i = N - 1; i >= 0; i--) {
      if (!this.#kids[i].length) this.#leaves[i] = 1;
      if (par[i] >= 0) this.#leaves[par[i]] += this.#leaves[i];
    }
    this.#a0 = new Float64Array(N); this.#a1 = new Float64Array(N);
    this.#a1[0] = TAU;
    for (let i = 0; i < N; i++) {
      let a = this.#a0[i];
      const w = (this.#a1[i] - this.#a0[i]) / this.#leaves[i];
      for (const c of this.#kids[i]) {
        this.#a0[c] = a; a += this.#leaves[c] * w; this.#a1[c] = a;
      }
    }
    this.#maxDepth = 0;
    for (let i = 0; i < N; i++) if (this.#depth[i] > this.#maxDepth) this.#maxDepth = this.#depth[i];
    this.#byDepth = Array.from({ length: this.#maxDepth + 1 }, () => []);
    for (let i = 0; i < N; i++) this.#byDepth[this.#depth[i]].push(i);
    for (const arr of this.#byDepth) arr.sort((x, y) => this.#a0[x] - this.#a0[y]);
    this.#retint();
    this.#buildMs = performance.now() - t0;
  }

  /* Above hue-depth a node takes its own angle as a hue; below it inherits,
     so each branch reads as one colour family. Deeper costs a little more at
     paint time, because it multiplies the distinct fillStyle strings. */
  #retint() {
    const N = this.#par.length;
    const hd = Math.max(0, +(this.getAttribute("hue-depth") ?? 2));
    this.#tint = new Float64Array(N);
    for (let i = 0; i < N; i++)
      this.#tint[i] = this.#depth[i] <= hd
        ? ((this.#a0[i] + this.#a1[i]) / 2) / TAU : this.#tint[this.#par[i]];
    // Merged pieces average their members' hues, and hue is an angle, so each
    // node's is kept as a vector rather than turned into one per piece per
    // frame. Radius plays no part, so this survives a resize and a zoom.
    this.#tcos = new Float64Array(N); this.#tsin = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      this.#tcos[i] = Math.cos(this.#tint[i] * TAU);
      this.#tsin[i] = Math.sin(this.#tint[i] * TAU);
    }
    this.#tintKey++;
  }

  /* A blended hue is a continuous value, and a colour is a string the canvas
     has to parse, so hues are rounded to a slice one pixel wide at the fringe
     and interned. That is the same threshold that decides two wedges cannot be
     told apart: neighbouring slices differ by 0.16°, and a wedge wide enough to
     read as its own arc cannot collide with its neighbour at that step. */
  #quant(h) { const w = ((h % 1) + 1) % 1; return Math.round(w * this.#hueQ) / this.#hueQ; }
  #hue(i) { return this.#quant(this.#tint[i]); }

  /* density (the default) splits a merged run at pixel boundaries and shades
     each piece by how many wedges fell in it; on merges each run flat; off
     draws every node. */
  #mode() {
    const m = this.getAttribute("merge");
    return m === "off" || m === "on" ? m : "density";
  }

  /* A colour is a string, and a string is what the canvas has to parse, so
     they are interned rather than rebuilt per piece per frame. `step` is the
     density rung, RAMP_STEPS meaning fully covered. */
  #colourId(tint, rel, step) {
    const key = tint + "|" + rel + "|" + step;
    let id = this.#paletteKey.get(key);
    if (id === undefined) {
      const base = Math.max(.22, this.#val * (1 - rel * .035));
      const v = base * (RAMP_FLOOR + (1 - RAMP_FLOOR) * step / RAMP_STEPS);
      id = this.#palette.length;
      this.#palette.push(hsv(tint, this.#sat, Math.min(1, v)));
      this.#paletteKey.set(key, id);
    }
    return id;
  }

  #repalette() {
    const N = this.#par.length;
    this.#sat = parseFloat(this.#tok("--_sat", ".55"));
    this.#val = parseFloat(this.#tok("--_val", ".88"));
    this.#palette = [];
    this.#paletteKey = new Map();
    this.#fillId = new Int32Array(N);
    this.#hueQ = Math.max(1, Math.round(TAU * this.#rmax / MERGE_PX));
    // Only the unmerged draw reads a per-node fill; a merged one colours the
    // run, so filling this in would be 82,115 lookups nothing goes on to read.
    if (this.#mode() !== "off") return;
    const base = this.#depth[this.#root];
    for (let i = 0; i < N; i++)
      this.#fillId[i] = this.#colourId(this.#hue(i), this.#depth[i] - base, RAMP_STEPS);
  }

  /* Adjacent wedges thinner than a pixel are one shape to the rasteriser,
     which below about 0.1 px draws them as nothing at all, so they are drawn as
     one and take the mean of their hues. Blending is what lets a run ignore
     colour, and matching on it instead left nothing to merge above hue-depth 2,
     where every node takes its own angle: the draw paid all 82,115 arcs there
     rather than 7,823. A gap between subtrees breaks every run, which is what
     keeps the fringe reading as many nodes. In density mode a run is then cut
     at pixel boundaries and each piece keeps its own count and its own blend,
     so a flat block becomes a ramp showing where the tree is packed. Runs are
     found off `#byDepth`, already sorted by start angle for hit testing. */
  #remerge() {
    const mode = this.#mode();
    if (mode === "off") { this.#seg = null; return; }
    const dense = mode === "density";
    const base = this.#depth[this.#root];
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const s0 = [], s1 = [], sd = [], st = [], sn = [], sw = [];
    let peak = 1;
    for (let d = base; d <= this.#maxDepth; d++) {
      const arr = this.#byDepth[d];
      const rel = d - base;
      const r1 = this.#r0 + (rel + 1) * this.#rw;
      const thin = k => (this.#a1[k] - this.#a0[k]) * sc * r1 < MERGE_PX;
      // Hue wraps, so the mean of 0.99 and 0.01 has to come out at 0 rather
      // than 0.5, which is why the members are summed as vectors.
      const blend = (lo, hi) => {
        if (lo === hi) return this.#hue(arr[lo]);
        let cx = 0, cy = 0;
        for (let k = lo; k <= hi; k++) { cx += this.#tcos[arr[k]]; cy += this.#tsin[arr[k]]; }
        return this.#quant(Math.atan2(cy, cx) / TAU);
      };
      let i = 0;
      while (i < arr.length) {
        if (!this.#inView(arr[i])) { i++; continue; }
        let j = i;
        while (thin(arr[j]) && j + 1 < arr.length && this.#inView(arr[j + 1]) && thin(arr[j + 1])
               && Math.abs(this.#a0[arr[j + 1]] - this.#a1[arr[j]]) < 1e-9) j++;
        const from = this.#a0[arr[i]], to = this.#a1[arr[j]];
        if (j === i || !dense) {
          // A wedge that stayed whole is fully covered, and only it is wide
          // enough to earn a hairline.
          s0.push(from); s1.push(to); sd.push(rel); st.push(blend(i, j));
          sn.push(0); sw.push(j === i && (to - from) * sc > .012 ? 1 : 0);
        } else {
          const pieces = Math.max(1, Math.round((to - from) * sc * r1));
          const width = (to - from) / pieces;
          let m = i;
          for (let q = 0; q < pieces; q++) {
            const a = from + q * width, b = a + width;
            let count = 0, cx = 0, cy = 0;
            while (m <= j && (this.#a0[arr[m]] + this.#a1[arr[m]]) / 2 < b) {
              cx += this.#tcos[arr[m]]; cy += this.#tsin[arr[m]]; count++; m++;
            }
            if (count > peak) peak = count;
            s0.push(a); s1.push(b); sd.push(rel);
            // A piece no midpoint fell in lies under one wedge, so it takes
            // that wedge's hue rather than the mean of nothing.
            st.push(count ? this.#quant(Math.atan2(cy, cx) / TAU)
                          : this.#hue(arr[Math.min(m, j)]));
            sn.push(count || 1); sw.push(0);
          }
        }
        i = j + 1;
      }
    }
    // Log, because counts run 1 to 64 and a linear ramp would spend most of
    // its range on the sparse end. A count of 0 means a whole wedge, not an
    // empty one, so it takes the top rung.
    const lg = Math.log(peak);
    const f = new Int32Array(s0.length);
    for (let i = 0; i < f.length; i++)
      f[i] = this.#colourId(st[i], sd[i],
        sn[i] && lg > 0 ? Math.round(RAMP_STEPS * Math.log(sn[i]) / lg) : RAMP_STEPS);
    this.#seg = { s0: Float64Array.from(s0), s1: Float64Array.from(s1),
                  d: Int16Array.from(sd), f, w: Uint8Array.from(sw) };
  }

  /* Palette and runs survive anything that leaves angles, depths, colours and
     radius alone, so a repeated repaint pays for neither. */
  #prepare() {
    const key = [this.#root, this.#tintKey, this.#rmax.toFixed(1),
                 this.#tok("--_sat", ""), this.#tok("--_val", ""),
                 this.#mode()].join("|");
    if (key === this.#prepKey) return;
    this.#prepKey = key;
    const t0 = performance.now();
    this.#repalette();
    this.#remerge();
    this.#prepMs = performance.now() - t0;
  }

  #fit() {
    if (!this.#ready) return;
    const box = this.#sr.querySelector(".stage").getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.#base, this.#over]) {
      c.width = Math.round(box.width * this.#dpr);
      c.height = Math.round(box.height * this.#dpr);
    }
    const s = Math.min(box.width, box.height);
    this.#cx = box.width / 2; this.#cy = box.height / 2;
    this.#r0 = s * .075; this.#rmax = s * .485;
    this.#draw(); this.#overlay();
  }

  #tok(n, f) {
    const v = getComputedStyle(this).getPropertyValue(n).trim();
    return v || f;
  }
  #inView(i) {
    return this.#depth[i] >= this.#depth[this.#root]
      && this.#a0[i] >= this.#a0[this.#root] - 1e-9
      && this.#a1[i] <= this.#a1[this.#root] + 1e-9;
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

  #draw() {
    if (!this.#ready) return;
    this.#rw = (this.#rmax - this.#r0) / (this.#maxDepth - this.#depth[this.#root] + 1);
    this.#prepare();
    const t0 = performance.now();
    let drawn = 0;
    const g = this.#base.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#base.width, this.#base.height);
    const panel = this.#tok("--_panel", "#141b1c");
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const half = Math.PI / 2;
    let cur = -1;

    const wedge = (s, e, r0, r1) => {
      g.beginPath();
      g.arc(this.#cx, this.#cy, r1, s, e);
      g.arc(this.#cx, this.#cy, r0, e, s, true);
      g.closePath();
    };

    if (this.#seg) {
      const { s0, s1, d: sd, f, w } = this.#seg;
      for (let i = 0; i < f.length; i++) {
        const s = (s0[i] - this.#a0[this.#root]) * sc - half;
        const e = (s1[i] - this.#a0[this.#root]) * sc - half;
        wedge(s, e, this.#r0 + sd[i] * this.#rw, this.#r0 + (sd[i] + 1) * this.#rw);
        if (f[i] !== cur) { cur = f[i]; g.fillStyle = this.#palette[cur]; }
        g.fill();
        drawn++;
        if (w[i]) { g.strokeStyle = panel; g.lineWidth = .6; g.stroke(); }
      }
    } else {
      for (let i = 0; i < this.#par.length; i++) {
        if (!this.#inView(i)) continue;
        const [s, e, r0, r1] = this.#geom(i);
        wedge(s, e, r0, r1);
        if (this.#fillId[i] !== cur) { cur = this.#fillId[i]; g.fillStyle = this.#palette[cur]; }
        g.fill();
        drawn++;
        // A hairline on a sub-pixel wedge would cover the fill it separates.
        if (e - s > .012) { g.strokeStyle = panel; g.lineWidth = .6; g.stroke(); }
      }
    }

    // The hub's ground only. Its label names whatever the pointer is over, so
    // it is painted on the overlay instead of here.
    g.beginPath(); g.arc(this.#cx, this.#cy, this.#r0 - 3, 0, TAU);
    g.fillStyle = panel; g.fill();
    this.#drawn = drawn;
    this.#drawMs = performance.now() - t0;
    this.#emit("disc-render", { ...this.stats, name: this.#label(this.#root) });
  }

  #overlay() {
    if (!this.#ready) return;
    const g = this.#over.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#over.width, this.#over.height);
    this.#hub(g);
    const mark = this.#hover >= 0 ? this.#hover : this.#cursor;
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
      if (cur === mark) { g.globalAlpha = .22; g.fill(); g.globalAlpha = 1; }
      g.stroke();
      if (cur === this.#root) break;
      cur = this.#par[cur];
    }
  }

  /* The hub names what the readout names — the node under the pointer, or the
     one the keyboard is on — and falls back to the way out of the view: up a
     level when zoomed, the root's own name at the top. Drawing it on the
     overlay is what makes it free to follow the pointer, since the base holds
     every arc and the overlay only the path being highlighted. */
  #hub(g) {
    const sel = this.#hover >= 0 ? this.#hover
      : this.#cursor !== this.#root ? this.#cursor : -1;
    const named = sel >= 0 && this.#inView(sel);
    const text = named ? this.#label(sel)
      : this.#root === 0 ? (this.#names[0] ?? "root") : "↑ up";
    const { lines, lh } = this.#fitHub(g, text);
    g.fillStyle = named ? this.#tok("--_ink", "#e7eded") : this.#tok("--_muted", "#90a1a1");
    g.textAlign = "center"; g.textBaseline = "middle";
    const top = this.#cy - (lines.length - 1) * lh / 2;
    lines.forEach((line, k) => g.fillText(line, this.#cx, top + k * lh));
  }

  /* A name runs to 71 characters and the hub is about a hundred across, so the
     label steps down the sizes and wraps until it fits, clipping only when
     nothing does. Every line has to clear the chord at the block's edge rather
     than the diameter, which is why the budget narrows as a line is added.
     Sets the font on `g` as it goes. */
  #fitHub(g, text) {
    const mono = this.#tok("--_mono", "monospace");
    const r = this.#r0 - 5;
    for (const px of [12, 11, 10, 9, 8]) {
      g.font = `500 ${px}px ${mono}`;
      const lh = px + 2;
      for (let n = 1; n <= 3 && n * lh < 2 * r; n++) {
        const lines = this.#wrap(g, text, 2 * Math.sqrt(r * r - (n * lh / 2) ** 2), n);
        if (lines) return { lines, lh };
      }
    }
    g.font = `500 8px ${mono}`;
    return { lines: this.#wrap(g, text, 1.4 * r, 3, true), lh: 10 };
  }

  /* Greedy by word, null when the text needs more than `n` lines. Under `hard`
     a word too long for a line is cut and the overflow dropped instead, both
     marked with an ellipsis; that is the last resort under the smallest font. */
  #wrap(g, text, w, n, hard = false) {
    const cut = word => {
      let s = word;
      while (s.length > 1 && g.measureText(s + "…").width > w) s = s.slice(0, -1);
      return s + "…";
    };
    const out = [];
    let line = "";
    for (const word of text.split(" ")) {
      const join = line ? line + " " + word : word;
      if (g.measureText(join).width <= w) { line = join; continue; }
      if (line) out.push(line);
      if (out.length === n) {
        if (!hard) return null;
        out[n - 1] = cut(out[n - 1]);
        return out;
      }
      if (g.measureText(word).width <= w) line = word;
      else if (hard) line = cut(word);
      else return null;
    }
    if (line) out.push(line);
    return out;
  }

  /* Angles nest, so a point maps to a ring by radius and to one node in that
     ring by binary search — no spatial index. */
  #hit(px, py) {
    const t0 = performance.now();
    const dx = px - this.#cx, dy = py - this.#cy, r = Math.hypot(dx, dy);
    if (r < this.#r0 || r > this.#rmax) return -1;
    const d = this.#depth[this.#root] + Math.floor((r - this.#r0) / this.#rw);
    if (d > this.#maxDepth) return -1;
    let ang = Math.atan2(dy, dx) + Math.PI / 2;
    if (ang < 0) ang += TAU;
    const A = this.#a0[this.#root]
      + ang / (TAU / (this.#a1[this.#root] - this.#a0[this.#root]));
    const arr = this.#byDepth[d];
    let lo = 0, hi = arr.length - 1, best = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.#a0[arr[m]] <= A) { best = arr[m]; lo = m + 1; } else hi = m - 1;
    }
    this.#hitUs = (performance.now() - t0) * 1000;
    return best >= 0 && this.#a1[best] >= A && this.#inView(best) ? best : -1;
  }

  #at(ev) {
    const b = this.#over.getBoundingClientRect();
    return [ev.clientX - b.left, ev.clientY - b.top];
  }
  #onMove = ev => {
    const h = this.#hit(...this.#at(ev));
    if (h === this.#hover) return;
    this.#hover = h; this.#overlay(); this.#say(h);
    if (h >= 0) this.#emit("disc-hover", {
      index: h, name: this.#label(h), depth: this.#depth[h], leaves: this.#leaves[h] });
  };
  #onLeave = () => { this.#hover = -1; this.#overlay(); this.#say(-1); };
  #onClick = ev => {
    const [px, py] = this.#at(ev);
    if (Math.hypot(px - this.#cx, py - this.#cy) < this.#r0) return this.up();
    const h = this.#hit(px, py);
    if (h >= 0 && this.#kids[h].length) this.zoomTo(h);
  };
  #onKey = ev => {
    const c = this.#cursor, sib = this.#par[c] >= 0 ? this.#kids[this.#par[c]] : [c];
    const at = sib.indexOf(c);
    let next = null;
    if (ev.key === "ArrowRight") next = sib[(at + 1) % sib.length];
    else if (ev.key === "ArrowLeft") next = sib[(at - 1 + sib.length) % sib.length];
    else if (ev.key === "ArrowDown") next = this.#kids[c][0] ?? null;
    else if (ev.key === "ArrowUp") next = this.#par[c] >= 0 ? this.#par[c] : null;
    else if (ev.key === "Enter" || ev.key === " ") { if (this.#kids[c].length) this.zoomTo(c); }
    else if (ev.key === "Escape") this.up();
    else return;
    ev.preventDefault();
    if (next != null) {
      this.#cursor = next; this.#overlay(); this.#say(next);
      this.#over.setAttribute("aria-label", this.#label(next));
    }
  };

  zoomTo(i) {
    if (!(i >= 0) || i >= this.#par.length) return;
    this.#root = i; this.#cursor = i; this.#hover = -1;
    this.#draw(); this.#overlay(); this.#crumbs(); this.#say(-1);
    this.#emit("disc-zoom", { index: i, name: this.#label(i), path: this.path(i) });
  }
  up() { if (this.#root !== 0) this.zoomTo(Math.max(0, this.#par[this.#root])); }
  reset() { this.zoomTo(0); }
  /* Call after the host page changes theme by any means other than
     prefers-color-scheme, which the element already watches. */
  repaint() { this.#draw(); this.#overlay(); }
  path(i) {
    const out = [];
    for (let c = i; c >= 0; c = this.#par[c]) out.unshift(this.#label(c));
    return out;
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #crumbs() {
    const path = [];
    for (let c = this.#root; c >= 0; c = this.#par[c]) path.unshift(c);
    this.#crumb.innerHTML = path.map((i, k) =>
      (k ? "<i>›</i>" : "") + (i === this.#root
        ? `<span>${this.#label(i)}</span>`
        : `<button type="button" data-i="${i}">${this.#label(i)}</button>`)).join("");
  }
  #say(i) {
    const j = i >= 0 ? i : this.#cursor;
    if (j < 0 || !this.#ready) { this.#tip.textContent = ""; return; }
    const n = this.#leaves[j], k = this.#kids[j].length;
    this.#tip.innerHTML = `<b>${this.#label(j)}</b> <em>· depth ${this.#depth[j]}`
      + ` · ${n.toLocaleString("en-GB")} leaf node${n === 1 ? "" : "s"} below`
      + ` · ${k.toLocaleString("en-GB")} direct child${k === 1 ? "" : "ren"}</em>`;
  }
}
customElements.define("hypernym-disc", HypernymDisc);
