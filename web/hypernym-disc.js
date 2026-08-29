/* <hypernym-disc> — a zoomable nested-arc view of any rooted tree.
 *
 * Data is {names: "a\nb\n…", par: [-1, 0, 0, …]} where par[i] is the index of
 * i's parent and every parent precedes its children, so each pass below is a
 * single loop rather than a traversal.
 *
 *   <hypernym-disc src="wordnet-tree.json"></hypernym-disc>
 *   <hypernym-disc> wrapping an application/json script child holding {…}
 *   document.querySelector("hypernym-disc").data = {names, par};
 *
 * Attributes: src, readout="off", hue-depth (default 2), start (node name).
 * Properties: data, index, names. Methods: zoomTo(i), up(), reset(), repaint(), path(i).
 * Events: disc-hover {index,name,depth,leaves}, disc-zoom {index,name,path},
 *         disc-render {nodes,drawn,buildMs,drawMs,hitUs,name} after every repaint.
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

class HypernymDisc extends HTMLElement {
  static observedAttributes = ["src", "start", "hue-depth"];

  #sr; #base; #over; #crumb; #tip; #ro;
  #names = []; #par = []; #kids = [];
  #depth; #leaves; #a0; #a1; #tint; #byDepth = []; #maxDepth = 0;
  #root = 0; #hover = -1; #cursor = 0;
  #buildMs = 0; #drawMs = 0; #drawn = 0; #hitUs = 0;
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
    if (n === "start" && this.#ready) this.#applyStart();
    if (n === "hue-depth" && this.#ready) { this.#retint(); this.#draw(); this.#overlay(); }
  }
  #mq;
  #repaint = () => { this.#draw(); this.#overlay(); };

  async #load() {
    const inline = this.querySelector('script[type="application/json"]');
    const src = this.getAttribute("src");
    try {
      if (src) this.data = await (await fetch(src)).json();
      else if (inline) this.data = JSON.parse(inline.textContent);
    } catch (err) {
      this.#tip.innerHTML = `<b>Could not load the tree.</b> ${err.message}`;
    }
  }

  set data(d) {
    if (!d || !d.par) return;
    this.#names = typeof d.names === "string" ? d.names.split("\n") : d.names;
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
             buildMs: this.#buildMs, drawMs: this.#drawMs, hitUs: this.#hitUs };
  }
  get names() { return this.#names; }

  #applyStart() {
    const want = this.getAttribute("start");
    const i = want ? this.#names.indexOf(want) : 0;
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
    const t0 = performance.now();
    let drawn = 0;
    const g = this.#base.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#base.width, this.#base.height);
    const S = parseFloat(this.#tok("--_sat", ".55")), V = parseFloat(this.#tok("--_val", ".88"));
    const panel = this.#tok("--_panel", "#141b1c");
    this.#rw = (this.#rmax - this.#r0) / (this.#maxDepth - this.#depth[this.#root] + 1);
    for (let i = 0; i < this.#par.length; i++) {
      if (!this.#inView(i)) continue;
      const [s, e, r0, r1] = this.#geom(i);
      const d = this.#depth[i] - this.#depth[this.#root];
      g.beginPath();
      g.arc(this.#cx, this.#cy, r1, s, e);
      g.arc(this.#cx, this.#cy, r0, e, s, true);
      g.closePath();
      g.fillStyle = hsv(this.#tint[i], S, Math.max(.22, V * (1 - d * .035)));
      g.fill();
      drawn++;
      // A hairline on a sub-pixel wedge would cover the fill it separates.
      if (e - s > .012) { g.strokeStyle = panel; g.lineWidth = .6; g.stroke(); }
    }
    g.beginPath(); g.arc(this.#cx, this.#cy, this.#r0 - 3, 0, TAU);
    g.fillStyle = panel; g.fill();
    g.fillStyle = this.#tok("--_muted", "#90a1a1");
    g.font = `500 11px ${this.#tok("--_mono", "monospace")}`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(this.#root === 0 ? this.#names[0] : "↑ up", this.#cx, this.#cy);
    this.#drawn = drawn;
    this.#drawMs = performance.now() - t0;
    this.#emit("disc-render", { ...this.stats, name: this.#names[this.#root] });
  }

  #overlay() {
    if (!this.#ready) return;
    const g = this.#over.getContext("2d");
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, this.#over.width, this.#over.height);
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
      index: h, name: this.#names[h], depth: this.#depth[h], leaves: this.#leaves[h] });
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
      this.#over.setAttribute("aria-label", this.#names[next]);
    }
  };

  zoomTo(i) {
    if (!(i >= 0) || i >= this.#par.length) return;
    this.#root = i; this.#cursor = i; this.#hover = -1;
    this.#draw(); this.#overlay(); this.#crumbs(); this.#say(-1);
    this.#emit("disc-zoom", { index: i, name: this.#names[i], path: this.path(i) });
  }
  up() { if (this.#root !== 0) this.zoomTo(Math.max(0, this.#par[this.#root])); }
  reset() { this.zoomTo(0); }
  /* Call after the host page changes theme by any means other than
     prefers-color-scheme, which the element already watches. */
  repaint() { this.#draw(); this.#overlay(); }
  path(i) {
    const out = [];
    for (let c = i; c >= 0; c = this.#par[c]) out.unshift(this.#names[c]);
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
        ? `<span>${this.#names[i]}</span>`
        : `<button type="button" data-i="${i}">${this.#names[i]}</button>`)).join("");
  }
  #say(i) {
    const j = i >= 0 ? i : this.#cursor;
    if (j < 0 || !this.#ready) { this.#tip.textContent = ""; return; }
    const n = this.#leaves[j], k = this.#kids[j].length;
    this.#tip.innerHTML = `<b>${this.#names[j]}</b> <em>· depth ${this.#depth[j]}`
      + ` · ${n.toLocaleString("en-GB")} leaf node${n === 1 ? "" : "s"} below`
      + ` · ${k.toLocaleString("en-GB")} direct child${k === 1 ? "" : "ren"}</em>`;
  }
}
customElements.define("hypernym-disc", HypernymDisc);
