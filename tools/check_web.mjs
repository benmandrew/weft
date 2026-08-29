/* Holds web/ to what a browser will actually accept and run.
 *
 * Two things, because a JavaScript file can parse cleanly and still be
 * rejected. `node --check` parses; it does not run the early-error pass that
 * resolves private names, so a `this.#gone` left behind by a refactor passes
 * it and then throws SyntaxError in the browser when the class body is
 * evaluated, which leaves the element undefined and the page blank. Loading
 * each module against a stubbed DOM fails exactly where the browser fails.
 *
 * Then the draw pipeline is run over a tree small enough to write down, since
 * the modules loading says nothing about whether they still draw. The
 * assertions are the properties the pipeline is built on rather than exact
 * counts, which move whenever the geometry does.
 *
 *     node tools/check_web.mjs
 */
const mod = name => new URL(`../web/${name}`, import.meta.url);
const problems = [];
const check = (ok, said) => { if (!ok) problems.push(said); };

/* All the browser the modules touch at load: a template to hold the markup,
   a base class, a registry, and the worker's first message out. */
globalThis.document = {
  createElement: () => ({ innerHTML: "", content: { cloneNode: () => ({}) } }),
};
globalThis.HTMLElement = class {};
globalThis.customElements = { define() {} };
globalThis.self = globalThis;
globalThis.postMessage = () => {};

const MODULES = ["disc-paint.js", "disc-worker.js", "hypernym-disc.js"];
for (const name of MODULES) {
  try { await import(mod(name)); }
  catch (e) { problems.push(`web/${name} does not load — ${e.constructor.name}: ${e.message}`); }
}
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

const { Painter, TAU } = await import(mod("disc-paint.js"));

/* Four subtrees of 2,000 leaves. At the geometry below that puts the fringe
   wedges at about a quarter of a pixel, so the merge is the path under test
   rather than the one that draws every node. */
const BRANCHES = 4, LEAVES = 2000;
const par = [-1];
for (let b = 0; b < BRANCHES; b++) par.push(0);
for (let b = 0; b < BRANCHES; b++)
  for (let k = 0; k < LEAVES; k++) par.push(1 + b);
const N = par.length;

/* The element's #build, which the painter is fed the output of. */
const kids = Array.from({ length: N }, () => []);
for (let i = 0; i < N; i++) if (par[i] >= 0) kids[par[i]].push(i);
const depth = new Int16Array(N), leaves = new Int32Array(N);
for (let i = 0; i < N; i++) depth[i] = par[i] < 0 ? 0 : depth[par[i]] + 1;
for (let i = N - 1; i >= 0; i--) {
  if (!kids[i].length) leaves[i] = 1;
  if (par[i] >= 0) leaves[par[i]] += leaves[i];
}
const a0 = new Float64Array(N), a1 = new Float64Array(N);
a1[0] = TAU;
for (let i = 0; i < N; i++) {
  let a = a0[i];
  const w = (a1[i] - a0[i]) / leaves[i];
  for (const c of kids[i]) { a0[c] = a; a += leaves[c] * w; a1[c] = a; }
}
let maxDepth = 0;
for (let i = 0; i < N; i++) if (depth[i] > maxDepth) maxDepth = depth[i];
const rings = Array.from({ length: maxDepth + 1 }, () => []);
for (let i = 0; i < N; i++) rings[depth[i]].push(i);
for (const r of rings) r.sort((x, y) => a0[x] - a0[y]);
const byDepth = rings.map(r => Int32Array.from(r));
const layout = { par: Int32Array.from(par), depth, a0, a1, byDepth, maxDepth };

const BOX = 724, DPR = 2, R0 = BOX * .075, RMAX = BOX * .485;
const view = mode => ({
  root: 0, w: Math.round(BOX * DPR), h: Math.round(BOX * DPR), dpr: DPR,
  cx: BOX / 2, cy: BOX / 2, r0: R0, rmax: RMAX,
  rw: (RMAX - R0) / (maxDepth + 1), mode,
  sat: ".55", val: ".88", panel: "#141b1c",
});

let arcs = 0;
const ctx = {
  canvas: { width: 0, height: 0 },
  setTransform() {}, clearRect() {}, beginPath() {}, closePath() {},
  arc() { arcs++; }, fill() {}, stroke() {},
  fillStyle: "", strokeStyle: "", lineWidth: 1,
};
const paint = (p, v) => { arcs = 0; return p.paint(ctx, v); };
const fresh = (hd = 2) => { const p = new Painter(); p.layout(layout, hd); return p; };

const off = paint(fresh(), view("off"));
check(off.drawn === N, `merge=off drew ${off.drawn} of ${N} nodes`);
check(ctx.canvas.width === Math.round(BOX * DPR), "the painter did not size the canvas");
check(arcs === off.drawn * 2 + 1, `${arcs} arcs for ${off.drawn} wedges and a hub`);

const dense = paint(fresh(), view("density"));
check(dense.drawn > 0 && dense.drawn < N, `density drew ${dense.drawn} of ${N}, so nothing merged`);
check(dense.segments === dense.drawn, "density drew something other than its segments");

const flat = paint(fresh(), view("on"));
check(flat.drawn > 0 && flat.drawn <= dense.drawn,
      `merge=on drew ${flat.drawn} against density's ${dense.drawn}`);

/* The one that guards the hue blend: merging joins neighbours whatever their
   colour, so a hue depth that gives every node its own must merge as well as a
   depth that gives a whole branch one. */
const deep = paint(fresh(19), view("density"));
check(deep.drawn < N, `at hue-depth 19 density drew ${deep.drawn} of ${N}, so the merge went by colour`);

/* Palette and runs survive a repeat, and a zoom is a different view. */
const p = fresh();
const first = paint(p, view("density"));
const again = paint(p, view("density"));
check(again.drawn === first.drawn, `a repeat drew ${again.drawn} against ${first.drawn}`);
const zoomed = paint(p, { ...view("density"), root: 1 });
check(zoomed.drawn > 0 && zoomed.drawn < first.drawn,
      `zooming into a subtree drew ${zoomed.drawn} against ${first.drawn}`);

if (problems.length) {
  for (const said of problems) console.error(`web: ${said}`);
  process.exit(1);
}
console.log(`web/: ${MODULES.length} modules load, ${N.toLocaleString("en-GB")} nodes`
  + ` merge to ${dense.drawn.toLocaleString("en-GB")} arcs`);
