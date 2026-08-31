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
const check = (ok, said) => {
  if (!ok) problems.push(said);
};

/* Enough browser to load the modules and, below, to run one of the elements.
   Both discs clone the same markup — a search box, two canvases, a definition
   and a crumb line — so one fragment serves either template.

   A canvas here records what it was asked to draw and measures text off the
   font size it was set, which is what lets the element be driven and its draw
   counted. Nothing is rasterised and nothing is compared to a picture: what is
   asserted below is that the code runs and puts the right number of things in
   the right places. */
const drew = {
  fillText: 0,
  strokeText: 0,
  stroke: 0,
  fill: 0,
  fillRect: 0,
  arc: 0,
  curve: 0,
  image: 0,
};
const PX = 0.6; // stub glyph width, as a fraction of the font size

class El {
  constructor(tag = "div", cls = "") {
    this.tagName = tag;
    this.className = cls;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.value = "";
    this.placeholder = "";
    this.disabled = false;
    this._html = "";
    this._attr = new Map();
    this._on = new Map();
    const held = new Set(cls.split(" ").filter(Boolean));
    this.classList = {
      add: c => held.add(c),
      remove: c => held.delete(c),
      contains: c => held.has(c),
      toggle: (c, on) => (on ? held.add(c) : held.delete(c)),
    };
  }
  addEventListener(type, fn) {
    (this._on.get(type) ?? this._on.set(type, []).get(type)).push(fn);
  }
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  append(...kids) {
    for (const kid of kids) if (kid instanceof El) kid._parent = this;
    this.children.push(...kids);
  }
  replaceChildren(...kids) {
    for (const kid of kids) if (kid instanceof El) kid._parent = this;
    this.children = kids;
    this._html = "";
  }
  /* Enough selector to answer what the elements actually ask: a tag name, on
     its own or qualified by one class or one data attribute. Both discs
     delegate their list handlers off `e.target.closest("li[data-i]")`, so
     without this a row could be built and counted here but never clicked. */
  closest(sel) {
    const m = /^([a-z]+)?(?:\[data-([\w-]+)\]|\.([\w-]+))?$/.exec(sel);
    if (!m) return null;
    const [, tag, data, cls] = m;
    for (let el = this; el instanceof El; el = el._parent) {
      if (tag && el.tagName !== tag) continue;
      if (data && !(data in el.dataset)) continue;
      if (cls && !el.classList.contains(cls)) continue;
      return el;
    }
    return null;
  }
  set innerHTML(v) {
    this._html = v;
  }
  get innerHTML() {
    return this._html;
  }
  /* Text as a browser reports it: setting it replaces the children, and
     reading it walks them. Both discs build a row out of spans and strings —
     a pair, an arrow and a count — so a getter answering only its own string
     would report every one of those rows as empty. */
  set textContent(v) {
    this.children = [];
    this._html = String(v);
  }
  get textContent() {
    if (!this.children.length) return this._html;
    return this.children.map(k => (k instanceof El ? k.textContent : String(k))).join("");
  }
  setAttribute(n, v) {
    this._attr.set(n, String(v));
  }
  getAttribute(n) {
    return this._attr.get(n) ?? null;
  }
  hasAttribute(n) {
    return this._attr.has(n);
  }
  removeAttribute(n) {
    this._attr.delete(n);
  }
  scrollIntoView() {}
  get childElementCount() {
    return this.children.length;
  }
  // Enough scroll geometry for the moves column to page. A row apiece and no
  // visible height, so one page is enough to overflow and the fill loop stops
  // where a browser's would.
  get scrollHeight() {
    return this.children.length;
  }
  clientHeight = 0;
  scrollTop = 0;
  // Settable, so a test can make the frame landscape and put the element
  // through the shape it only takes beside a column.
  getBoundingClientRect() {
    return this._rect ?? { width: BOX, height: BOX };
  }
  querySelector(sel) {
    const want = sel.replace(".", "");
    for (const kid of this.children) {
      if (kid.className === want) return kid;
      const deep = kid.querySelector?.(sel);
      if (deep) return deep;
    }
    return null;
  }
}

class Canvas extends El {
  constructor() {
    super("canvas", "");
    this.width = 0;
    this.height = 0;
    // Its own tally as well as the shared one, so a claim about what a single
    // canvas was asked to draw can be made — the two discs share `drew`, and
    // the base's 110 dots would drown out the overlay's nothing.
    this.drew = {
      fillText: 0,
      strokeText: 0,
      stroke: 0,
      fill: 0,
      fillRect: 0,
      arc: 0,
      curve: 0,
      image: 0,
    };
    // Where the text went, so a claim can be made about the halo sitting on
    // the letter it belongs to rather than beside it.
    this.text = { fill: [], stroke: [] };
    // And where the bundle was blitted, since it is held in a square of its
    // own and put back on the ring by inverting one fraction.
    this.images = [];
    // The colour each stroke went down in, in the order they were drawn, which
    // is the only way to make a claim about z-order without rasterising, and
    // the same for fills, which is how <letter-disc> draws its arcs.
    this.inks = [];
    this.fills = [];
    const both = what => {
      drew[what]++;
      this.drew[what]++;
    };
    this._g = {
      canvas: this,
      font: "10px x",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
      lineJoin: "",
      setTransform() {},
      clearRect() {},
      // <letter-disc>'s scrim, which is how it dims the picture around what the
      // pointer is on: one fill over the frame rather than a second pass over
      // 344 arcs, and it takes the ring bands and the letters down with it.
      fillRect: () => both("fillRect"),
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill: () => {
        both("fill");
        this.fills.push(this._g.fillStyle);
      },
      /* Answered false throughout, so what is driven below is the ring band
         and the letters outside it. <letter-disc> asks the path itself for a
         point inside the ring, since a ribbon there is a curved shape no
         arithmetic short of the path describes, and nothing here rasterises
         one. What that costs is exactly the interior hit; the ends are what
         the assertions reach, and they are where an arc is identifiable. */
      isPointInPath: () => false,
      bezierCurveTo: () => both("curve"),
      stroke: () => {
        both("stroke");
        this.inks.push(this._g.strokeStyle);
      },
      arc: () => both("arc"),
      fillText: (t, x, y) => {
        both("fillText");
        // The colour as well as the point, since the hub's halo is now made of
        // fills like the letters it sits under and the ground is what tells
        // the two apart.
        this.text.fill.push({ t, x, y, c: this._g.fillStyle });
      },
      strokeText: (t, x, y) => {
        both("strokeText");
        this.text.stroke.push({ t, x, y });
      },
      drawImage: (_img, ...box) => {
        both("image");
        this.images.push(box);
      },
      measureText(text) {
        const px = parseFloat(/([\d.]+)px/.exec(this.font)?.[1]) || 10;
        /* The ink either side of the baseline as well as the width, and it has
           to depend on the letters: a real face puts "iris" between the dot
           and the baseline and hangs "guppy" below it, which is what made the
           hub's name move as the pointer crossed the disc. Reported flat, the
           stub could not tell a fix from the bug. */
        return {
          width: text.length * PX * px,
          // The dot on an i is in the tall class, since it is what the name
          // moving under the pointer was first noticed on.
          actualBoundingBoxAscent: px * (/[A-Zbdfhijklt]/.test(text) ? 0.72 : 0.52),
          actualBoundingBoxDescent: px * (/[gjpqy]/.test(text) ? 0.2 : 0),
        };
      },
    };
  }
  getContext() {
    return this._g;
  }
}

/* The markup both templates hold. Written out rather than parsed, since the
   only thing the elements do with it is querySelector by class. */
const fragment = () => {
  const frame = new El("div", "frame");
  // Hidden as the template has it, since a host that names no index gets no
  // picker and the element is what shows it.
  const pick = new El("div", "pick");
  pick.hidden = true;
  pick.append(new El("select", "cat"));
  const find = new El("div", "find");
  const moves = new El("div", "moves");
  moves.append(new El("div", "why"), new El("ul", "list"));
  // <hypernym-disc>'s list of the ring below the root. Same two parts, its own
  // element, since one fragment serves either template and the two discs reach
  // for their own by class.
  const kids = new El("div", "kids");
  kids.append(new El("div", "why"), new El("ul", "list"));
  // <letter-disc>'s list of the arcs in the picture. Same two parts again,
  // its own element, since one fragment serves all three templates and each
  // disc reaches for its own by class.
  const arcs = new El("div", "arcs");
  arcs.append(new El("div", "why"), new El("ul", "list"));
  find.append(new El("input", "q"), new El("ul", "hits"), moves, kids, arcs);
  const stage = new El("div", "stage");
  stage.append(new Canvas(), new Canvas());
  stage.children[0].className = "base";
  stage.children[1].className = "over";
  const crumb = new El("div", "crumb");
  crumb.append(new El("span", "head"), new El("span", "tail"));
  frame.append(pick, find, stage, new El("div", "gloss"), crumb);
  const root = new El("div", "");
  root.append(new El("style", ""), frame);
  return root;
};

globalThis.document = {
  // Resolved, so the elements' document.fonts.ready callbacks are run rather
  // than only parsed. Awaited once below, after the word disc's draw counts.
  fonts: { ready: Promise.resolve() },
  createElement: tag =>
    tag === "canvas"
      ? new Canvas()
      : tag === "template"
        ? { innerHTML: "", content: { cloneNode: fragment } }
        : new El(tag),
};
globalThis.HTMLElement = class extends El {
  attachShadow() {
    this._shadow = new El("div", "");
    return this._shadow;
  }
  /* Setting an observed attribute calls the callback, which is what a browser
     does and what the element counts on when it changes its own `src` from the
     picker. Driven this way rather than by calling the callback by hand, for
     the reason the resize observer keeps its callbacks: a test that reaches
     past the browser's plumbing stops being a statement about the element. */
  setAttribute(n, v) {
    const was = this.getAttribute(n);
    super.setAttribute(n, v);
    if (this.constructor.observedAttributes?.includes(n)) {
      this.attributeChangedCallback?.(n, was, String(v));
    }
  }
};
const REGISTRY = new Map();
globalThis.customElements = {
  define(name, cls) {
    REGISTRY.set(name, cls);
  },
};
/* The callbacks are kept, so a test can resize an element the way a browser
   does rather than reaching for a private method — and what each one observes
   is kept with them, because a browser only calls back when one of the boxes
   it was actually given has moved.

   That distinction is the whole point of modelling it. An element can measure
   one box and observe another, and then a change to the box it measures raises
   no callback at all and the element never learns of it. Firing every callback
   on every resize hides exactly that, and hid it here. */
const OBSERVERS = [];
globalThis.ResizeObserver = class {
  constructor(fn) {
    this._o = { fn, seen: new Map() };
    OBSERVERS.push(this._o);
  }
  observe(el) {
    if (el) this._o.seen.set(el, null);
  }
  disconnect() {
    const i = OBSERVERS.indexOf(this._o);
    if (i >= 0) OBSERVERS.splice(i, 1);
  }
};
/* One turn of the layout: every observer one of whose boxes has moved since it
   last ran, and no others. */
const resize = () => {
  for (const o of [...OBSERVERS]) {
    let moved = false;
    for (const [el, was] of o.seen) {
      const now = el.getBoundingClientRect();
      if (!was || was.width !== now.width || was.height !== now.height) moved = true;
      o.seen.set(el, { width: now.width, height: now.height });
    }
    if (moved) o.fn();
  }
};
/* The listeners are kept, the way the resize observer's are, so a test can
   drive a change of resolution as a browser drives one. Removal goes by
   function rather than by query, since re-arming takes the listener off the
   old query object and puts it on a new one. */
const MEDIA = [];
globalThis.matchMedia = q => ({
  addEventListener(_, fn) {
    MEDIA.push({ q, fn });
  },
  removeEventListener(_, fn) {
    const i = MEDIA.findIndex(m => m.fn === fn);
    if (i >= 0) MEDIA.splice(i, 1);
  },
});
// A browser zoom: devicePixelRatio moves and the CSS box stays where it was.
const zoom = to => {
  window.devicePixelRatio = to;
  for (const m of [...MEDIA]) if (m.q.includes("dppx")) m.fn();
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.window = { devicePixelRatio: 2 };
globalThis.self = globalThis;
globalThis.postMessage = () => {};

// The square the driven element is given, which every point below is measured
// against. The nested disc's own synthetic view uses it too.
const BOX = 720;

const MODULES = [
  "disc-colour.js",
  "disc-index.js",
  "disc-label.js",
  "disc-paint.js",
  "disc-ratio.js",
  "disc-search.js",
  "disc-worker.js",
  "hypernym-disc.js",
  "letter-disc.js",
  "letter-graph.js",
  "word-bundle.js",
  "word-bundle-worker.js",
  "word-chain.js",
  "word-disc.js",
  "word-layout.js",
];
for (const name of MODULES) {
  try {
    await import(mod(name));
  } catch (e) {
    problems.push(`web/${name} does not load — ${e.constructor.name}: ${e.message}`);
  }
}
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

const { Painter, TAU } = await import(mod("disc-paint.js"));

/* Four subtrees of 2,000 leaves. At the geometry below that puts the fringe
   wedges at about a quarter of a pixel, so the merge is the path under test
   rather than the one that draws every node. */
const BRANCHES = 4,
  LEAVES = 2000;
const par = [-1];
for (let b = 0; b < BRANCHES; b++) par.push(0);
for (let b = 0; b < BRANCHES; b++) for (let k = 0; k < LEAVES; k++) par.push(1 + b);
const N = par.length;

/* The element's #build, which the painter is fed the output of. */
const kids = Array.from({ length: N }, () => []);
for (let i = 0; i < N; i++) if (par[i] >= 0) kids[par[i]].push(i);
const depth = new Int16Array(N),
  leaves = new Int32Array(N);
for (let i = 0; i < N; i++) depth[i] = par[i] < 0 ? 0 : depth[par[i]] + 1;
for (let i = N - 1; i >= 0; i--) {
  if (!kids[i].length) leaves[i] = 1;
  if (par[i] >= 0) leaves[par[i]] += leaves[i];
}
const a0 = new Float64Array(N),
  a1 = new Float64Array(N);
a1[0] = TAU;
for (let i = 0; i < N; i++) {
  let a = a0[i];
  const w = (a1[i] - a0[i]) / leaves[i];
  for (const c of kids[i]) {
    a0[c] = a;
    a += leaves[c] * w;
    a1[c] = a;
  }
}
let maxDepth = 0;
for (let i = 0; i < N; i++) if (depth[i] > maxDepth) maxDepth = depth[i];
const rings = Array.from({ length: maxDepth + 1 }, () => []);
for (let i = 0; i < N; i++) rings[depth[i]].push(i);
for (const r of rings) r.sort((x, y) => a0[x] - a0[y]);
const byDepth = rings.map(r => Int32Array.from(r));
const layout = { par: Int32Array.from(par), depth, a0, a1, byDepth, maxDepth };

const DPR = 2,
  R0 = BOX * 0.075,
  RMAX = BOX * 0.485;
const view = mode => ({
  root: 0,
  w: Math.round(BOX * DPR),
  h: Math.round(BOX * DPR),
  dpr: DPR,
  cx: BOX / 2,
  cy: BOX / 2,
  r0: R0,
  rmax: RMAX,
  rw: (RMAX - R0) / (maxDepth + 1),
  rings: maxDepth + 1,
  mode,
  sat: ".55",
  val: ".88",
  panel: "#141b1c",
});

let arcs = 0;
const ctx = {
  canvas: { width: 0, height: 0 },
  setTransform() {},
  clearRect() {},
  beginPath() {},
  closePath() {},
  arc() {
    arcs++;
  },
  fill() {},
  stroke() {},
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
};
const paint = (p, v) => {
  arcs = 0;
  return p.paint(ctx, v);
};
const fresh = (hd = 2) => {
  const p = new Painter();
  p.layout(layout, hd);
  return p;
};

const off = paint(fresh(), view("off"));
check(off.drawn === N, `merge=off drew ${off.drawn} of ${N} nodes`);
check(ctx.canvas.width === Math.round(BOX * DPR), "the painter did not size the canvas");
check(arcs === off.drawn * 2 + 1, `${arcs} arcs for ${off.drawn} wedges and a hub`);

const dense = paint(fresh(), view("density"));
check(dense.drawn > 0 && dense.drawn < N, `density drew ${dense.drawn} of ${N}, so nothing merged`);
check(dense.segments === dense.drawn, "density drew something other than its segments");

const flat = paint(fresh(), view("on"));
check(
  flat.drawn > 0 && flat.drawn <= dense.drawn,
  `merge=on drew ${flat.drawn} against density's ${dense.drawn}`,
);

/* The one that guards the hue blend: merging joins neighbours whatever their
   colour, so a hue depth that gives every node its own must merge as well as a
   depth that gives a whole branch one. */
const deep = paint(fresh(19), view("density"));
check(
  deep.drawn < N,
  `at hue-depth 19 density drew ${deep.drawn} of ${N}, so the merge went by colour`,
);

/* The ring cap. Two rings of a three-ring tree is the root and its branches,
   never the 8,000 leaves, and the painter has to re-merge rather than serve the
   full-depth run it just cached. */
const capped = paint(fresh(), { ...view("density"), rings: 2 });
check(
  capped.drawn === 1 + BRANCHES,
  `two rings drew ${capped.drawn}, not the root and its ${BRANCHES} branches`,
);
const one = paint(fresh(), { ...view("density"), rings: 1 });
check(one.drawn === 1, `one ring drew ${one.drawn}, not the root alone`);
const shared = fresh();
paint(shared, view("density"));
check(
  paint(shared, { ...view("density"), rings: 2 }).drawn === 1 + BRANCHES,
  "the cap did not re-merge over a cached full-depth run",
);

/* Palette and runs survive a repeat, and a zoom is a different view. */
const p = fresh();
const first = paint(p, view("density"));
const again = paint(p, view("density"));
check(again.drawn === first.drawn, `a repeat drew ${again.drawn} against ${first.drawn}`);
const zoomed = paint(p, { ...view("density"), root: 1 });
check(
  zoomed.drawn > 0 && zoomed.drawn < first.drawn,
  `zooming into a subtree drew ${zoomed.drawn} against ${first.drawn}`,
);

/* The search box, which is scored rather than drawn. The order of the bands is
   what the assertions are on: a stronger kind of match outranks a weaker one
   however long the name it sits in. */
const { Search } = await import(mod("disc-search.js"));
const NAMES = [
  "cat",
  "catamaran",
  "domestic cat",
  "polecat",
  "concatenate",
  "dog",
  "waterfowl",
  "wildcat hunting",
];
const find = (q, n) => new Search(NAMES).query(q, n).map(h => h.name);

check(find("cat")[0] === "cat", `an exact name is not first: ${find("cat")[0]}`);
check(find("cat")[1] === "catamaran", `the shorter prefix is not second: ${find("cat")[1]}`);
check(
  find("cat").indexOf("domestic cat") < find("cat").indexOf("polecat"),
  "a word in the name did not beat a match inside one",
);
check(
  find("cat").indexOf("polecat") < find("cat").indexOf("concatenate"),
  "an earlier match inside the name did not win",
);
check(find("CaT")[0] === "cat", "the query is case sensitive");
check(
  find("wtrfl").length === 1 && find("wtrfl")[0] === "waterfowl",
  `letters in order did not reach waterfowl: ${find("wtrfl")}`,
);
check(find("cat", 2).length === 2, "the limit was not kept");
/* The mask that skips most names before they are scored keeps a bit for the
   space, so a multiword query still has to reach a multiword name through it,
   and holding every character of a query is not the same as holding them in
   order. */
check(
  find("wld hnt").join("|") === "wildcat hunting",
  `a multiword subsequence did not survive the prune: ${find("wld hnt")}`,
);
check(find("tac").length === 0, `letters out of order matched: ${find("tac")}`);
check(find("   ").length === 0 && find("").length === 0, "an empty query matched");
check(find("zzz").length === 0, "a query that matches nothing returned hits");
/* Names repeat in WordNet, so the same name at two indices has to come back
   twice rather than being folded into one. */
check(
  new Search(["bank", "bank"]).query("bank").length === 2,
  "a repeated name collapsed to one hit",
);

/* The hub's label, which wraps rather than draws. A monospace stub stands in
   for the canvas, so a width is a character count and the expected lines can be
   written down. What is asserted is that nothing is dropped without a mark:
   a break inside a word carries a hyphen, a break on a space does not. */
const { fit, wrap } = await import(mod("disc-label.js"));
const CH = 6;
const mono = { font: "", measureText: s => ({ width: s.length * CH }) };
const lines = (text, w, n, hard) => wrap(mono, text, w * CH, n, hard);

check(lines("cat", 10, 1)?.join("|") === "cat", "a short name did not come back whole");
check(
  lines("domestic cat", 8, 2)?.join("|") === "domestic|cat",
  `wrapped to ${lines("domestic cat", 8, 2)}`,
);
check(lines("domestic cat", 8, 1) === null, "a name needing two lines fitted in one");
check(lines("dichlorodiphenyl", 8, 2) === null, "a long word broke without hard set");

/* The one the hyphen is for: a single word too long for any line. */
check(
  lines("dichlorodiphenyltrichloroethane", 8, 3, true).join("|") === "dichlor-|odiphen-|yltrich-",
  `hyphenated to ${lines("dichlorodiphenyltrichloroethane", 8, 3, true)}`,
);
check(
  lines("dichlorodiphenyl", 8, 3, true).every(l => l.length <= 8),
  "a hyphenated line ran past the width",
);
check(
  lines("united nations educational scientific", 10, 2, true).join("|") === "united|nations e-",
  `broke to ${lines("united nations educational scientific", 10, 2, true)}`,
);
/* A break landing on a space must not invent a hyphen inside the name. */
check(
  lines("aa bb cc", 6, 1, true).join("|") === "aa bb",
  `a break on a space came back as ${lines("aa bb cc", 6, 1, true)}`,
);
/* No ellipsis survives anywhere. */
for (const t of [
  "dichlorodiphenyltrichloroethane",
  "united nations educational scientific",
  "blood-oxygenation level dependent functional magnetic resonance imaging",
])
  check(!lines(t, 9, 3, true).join("").includes("\u2026"), `an ellipsis came back for ${t}`);

/* And the ladder above it: a short name gets the big size, a long one is
   pushed down to the smallest and still comes back with something to draw. */
const big = fit(mono, "cat", 60, "monospace");
const small = fit(
  mono,
  "blood-oxygenation level dependent functional magnetic resonance imaging",
  60,
  "monospace",
);
check(big.lh > small.lh, `a short name took ${big.lh} against a long name's ${small.lh}`);
/* A caller can hand in a ladder and a weight of its own — <word-disc>'s hub is
   the larger of the two and sets bolder, heavier type — and the defaults are
   what everything else still gets. */
const asked = fit(mono, "cat", 60, "monospace", { sizes: [30, 24], weight: 700 });
check(asked.px === 30, `a ladder of its own was ignored: ${asked.px}`);
check(asked.font.startsWith("700 30px"), `the weight was ignored: ${asked.font}`);
check(big.font.startsWith("500 "), `the default weight moved: ${big.font}`);
check(big.px === 12 && big.font.includes("12px"), `the default ladder moved: ${big.font}`);
/* The face comes back as well as being set, so the element can hold the fit
   and put the font back without measuring the name again. */
for (const [what, got] of [
  ["a short name", big],
  ["the longest name in WordNet", small],
])
  check(
    got.font.includes(`${got.lh - 2}px`),
    `fit returned ${got.font} for ${what}, which is not the ${got.lh - 2}px it wrapped to`,
  );
check(
  small.lines.length > 0 && small.lines.every(l => l.length > 0),
  "the longest name in WordNet left the hub with nothing to draw",
);

/* The word disc's layout, which is render.py's `words_disc` written a second
   time. What is asserted is the ordering the Python has, since that is the
   thing that can drift: a wedge per first letter in alphabetical order, and
   inside one the destinations in the order the ring visits them. */
const {
  at: wordAt,
  chords: wordChords,
  fanKey,
  layout: wordLayout,
  HUB_SHARE,
  MAX_LABEL_PX,
  MIN_LABEL_PX,
  rank,
  solve,
  turns,
} = await import(mod("word-layout.js"));

check(
  rank(["b", "a", "c"], [1, 2, 1]).join("|") === "a|b|c",
  `rank did not put the commonest first and break the tie by spelling: ${rank(["b", "a", "c"], [1, 2, 1])}`,
);

/* render.py's key is (ord(head) - ord(tail) - 1) % 26, counted backwards from
   the wedge's own letter so the bundle leaves as a fan rather than crossing
   itself. S handing over to T is the far end of that count, not the near one. */
check(fanKey(18, 19) === 24, `fanKey(s, t) is ${fanKey(18, 19)}, not 24`);
check(fanKey(19, 19) === 25, `a word ending on its own letter scored ${fanKey(19, 19)}`);
check(fanKey(19, 17) === 1, `fanKey(t, r) is ${fanKey(19, 17)}, not 1`);

const WORDS = ["cat", "dog", "tiger", "toad", "tuna", "trout", "rat", "emu"];
const L = wordLayout(WORDS);

check(L.n === WORDS.length, `laid out ${L.n} of ${WORDS.length} words`);
check(
  new Set(L.order).size === WORDS.length,
  "the placement order is not a permutation of the words",
);
check(
  L.live.join("") ===
    [...new Set(WORDS.map(w => w.charCodeAt(0) - 97))].sort((a, b) => a - b).join(""),
  "the wedges are not the live letters in alphabetical order",
);

/* Angles run down from the top and never wrap, which is what lets the hit test
   binary-search one array with no spatial index behind it. */
let falls = true;
for (let k = 1; k < L.order.length; k++)
  if (L.ang[L.order[k]] >= L.ang[L.order[k - 1]]) falls = false;
check(falls, "the placement order does not run clockwise from the top");
check(
  L.ang[L.order[0]] <= Math.PI / 2 && Math.PI / 2 - L.ang[L.order[L.n - 1]] < 2 * Math.PI,
  "the ring starts somewhere other than the top, or runs past a full turn",
);

const wedge = L.wedge.find(w => w.letter === 19);
check(
  Array.from(L.order)
    .filter(i => L.head[i] === 19)
    .map(i => WORDS[i])
    .join("|") === "tiger|toad|tuna|trout",
  "the T wedge is not in fan order",
);
check(wedge.count === 4, `the T wedge holds ${wedge.count} words, not 4`);

/* The successors of a word are a whole wedge, never a list stored per word:
   everything starting with the letter it ends on, itself excluded. */
const after = w => {
  const i = WORDS.indexOf(w);
  return L.byHead[L.tail[i]]
    .filter(j => j !== i)
    .map(j => WORDS[j])
    .sort()
    .join("|");
};
check(after("cat") === "tiger|toad|trout|tuna", `cat is followed by ${after("cat")}`);
check(after("trout") === "tiger|toad|tuna", `trout follows itself: ${after("trout")}`);
check(after("emu") === "", `emu leads somewhere: ${after("emu")}`);

let walked = 0;
for (let i = 0; i < L.n; i++) for (const j of L.byHead[L.tail[i]]) if (j !== i) walked++;
check(wordChords(L) === walked, `chords counted ${wordChords(L)} against a walk's ${walked}`);

/* The rule, and the one thing it does not enforce. */
const { Chain } = await import(mod("word-chain.js"));
const at = w => WORDS.indexOf(w);
const c = new Chain(L.head, L.tail);

check(
  WORDS.every((_, i) => c.legal(i)),
  "an empty chain refused a word",
);
check(c.end === -1 && c.letter === -1, "an empty chain has an end or a letter");

check(c.play(at("cat")) !== null && c.letter === 19, "cat did not hand over on T");
check(!c.legal(at("rat")), "rat followed cat");
check(c.legal(at("tiger")) && c.legal(at("toad")), "the T wedge is not the move set");
check(c.replies(c.end, L.byHead) === 4, `cat left ${c.replies(c.end, L.byHead)} replies, not 4`);

/* A word already played is not a move, and neither is the word play is
   standing on — that one falls out of the same test rather than needing its
   own, since it is used by definition. */
check(!c.legal(at("cat")), "cat is a move from cat");
check(c.play(at("cat")) === null, "playing cat twice was allowed");
check(c.length === 1, `a refused move still lengthened the chain to ${c.length}`);

c.play(at("tiger"));
c.play(at("rat"));
check(!c.legal(at("tiger")), "tiger followed rat after being played");
check(c.play(at("tiger")) === null, "a repeat was played");
check(c.steps.map(i => WORDS[i]).join("|") === "cat|tiger|rat", `the chain is ${c.steps}`);
/* The T wedge minus tiger, which is used, and minus rat, which is where play
   is standing. */
check(
  c.replies(c.end, L.byHead) === 3,
  `rat left ${c.replies(c.end, L.byHead)} replies, not toad, tuna and trout`,
);

/* Winding back puts a word's own move back with it, which is what the crumb
   path's root does when it winds all the way to nothing. */
c.rewind(1);
check(c.length === 1 && c.legal(at("tiger")), "winding back left tiger used");
check(c.clear() === -1 && c.length === 0, "clearing left a chain");
check(
  WORDS.every((_, i) => c.legal(i)),
  "clearing left a word unplayable",
);

/* The end of the round, which now has two shapes: a letter the category never
   had a word for, and one whose words are all spent. */
check(c.play(at("emu")) !== null && c.stuck(L.byHead), "emu is not a dead end");
check(c.clear() === -1 && !c.stuck(L.byHead), "clearing left the chain stuck");

/* Walking the T wedge dry: cat leaves four, and taking all of them by way of
   words that come back to T ends the round on a letter the category does have
   words for. */
const dry = new Chain(L.head, L.tail);
for (const w of ["cat", "trout", "toad", "dog"]) dry.play(at(w));
check(dry.steps.map(i => WORDS[i]).join("|") === "cat|trout|toad|dog", `walked ${dry.steps}`);
check(dry.stuck(L.byHead), "dog is not a dead end, since nothing starts with G");
dry.rewind(2);
check(!dry.stuck(L.byHead), "winding back off a dead end left the chain stuck");
check(dry.legal(at("toad")) && !dry.legal(at("trout")), "the wound-back move set is wrong");

/* The sizing, which is one equation with the label size on both sides: a
   label's length is set by its type and the room it has along the ring is set
   by the radius. Solved rather than measured, so what is asserted is that it
   stays inside the square it was given at every count, down to a frame too
   small to draw in. */
const SQUARE = 720,
  WIDE = 5.4; // "milliampere" at 1 px of type, near enough
const fits = got => got.outer + 24 / 2 <= SQUARE / 2 + 0.001 && got.r > 0;

const roomy = solve(wordLayout(WORDS).span, WIDE, SQUARE);
/* The hub is one radius doing both jobs — what a click in the middle undoes
   and what the name has to fit inside — so no part of a name can be somewhere
   a click does nothing. It stops short of the dots either way. */
check(roomy.hub < roomy.r * 0.62, "the hub reaches the band the dots are hit-tested in");
check(roomy.labelPx === MAX_LABEL_PX, `8 words did not reach the label cap: ${roomy.labelPx}`);
check(fits(roomy), "the label cap put the disc outside its own square");
check(
  Math.abs(roomy.hub - roomy.r * HUB_SHARE) < 0.001,
  "a roomy disc did not take the hub's own share of the ring",
);

/* 110 words is what `build` draws and what the element opens on, and the
   labels have to be solved there rather than capped or dropped. */
const many = Array.from({ length: 110 }, (_, i) => `w${i}x`);
const mid = solve(wordLayout(many).span, WIDE, SQUARE);
check(
  mid.labelPx > MIN_LABEL_PX && mid.labelPx < MAX_LABEL_PX,
  `110 words solved to ${mid.labelPx}, which is the cap or the floor rather than a fit`,
);
check(fits(mid), "110 words put the disc outside its own square");

/* And past the floor the labels go rather than smearing, which is the trade
   `--limit 0` makes in the SVG by shrinking the type instead. */
const crowd = Array.from({ length: 1600 }, (_, i) => `w${i}x`);
const tight = solve(wordLayout(crowd).span, WIDE, SQUARE);
check(tight.labelPx === 0, `1,600 words kept ${tight.labelPx}px labels`);
check(tight.r > mid.r, "dropping the labels did not give the ring their room");
check(fits(tight), "1,600 words put the disc outside its own square");

/* A frame with no room in it still has to come back with a disc rather than a
   negative radius or a hub swallowing the ring. */
for (const size of [0, 12, 40, 200]) {
  const got = solve(wordLayout(many).span, WIDE, size);
  check(got.r > 0, `a ${size}px frame solved to a radius of nothing`);
  check(got.hub < got.r, `a ${size}px frame put the hub outside the dot ring`);
}

/* The hit test: the binary search over the placement order, which the gaps
   between wedges have to fall out of. */
const turn = turns(L);
let rises = true;
for (let k = 1; k < turn.length; k++) if (turn[k] <= turn[k - 1]) rises = false;
check(rises, "the turns are not strictly increasing, so the binary search is unsound");
for (let k = 0; k < turn.length; k++)
  check(
    wordAt(L, turn, turn[k]) === L.order[k],
    `the centre of ${WORDS[L.order[k]]} hit ${WORDS[wordAt(L, turn, turn[k])] ?? "nothing"}`,
  );
/* Both edges of a slice, since the search lands on the entry below `t` and
   the slice it wants may be the one above: a point just short of a word's
   centre is still that word's. */
for (let k = 0; k < turn.length; k++)
  for (const off of [-0.4, 0.4])
    check(
      wordAt(L, turn, turn[k] + L.span * off) === L.order[k],
      `${off < 0 ? "just short of" : "just past"} ${WORDS[L.order[k]]} hit something else`,
    );
/* The gap after the last word of a wedge belongs to nobody. GAP is 3.5° and a
   slice here is far wider, so half a slice past the last word of the first
   wedge is inside the next word's, and a hair past the wedge's edge is not. */
const edge = L.wedge[0];
check(
  wordAt(L, turn, Math.PI / 2 - edge.to + 0.001) === -1,
  "the gap between two wedges answered with a word",
);
check(wordAt(L, turn, 2 * Math.PI - 0.001) === -1, "the gap before the top answered with a word");

/* The resting bundle's own square. It is sized here rather than in the element
   because a square that comes back below the ring it holds draws a blurred
   bundle and nothing downstream can tell, and because the step is what makes a
   resize a blit rather than a rebuild. */
const {
  bundle: strokeBundle,
  curve: wordCurve,
  BANDS,
  KNEE,
  RING,
  MAX_PX,
  square,
  thin,
} = await import(mod("word-bundle.js"));
const ABC26 = "abcdefghijklmnopqrstuvwxyz";

check(square(300, 2) * RING >= 300 * 2, `square(300, 2) holds a ring short of the radius asked`);
check(
  square(300, 2) === square(304, 2),
  `four pixels of radius moved the square from ${square(300, 2)} to ${square(304, 2)}`,
);
check(square(4000, 2) === MAX_PX, `a huge disc asked for ${square(4000, 2)} rather than the cap`);
check(square(10, 1) > 0, `a tiny disc sized its bundle at ${square(10, 1)}`);

/* The backing-store ratio, and the bundle's cap held to it.
   A ratio is never above the screen's own, and the pixels it asks for are
   never above the budget, whatever box it is handed. */
const { ratio, MAX_AREA } = await import(mod("disc-ratio.js"));
for (const [d, w, h] of [
  [4, 716, 716],
  [3, 1900, 1000],
  [2, 3000, 2000],
  [4, 100, 100],
  [1, 400, 300],
]) {
  const k = ratio(d, w, h);
  check(
    k > 0 && k <= d && w * k * (h * k) <= MAX_AREA + 1,
    `ratio ${k} on ${w} by ${h} at dpr ${d} asks for ${Math.round(w * k * h * k)} pixels`,
  );
}
/* The case the cap of 2 used to blur: a disc zoomed to 200% on a Retina
   screen, which halves the CSS box and doubles the ratio, so the pixels are
   the same and there is nothing to save by refusing them. */
check(ratio(4, 716, 716) === 4, `a zoomed disc was held to ${ratio(4, 716, 716)}`);
check(ratio(0, 700, 400) === 1, `a screen reporting no ratio came back at ${ratio(0, 700, 400)}`);
/* And the bundle's cap must not bind before that budget does, or the picture
   blurs under dots and labels that stayed sharp. The largest ring a budgeted
   square frame can hold is half its side. */
const budgeted = Math.sqrt(MAX_AREA) / 2;
check(
  square(budgeted, 1) <= MAX_PX,
  `a frame at the budget wants ${square(budgeted, 1)} against a cap of ${MAX_PX}`,
);

/* The stroke thinned by what the disc holds. An alpha of zero draws nothing
   and one above the tuned value draws more ink than the value it was tuned at,
   and the element could notice neither, which is why the rule is here. Written
   down as the shape rather than the numbers, since FALL is a knob. */
check(thin(0.11, KNEE) === 0.11, `at the knee the alpha moved to ${thin(0.11, KNEE)}`);
check(thin(0.2, 1) === 0.2, `a sparse category was thinned to ${thin(0.2, 1)}`);
/* animal, the densest the corpus has, against language, the densest the value
   was ever exercised on. Thinner, and still ink rather than nothing. */
const thinnest = thin(0.11, 96470);
check(thinnest > 0 && thinnest < 0.11, `96,470 chords came back at ${thinnest}`);
check(
  thin(0.11, 96470) < thin(0.11, 24898),
  `animal is not thinner than drug: ${thin(0.11, 96470)} against ${thin(0.11, 24898)}`,
);
/* Held above the floor the rasteriser has. Coverage for a half-pixel stroke is
   already partial, so an alpha this side of a hundredth is a bundle that is
   drawn and cannot be seen. */
check(thinnest > 0.01, `the densest category draws at ${thinnest}, which is under the floor`);

/* Every chord, stroked one at a time: batched into one path per letter the
   alpha stops accumulating where curves overlap and the bundle reads flat. */
const bundleCanvas = new Canvas();
const strokes = strokeBundle(bundleCanvas.getContext("2d"), {
  px: 512,
  ang: L.ang,
  byHead: L.byHead,
  tail: L.tail,
  live: L.live,
  // A colour apiece rather than one for all 26, so the order they went down in
  // can be read back off the stub.
  colours: Array.from({ length: 26 }, (_, i) => `L${i}`),
  pull: 0.32,
  alpha: 0.2,
  lineWidth: 1,
});
check(
  strokes === wordChords(L) && bundleCanvas.drew.stroke === strokes,
  `the bundle drew ${bundleCanvas.drew.stroke} strokes for ${wordChords(L)} chords`,
);
check(
  bundleCanvas.drew.curve === strokes,
  `${bundleCanvas.drew.curve} curves against ${strokes} strokes`,
);
check(typeof wordCurve === "function", "word-bundle.js exports no shared curve");

/* The z-order. Drawn letter by letter, every chord leaving Z composited over
   every chord leaving A and the fringe read as the back of the alphabet. Each
   letter is cut into BANDS slices now, so what is asserted is that no letter's
   chords are a contiguous run: a wedge whose chords all sit together is a wedge
   sitting under or over a neighbour everywhere they cross. Written down as a
   spread rather than an exact schedule, since that moves whenever BANDS does.

   A word set large enough for the bands to bite, since 13 chords over 5 wedges
   cannot show an interleave however it is ordered. */
const SPREAD = Array.from({ length: 520 }, (_, i) => {
  const a = ABC26[i % 26];
  return a + ABC26[(i >> 2) % 26] + ABC26[(i * 5 + 1) % 26];
});
const spreadL = wordLayout(SPREAD);
const spreadCanvas = new Canvas();
const spreadStrokes = strokeBundle(spreadCanvas.getContext("2d"), {
  px: 512,
  ang: spreadL.ang,
  byHead: spreadL.byHead,
  tail: spreadL.tail,
  live: spreadL.live,
  colours: Array.from({ length: 26 }, (_, i) => `L${i}`),
  pull: 0.2,
  alpha: 0.11,
  lineWidth: 1,
});
check(
  spreadStrokes === wordChords(spreadL),
  `${spreadStrokes} strokes for ${wordChords(spreadL)} chords once the bands cut them up`,
);

const inks = spreadCanvas.inks;
const seen = new Map();
inks.forEach((ink, k) => {
  const held = seen.get(ink) ?? { first: k, last: k, n: 0 };
  held.last = k;
  held.n++;
  seen.set(ink, held);
});
/* Every wedge with a slice to put in each band reaches both ends of the stack.
   Before the bands the first letter drawn ended before the second began, so
   `last` for A was under its own count rather than near the top. */
for (const [ink, held] of seen) {
  if (held.n < BANDS) continue;
  check(
    held.first < inks.length * 0.1 && held.last > inks.length * 0.9,
    `${ink} runs from ${held.first} to ${held.last} of ${inks.length}, so it is not spread through the stack`,
  );
}
check(seen.size > 1, `the spread set drew in ${seen.size} colours, so there is no order to check`);
/* And the bands run both ways. Spreading the slices is not enough on its own:
   drawn in the same order in every band, a letter is still under its neighbour
   at every crossing. So a pair has to appear in both orders — which rotating
   the order within a band does not give, since that keeps the cycle and only
   moves where it starts. */
const pairs = new Set();
for (let k = 1; k < inks.length; k++)
  if (inks[k] !== inks[k - 1]) pairs.add(`${inks[k - 1]}>${inks[k]}`);
check(
  [...pairs].some(p => pairs.has(p.split(">").reverse().join(">"))),
  "no two letters were drawn in both orders, so one is under the other at every crossing",
);
/* And the batching survived it: the colour is what canvas has to parse, so a
   band-by-band interleave has to stay far short of a change per stroke. */
let changes = 0;
for (let k = 1; k < inks.length; k++) if (inks[k] !== inks[k - 1]) changes++;
check(
  changes <= BANDS * 26 && changes < inks.length / 4,
  `${changes} colour changes over ${inks.length} strokes, against a ceiling of ${BANDS * 26}`,
);

/* And <word-disc> itself, driven. Every check above this runs a module the
   element calls; none of them constructs it, and a class body is where the
   things that only fail on construction live — a field initialiser naming a
   constant a refactor moved away parses, imports, and then throws the first
   time a page puts the tag on screen. That has happened, to this element, and
   nothing short of building one catches it.

   So the stub DOM at the top of this file is driven: data in, a pointer moved
   over a word's own screen point, a click there, and the chain read back.
   The points are computed from word-layout.js rather than guessed, which is
   what makes a hit a statement about where the element puts a word. */
const WordDisc = REGISTRY.get("word-disc");
check(WordDisc !== undefined, "word-disc never reached the registry");

const fire = (el, type, ev) => {
  for (const fn of el._on.get(type) ?? []) fn(ev);
};

// The tally is shared, and the bundle above drew into it. Zeroed here so the
// counts below are the element's own.
for (const k of Object.keys(drew)) drew[k] = 0;

const disc = new WordDisc();
disc.connectedCallback();
// Landscape and fitted, which is the only shape that has a column beside the
// disc, so the moves list below is built rather than skipped. The stage's own
// box is untouched, so every measurement above still holds.
disc.setAttribute("fit", "");
disc._shadow.querySelector(".frame")._rect = { width: BOX + 300, height: BOX };
disc.data = { category: "test", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };

const shadow = disc._shadow;
const over = shadow.querySelector(".over");
const gloss = shadow.querySelector(".gloss");
const line = shadow.querySelector(".crumb").querySelector(".head");
const moves = shadow.querySelector(".moves");
const list = moves.querySelector(".list");
const why = () => [...moves.querySelector(".why").children].map(c => c.textContent).join("");

check(disc.words.join("|") === WORDS.join("|"), `the element drew ${disc.words}`);
/* No attribute is every word the category has, not a cut at some count of
   them: `build` draws 110 and the element does not, because the SVG can grow
   its canvas and shrink its type where the element has only the frame it was
   given. */
check(!disc.hasAttribute("limit"), "the driven element was given a limit");

check(disc.stats.bundle, "8 words did not get a resting bundle");
/* There is no Worker here, so what is driven below is the fallback — the same
   word-bundle.js the worker runs, against a canvas of this document's, which
   is what stops the two drifting. */
check(disc.stats.thread === "main", `the stub found a ${disc.stats.thread} to build on`);
check(drew.image === 1, `the bundle was blitted ${drew.image} times, not once`);
check(drew.curve === wordChords(L), `${drew.curve} curves for ${wordChords(L)} chords`);
check(drew.fillText > WORDS.length, "fewer labels were drawn than there are words");
/* The font swap, here rather than at the top of this block because it is a
   whole extra draw and the three counts above describe one. Nothing has
   awaited until now, so the callback connectedCallback queued on the stub's
   resolved document.fonts.ready has been sitting in the microtask queue since;
   this is where it runs. Asserting the blit is what says it ran at all — a
   callback that silently did nothing would leave every fit measured against
   the fallback, which is the fault this exists to catch, and it would pass. */
const blits = drew.image;
await document.fonts.ready;
check(drew.image === blits + 1, `the font swap redrew ${drew.image - blits} times, not once`);
/* Nothing is painted behind the hub's name. A panel wide enough to hold it
   covered the middle of the disc, which is where the long chords cross and so
   is the part of the figure worth seeing; the name carries its own ground
   instead, laid under the fill. With the pointer off the disc and no chain
   there is no highlighted path either, so the overlay owes an arc to nothing
   at all — that count is what says the panel has gone. */
over.drew.arc = 0;
over.drew.strokeText = 0;
over.drew.fillText = 0;
over.text = { fill: [], stroke: [] };
disc.repaint();
check(over.drew.arc === 0, `the hub drew ${over.drew.arc} arcs behind its name`);
/* The ground the stub resolves the hub's halo to, everything else being ink,
   muted or the warning colour. */
const GROUND = "#0c1112";
const inked = () => over.text.fill.filter(t => t.c !== GROUND);
const ringed = () => over.text.fill.filter(t => t.c === GROUND);
check(ringed().length > 0, "the hub's name carries no halo, so the bundle runs through it");
/* And the halo is copies of the letters rather than a stroke under them. A
   stroke is centred on the glyph outline, which centres it in the geometry
   and not in what is drawn: a stroke comes off the outline where a fill is a
   rasterised glyph, so the halo could read as a shadow lying off to one side.
   Copies of the same call cannot, and this is what says they are copies —
   one text, one radius, and offsets that sum to nothing, so the ring's centre
   is the point the letters themselves go down at. */
check(over.drew.strokeText === 0, `the hub stroked text ${over.drew.strokeText} times`);
const letters = inked();
check(
  letters.length === 1 && letters[0].t === "test",
  `the hub drew ${JSON.stringify(letters.map(t => t.t))} in ink`,
);
const halo = ringed();
check(
  halo.length >= 8 && halo.every(h => h.t === letters[0]?.t),
  `the halo is ${halo.length} copies of ${JSON.stringify([...new Set(halo.map(h => h.t))])}`,
);
const radii = halo.map(h => Math.hypot(h.x - letters[0].x, h.y - letters[0].y));
check(
  radii[0] > 0 && Math.max(...radii) - Math.min(...radii) < 1e-9,
  `the halo runs from ${Math.min(...radii).toFixed(3)} to ${Math.max(...radii).toFixed(3)} out`,
);
const haloMid = k => halo.reduce((s, h) => s + h[k], 0) / halo.length;
check(
  Math.abs(haloMid("x") - letters[0].x) < 1e-9 && Math.abs(haloMid("y") - letters[0].y) < 1e-9,
  `the halo centres on ${haloMid("x").toFixed(3)},${haloMid("y").toFixed(3)} against letters at ${letters[0].x.toFixed(3)},${letters[0].y.toFixed(3)}`,
);
// And the ink goes down last, so no copy lands on the letters it is under.
check(over.text.fill.at(-1).c !== GROUND, "the halo was drawn over the letters");
/* And the block is centred on the face rather than on the em square, whose
   descender space is empty for most words and put the type a pixel or two
   low, and rather than on the word's own ink, which moved the name up and
   down as the pointer crossed the disc: "iris" stops at the dot and "guppy"
   runs below the baseline, so centring each word's ink gave each word its own
   baseline. */
// Nothing hovered and no chain, so the hub names the category on one line
// and draws no way back under it — which `letters` above has already counted.
const size = +/([\d.]+)px/.exec(over._g.font)[1];
// The band the hub measures off the face, which the stub reports for the
// reference string and for any name holding a capital or an ascender.
const band = 0.72 * size;
const centre = letters[0].y - band / 2;
check(
  Math.abs(centre - BOX / 2) < 0.01,
  `the name sits on a band centred at ${centre.toFixed(2)}, not on the hub at ${BOX / 2}`,
);

/* One baseline for every name in a face, whatever ink the letters have. Three
   shapes: a dot and no descender, a descender and no ascender, and neither. */
const baselines = new Map();
for (const name of ["iris", "guppy", "cow", "test"]) {
  over.text.fill.length = 0;
  disc.data = { category: name, words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };
  // The ink alone: the halo under it is the same string at eight offsets.
  const drawn = over.text.fill.filter(t => t.t === name && t.c !== GROUND);
  check(drawn.length === 1, `the hub drew ${name} ${drawn.length} times in ink`);
  if (drawn.length === 1) baselines.set(name, drawn[0].y);
}
check(
  new Set(baselines.values()).size === 1,
  `the name moved with its letters: ${[...baselines].map(([n, y]) => `${n} at ${y.toFixed(2)}`).join(", ")}`,
);
// Back to the category the checks below read.
disc.data = { category: "test", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };

/* Where the element puts word i, off the sizing it solved for this square.
   Computed rather than written down, so a hit is a statement about the
   element agreeing with word-layout.js and not about either being right. */
const geo = solve(L.span, Math.max(...WORDS.map(w => w.length)) * PX, BOX);
const spot = w => {
  const i = WORDS.indexOf(w);
  return {
    offsetX: BOX / 2 + Math.cos(L.ang[i]) * geo.r,
    offsetY: BOX / 2 - Math.sin(L.ang[i]) * geo.r,
  };
};

/* The bundle's square, put back on that ring. RING is the fraction of the
   square the ring sits at and the blit inverts it, so a factor wrong in either
   draws the whole picture at the wrong scale — which no count of strokes or
   blits would notice. */
const blit = shadow.querySelector(".base").images[0];
check(blit?.length === 4, `the bundle was blitted with ${blit?.length ?? 0} placing arguments`);
check(
  Math.abs(blit[2] * RING - geo.r) < 0.01 && Math.abs(blit[3] * RING - geo.r) < 0.01,
  `the blitted square holds a ring of ${(blit[2] * RING).toFixed(1)} against the disc's ${geo.r.toFixed(1)}`,
);
check(
  Math.abs(blit[0] + blit[2] / 2 - BOX / 2) < 0.01 &&
    Math.abs(blit[1] + blit[3] / 2 - BOX / 2) < 0.01,
  "the bundle was blitted off the centre the dots are placed around",
);
/* And drawn at the resolution it is shown at, since a square short of the ring
   is blitted up and reads as a blurred picture that nothing else would catch.
   DPR is 2 here, so the ring wants twice its radius in the square. */
check(
  disc.stats.bundlePx * RING >= geo.r * 2,
  `the bundle is held at ${disc.stats.bundlePx} square for a ring wanting ${(geo.r * 2) / RING}`,
);
// A browser sends the move before the click, and the readout follows the
// pointer, so a click with no move under it would be testing a state no user
// can reach.
const point = w => {
  fire(over, "pointermove", spot(w));
  fire(over, "click", spot(w));
};

fire(over, "pointermove", spot("cat"));
check(disc.stats.chain === 0, "a pointer move played a word");
point("cat");
check(disc.chain.join("|") === "cat", `clicking cat gave ${disc.chain}`);
/* The pointer is still on the word the click just played, and that word is now
   used — but it is where play is standing, not a move going begging, so the
   readout has to leave it alone and count what can follow it. */
check(
  !gloss.innerHTML.includes("already played") && !gloss.innerHTML.includes("not a move"),
  `the word just played read as ${gloss.innerHTML}`,
);
check(
  gloss.innerHTML.includes("4 possible next words"),
  `cat did not count its four replies: ${gloss.innerHTML}`,
);
/* The letter that decides the next move is the word's own last one, so it is
   marked where it sits rather than named again after the word. */
check(
  gloss.innerHTML.includes('<b>ca<span class="last">t</span></b>'),
  `cat's last letter is not marked in place: ${gloss.innerHTML}`,
);
check(
  !gloss.innerHTML.includes("hands over"),
  `the readout still names the letter twice: ${gloss.innerHTML}`,
);

/* An illegal word is inert: rat does not follow cat, and clicking it neither
   plays nor clears what is there. */
point("rat");
check(disc.chain.join("|") === "cat", `clicking an illegal word gave ${disc.chain}`);
point("toad");
check(disc.chain.join("|") === "cat|toad", `toad did not follow cat: ${disc.chain}`);

/* The hub is the way back, which is the one thing clicking a word cannot do. */
fire(over, "click", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(disc.chain.join("|") === "cat", `the hub did not undo: ${disc.chain}`);

/* A repeat is refused at the click, and refused without disturbing what is
   there: the fourth click below lands on a word already in the chain. */
disc.clear();
for (const w of ["cat", "tiger", "rat", "tiger"]) point(w);
check(disc.chain.join("|") === "cat|tiger|rat", `the cycle gave ${disc.chain}`);
check(
  gloss.innerHTML.includes("already played"),
  `the pointer on a used word read as ${gloss.innerHTML}`,
);
check(!line.innerHTML.includes("warn"), "a step in the chain line was marked a repeat");

/* The moves column: every word that could be played next, in the room the
   search box leaves empty. `byHead` holds a wedge commonest first, so the list
   comes out in the order the disc drew it and no sort is needed. */
const listed = () => [...list.children].map(li => li.textContent);
disc.clear();
check(
  listed().join("|") === [...WORDS].sort().join("|"),
  `before the first move the column is not the category, in order: ${listed()}`,
);
check(why().includes("any one opens"), `an empty chain read as ${why()}`);

point("cat");
check(listed().join("|") === "tiger|toad|trout|tuna", `after cat the column held ${listed()}`);
check(why() === "must start with T", `after cat the column said ${why()}`);
/* A word already played is not a move, so it leaves the column when it is
   played and comes back when play is wound off it. */
point("tiger");
check(!listed().includes("tiger"), `a played word stayed in the column: ${listed()}`);
check(listed().join("|") === "rat", `after tiger the column held ${listed()}`);
point("rat");
check(listed().join("|") === "toad|trout|tuna", `after rat the column held ${listed()}`);
disc.rewind(1);
check(listed().includes("tiger"), `winding back did not put tiger back: ${listed()}`);

/* Hovering a row is hovering its dot, and the seam between two rows is not a
   place the hover ends. A pointer travelling down the column passes over the
   list and over no row — the list's padding, the slack at the end of a line, a
   hairline between two rows abutting at a fractional width — and clearing
   there blinked the highlight off and on again between every pair. Only
   leaving the list clears it. No CSS is needed to say so: the seam is a
   pointermove whose target is the list rather than a row, which is exactly
   what the browser sends. */
disc.clear();
point("cat");
const onToad = '<b>toa<span class="last">d</span></b>';
const row = list.children.find(li => li.textContent === "toad");
fire(list, "pointermove", { target: row });
check(gloss.innerHTML.includes(onToad), `hovering a row read as ${gloss.innerHTML}`);
fire(list, "pointermove", { target: list });
check(
  gloss.innerHTML.includes(onToad),
  `the seam between two rows dropped the hover: ${gloss.innerHTML}`,
);
fire(list, "pointerleave", {});
check(!gloss.innerHTML.includes(onToad), `leaving the list kept the hover: ${gloss.innerHTML}`);

/* A wedge run dry says so rather than emptying without a word. */
disc.clear();
point("emu");
check(listed().length === 0, `a dead end listed ${listed()}`);
check(why().includes("nothing left starting with U"), `a dead end read as ${why()}`);

/* The suggestions and the moves want the same column, so the box owning
   something takes it. */
disc.clear();
disc._shadow.querySelector(".q").value = "ca";
fire(shadow.querySelector(".q"), "input", {});
check(moves.hidden === true, "the moves column stayed under the suggestions");
fire(shadow.querySelector(".q"), "keydown", { key: "Escape", preventDefault() {} });
fire(shadow.querySelector(".q"), "keydown", { key: "Escape", preventDefault() {} });
check(moves.hidden === false, "the moves column did not come back");

/* The crumb path's root, which is the only way back to a different first word:
   a one-step chain renders its one step as the name you are at rather than as
   a button, so without a root there is nothing before it to click. The markup
   is asserted rather than the click, since the line is written as a string and
   the stub has no parser to make an element of it. */
disc.clear();
const chevrons = () => (line.innerHTML.match(/<i>/g) ?? []).length;
check(
  line.innerHTML.includes('class="root"') && !line.innerHTML.includes("<button"),
  `an empty chain offered a way back: ${line.innerHTML}`,
);
point("cat");
check(
  line.innerHTML.includes('class="root" data-k="-1"') && line.innerHTML.includes("test"),
  `a one-step chain has no root to wind back to: ${line.innerHTML}`,
);
/* The label is not a step, and the chevrons are what say so: they separate one
   word from the next and never the label from the first word, which the rule
   beside it separates instead. One word takes none, two take one. */
check(chevrons() === 0, `the label was separated like a step: ${line.innerHTML}`);
point("toad");
check(disc.chain.join("|") === "cat|toad", `expected cat|toad, got ${disc.chain}`);
check(chevrons() === 1, `two words took ${chevrons()} chevrons, not one`);
check(
  line.innerHTML.indexOf('class="root"') < line.innerHTML.indexOf("<i>"),
  "the label is not before the path",
);
// The handler winds back to one past the step it names, so the root is -1.
disc.rewind(-1 + 1);
check(disc.chain.length === 0, "winding back to the root left a chain");

/* The end of the round is said rather than left to be inferred from an empty
   fan, and it now has two shapes that the readout has to tell apart: a letter
   the category never had a word for, and one whose words the chain has used
   up. Only the first is a fact about the category. */
disc.clear();
point("emu");
check(
  gloss.innerHTML.includes("nothing starts with U"),
  `emu, whose letter nothing starts with, read as ${gloss.innerHTML}`,
);
check(disc.stats.chain === 1, "the dead end was not played");

// Each of these is the other's only reply, so the second move spends the wedge
// rather than finding it empty.
disc.data = { category: "pair", words: ["ab", "ba"], zipf: [2, 1] };
disc.play(0);
check(gloss.innerHTML.includes("1 possible next word"), `ab read as ${gloss.innerHTML}`);
disc.play(1);
check(gloss.innerHTML.includes("every A word is used"), `a spent wedge read as ${gloss.innerHTML}`);
check(!disc.play(0), "a word already used was played once its wedge ran dry");

/* limit 0 is every word rather than none, and a category that large keeps its
   bundle now that the bundle is built off the frame's size. The browser calls
   this on its own; here it is called by hand, which is the same entry point. */
disc.clear();
// Spread over the alphabet at both ends, since 900 words that all start with
// W and end with X have no chords between them at all and would leave the
// ceiling below untested.
const ABC = "abcdefghijklmnopqrstuvwxyz";
const CROWD = Array.from(
  { length: 900 },
  (_, i) => ABC[i % 26] + ABC[((i / 26) | 0) % 26] + ABC[((i / 676) | 0) % 26] + ABC[(i * 7) % 26],
);
disc.data = { category: "crowd", words: CROWD, zipf: CROWD.map((_, i) => -i) };
check(disc.stats.words === CROWD.length, `the default drew ${disc.stats.words} of ${CROWD.length}`);
/* Nothing is capped: a page goes into the DOM and the rest follow as the
   column is scrolled, so what is listed first is the head of the whole sorted
   list rather than a selection from it. */
check(
  list.children.length === 200,
  `900 words listed ${list.children.length}, not one page of them`,
);
check(
  [...list.children].map(li => li.textContent).join("|") ===
    [...CROWD].sort().slice(0, 200).join("|"),
  "the first page is not the head of the sorted list",
);
/* Scrolling to the foot brings the next page, and going on brings the rest of
   them: the list ends where the category does and not at a cap. */
const scroll = () => {
  list.scrollTop = list.scrollHeight;
  fire(list, "scroll", {});
};
scroll();
check(list.children.length === 400, `one scroll listed ${list.children.length}, not two pages`);
for (let k = 0; k < 10; k++) scroll();
check(
  list.children.length === CROWD.length,
  `scrolling reached ${list.children.length} of ${CROWD.length}`,
);
check(
  [...list.children].map(li => li.textContent).join("|") === [...CROWD].sort().join("|"),
  "the whole list is not the category in order",
);
/* A move set is never paged: the largest over the 37 categories is animal's
   187, after "mollusc", against a page of 200, so a wedge arrives whole. */
disc.play(0);
check(
  list.children.length > 0 && list.children.length < 200,
  `a move set came back as ${list.children.length} rows, so it was paged`,
);
disc.setAttribute("limit", "0");
check(disc.stats.words === CROWD.length, `limit 0 drew ${disc.stats.words} of ${CROWD.length}`);
/* The ceiling that used to sit at 24,000 and cost the seven largest categories
   their picture. animal holds 96,470 chords at no limit and the crowd below
   holds more than 24,000, so this is the case that lost the bundle before. */
check(
  disc.stats.chords > 24000 && disc.stats.bundle,
  `900 words hold ${disc.stats.chords} chords and the bundle is ${disc.stats.bundle}`,
);
check(disc.stats.labelPx === 0, `900 words in a ${BOX}px square kept their labels`);

/* A resize does not rebuild it. The bundle is held in a square of its own, so
   a new radius inside the same size step is a scaled blit and nothing else,
   which is the whole reason the ceiling could be lifted. A few pixels of stage
   cannot cross a step, since one is 256 device pixels of square. The element
   is resized through its own observer rather than a private method, and the
   wait is what the trailing timer holds a drag back by. */
await new Promise(r => setTimeout(r, 80));
drew.curve = 0;
drew.image = 0;
shadow.querySelector(".stage")._rect = { width: BOX - 4, height: BOX - 4 };
resize();
check(drew.curve === 0, `a resize restroked ${drew.curve} chords`);
check(drew.image > 0, "the bundle was not blitted after a resize");
check(disc.stats.bundle, "the bundle went out over a resize");

/* A browser zoom raises devicePixelRatio and leaves the CSS box alone, so the
   resize observer never fires and an element sized in pixels by its host would
   go on painting at the resolution before the zoom — a disc that blurs on cmd+
   and never recovers. The resolution query is what catches it, and the canvas
   has to come back larger for the box it already had. */
await new Promise(r => setTimeout(r, 80));
const wasWide = shadow.querySelector(".base").width;
zoom(4);
const nowWide = shadow.querySelector(".base").width;
check(
  nowWide === Math.round((BOX - 4) * ratio(4, BOX - 4, BOX - 4)),
  `a zoom to dpr 4 took the canvas from ${wasWide} to ${nowWide}`,
);
zoom(2);

disc.setAttribute("limit", "40");
check(disc.stats.words === 40, `limit 40 drew ${disc.stats.words}`);
check(disc.stats.bundle && disc.stats.labelPx > 0, "40 words lost the bundle or the labels");
disc.repaint();

/* The category picker, which index-src turns on and nothing else does. Its one
   piece of arithmetic is where a category's words are: export_words.py writes
   the 37 files flat beside their index and web-dist stages them that way, so
   the element takes the index's own path and swaps the last segment. Get that
   wrong and the element asks a directory nobody has, which a browser reports
   as a disc that never changes and nothing downstream can tell. */
const INDEX = [
  { name: "animal", words: WORDS.length },
  { name: "bird", words: 3 },
];
const BIRDS = ["emu", "urubu", "umbrellabird"];
const FILES = new Map([
  ["/out/words-index.json", INDEX],
  [
    "/out/words-animal.json",
    { category: "animal", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) },
  ],
  ["/out/words-bird.json", { category: "bird", words: BIRDS, zipf: [3, 2, 1] }],
]);
const fetched = [];
globalThis.fetch = async url => {
  fetched.push(url);
  if (!FILES.has(url)) throw new Error(`nothing at ${url}`);
  return { json: async () => FILES.get(url) };
};
const settle = () => new Promise(r => setTimeout(r, 0));

check(shadow.querySelector(".pick").hidden, "a disc given no index built a picker anyway");

/* An index is enough to open on. Named without a src it means the first
   category rather than a blank disc, which is the whole of what a host has to
   write to get a disc that can be steered. */
const picked = new WordDisc();
picked.setAttribute("index-src", "/out/words-index.json");
picked.connectedCallback();
await settle();
await settle();

const cat = picked._shadow.querySelector(".cat");
check(!picked._shadow.querySelector(".pick").hidden, "the index landed and the picker stayed off");
check(
  cat.children.map(o => o.value).join("|") === "animal|bird",
  `the picker offers ${cat.children.map(o => o.value)}`,
);
check(
  cat.children[0].textContent === `animal (${WORDS.length})`,
  `the picker labels animal as "${cat.children[0].textContent}", so the count is not on it`,
);
check(
  picked.getAttribute("src") === "/out/words-animal.json",
  `an index alone opened ${picked.getAttribute("src")}`,
);
check(picked.stats.category === "animal", `an index alone drew ${picked.stats.category}`);
check(cat.value === "animal", `the picker reads ${cat.value} for the words it opened on`);
check(
  fetched.filter(u => u.endsWith("words-index.json")).length === 1,
  "the index was fetched more than once",
);

/* Choosing a category is a load, and what comes back is a different disc: a
   chain over words that are no longer drawn has nothing to stand on. */
picked.play(0);
check(picked.chain.length === 1, "a word did not play on the disc the index opened");
cat.value = "bird";
fire(cat, "change");
await settle();
await settle();
check(
  picked.getAttribute("src") === "/out/words-bird.json",
  `the picker asked for ${picked.getAttribute("src")}, which is not beside its index`,
);
check(picked.stats.category === "bird", `the picker chose bird and drew ${picked.stats.category}`);
check(picked.words.join("|") === BIRDS.join("|"), `bird came back as ${picked.words}`);
check(picked.chain.length === 0, "the chain survived a change of category");

/* It follows a src the host set as well as its own change event, since the two
   are the same choice made from either end. */
picked.setAttribute("src", "/out/words-animal.json");
await settle();
check(cat.value === "animal", `a host-set src left the picker reading ${cat.value}`);

/* The stacked layout and back, the round trip all three elements make. The
   stage is observed because its box sizes the canvases and the frame because
   its shape decides the layout, and the two do not move together: stacked, the
   stage is a square of the height the flex column leaves, so a frame dragged
   wider leaves it exactly where it was and an element watching only the stage
   is never called back. It drops to the stacked layout when the page narrows
   and stays there however wide the page is dragged after. Dropping the frame
   from the observer fails the second half of this and not the first. */
const wFrame = shadow.querySelector(".frame");
const wStage = shadow.querySelector(".stage");
wFrame._rect = { width: BOX, height: BOX };
wStage._rect = { width: BOX, height: BOX };
resize();
check(list.children.length === 0, `${list.children.length} move rows survived stacking`);
wFrame._rect = { width: BOX + 300, height: BOX };
resize();
check(wFrame.classList.contains("wide"), "the word disc stayed stacked when the frame went wide");
check(list.children.length > 0, "the moves column did not come back when the frame went wide");

/* And <hypernym-disc> itself, built. Every check above it drives the pipeline
   the element calls rather than the element, which leaves its class body — the
   one place a field initialiser naming a constant a refactor moved parses,
   imports, and then throws the first time a page puts the tag on screen. That
   has happened to the other element, and nothing short of constructing one
   catches it.

   What is driven is the list of the ring below the root: the nodes a click on
   the disc would open, which is the one part of the element with no canvas in
   it at all. */
const HypernymDisc = REGISTRY.get("hypernym-disc");
check(HypernymDisc !== undefined, "hypernym-disc never reached the registry");

/* A root with three children, the middle one a branch. Named so the order the
   disc draws them in is not the order they sort in: alphabetical would read
   apple, moss, zebra, which is what <word-disc> does to its moves and what
   this list must not do, since a list ordered differently from the disc cannot
   be read against it. */
const TREE = [-1, 0, 0, 0, 2, 2];
const TREE_NAMES = ["thing", "zebra", "moss", "apple", "moss cap", "moss stem"];

const nest = new HypernymDisc();
nest.connectedCallback();
// Landscape and fitted, the only shape with a column beside the disc.
nest.setAttribute("fit", "");
nest._shadow.querySelector(".frame")._rect = { width: BOX + 300, height: BOX };
nest.data = { par: TREE, names: TREE_NAMES };

const ring = nest._shadow.querySelector(".kids");
const kidRows = ring.querySelector(".list");
const kidNames = () => kidRows.children.map(li => li.children[0].textContent).join("|");
const kidMarks = () => kidRows.children.map(li => li.className).join("|");
// A branch prints what it weighs and a leaf prints nothing, so the second span
// is there or it is not.
const kidWeights = () => kidRows.children.map(li => li.children[1]?.textContent ?? "").join("|");
const kidWhy = () =>
  ring
    .querySelector(".why")
    .children.map(c => c.textContent)
    .join("");

check(kidNames() === "zebra|moss|apple", `the ring below the root reads ${kidNames()}`);
/* A leaf is a dead end and a branch is a way further in, and the list says
   which is which before the click, as the disc's own cursor does. */
check(kidMarks() === "leaf||leaf", `the rows are marked ${kidMarks()}`);
check(kidWhy() === "3 below · 1 opens further", `the list is headed "${kidWhy()}"`);
/* What a branch weighs: the leaves under it against every leaf in the ring,
   which is the same fraction as the share of the turn its wedge takes. moss
   holds two of the root's four leaves. */
check(kidWeights() === "|50%|", `the rows weigh ${kidWeights()}`);

/* Clicking a row is clicking its wedge. */
fire(kidRows, "click", { target: kidRows.children[1] });
check(nest.index === 2, `a branch row left the root at ${nest.index}`);
check(kidNames() === "moss cap|moss stem", `moss opened onto ${kidNames()}`);
check(kidMarks() === "leaf|leaf", `moss's children are marked ${kidMarks()}`);
check(kidWhy() === "2 below · 0 open further", `a ring of leaves is headed "${kidWhy()}"`);
check(kidWeights() === "|", `a ring of leaves weighs ${kidWeights()}`);

/* A leaf is not one. Clicking a leaf already on screen holds the highlight
   where a branch opens a disc, and going to its parent — which is where the
   disc already is — would rebuild the list under the click that came out of
   it and throw the scroll back to the top. */
const held = kidRows.children[0];
fire(kidRows, "click", { target: kidRows.children[0] });
check(nest.index === 2, `a leaf row moved the root to ${nest.index}`);
// The rows are the same objects, which is the only way to say from here that
// nothing was rebuilt rather than rebuilt to the same names.
check(kidRows.children[0] === held, "a leaf click rebuilt the list under itself");

/* Three digits at most, over a ring whose shares span three orders of
   magnitude: a root of 10,000 leaves under four branches holding 996, 990, 9
   and 8,005 of them. Rounded whole above 9.95%, one decimal down to 0.095%,
   and everything below that a floor rather than a row of zeroes. Inverting the
   ratio, or dividing by the row count rather than the leaf count, fails every
   one of them. */
const SHARES = [996, 990, 9, 8005];
const TIERS = [-1];
for (let b = 0; b < SHARES.length; b++) TIERS.push(0);
SHARES.forEach((n, b) => {
  for (let k = 0; k < n; k++) TIERS.push(1 + b);
});
nest.data = { par: TIERS, names: ["all", "a", "b", "c", "d"] };
check(kidNames() === "a|b|c|d", `the wide ring reads ${kidNames()}`);
check(kidWeights() === "10%|9.9%|<0.1%|80%", `the wide ring weighs ${kidWeights()}`);

/* The suggestions and the ring below want the same room, and only one of them
   is being asked for at a time. */
const nestQ = nest._shadow.querySelector(".q");
nestQ.value = "a";
fire(nestQ, "input", {});
check(ring.hidden, "a query left the ring below drawn under the suggestions");
fire(nestQ, "blur", {});
check(!ring.hidden, "the ring below did not come back when the search closed");

/* Stacked there is no column, so the rows are dropped rather than left behind
   display:none — 661 of them at WordNet's widest node. */
const nFrame = nest._shadow.querySelector(".frame");
const nStage = nest._shadow.querySelector(".stage");
nFrame._rect = { width: BOX, height: BOX };
nStage._rect = { width: BOX, height: BOX };
resize();
check(kidRows.children.length === 0, `${kidRows.children.length} rows survived stacking`);

/* And back out of it, which is the half a page dragged wider has to do. See
   the same pair on <letter-disc> below for why the stage's box does not move
   on the way back and why observing it alone leaves an element stacked for
   good. All three elements make this round trip and all three had the fault. */
nFrame._rect = { width: BOX + 300, height: BOX };
resize();
check(nFrame.classList.contains("wide"), "the nested disc stayed stacked when the frame went wide");
check(kidRows.children.length > 0, "the ring below did not come back when the frame went wide");

/* The letter graph, which is graph.py's claim drawn rather than printed: 26
   nodes, one arc per letter pair some word bridges, and nothing bundled.
   Measured over the 37 categories animal is the worst at 344 populated pairs,
   with weights from 1 to 32 and 103 of the 344 at weight 1 — which is why the
   width is a log and why every arc stays a thing to point at rather than being
   merged into a neighbour. */
const {
  ALPHA,
  at: slotAt,
  fade,
  GAP: LGAP,
  layout: letterLayout,
  letterAt,
  matrix,
  near,
  pull: lpull,
  solve: lsolve,
  TAPER,
  weight,
} = await import(mod("letter-graph.js"));

/* Nine words over six letters, with two loops in them and with the weight
   order and the alphabetical order deliberately apart: C leaves twice and N
   arrives three times, so a list or a ring that came back alphabetical would
   be saying something the picture does not. */
const LWORDS = ["cat", "cot", "tan", "tin", "toad", "dog", "area", "aorta", "nan"];
const LM = matrix(LWORDS);
check(LM.n === 9, `the matrix counted ${LM.n} words, not 9`);
check(LM.pairs === 6, `${LWORDS.length} words made ${LM.pairs} arcs, not 6`);
check(LM.loops === 2, `${LM.loops} arcs came back to their own letter, not 2`);
check(LM.starts[2] === 2 && LM.ends[19] === 2, "C does not leave twice or T does not arrive twice");
/* A word outside a to z is no edge of this graph, since the ring is 26
   letters. Nothing the exporter writes reaches this; a host building its own
   list does. */
check(matrix(["cat", "", "3d", "x-ray"]).n === 2, "a word outside a to z became an edge");

const LL = letterLayout(LM);
check(LL.live.length === 6, `${LL.live.length} letters carry traffic, not 6`);
check(LL.edges.length === 6 && LL.order.length === 6, "the layout lost an arc");

/* The one property proportional node arcs exist to buy, and the reason there
   is no floor under one: a unit of weight is the same number of degrees
   everywhere on the ring, so a ribbon is the same width at both of its ends
   and its width means one thing wherever it is read. Equal arcs would make a
   quiet letter's ends fat and a busy letter's thin, and every ribbon between
   the two a trapezoid claiming two different counts — which nothing
   downstream could tell. Adding a floor back fails this. */
const perW = [];
for (const e of LL.edges) {
  perW.push((e.a0 - e.a1) / e.w, (e.b0 - e.b1) / e.w);
}
check(
  Math.max(...perW) - Math.min(...perW) < 1e-9,
  `a unit of weight is worth ${Math.min(...perW)} to ${Math.max(...perW)} radians round the ring`,
);
/* And the width is the log of the count rather than the count, which is what
   keeps the 103 arcs of weight 1 visible against a trunk of 32. Linear would
   put them at a thirtieth. */
check(
  Math.abs((LL.edges[0].a0 - LL.edges[0].a1) / weight(LL.edges[0].n) - perW[0]) < 1e-9,
  "an arc's width is not its log weight",
);
check(weight(32) / weight(1) < 6 && 32 / 1 > 6, "log weighting did not compress the range");

/* Every letter's arc is tiled exactly by its own ends, leaving from the first
   half and arriving in the second, and the ring is tiled by the arcs and the
   gaps. A slot that overran its arc would draw a ribbon landing on the wrong
   letter. */
const TAU_ = Math.PI * 2;
let turned = LGAP * LL.live.length;
for (const arc of LL.arcs) {
  turned += arc.span;
  let out = 0,
    into = 0;
  for (const k of LL.out[arc.letter]) out += LL.edges[k].a0 - LL.edges[k].a1;
  for (const k of LL.into[arc.letter]) into += LL.edges[k].b0 - LL.edges[k].b1;
  check(
    Math.abs(out - (arc.from - arc.split)) < 1e-9,
    `${String.fromCharCode(65 + arc.letter)}'s leaving ends do not tile its leaving half`,
  );
  check(
    Math.abs(into - (arc.split - arc.to)) < 1e-9,
    `${String.fromCharCode(65 + arc.letter)}'s arriving ends do not tile its arriving half`,
  );
  check(arc.split <= arc.from + 1e-9 && arc.split >= arc.to - 1e-9, "a split fell outside its arc");
}
check(Math.abs(turned - TAU_) < 1e-9, `the arcs and the gaps come to ${turned} rather than a turn`);

/* The shapes a real category can put through this, each of which lands the
   split at an end of its arc or leaves the ring with almost nothing on it. A
   letter nothing starts with has no leaving half at all and its whole arc is
   the arriving one; a category of one loop is a single letter joined to
   itself. What is owed in every case is ends of some width, finite angles, a
   split inside its own arc, and a hit test that still round-trips. */
for (const [what, words] of [
  ["nothing at all", []],
  ["one word", ["cat"]],
  ["one loop", ["area"]],
  ["a letter nothing starts with", ["dog", "dig", "cog"]],
  ["a letter nothing ends with", ["cat", "cot", "tic"]],
  ["one letter throughout", ["aa", "aaa"]],
]) {
  const E = letterLayout(matrix(words));
  for (const e of E.edges) {
    check(e.a0 > e.a1 && e.b0 > e.b1, `${what} gave an arc an end of no width`);
    check(Number.isFinite(e.a0 + e.a1 + e.b0 + e.b1), `${what} gave an arc a non-finite angle`);
  }
  for (const arc of E.arcs) {
    check(
      Number.isFinite(arc.span) && arc.split <= arc.from + 1e-9 && arc.split >= arc.to - 1e-9,
      `${what} put a split outside its own arc`,
    );
  }
  for (let k = 1; k < E.turn.length; k++) {
    check(E.turn[k] > E.turn[k - 1], `${what} left the ends out of order`);
  }
  for (let k = 0; k < E.turn.length; k++) {
    check(slotAt(E, (E.turn[k] + E.upto[k]) / 2) === k, `${what} lost an end to the hit test`);
  }
}

/* The hit test: one binary search over ends laid out clockwise from the top,
   which is only sound if they never go backwards. */
let climbs = true;
for (let k = 1; k < LL.turn.length; k++) if (LL.turn[k] <= LL.turn[k - 1]) climbs = false;
check(climbs, "the ends are not strictly increasing, so the binary search is unsound");
check(LL.turn.length === LL.edges.length * 2, `${LL.turn.length} ends for ${LL.edges.length} arcs`);
for (let k = 0; k < LL.turn.length; k++) {
  const mid = (LL.turn[k] + LL.upto[k]) / 2;
  check(slotAt(LL, mid) === k, `the middle of end ${k} hit ${slotAt(LL, mid)}`);
  // Both edges of a slot, since the search lands below the query and the slot
  // above it may be the nearer one.
  check(slotAt(LL, LL.turn[k] + 1e-9) === k, `the leading edge of end ${k} missed`);
  check(slotAt(LL, LL.upto[k] - 1e-9) === k, `the trailing edge of end ${k} missed`);
}
/* The gap between two letters belongs to nobody, and so does the band before
   the top of the ring. */
const firstArc = LL.arcs[0];
// Turns run clockwise from the top, so the gap after an arc is past its far
// edge rather than short of it.
const inGap = Math.PI / 2 - firstArc.to + LGAP / 2;
check(slotAt(LL, inGap) === -1, "the gap between two letters answered with an arc");
check(letterAt(LL, 1e-9) === firstArc.letter, "the top of the ring is not the first letter");
check(letterAt(LL, inGap) === -1, "the gap between two letters answered with a letter");

/* The prune in front of the interior hit test, which is what stops a pointer
   inside the ring asking the path about all 344 arcs. It is a prune rather
   than an answer, so what it owes is that it never refuses a point that is
   actually on a ribbon — the claim disc-search.js's character mask is held to,
   and checked the same way, by walking the thing itself rather than arguing
   about it.

   The walk is each ribbon's own boundary: its two runs along the ring and the
   two cubics between them, rebuilt here from letter-graph.js's own control
   points so the sample is of the shape that is drawn. Widening `near`'s wedge
   is inert; narrowing it fails. */
{
  const R = 320,
    C = 0;
  const at = (ang, r = R) => [C + Math.cos(ang) * r, C - Math.sin(ang) * r];
  const turnOf = ([x, y]) => (((Math.PI / 2 - Math.atan2(-(y - C), x - C)) % TAU_) + TAU_) % TAU_;
  const cubic = (p0, p1, p) => {
    const c0 = [C + (p0[0] - C) * p, C + (p0[1] - C) * p];
    const c1 = [C + (p1[0] - C) * p, C + (p1[1] - C) * p];
    const out = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24,
        u = 1 - t;
      out.push([
        u ** 3 * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t ** 3 * p1[0],
        u ** 3 * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t ** 3 * p1[1],
      ]);
    }
    return out;
  };
  /* Over the six-letter set above and over one whose arcs straddle the top of
     the ring. That second one is not decoration: a wedge is found as the
     complement of the largest gap between an arc's four turns, which is the
     only way to find it when the arc runs from the first letter to the last
     and its wedge wraps through turn zero. On a set where nothing wraps, the
     span from the lowest turn to the highest happens to be the same answer and
     a broken search for that gap is inert. Two of these eight arcs wrap. */
  const WRAP = ["af", "ef", "ab", "bc", "cd", "de", "fa", "fb"];
  const WL = letterLayout(matrix(WRAP));
  check(
    WL.edges.filter(e => !e.wide && e.t0 > e.t1).length === 2,
    "the wrapping set no longer has an arc whose wedge straddles the top",
  );
  let walked = 0,
    pruned = 0;
  for (const e of [...LL.edges, ...WL.edges]) {
    const bm = (e.b0 + e.b1) / 2,
      bh = ((e.b0 - e.b1) / 2) * TAPER;
    const t0 = bm + bh,
      t1 = bm - bh;
    const p = lpull(e.a1 - t0);
    const on = [];
    for (let i = 0; i <= 24; i++) {
      on.push(at(e.a0 + ((e.a1 - e.a0) * i) / 24), at(t0 + ((t1 - t0) * i) / 24));
    }
    on.push(...cubic(at(e.a1), at(t0), p), ...cubic(at(t1), at(e.a0), p));
    for (const pt of on) {
      walked++;
      check(near(e, turnOf(pt)), `the prune refused a point on the arc it belongs to`);
    }
    if (!e.wide) pruned++;
  }
  check(walked > 500, `only ${walked} points of ribbon boundary were walked`);
  // And it has to prune something, or it is two comparisons buying nothing.
  check(pruned > 0, "every arc was marked wide, so the prune refuses nothing");
}

/* The pull runs with the turn an arc covers, which is what makes a loop a loop
   rather than a spike at the centre. A third of the arcs are short — 31% of
   animal's 344 cover less than a third of the turn, and 12 of them run a
   letter back to itself — so a fixed pull, which is what <word-disc> uses
   where the chords worth seeing are long, would draw all of them pointing
   inward. */
check(lpull(0) > lpull(Math.PI / 2), "a loop does not hug the ring more than a quarter turn");
check(lpull(Math.PI / 2) > lpull(Math.PI), "a quarter turn does not hug more than a half");
check(
  lpull(Math.PI) > 0 && lpull(0) < 1,
  `the pull left the range at ${lpull(0)}, ${lpull(Math.PI)}`,
);
check(TAPER > 0 && TAPER < 1, `the taper is ${TAPER}, which is no taper or an inverted one`);

/* The fill thinned by what the ring holds, the shape rather than the numbers:
   a ribbon is filled, so the alpha accumulates wherever two overlap and the
   middle is where they all do. animal draws 344 arcs into the ring colour
   draws 67 into. An alpha below a hundredth is a picture that is drawn and
   cannot be seen. */
check(fade(ALPHA, 67) === ALPHA, "a sparse category was thinned");
check(fade(ALPHA, 120) === ALPHA, "the knee itself was thinned");
check(fade(ALPHA, 344) < fade(ALPHA, 200), "animal is not thinner than a middling category");
check(fade(ALPHA, 344) > 0.01, `animal fills at ${fade(ALPHA, 344)}, which cannot be seen`);

/* The sizing. Simpler than <word-disc>'s, since the labels are 26 single
   letters rather than a category's words, but it owes the same two things:
   a disc that stays inside its own square and one that comes back positive at
   any size at all. */
for (const size of [12, 40, 120, 300, 720, 2000]) {
  const got = lsolve(size);
  check(got.r > 0, `a ${size}px frame solved to a radius of ${got.r}`);
  check(got.hub < got.r, `a ${size}px frame put the hub outside the ring`);
  check(got.band > 0, `a ${size}px frame gave the ring no band`);
  check(
    got.outer <= size / 2 + 1e-9,
    `a ${size}px frame put the disc ${got.outer - size / 2}px outside its own square`,
  );
}
/* Past the floor the letters go rather than smearing, and the ring takes their
   room — which is the trade <word-disc> makes at its own label floor, with the
   hub naming what the pointer is on instead. */
check(lsolve(70).labelPx === 0, `a 70px frame kept ${lsolve(70).labelPx}px letters`);
check(lsolve(80).labelPx > 0, "an 80px frame dropped its letters");
/* Either side of the floor, which is the only place the two can be compared:
   a frame 10px smaller that drops its letters has the bigger ring of the two,
   because their room goes to it. */
check(
  lsolve(70).r > lsolve(80).r,
  `dropping the letters left the ring at ${lsolve(70).r} against ${lsolve(80).r} with them`,
);

/* And <letter-disc> itself, driven. The two blocks above run the geometry the
   element calls rather than the element, which leaves its class body — the one
   place a field initialiser naming a constant a refactor moved parses, imports
   and then throws the first time a page puts the tag on screen. That has
   happened to <word-disc>, and nothing short of constructing one catches it.

   The points a pointer is moved to are computed from letter-graph.js rather
   than guessed, which is what makes a hit a statement about the element
   agreeing with its own layout. */
const LetterDisc = REGISTRY.get("letter-disc");
check(LetterDisc !== undefined, "letter-disc never reached the registry");

const ld = new LetterDisc();
ld.connectedCallback();
// Landscape and fitted, the only shape with a column beside the disc, so the
// list below is built rather than skipped.
ld.setAttribute("fit", "");
ld._shadow.querySelector(".frame")._rect = { width: BOX + 300, height: BOX };
for (const k of Object.keys(drew)) drew[k] = 0;
ld.data = { category: "test", words: LWORDS };

const lShadow = ld._shadow;
const lBase = lShadow.querySelector(".base");
const lOver = lShadow.querySelector(".over");
const lGloss = lShadow.querySelector(".gloss");
const lCrumb = lShadow.querySelector(".crumb").querySelector(".head");
const lTail = lShadow.querySelector(".crumb").querySelector(".tail");
const arcsEl = lShadow.querySelector(".arcs");
const arcRows = arcsEl.querySelector(".list");
const arcWhy = () => [...arcsEl.querySelector(".why").children].map(c => c.textContent).join("");
const arcList = () =>
  arcRows.children.map(li => li.children.map(sp => sp.textContent ?? "").join("")).join("|");

check(ld.stats.pairs === 6 && ld.stats.loops === 2, `the element drew ${ld.stats.pairs} arcs`);
check(
  ld.stats.words === 9 && ld.stats.letters === 6,
  `the element counted ${ld.stats.words} words`,
);
/* One fill per arc on the base, in the colour of the letter the arc leaves —
   which is the only way from here to say the arcs were drawn at all, since
   nothing rasterises. */
check(lBase.drew.fill === 6, `the base filled ${lBase.drew.fill} shapes for 6 arcs`);
check(new Set(lBase.fills).size > 1, "every arc was filled in the same colour");
/* Light before heavy, so the trunks read over the hairlines rather than the
   back of the alphabet reading over the front. It is the ranking that
   word-bundle.js has to cut into 64 bands to escape, and the one thing 344
   unequal arcs do have. Reversing the order fails this. */
let rising = true;
for (let k = 1; k < LL.order.length; k++) {
  if (LL.edges[LL.order[k]].w < LL.edges[LL.order[k - 1]].w) rising = false;
}
check(rising, "the arcs are not drawn light before heavy");

/* The column lists every arc at rest, heaviest first, which is what says at
   once which letter pairs a category is made of. Sorting it alphabetically, or
   leaving it in the layout's own order, fails this. */
check(arcWhy() === "6 arcs · heaviest first", `the resting list is headed "${arcWhy()}"`);
check(
  arcList() === "A → A2|C → T2|T → N2|D → G1|N → N1|T → D1",
  `the resting list reads ${arcList()}`,
);
/* Held before anything is pointed at, since the claim below is that these very
   objects are still in the list afterwards. */
const heldRows = arcRows.children[0];

/* A pointer on the ring, at the middle of a known end. The geometry is the
   element's own — solve at the stage's square, centred on it — so a hit here
   says the element and letter-graph.js agree about where an arc lands. */
const LG = lsolve(BOX);
const lmid = BOX / 2;
const ringPt = k => {
  const a = Math.PI / 2 - (LL.turn[k] + LL.upto[k]) / 2;
  return { offsetX: lmid + Math.cos(a) * LG.r, offsetY: lmid - Math.sin(a) * LG.r };
};
const letterPt = arc => {
  const at = LG.r + LG.band / 2 + LG.labelPx * 0.5;
  return { offsetX: lmid + Math.cos(arc.mid) * at, offsetY: lmid - Math.sin(arc.mid) * at };
};
const heavy = LL.edges.findIndex(e => e.from === 2 && e.to === 19);
const heavyEnd = [...LL.slotEdge].indexOf(heavy);
fire(lOver, "pointermove", ringPt(heavyEnd));
check(ld.arc?.from === "C" && ld.arc?.to === "T", `the ring end named ${JSON.stringify(ld.arc)}`);
/* The readout names the words on the arc rather than counting them, which is
   what ties this disc to <word-disc>: an arc is two words and this is which
   two. */
check(
  lGloss.innerHTML.includes("<b>C → T</b>") && lGloss.innerHTML.includes("cat, cot"),
  `the arc reads "${lGloss.innerHTML}"`,
);
/* The crumb carries what the pointer is on past the category, muted, the way
   both other discs carry theirs. */
check(lTail.innerHTML.includes("C → T"), `the crumb tail reads "${lTail.innerHTML}"`);

/* A pointer outside the ring is on a letter, which lights everything touching
   it in either direction — the letter's whole part in the picture. */
const tArc = LL.arcs.find(a => a.letter === 19);
fire(lOver, "pointermove", letterPt(tArc));
check(ld.arc === null, "the letter band answered with an arc");
check(
  lGloss.innerHTML.includes("<b>T</b>") && lGloss.innerHTML.includes("3 words start here"),
  `the letter reads "${lGloss.innerHTML}"`,
);

/* Pointing never rebuilds the column, which is what stops a list moving under
   a pointer on its way to a row. Two hovers have been through since those rows
   were held — an arc and a letter — and they are still the same objects, which
   is the only way from here to say nothing was rebuilt rather than rebuilt to
   the same names. Calling #showList from #preview fails this. */
check(arcRows.children[0] === heldRows, "a hover rebuilt the column");
check(arcWhy() === "6 arcs · heaviest first", `a hover moved the list to "${arcWhy()}"`);

/* A click drills, which is the one thing pointing cannot do: the column
   becomes that letter's arcs, leaving ones first and then arriving. An arc
   drills to the letter it leaves. */
fire(lOver, "click", ringPt(heavyEnd));
check(ld.letter === "C", `clicking the C→T arc drilled to ${ld.letter}`);
check(arcList() === "C → T2", `C's column reads ${arcList()}`);
check(arcWhy() === "C1 out, 0 in · ", `C's column is headed "${arcWhy()}"`);
check(lCrumb.innerHTML.includes(">C<"), `the crumb does not name C: "${lCrumb.innerHTML}"`);

fire(lOver, "click", letterPt(tArc));
check(ld.letter === "T", `clicking T's band drilled to ${ld.letter}`);
/* fanKey's order: the destinations in the order the ring visits them, counted
   backwards from T's own letter, which puts N before D. */
check(arcList() === "T → N2|T → D1|C → T2", `T's column reads ${arcList()}`);
/* An arriving arc reads apart from a leaving one, as the ring band has it. */
check(
  arcRows.children.map(li => (li.classList.contains("in") ? "in" : "out")).join("|") ===
    "out|out|in",
  "the column does not mark an arriving arc",
);

/* The seam. A pointer between two rows is over the list and over no row, which
   is what a browser sends, and clearing the highlight there is what makes it
   blink off and on all the way down a column. A move that lands on no row
   holds what the last one set; only leaving the list clears it. Restoring the
   clearing branch fails the second of these. */
fire(arcRows, "pointermove", { target: arcRows.children[0] });
check(ld.arc?.to === "N", `hovering a row named ${JSON.stringify(ld.arc)}`);
check(arcRows.children[0].classList.contains("on"), "a hovered row is not marked");
fire(arcRows, "pointermove", { target: arcRows });
check(ld.arc?.to === "N", "a move landing on no row cleared the highlight");
fire(arcRows, "pointerleave", {});
check(ld.arc === null, "leaving the list left the highlight behind");

/* The hub, which is disc-label.js's halo and baseline now rather than a second
   copy of <word-disc>'s. Nothing is stroked, the ground is copies of the ink's
   own call ringed at one radius about the point the ink goes down at, and the
   ink goes last. */
ld.show(-1);
lOver.drew.strokeText = 0;
lOver.text = { fill: [], stroke: [] };
ld.repaint();
check(lOver.drew.strokeText === 0, `the hub stroked ${lOver.drew.strokeText} times`);
const lGround = lOver.text.fill.filter(t => t.c === "#0c1112");
const lInk = lOver.text.fill.filter(t => t.c !== "#0c1112");
check(lInk.length === 1 && lGround.length === 8, `the hub laid ${lGround.length} copies of ground`);
check(
  lGround.every(t => t.t === lInk[0].t),
  "the ground is not the same text as the ink over it",
);
{
  const rs = lGround.map(t => Math.hypot(t.x - lInk[0].x, t.y - lInk[0].y));
  check(
    Math.max(...rs) - Math.min(...rs) < 1e-9 && rs[0] > 0,
    `the ground is ringed at ${Math.min(...rs)} to ${Math.max(...rs)} about the ink`,
  );
}
check(
  lOver.text.fill.indexOf(lInk[0]) === lOver.text.fill.length - 1,
  "the hub drew its ink before its ground",
);

/* The suggestions and the arc list want the same room, and only one of them is
   being asked for at a time. A word is not drawn on this disc — its letter
   pair is — so searching for one reaches the arc it sits on, which is the
   whole of what this disc can say about a word. */
const lq = lShadow.querySelector(".q");
lq.value = "toad";
fire(lq, "input", {});
check(arcsEl.hidden, "a query left the arc list drawn under the suggestions");
check(
  ld.arc?.from === "T" && ld.arc?.to === "D",
  `searching toad reached ${JSON.stringify(ld.arc)}`,
);
fire(lq, "blur", {});
check(!arcsEl.hidden, "the arc list did not come back when the search closed");

/* Stacked there is no column, so the rows are dropped rather than left behind
   display:none — 344 of them for animal. */
const lFrame = lShadow.querySelector(".frame");
const lStage = lShadow.querySelector(".stage");
lFrame._rect = { width: BOX, height: BOX };
lStage._rect = { width: BOX, height: BOX };
resize();
check(arcRows.children.length === 0, `${arcRows.children.length} rows survived stacking`);

/* And back again, which is the half of it that a page being dragged wider has
   to do and that firing every callback on every resize could never show.

   Stacked, the stage is a square of whatever height the flex column leaves, so
   it is the frame's height that sets it and a frame growing wider leaves the
   stage's box exactly where it was. An element observing only its stage
   therefore gets no callback at all on the way back out: it goes to the
   stacked layout when the page narrows and stays there however wide the page
   is dragged afterwards. Observing the frame as well is what catches it. */
lFrame._rect = { width: BOX + 300, height: BOX };
resize();
check(
  lFrame.classList.contains("wide"),
  "a frame dragged wide again with its stage unmoved stayed in the stacked layout",
);
check(arcRows.children.length > 0, "the column did not come back when the frame went wide again");

/* embed.html is the one page `make web-dist` stages, and it names its modules,
   its elements and its data files by hand where the target finds the modules by
   glob. So the glob's own guarantee stops at the directory's edge: a module
   renamed here would be copied under its new name and left unreferenced by the
   page, with nothing to say so. This is what says so. Only the names are
   checked — nothing here renders the markup. */
const { existsSync, readFileSync } = await import("node:fs");
const page = readFileSync(new URL("../web/embed.html", import.meta.url), "utf8");
for (const [, src] of page.matchAll(/(?:src|names-src|glosses-src)="([^"]+)"/g)) {
  if (src.endsWith(".js"))
    check(
      existsSync(new URL(`../web/${src}`, import.meta.url)),
      `embed.html names a missing ${src}`,
    );
  else
    check(
      /^(wordnet-(tree\.json|names\.txt|glosses\.txt)|words-[a-z-]+\.json)$/.test(src),
      `embed.html asks for ${src}, which web-dist does not stage flat beside it`,
    );
}
/* Each element stands alone on that page, so a host can lift one section and
   drop it anywhere without bringing the other. What can be checked here is that
   each is there and carries its own script: a section whose module is loaded
   somewhere else on the page cannot be lifted out on its own, and that is the
   one way the two could quietly become a pair again. */
for (const tag of ["hypernym-disc", "word-disc", "letter-disc"]) {
  check(page.includes(`<${tag}`), `embed.html carries no <${tag}>`);
  check(
    page.includes(`src="${tag}.js"`),
    `embed.html does not load ${tag}.js, so its section cannot be lifted out alone`,
  );
}

if (problems.length) {
  for (const said of problems) console.error(`web: ${said}`);
  process.exit(1);
}
console.log(
  `web/: ${MODULES.length} modules load, ${N.toLocaleString("en-GB")} nodes` +
    ` merge to ${dense.drawn.toLocaleString("en-GB")} arcs,` +
    ` ${WORDS.length} words lay out in ${L.live.length} wedges and play,` +
    ` ${LWORDS.length} words make ${LL.pairs} letter arcs`,
);
