/* Holds web/ to what a browser will actually accept and run: every module is
 * loaded against a stubbed DOM and all three elements are built and driven, so
 * a fault that only shows when a class body is evaluated fails here rather than
 * leaving a blank page. The assertions are on the properties the code rests on
 * rather than on exact counts, which move whenever the geometry does.
 *
 *     node tools/check_web.mjs
 */
const mod = name => new URL(`../web/${name}`, import.meta.url);
const { existsSync, readFileSync } = await import("node:fs");
const problems = [];
const check = (ok, said) => {
  if (!ok) problems.push(said);
};

/* Enough browser to load the modules and drive the elements. One markup
   fragment serves all three templates. A canvas records what it was asked to
   draw and measures text off the font size it was set; nothing is rasterised,
   so what is asserted is counts and positions rather than pixels. */
const drew = {
  fillText: 0,
  strokeText: 0,
  stroke: 0,
  fill: 0,
  fillRect: 0,
  arc: 0,
  curve: 0,
  image: 0,
  inPath: 0,
  inStroke: 0,
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
  removeEventListener(type, fn) {
    const held = this._on.get(type);
    if (held)
      this._on.set(
        type,
        held.filter(f => f !== fn),
      );
  }
  /* Real delivery, where this used to answer true and drop the event: it is how
     <word-run> hears the disc, and an element that binds by listening cannot be
     driven at all against a stub that never calls back. Bubbling walks the
     parents the append above recorded. */
  dispatchEvent(ev) {
    for (const fn of (this._on.get(ev.type) ?? []).slice()) fn(ev);
    if (ev.bubbles && this._parent) this._parent.dispatchEvent(ev);
    return true;
  }
  /* No shadow tree in the stub deep enough to matter, so the one root is the
     document, which is what getElementById below answers off. */
  getRootNode() {
    return globalThis.document;
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
  /* Text as a browser reports it: setting it replaces the children, reading it
     walks them. Both discs build a row out of spans and strings, so a getter
     answering only its own string would report every row as empty. */
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
    if (n === "id") BY_ID.set(String(v), this);
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
  // Enough scroll geometry for the moves column to page: a row apiece and no
  // visible height, so the fill loop stops where a browser's would.
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
    // Its own tally as well as the shared one: the two discs share `drew`, so a
    // claim about one canvas needs a count the base's dots cannot drown out.
    this.drew = {
      fillText: 0,
      strokeText: 0,
      stroke: 0,
      fill: 0,
      fillRect: 0,
      arc: 0,
      curve: 0,
      image: 0,
      // Whether the middle was asked at all. Both answer false below, so this
      // is the only way to claim that the hub stopped swallowing the pointer.
      inPath: 0,
      inStroke: 0,
    };
    // Where the text went, so a claim can be made about the halo sitting on
    // the letter it belongs to rather than beside it.
    this.text = { fill: [], stroke: [] };
    // And where the bundle was blitted, with the source beside the box: a
    // bundle replaced and not let go of is a claim about a picture nothing draws.
    this.images = [];
    this.sources = [];
    // The colour each stroke went down in, in order, which is the only way to
    // make a claim about z-order without rasterising; the same for fills.
    this.inks = [];
    this.nibs = [];
    this.fills = [];
    // Where each path opened and where its far edge turned back. A band is one
    // path and its ribbon is written by shared code, so those two points are the
    // only things that say it was handed its own slice at each end, and at the
    // height it was cut for.
    this.moves = [];
    this.lines = [];
    // And where each cubic landed, which is what says a ribbon's two edges are
    // the height apart it was cut for rather than lying on one another.
    this.curves = [];
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
      // <letter-disc>'s scrim: one fill over the frame is how it dims the
      // picture around what the pointer is on.
      fillRect: () => both("fillRect"),
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      closePath() {},
      moveTo: (x, y) => {
        this.moves.push({ x, y });
      },
      lineTo: (x, y) => {
        this.lines.push({ x, y });
      },
      fill: () => {
        both("fill");
        this.fills.push(this._g.fillStyle);
      },
      /* Both answered false throughout, so what is driven below is the ring
         band and the letters outside it; the interior hit asks the path itself,
         and <word-disc>'s fan asks the stroke. The prune in front of each is
         where the arithmetic is, and `near` and `spans` are asserted directly. */
      isPointInPath: () => {
        both("inPath");
        return false;
      },
      isPointInStroke: () => {
        both("inStroke");
        return false;
      },
      bezierCurveTo: (_ax, _ay, _bx, _by, x, y) => {
        both("curve");
        this.curves.push({ x, y });
      },
      stroke: () => {
        both("stroke");
        this.inks.push(this._g.strokeStyle);
        // The nib as well as the ink: a stroke at no width goes down invisibly
        // and counts the same, and a mitred join at a path that turns back on
        // itself is a spike rather than a corner.
        this.nibs.push({ width: this._g.lineWidth, join: this._g.lineJoin });
      },
      arc: () => both("arc"),
      fillText: (t, x, y) => {
        both("fillText");
        // The colour as well as the point: the hub's halo is made of fills like
        // the letters it sits under, and the ground is what tells the two apart.
        this.text.fill.push({ t, x, y, c: this._g.fillStyle });
      },
      strokeText: (t, x, y) => {
        both("strokeText");
        this.text.stroke.push({ t, x, y });
      },
      drawImage: (img, ...box) => {
        both("image");
        this.images.push(box);
        this.sources.push(img);
      },
      measureText(text) {
        const px = parseFloat(/([\d.]+)px/.exec(this.font)?.[1]) || 10;
        /* Ink metrics have to depend on the letters: reported flat, the stub
           could not tell the fix from the bug that moved the hub's name. */
        return {
          width: text.length * PX * px,
          // The dot on an i counts as tall, since it is what the moving name
          // was first noticed on.
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
  // Hidden as the template has it: a host that names no index gets no picker.
  const pick = new El("div", "pick");
  pick.hidden = true;
  pick.append(new El("select", "cat"));
  const find = new El("div", "find");
  const moves = new El("div", "moves");
  moves.append(new El("div", "why"), new El("ul", "list"));
  // <hypernym-disc>'s list of the ring below the root: its own element, since
  // one fragment serves either template and each disc reaches for its own.
  const kids = new El("div", "kids");
  kids.append(new El("div", "why"), new El("ul", "list"));
  find.append(new El("input", "q"), new El("ul", "hits"), moves, kids);
  const stage = new El("div", "stage");
  stage.append(new Canvas(), new Canvas());
  stage.children[0].className = "base";
  stage.children[1].className = "over";
  const crumb = new El("div", "crumb");
  crumb.append(new El("span", "head"), new El("span", "tail"));
  // <balance-flow>'s transport, which no disc reaches for: it is the one element
  // here whose state a click moves rather than the pointer.
  const rail = new El("div", "rail");
  const keys = new El("div", "keys");
  for (const k of ["first", "prev", "play", "next", "last"]) keys.append(new El("button", k));
  const slide = new El("div", "slide");
  slide.append(new El("div", "marks"), new El("input", "scrub"));
  rail.append(keys, slide);
  frame.append(pick, find, stage, rail, new El("div", "gloss"), crumb);
  // <word-run> holds no frame at all: one line, and the rest of this is what
  // the discs reach for.
  const root = new El("div", "");
  root.append(new El("style", ""), frame, new El("div", "run"));
  return root;
};

/* Elements by id, filled as one is set rather than by walking a tree, since
   the stub has no tree to walk. */
const BY_ID = new Map();
globalThis.document = {
  getElementById: id => BY_ID.get(id) ?? null,
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
  /* Setting an observed attribute calls the callback, as a browser does and as
     the element counts on when it sets its own `src` from the picker. Calling
     it by hand would reach past the plumbing and test something else. */
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
/* The callbacks are kept, and so is what each one observes, because a browser
   calls back only when a box it was actually given has moved. An element can
   measure one box and observe another; firing every callback on every resize
   hides exactly that, and hid it here. */
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
/* And the observer a disc gives its pixels back on, kept the same way:
   `nearScreen(false)` is a disc a viewport away, `nearScreen(true)` one back. */
const SEEN = [];
globalThis.IntersectionObserver = class {
  constructor(fn) {
    SEEN.push(fn);
  }
  observe() {}
  disconnect() {}
};
const nearScreen = isIntersecting => {
  for (const fn of SEEN) fn([{ isIntersecting }]);
};
/* A disc left behind rather than scrolled past: out of range, and then past the
   hold the sleep waits out. The hold is imported rather than written down here,
   so a disc-idle.js that lengthens it does not leave this waiting too little. */
const { HOLD, watch: watchIdle } = await import(mod("disc-idle.js"));
const away = async () => {
  nearScreen(false);
  await new Promise(r => setTimeout(r, HOLD + 40));
};
/* The listeners are kept, so a change of resolution is driven as a browser
   drives one. Removal goes by function, since re-arming moves it to a new query. */
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
  "balance-bank.js",
  "balance-flow.js",
  "disc-colour.js",
  "disc-idle.js",
  "disc-index.js",
  "disc-label.js",
  "disc-lines.js",
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
  "word-longest.js",
  "word-run.js",
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

/* Four subtrees of 2,000 leaves, which at the geometry below puts the fringe
   wedges at about a quarter of a pixel, so the merge is the path under test. */
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

/* Guards the hue blend: merging joins neighbours whatever their colour, so a
   hue depth giving every node its own must merge as well as one giving a branch one. */
const deep = paint(fresh(19), view("density"));
check(
  deep.drawn < N,
  `at hue-depth 19 density drew ${deep.drawn} of ${N}, so the merge went by colour`,
);

/* The ring cap: two rings of a three-ring tree is the root and its branches, so
   the painter has to re-merge rather than serve the full-depth run it cached. */
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

/* The search box, scored rather than drawn. The band order is what is asserted:
   a stronger kind of match outranks a weaker one however long the name. */
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
/* The mask that skips most names keeps a bit for the space, so a multiword query
   still reaches a multiword name, and holding a query's characters is not the
   same as holding them in order. */
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

/* The hub's label, which wraps rather than draws; a monospace stub makes a width
   a character count. Nothing may be dropped without a mark: a break inside a
   word carries a hyphen, a break on a space does not. */
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
/* A caller can hand in a ladder and a weight of its own, and the defaults are
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

/* The word disc's layout, render.py's `words_disc` written a second time, so the
   ordering is what is asserted: a wedge per first letter alphabetically, and
   inside one the ring's own visiting order. */
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
  spans,
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

/* The prune in front of the fan's hit test. It is allowed to let a point
   through that is not on the chord, since a path is then built and asked; what
   it may never do is refuse one that is. So the obligation is checked against
   the cubic itself, walked point by point, for pairs that wrap through the top
   and pairs that nearly face each other. */
{
  const PULL = 0.32;
  const on = (a, b, t) => {
    // disc-colour.js's bow, as Bernstein: the ends on the ring and the two
    // control points pulled in along their own rays.
    const p = [
      [Math.cos(a), Math.sin(a)],
      [Math.cos(a) * PULL, Math.sin(a) * PULL],
      [Math.cos(b) * PULL, Math.sin(b) * PULL],
      [Math.cos(b), Math.sin(b)],
    ];
    const u = 1 - t;
    const w = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
    return [0, 1].map(k => w.reduce((sum, c, j) => sum + c * p[j][k], 0));
  };
  const pairs = [
    [0.2, 1.1],
    [-0.3, 0.4],
    [3.0, -3.0],
    [0.1, 3.0],
    [2.5, -2.5],
    [1.0, 1.02],
  ];
  let held = true,
    where = "";
  for (const [a, b] of pairs)
    for (let k = 0; k <= 64; k++) {
      const [x, y] = on(a, b, k / 64);
      if (x === 0 && y === 0) continue;
      if (!spans(a, b, Math.atan2(y, x), 0)) {
        held = false;
        where = `${a},${b} at t=${k / 64}`;
      }
    }
  check(held, `spans refused a point that is on the chord: ${where}`);

  // And it prunes: a constant true would pass the obligation above.
  check(
    !spans(0.2, 1.1, 2.4, 0) && !spans(0.2, 1.1, -0.6, 0),
    "spans accepted an angle outside the wedge its chord can reach",
  );
  // The pad widens the wedge at both ends, which is what pays the hit
  // tolerance where the fan runs closest to the middle.
  check(spans(0.2, 1.1, 1.2, 0.2) && spans(0.2, 1.1, 0.1, 0.2), "the pad did not widen the wedge");
}

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

/* A word already played is not a move, and neither is the word play is standing
   on — that falls out of the same test, since it is used by definition. */
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

/* Walking the T wedge dry, so the round ends on a letter the category does
   have words for rather than on one it never had. */
const dry = new Chain(L.head, L.tail);
for (const w of ["cat", "trout", "toad", "dog"]) dry.play(at(w));
check(dry.steps.map(i => WORDS[i]).join("|") === "cat|trout|toad|dog", `walked ${dry.steps}`);
check(dry.stuck(L.byHead), "dog is not a dead end, since nothing starts with G");
dry.rewind(2);
check(!dry.stuck(L.byHead), "winding back off a dead end left the chain stuck");
check(dry.legal(at("toad")) && !dry.legal(at("trout")), "the wound-back move set is wrong");

/* How far the category runs if every word is chosen perfectly, which is
   graph.py's `longest_chain` written a second time. The two halves drift
   quietly — both keep answering with a playable chain, one of them just stops
   finding the longest — so tools/chains.json pins the answer word for word and
   tools/check_chain.py runs the same cases through the Python. Every case is
   also played out here, so a fixture and an implementation that have drifted
   together still fail. */
const {
  buckets: chainBuckets,
  chain: longestChain,
  components: chainParts,
  hierholzer: chainWalk,
  longest: longestOn,
  trace: chainTrace,
} = await import(mod("word-longest.js"));

/** Whatever stops `said` being playable from `pool`, or null. */
const unplayable = (said, pool, opening) => {
  const held = new Set(pool),
    played = new Set();
  if (opening !== undefined && said[0] !== opening)
    return `it was to open on ${opening} and opens on ${said[0]}`;
  for (let i = 0; i < said.length; i++) {
    const word = said[i];
    if (!held.has(word)) return `${word} is not in the list`;
    if (played.has(word)) return `${word} is played twice`;
    if (i && said[i - 1].slice(-1) !== word[0])
      return `${said[i - 1]} does not hand over to ${word}`;
    played.add(word);
  }
  return null;
};

const CHAINS = JSON.parse(readFileSync(new URL("chains.json", import.meta.url), "utf8"));
/* A case constrained to an opening word names the list it shares rather than
   carrying a second copy of it. */
const CHAIN_LISTS = new Map(CHAINS.cases.filter(k => k.words).map(k => [k.name, k.words]));
for (const kase of CHAINS.cases) {
  const kaseWords = kase.words ?? CHAIN_LISTS.get(kase.like);
  const got = longestChain(kaseWords, kase.opening);
  const broken = unplayable(got.words, kaseWords, kase.opening);
  check(broken === null, `chains.json ${kase.name}: the chain is not playable — ${broken}`);
  const parted = got.words.findIndex((w, i) => w !== kase.chain[i]);
  check(
    got.words.length === kase.chain.length && parted < 0,
    `chains.json ${kase.name}: chained ${got.words.length} words where the file holds` +
      ` ${kase.chain.length}` +
      (parted < 0
        ? ""
        : `, and parts from it at ${parted}: ${got.words[parted]} for ${kase.chain[parted]}`),
  );
  check(
    got.bound === kase.bound,
    `chains.json ${kase.name}: bound ${got.bound}, where the file holds ${kase.bound}`,
  );
  check(
    got.certified === kase.certified,
    `chains.json ${kase.name}: certified ${got.certified}, where the file holds ${kase.certified}`,
  );
  /* The bound is what the flow relaxation allows and the chain is what
     connectivity leaves of it, so one can never pass the other. */
  check(
    got.words.length <= got.bound,
    `chains.json ${kase.name}: a chain of ${got.words.length} beat its own bound of ${got.bound}`,
  );
  check(
    got.certified === (got.words.length === got.bound),
    `chains.json ${kase.name}: certified does not mean the bound was reached`,
  );
}

/* A multiword entry is stored as it came in. Stripping the space would put the
   word in the right bucket and hand back a spelling the category does not have,
   which no other assertion here would notice. */
check(
  chainBuckets(["polar bear"])[("p".charCodeAt(0) - 97) * 26 + ("r".charCodeAt(0) - 97)][0] ===
    "polar bear",
  "a multiword entry lost its spelling on the way into a bucket",
);

/* The two pieces the driver rests on, asserted on their own: a split the union
   find has to see, and a walk that has to spend every arc it is given. */
const SPLIT = new Int32Array(26 * 26);
SPLIT[2 * 26 + 19] = 1; // c -> t
SPLIT[19 * 26 + 0] = 1; // t -> a
SPLIT[3 * 26 + 14] = 1; // d -> o
const { find: splitFind, touched: splitTouched } = chainParts(SPLIT);
check(
  splitFind(2) === splitFind(19) && splitFind(2) !== splitFind(3),
  "the union find joined two letters no word bridges, or split two a word does",
);
check(
  splitTouched[2] && splitTouched[0] && !splitTouched[1],
  "a letter no arc touches came back touched",
);

const TRIANGLE = new Int32Array(26 * 26);
TRIANGLE[0 * 26 + 1] = 1; // a -> b
TRIANGLE[1 * 26 + 2] = 1; // b -> c
TRIANGLE[2 * 26 + 0] = 1; // c -> a
check(
  chainWalk(TRIANGLE, 0).join("") === "0120",
  `the walk round a triangle came back ${chainWalk(TRIANGLE, 0)}`,
);

/* An empty category is a chain of none rather than a throw, since the element
   is handed its words asynchronously and draws before they land. */
check(longestOn(new Int32Array(26 * 26)).letters.length === 0, "an empty matrix chained something");

/* And what the fixture cannot cover: word lists nobody wrote down. What is
   asserted is the two properties that hold whatever the words are. */
let seed = 12345;
const roll = n => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
let chained = 0;
for (let trial = 0; trial < 200; trial++) {
  const alphabet = "abcdefgh".slice(0, 2 + roll(6));
  const list = new Set();
  for (let i = 0, n = 4 + roll(12); i < n; i++) {
    let word = "";
    for (let j = 0, len = 2 + roll(3); j < len; j++) word += alphabet[roll(alphabet.length)];
    list.add(word);
  }
  const words = [...list];
  const got = longestChain(words);
  chained += got.words.length;
  const broken = unplayable(got.words, words);
  if (broken !== null) {
    check(false, `a random list chained something unplayable — ${broken}: ${words}`);
    break;
  }
  if (got.words.length > got.bound) {
    check(
      false,
      `a random list chained ${got.words.length} past its bound of ${got.bound}: ${words}`,
    );
    break;
  }
  /* And the same two properties under an opening word, which is the question a
     player standing on a word asks. A forced opening cannot be longer than the
     free one, and it has to be the word that was asked for. */
  const opener = words[roll(words.length)];
  const forced = longestChain(words, opener);
  chained += forced.words.length;
  const spoilt = unplayable(forced.words, words, opener);
  if (spoilt !== null) {
    check(false, `opening on ${opener} chained something unplayable — ${spoilt}: ${words}`);
    break;
  }
  if (forced.words.length > forced.bound || forced.words.length > got.bound) {
    check(
      false,
      `opening on ${opener} chained ${forced.words.length} past a bound of` +
        ` ${Math.min(forced.bound, got.bound)}: ${words}`,
    );
    break;
  }
}

/* The sizing, one equation with the label size on both sides. What is asserted
   is that it stays inside its square at every count, down to a frame too small
   to draw in. */
const SQUARE = 720,
  WIDE = 5.4; // "milliampere" at 1 px of type, near enough
const fits = got => got.outer + 24 / 2 <= SQUARE / 2 + 0.001 && got.r > 0;

const roomy = solve(wordLayout(WORDS).span, WIDE, SQUARE);
/* The hub is one radius doing both jobs — what a click undoes and what the name
   must fit inside — so no part of a name can be where a click does nothing. */
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
/* Both edges of a slice, since the search lands on the entry below `t` and the
   slice it wants may be the one above. */
for (let k = 0; k < turn.length; k++)
  for (const off of [-0.4, 0.4])
    check(
      wordAt(L, turn, turn[k] + L.span * off) === L.order[k],
      `${off < 0 ? "just short of" : "just past"} ${WORDS[L.order[k]]} hit something else`,
    );
/* The gap after the last word of a wedge belongs to nobody: half a slice past
   it is inside the next word's, and a hair past the wedge's edge is not. */
const edge = L.wedge[0];
check(
  wordAt(L, turn, Math.PI / 2 - edge.to + 0.001) === -1,
  "the gap between two wedges answered with a word",
);
check(wordAt(L, turn, 2 * Math.PI - 0.001) === -1, "the gap before the top answered with a word");

/* The resting bundle's own square. A square below the ring it holds draws a
   blurred bundle and nothing downstream can tell; the step is what makes a
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

/* The backing-store ratio, and the bundle's cap held to it: never above the
   screen's own, and never above the budget, whatever box it is handed. */
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
/* Zoom halves the CSS box and doubles the ratio, so the pixels asked for are
   the same and there is nothing to save by refusing them. */
check(ratio(4, 716, 716) === 4, `a zoomed disc was held to ${ratio(4, 716, 716)}`);
check(ratio(0, 700, 400) === 1, `a screen reporting no ratio came back at ${ratio(0, 700, 400)}`);

/* The sleep a disc gives its pixels back on, held rather than taken the moment
   the disc leaves the band. A fast scroll crosses the whole band in one
   gesture, so a sleep taken there empties and refills a disc for a moment
   nobody spent looking at it, which is the stutter. Driven here rather than
   through an element, since the element draws the same either way and what has
   to be asserted is the sleep that never ran. */
const idleAt = SEEN.length;
let slept = 0,
  woke = 0;
const idleWatch = watchIdle(
  {},
  () => slept++,
  () => woke++,
);
const inBand = isIntersecting => SEEN[idleAt]([{ isIntersecting }]);
inBand(false);
inBand(true);
await new Promise(r => setTimeout(r, HOLD + 40));
check(slept === 0, `a disc scrolled past slept ${slept} times`);
check(woke === 1, `a disc scrolled past woke ${woke} times`);
/* And a disc left behind still gives them back, which the three elements below
   each assert through `away`. Disconnecting is what a held sleep must not
   outlive: an element taken out of the document is not one to empty. */
inBand(false);
idleWatch.disconnect();
await new Promise(r => setTimeout(r, HOLD + 40));
check(slept === 0, "a held sleep ran at a disc that had been disconnected");
/* And the bundle's cap must not bind before that budget does, or the picture
   blurs under dots and labels that stayed sharp. */
const budgeted = Math.sqrt(MAX_AREA) / 2;
check(
  square(budgeted, 1) <= MAX_PX,
  `a frame at the budget wants ${square(budgeted, 1)} against a cap of ${MAX_PX}`,
);

/* The stroke thinned by what the disc holds. Zero draws nothing and more than
   the tuned value draws too much ink, and the element could notice neither. */
check(thin(0.11, KNEE) === 0.11, `at the knee the alpha moved to ${thin(0.11, KNEE)}`);
check(thin(0.2, 1) === 0.2, `a sparse category was thinned to ${thin(0.2, 1)}`);
/* A denser disc draws thinner, and still ink rather than nothing. */
const thinnest = thin(0.11, 96470);
check(thinnest > 0 && thinnest < 0.11, `96,470 chords came back at ${thinnest}`);
check(
  thin(0.11, 96470) < thin(0.11, 24898),
  `animal is not thinner than drug: ${thin(0.11, 96470)} against ${thin(0.11, 24898)}`,
);
/* Held above the rasteriser's floor: an alpha this side of a hundredth is a
   bundle that is drawn and cannot be seen. */
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

/* The z-order. Letter by letter, every chord leaving Z composites over every
   chord leaving A and the fringe reads as the back of the alphabet, so what is
   asserted is that no letter's chords are a contiguous run. A word set large
   enough for the bands to bite. */
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
/* Every wedge with a slice in each band reaches both ends of the stack:
   collapsing BANDS to 1 puts a letter's chords back in one contiguous run. */
for (const [ink, held] of seen) {
  if (held.n < BANDS) continue;
  check(
    held.first < inks.length * 0.1 && held.last > inks.length * 0.9,
    `${ink} runs from ${held.first} to ${held.last} of ${inks.length}, so it is not spread through the stack`,
  );
}
check(seen.size > 1, `the spread set drew in ${seen.size} colours, so there is no order to check`);
/* And the bands run both ways, so a pair appears in both orders. Rotating the
   order within a band does not give it: it keeps the cycle and moves its start. */
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

/* And <word-disc> itself, built and driven: class-body faults surface only on
   construction, so the real element is built here. The points a pointer is moved
   to come from word-layout.js, so a hit says where the element puts a word. */
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
// Landscape and fitted, the only shape with a column beside the disc, so the
// moves list below is built rather than skipped. The stage's box is untouched.
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
/* No attribute is every word the category has, not a cut at some count: `build`
   draws 110 and the element does not, having only the frame it was given. */
check(!disc.hasAttribute("limit"), "the driven element was given a limit");

check(disc.stats.bundle, "8 words did not get a resting bundle");
/* There is no Worker here, so what is driven is the fallback — the same
   word-bundle.js the worker runs, which is what stops the two drifting. */
check(disc.stats.thread === "main", `the stub found a ${disc.stats.thread} to build on`);
check(drew.image === 1, `the bundle was blitted ${drew.image} times, not once`);
check(drew.curve === wordChords(L), `${drew.curve} curves for ${wordChords(L)} chords`);
check(drew.fillText > WORDS.length, "fewer labels were drawn than there are words");
/* The font swap. The callback queued on the stub's resolved document.fonts.ready
   runs here, and asserting the blit is what says it ran: one that silently did
   nothing would leave every fit measured against the fallback and still pass. */
const blits = drew.image;
await document.fonts.ready;
check(drew.image === blits + 1, `the font swap redrew ${drew.image - blits} times, not once`);
/* Nothing is painted behind the hub's name; it carries its own ground. With the
   pointer off the disc and no chain the overlay owes an arc to nothing, and that
   count is what says a panel disc has not come back. */
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
/* And the halo is copies of the letters rather than a stroke under them, which
   read as a shadow off to one side. One text, one radius, offsets summing to
   nothing. Shifting the ring by its own radius fails this. */
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
/* And the block is centred on a band measured off the face, rather than on the
   em square, which sat the type low, or on the word's own ink, which moved the
   name as the pointer crossed the disc. */
// Nothing hovered and no chain, so the hub names the category on one line and
// draws no way back under it.
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

/* Where the element puts word i, computed rather than written down, so a hit is
   a statement about the element agreeing with word-layout.js. */
const geo = solve(L.span, Math.max(...WORDS.map(w => w.length)) * PX, BOX);
const spot = w => {
  const i = WORDS.indexOf(w);
  return {
    offsetX: BOX / 2 + Math.cos(L.ang[i]) * geo.r,
    offsetY: BOX / 2 - Math.sin(L.ang[i]) * geo.r,
  };
};

/* The bundle's square, put back on that ring: the blit inverts RING, so a factor
   wrong in either draws the picture at the wrong scale and nothing notices. */
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
/* And drawn at the resolution it is shown at: a square short of the ring is
   blitted up and reads blurred. DPR is 2, so the ring wants twice its radius. */
check(
  disc.stats.bundlePx * RING >= geo.r * 2,
  `the bundle is held at ${disc.stats.bundlePx} square for a ring wanting ${(geo.r * 2) / RING}`,
);
// A browser sends the move before the click, and the readout follows the
// pointer, so a click with no move under it tests a state no user can reach.
const point = w => {
  fire(over, "pointermove", spot(w));
  fire(over, "click", spot(w));
};

fire(over, "pointermove", spot("cat"));
check(disc.stats.chain === 0, "a pointer move played a word");
point("cat");
check(disc.chain.join("|") === "cat", `clicking cat gave ${disc.chain}`);
/* The pointer is still on the word just played. It is used, but it is where play
   is standing, so the readout counts what can follow it rather than refusing it. */
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

/* How far perfect play can still run, which word-longest.js answers and the
   count of replies cannot: a letter with many replies can still be the shorter
   road. What is asserted is the invariant rather than the figure, since the
   figure moves whenever the word list does — the words played plus the words
   still to come never pass the free run, and while play stays on an optimal
   chain the two are equal. */
const reaches = () => {
  const said = /(?:perfect play reaches|playing it leaves) (\d+) more/.exec(gloss.innerHTML);
  return said ? +said[1] : -1;
};
/* The hub is the one place on the disc that names no word, so it is where the
   pointer goes to read the at-rest line rather than a word's own. */
const offWord = () => fire(over, "pointermove", { offsetX: BOX / 2, offsetY: BOX / 2 });
const FREE = longestChain(WORDS).words.length;
disc.clear();
offWord();
check(
  gloss.innerHTML.includes(`runs <b>${FREE}</b>`),
  `at rest the readout does not name the ${FREE}-word run: ${gloss.innerHTML}`,
);
/* A perfect prefix holds the sum at the free run the whole way down it, since
   what is left is priced over the words not yet played. A figure taken from the
   whole set instead runs over, which is the one thing this catches and the
   count of replies cannot. */
disc.clear();
for (const w of ["cat", "tiger", "rat", "trout"]) {
  point(w);
  check(
    disc.chain.length + reaches() === FREE,
    `after ${w} the readout has ${disc.chain.length} + ${reaches()}` +
      ` against a free run of ${FREE}`,
  );
}
/* And a move off that chain costs, so the figure falls rather than holding. */
disc.clear();
point("cat");
point("trout");
point("toad");
check(
  disc.chain.length + reaches() < FREE,
  `toad cost nothing: ${disc.chain.length} + ${reaches()} still makes ${FREE}`,
);
check(reaches() >= 0, `a chain in progress printed no figure: ${gloss.innerHTML}`);

/* The element against the module, across a move. trout is a move in both states
   below and worth different amounts in them, so a figure worked out before the
   move and held past it fails here rather than reading plausibly. */
disc.clear();
fire(over, "pointermove", spot("trout"));
const trout = reaches();
for (const w of ["cat", "tiger", "rat"]) point(w);
fire(over, "pointermove", spot("trout"));
const spent = WORDS.filter(w => !disc.chain.includes(w));
const owed = longestChain(spent, "trout").words.length - 1;
check(
  reaches() === owed,
  `the disc prices trout at ${reaches()} where word-longest.js says ${owed}`,
);
check(
  reaches() !== trout,
  `trout is worth ${trout} in both states, so this no longer tests a stale figure`,
);

/* Pointing at a word that is a move prices that move rather than the one play
   stands on, and says so in words a reader can tell apart. */
disc.clear();
point("cat");
fire(over, "pointermove", spot("toad"));
check(
  gloss.innerHTML.includes("playing it leaves"),
  `the pointer on a move did not price it: ${gloss.innerHTML}`,
);

/* A host with no use for the figures turns them off, and then nothing is
   solved: the attribute is read where the work would be done, not in CSS. */
disc.setAttribute("hint", "off");
disc.clear();
offWord();
check(!gloss.innerHTML.includes("runs <b>"), `hint="off" still named the run: ${gloss.innerHTML}`);
point("cat");
check(reaches() === -1, `hint="off" still priced the move: ${gloss.innerHTML}`);
disc.removeAttribute("hint");

/* Left as the block above found it: cat played, and the pointer on it. */
disc.clear();
point("cat");

/* An illegal word is inert: rat does not follow cat, and clicking it neither
   plays nor clears what is there. */
point("rat");
check(disc.chain.join("|") === "cat", `clicking an illegal word gave ${disc.chain}`);
point("toad");
check(disc.chain.join("|") === "cat|toad", `toad did not follow cat: ${disc.chain}`);

/* The fan is drawn across the middle, so the middle is asked before the hub
   is: a move whose chord passes under the name is still a move. The stub
   answers no, which is what leaves the way back reachable below. */
over.drew.inStroke = 0;
fire(over, "pointermove", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(over.drew.inStroke > 0, "the pointer in the middle never asked the fan");

/* At rest the anchor is the word the pointer was on when it crossed in, so
   following cat's fan inwards asks that fan and leaves it drawn. The chord
   under the pointer belongs to it, and a fan redrawn from the word the chord
   lands on would swing away at the moment the pointer arrived on one. */
disc.clear();
fire(over, "pointermove", spot("cat"));
// Twice cat's fan: the hit test builds it against the overlay's own context,
// and then the overlay draws it. An anchor on another word moves both.
const catFan = 2 * L.byHead[L.tail[WORDS.indexOf("cat")]].length;
over.drew.curve = 0;
over.drew.stroke = 0;
over.drew.inStroke = 0;
fire(over, "pointermove", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(over.drew.inStroke > 0, "the middle never asked the fan of the word held");
check(over.drew.stroke === 1, `the middle drew ${over.drew.stroke} strokes, not the fan alone`);
check(
  over.drew.curve === catFan,
  `the middle asked and drew ${over.drew.curve} chords, not ${catFan}`,
);

/* Held until the pointer comes back out: a second move inside still asks that
   fan, where taking the anchor afresh would lose it to the answer the chords
   had just given. */
over.drew.inStroke = 0;
fire(over, "pointermove", { offsetX: BOX / 2 + 2, offsetY: BOX / 2 - 2 });
check(over.drew.inStroke > 0, "the fan was let go of on a second move inside");

/* A pointer that was on nothing holds nothing, and the middle then answers on
   the way back alone: what lies under it is the resting bundle, every chord the
   disc has as a pair of words rather than a move, which no pointer rate hits. */
fire(over, "pointerleave", {});
over.drew.inStroke = 0;
fire(over, "pointermove", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(over.drew.inStroke === 0, "the middle asked a fan with nothing held");

/* Where play stands the fan is the chain's own and is drawn on the base, so
   nothing is held and the overlay puts no second fan under the pointer. */
disc.clear();
point("cat");
fire(over, "pointermove", spot("tiger"));
over.drew.stroke = 0;
fire(over, "pointermove", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(over.drew.stroke === 0, "the middle held a word of its own with a chain standing");
point("toad");

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

/* The moves column. `byHead` holds a wedge commonest first, so the list comes
   out in the order the disc drew it and no sort is needed. */
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
   place the hover ends: a pointermove targeting the list rather than a row must
   hold the highlight, or it blinks between every pair. Only leaving the list
   clears it, and the seam is exactly the event a browser sends. */
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

/* The crumb path's root, the only way back to a different first word. The markup
   is asserted rather than the click, the line being written as a string. */
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
/* The label is not a step, and the chevrons say so: they separate one word from
   the next and never the label from the first word. One word takes none. */
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

/* The end of the round has two shapes the readout must tell apart: a letter the
   category never had a word for, and one whose words the chain has used up. */
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
   bundle. The browser calls this on its own; here it is the same entry point. */
disc.clear();
// Spread over the alphabet at both ends, since words that all start with W and
// end with X have no chords between them and would leave the ceiling untested.
const ABC = "abcdefghijklmnopqrstuvwxyz";
const CROWD = Array.from(
  { length: 900 },
  (_, i) => ABC[i % 26] + ABC[((i / 26) | 0) % 26] + ABC[((i / 676) | 0) % 26] + ABC[(i * 7) % 26],
);
disc.data = { category: "crowd", words: CROWD, zipf: CROWD.map((_, i) => -i) };
check(disc.stats.words === CROWD.length, `the default drew ${disc.stats.words} of ${CROWD.length}`);
/* Nothing is capped: a page goes into the DOM and the rest follow as the column
   is scrolled, so what is listed first is the head of the whole sorted list. */
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
/* A word set of well over 24,000 chords still gets a bundle, which is what
   MAX_BUNDLE at 200,000 buys. */
check(
  disc.stats.chords > 24000 && disc.stats.bundle,
  `900 words hold ${disc.stats.chords} chords and the bundle is ${disc.stats.bundle}`,
);
check(disc.stats.labelPx === 0, `900 words in a ${BOX}px square kept their labels`);

/* A resize does not rebuild it: a new radius inside the same size step is a
   scaled blit. The element is resized through its own observer, and the wait is
   what the trailing timer holds a drag back by. */
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
   paint on at the old resolution. The canvas has to come back larger. */
await new Promise(r => setTimeout(r, 80));
const wasWide = shadow.querySelector(".base").width;
zoom(4);
const nowWide = shadow.querySelector(".base").width;
check(
  nowWide === Math.round((BOX - 4) * ratio(4, BOX - 4, BOX - 4)),
  `a zoom to dpr 4 took the canvas from ${wasWide} to ${nowWide}`,
);
zoom(2);

/* A disc more than a screen away gives its pixels back. Nothing downstream can
   tell, since it draws the same on the way back. */
// After the zoom above has settled, since a fit part way through a drag is held
// on the trailing timer and this claim is about a canvas that is still.
await new Promise(r => setTimeout(r, 80));
const bigBase = shadow.querySelector(".base").width;
check(bigBase > 0 && disc.stats.bundle, "the disc had no pixels to give back");
await away();
check(
  shadow.querySelector(".base").width === 0 && shadow.querySelector(".over").width === 0,
  `a disc a screen away kept a ${shadow.querySelector(".base").width}px canvas`,
);
check(!disc.stats.bundle, "a disc a screen away kept its bundle");
/* And does not take them straight back. The resize observer goes on firing at an
   element nobody can see. The box really moves, and past the coalescing window,
   so a fit that went ahead would size the canvases here and now. */
await new Promise(r => setTimeout(r, 80));
const wasStage = shadow.querySelector(".stage")._rect;
shadow.querySelector(".stage")._rect = { width: BOX - 8, height: BOX - 8 };
resize();
check(shadow.querySelector(".base").width === 0, "a resize woke a disc that was a screen away");
shadow.querySelector(".stage")._rect = wasStage;
nearScreen(true);
check(
  shadow.querySelector(".base").width === bigBase && disc.stats.bundle,
  `coming back left the canvas at ${shadow.querySelector(".base").width} of ${bigBase}`,
);

/* A bundle that has been replaced has to be let go of: its pixels sit outside the
   JS heap, so the collector sees a small object under no pressure and nothing
   downstream can tell. The stub's canvas has no close, so it is emptied. */
const dropped = shadow.querySelector(".base").sources.at(-1);
check(dropped?.width > 0, "no bundle was blitted, so there is none to let go of");

disc.setAttribute("limit", "40");
check(disc.stats.words === 40, `limit 40 drew ${disc.stats.words}`);
check(disc.stats.bundle && disc.stats.labelPx > 0, "40 words lost the bundle or the labels");
check(dropped.width === 0, "the bundle a word set replaced kept its pixels");

const kept = shadow.querySelector(".base").sources.at(-1);
check(kept !== dropped && kept.width > 0, "the bundle drawn for the new word set is not held");
disc.repaint();
check(kept.width === 0, "the bundle a theme replaced kept its pixels");

/* The category picker, which index-src turns on. Its one piece of arithmetic is
   where a category's words are: the index's own path with the last segment
   swapped. Get it wrong and it asks for a directory nobody has. */
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

/* An index is enough to open on: named without a src it means the first
   category rather than a blank disc. */
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

/* The stacked layout and back. The stage is observed because its box sizes the
   canvases and the frame because its shape decides the layout, and the two do not
   move together: a frame dragged wider leaves the stage's box where it was, so an
   element watching only the stage stays stacked. Dropping the frame fails this. */
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

/* And <hypernym-disc> itself, built: class-body faults surface only on
   construction. What is driven is the list of the ring below the root. */
const HypernymDisc = REGISTRY.get("hypernym-disc");
check(HypernymDisc !== undefined, "hypernym-disc never reached the registry");

/* A root with three children, the middle a branch, named so draw order and
   alphabetical order differ: a list that came back sorted fails. */
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
   which is the same fraction as the share of the turn its wedge takes. */
check(kidWeights() === "|50%|", `the rows weigh ${kidWeights()}`);

/* Clicking a row is clicking its wedge. */
fire(kidRows, "click", { target: kidRows.children[1] });
check(nest.index === 2, `a branch row left the root at ${nest.index}`);
check(kidNames() === "moss cap|moss stem", `moss opened onto ${kidNames()}`);
check(kidMarks() === "leaf|leaf", `moss's children are marked ${kidMarks()}`);
check(kidWhy() === "2 below · 0 open further", `a ring of leaves is headed "${kidWhy()}"`);
check(kidWeights() === "|", `a ring of leaves weighs ${kidWeights()}`);

/* A leaf is not one. Going to its parent, where the disc already is, would
   rebuild the list under the click and throw the scroll back to the top. */
const held = kidRows.children[0];
fire(kidRows, "click", { target: kidRows.children[0] });
check(nest.index === 2, `a leaf row moved the root to ${nest.index}`);
// The rows are the same objects, which is the only way to say from here that
// nothing was rebuilt rather than rebuilt to the same names.
check(kidRows.children[0] === held, "a leaf click rebuilt the list under itself");

/* Three digits at most: rounded whole above 9.95%, one decimal down to 0.095%,
   and a floor below that. Inverting the ratio, or dividing by the row count
   rather than the leaf count, fails every one of them. */
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
   display:none. */
const nFrame = nest._shadow.querySelector(".frame");
const nStage = nest._shadow.querySelector(".stage");
nFrame._rect = { width: BOX, height: BOX };
nStage._rect = { width: BOX, height: BOX };
resize();
check(kidRows.children.length === 0, `${kidRows.children.length} rows survived stacking`);

/* And back out of it. See the same pair on <letter-disc> below for why the
   stage's box does not move on the way back. */
nFrame._rect = { width: BOX + 300, height: BOX };
resize();
check(nFrame.classList.contains("wide"), "the nested disc stayed stacked when the frame went wide");
check(kidRows.children.length > 0, "the ring below did not come back when the frame went wide");

/* <word-run>, which follows the disc rather than being driven by a host: the
   events <word-disc> emits bubble and cross the shadow boundary, so an id is
   the whole of the binding. What is asserted is that it hears them, and that
   what it names is the run word-longest.js gives for the state the disc is in.
   The stub's dispatchEvent had to become real for any of this to be reachable. */
const { elide, run: makeRun } = await import(mod("word-run.js"));
const WordRun = REGISTRY.get("word-run");
check(WordRun !== undefined, "word-run never reached the registry");

/* The fold on its own. Hiding one word behind an ellipsis and a count reads
   worse than the word, so a run of 2n+1 is left whole and the fold starts
   above it. */
const whole = elide(9, 4);
check(
  whole.head === 9 && whole.hidden === 0,
  `a run of exactly 2n+1 folded to ${JSON.stringify(whole)} rather than staying whole`,
);
const folded = elide(20, 4);
check(
  folded.head === 4 && folded.tail === 4 && folded.hidden === 12,
  `20 words folded to ${JSON.stringify(folded)}`,
);
check(folded.head + folded.hidden + folded.tail === 20, "the fold lost or invented a word");
/* A host asking for no ends still gets a chain rather than an empty line. */
check(elide(20, 0).head > 0, "ends=0 folded every word away");

/* The run against the module the disc prices with: nothing played is the free
   chain, and opening on a word that is on one costs nothing. */
check(
  makeRun(WORDS, []).join("|") === longestChain(WORDS).words.join("|"),
  `the run with nothing played is ${makeRun(WORDS, [])}, not the free chain`,
);
const opened = makeRun(WORDS, ["cat"]);
check(opened[0] === "cat", `the run does not open on the word played: ${opened}`);
check(
  opened.length === FREE,
  `cat is on a longest chain, so opening on it should still make ${FREE}: ${opened}`,
);
/* And a word off every longest chain has to cost, or the element is telling a
   player their mistake was free. */
check(makeRun(WORDS, ["cat", "trout", "toad"]).length < FREE, "the run says toad cost nothing");
/* A word already played is not a move, so a run can neither repeat a word nor
   come out longer than the free chain. Continuing over the category rather
   than over what is left breaks both at once, and reads plausibly doing it. */
const runDeep = makeRun(WORDS, ["cat", "tiger", "rat", "trout"]);
check(new Set(runDeep).size === runDeep.length, `the run plays a word twice: ${runDeep}`);
check(
  runDeep.length <= FREE,
  `the run makes ${runDeep.length} where the free chain makes ${FREE}: ${runDeep}`,
);

/* Bound by id to a disc of its own, since the one above has been reloaded
   twice by here and the run has to be read against a word set it is known to
   agree with. Driven through play/undo rather than the pointer: what is being
   tested is that the disc's events arrive, not where a word sits. */
const runDisc = new WordDisc();
runDisc.connectedCallback();
runDisc.setAttribute("fit", "");
runDisc._shadow.querySelector(".frame")._rect = { width: BOX + 300, height: BOX };
runDisc.setAttribute("id", "the-word-disc");
runDisc.data = { category: "test", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };

const runEl = new WordRun();
runEl.setAttribute("for", "the-word-disc");
runEl.connectedCallback();
const runLine = () => runEl._shadow.querySelector(".run");
const runText = () => runLine().textContent;
/* The words are nested inside the two ends now, so this counts through them
   rather than across the row. */
const runDone = () => {
  let n = 0;
  const walk = el => {
    for (const kid of el.children ?? []) {
      if (kid.className === "done") n++;
      walk(kid);
    }
  };
  walk(runLine());
  return n;
};
const runParts = () => runLine().children.map(c => c.className);
const playOn = w => runDisc.play(runDisc.words.indexOf(w));

check(
  runText().includes(`${FREE} words`),
  `at rest the run does not name the ${FREE}-word chain: ${runText()}`,
);
check(runDone() === 0, `nothing is played, yet ${runDone()} words read as played`);
/* Every word and every chevron is an item of the row, since what splits the
   line's spare width between each pair is space-between over those items. What
   has to hold is that nothing runs two words together: the row opens with its
   count, then a word, and no word ever stands next to another. The elision is
   a step like the words it stands for, so it takes a chevron on either side
   and reads as three items rather than one; strict alternation would refuse
   that, where the rule below allows it and still catches a chevron dropped.
   The stub carries no CSS, so the shape is all that can be seen from here. */
const isJoin = c => c === "sep" || c === "gap";
const illaid = () => {
  const parts = runParts();
  if (parts[0] !== "count") return `it opens with ${parts[0]}`;
  const body = parts.slice(1);
  if (!body.length || isJoin(body[0])) return `the chain opens with ${body[0]}`;
  if (isJoin(body[body.length - 1])) return `the chain ends on ${body[body.length - 1]}`;
  for (let i = 1; i < body.length; i++)
    if (!isJoin(body[i]) && !isJoin(body[i - 1])) return `${body[i - 1]} runs into ${body[i]}`;
  return null;
};
check(illaid() === null, `the unfolded run is laid out wrong: ${illaid()} — ${runParts()}`);
runEl.setAttribute("ends", "2");
check(illaid() === null, `the folded run is laid out wrong: ${illaid()} — ${runParts()}`);
/* Two words at each end is one chevron inside each of them and one on either
   side of the elision. Counted rather than left to the rule above, since the
   fault this replaced was chevrons missing from one end while the other kept
   them, and a rule about neighbours cannot see that. */
const runSeps = () => runParts().filter(c => c === "sep").length;
check(runSeps() === 4, `a run folded to two words each end drew ${runSeps()} chevrons, not 4`);
check(runParts().filter(c => c === "gap").length === 1, "the folded run has no elision in it");
runEl.removeAttribute("ends");

/* The binding is the feature: nothing below touches the run element, so a word
   reaching it is the disc's own event arriving. */
playOn("cat");
check(runDone() === 1, `after one move ${runDone()} words read as played`);
check(runText().startsWith(`${FREE - 1} more`), `after cat the run counts ${runText()}`);
playOn("trout");
check(runDone() === 2, `after two moves ${runDone()} words read as played`);
/* Winding back is heard the same way, undo going through the same #after. */
runDisc.undo();
check(runDone() === 1, `undo left ${runDone()} words reading as played`);

/* A change of category reaches it too, which is what embed.html's control
   rests on: it writes `src` on the disc and nothing at all on the run. The stub
   fetches nothing, so the word set is set the way a load would end up setting
   it, through the same #build. */
const OTHER = ["ant", "toad", "newt", "test", "tern"];
runDisc.data = { category: "other", words: OTHER, zipf: OTHER.map((_, i) => 8 - i) };
check(
  runEl.run.length > 0 && runEl.run.every(w => OTHER.includes(w)),
  `after a change of category the run is still ${runEl.run}`,
);
check(runDone() === 0, "a change of category left words reading as played");
runDisc.data = { category: "test", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };
check(
  runEl.run.join("|") === longestChain(WORDS).words.join("|"),
  `changing back did not restore the run: ${runEl.run}`,
);

/* A host that would rather own the answer sets it, and the element shows that
   instead of working one out. */
runEl.run = ["one", "two", "three"];
check(runText().includes("three"), `a run set by hand did not show: ${runText()}`);

/* Unbinding stops it: an element off the page must not hold the disc. */
runEl.disconnectedCallback();
const heldRun = runText();
playOn("toad");
check(runText() === heldRun, `a disconnected run still followed the disc: ${runText()}`);
/* And it lets go rather than merely ignoring what arrives: a listener left on
   the disc holds a detached element for the life of the page. */
check(
  (runDisc._on.get("word-chain") ?? []).length === 0 &&
    (runDisc._on.get("word-render") ?? []).length === 0,
  "a disconnected run left its listeners on the disc",
);

/* The letter graph, graph.py's claim drawn rather than printed: 26 nodes, one arc
   per letter pair some word bridges, nothing bundled. Weights span a factor of
   thirty, which is why the width is a log and why no arc is merged away. */
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

/* Nine words over six letters, two loops among them, with weight order and
   alphabetical order deliberately apart, so a ring that came back alphabetical
   would be saying something the picture does not. */
const LWORDS = ["cat", "cot", "tan", "tin", "toad", "dog", "area", "aorta", "nan"];
const LM = matrix(LWORDS);
check(LM.n === 9, `the matrix counted ${LM.n} words, not 9`);
check(LM.pairs === 6, `${LWORDS.length} words made ${LM.pairs} arcs, not 6`);
check(LM.loops === 2, `${LM.loops} arcs came back to their own letter, not 2`);
check(LM.starts[2] === 2 && LM.ends[19] === 2, "C does not leave twice or T does not arrive twice");
/* A word outside a to z is no edge of this graph. Nothing the exporter writes
   reaches this; a host building its own list does. */
check(matrix(["cat", "", "3d", "x-ray"]).n === 2, "a word outside a to z became an edge");

const LL = letterLayout(LM);
check(LL.live.length === 6, `${LL.live.length} letters carry traffic, not 6`);
check(LL.edges.length === 6 && LL.order.length === 6, "the layout lost an arc");

/* The one property proportional node arcs buy, and why there is no floor under
   one: a unit of weight is the same number of degrees everywhere, so a ribbon is
   the same width at both ends. Adding a floor back fails this. */
const perW = [];
for (const e of LL.edges) {
  perW.push((e.a0 - e.a1) / e.w, (e.b0 - e.b1) / e.w);
}
check(
  Math.max(...perW) - Math.min(...perW) < 1e-9,
  `a unit of weight is worth ${Math.min(...perW)} to ${Math.max(...perW)} radians round the ring`,
);
/* And the width is the log of the count rather than the count, which is what
   keeps a weight-1 arc visible beside a trunk. Linear fails this. */
check(
  Math.abs((LL.edges[0].a0 - LL.edges[0].a1) / weight(LL.edges[0].n) - perW[0]) < 1e-9,
  "an arc's width is not its log weight",
);
check(weight(32) / weight(1) < 6 && 32 / 1 > 6, "log weighting did not compress the range");

/* Every letter's arc is tiled exactly by its own ends, and the ring by the arcs
   and the gaps. A slot overrunning its arc lands a ribbon on the wrong letter. */
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

/* The shapes a real category can put through this, each landing the split at an
   end of its arc or leaving the ring almost bare. What is owed is ends of some
   width, finite angles, a split inside its own arc, and a round-tripping hit. */
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

/* The prune in front of the interior hit test. It is a prune rather than an
   answer, so what it owes is never refusing a point actually on a ribbon, checked
   by walking each ribbon's own boundary, rebuilt from letter-graph.js's own
   control points. Widening `near`'s wedge is inert; narrowing it fails. */
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
  /* Over the six-letter set above and over one whose arcs straddle the top of the
     ring. The second is not decoration: the wedge is the complement of the largest
     gap between an arc's four turns, and where nothing wraps the span from lowest
     to highest is the same answer, so a broken search would be inert. */
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
   rather than a spike at the centre. A fixed pull, which is what <word-disc>
   uses, would draw every short arc pointing inward. */
check(lpull(0) > lpull(Math.PI / 2), "a loop does not hug the ring more than a quarter turn");
check(lpull(Math.PI / 2) > lpull(Math.PI), "a quarter turn does not hug more than a half");
check(
  lpull(Math.PI) > 0 && lpull(0) < 1,
  `the pull left the range at ${lpull(0)}, ${lpull(Math.PI)}`,
);
check(TAPER > 0 && TAPER < 1, `the taper is ${TAPER}, which is no taper or an inverted one`);

/* The fill thinned by what the ring holds, the shape rather than the numbers: a
   ribbon is filled, so the alpha accumulates wherever two overlap. */
check(fade(ALPHA, 67) === ALPHA, "a sparse category was thinned");
check(fade(ALPHA, 120) === ALPHA, "the knee itself was thinned");
check(fade(ALPHA, 344) < fade(ALPHA, 200), "animal is not thinner than a middling category");
check(fade(ALPHA, 344) > 0.01, `animal fills at ${fade(ALPHA, 344)}, which cannot be seen`);

/* The sizing, which owes the same two things as <word-disc>'s: a disc that stays
   inside its own square and one that comes back positive at any size. */
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
   room, with the hub naming what the pointer is on instead. */
check(lsolve(70).labelPx === 0, `a 70px frame kept ${lsolve(70).labelPx}px letters`);
check(lsolve(80).labelPx > 0, "an 80px frame dropped its letters");
/* Either side of the floor, the only place the two can be compared: the frame
   that drops its letters has the bigger ring, their room having gone to it. */
check(
  lsolve(70).r > lsolve(80).r,
  `dropping the letters left the ring at ${lsolve(70).r} against ${lsolve(80).r} with them`,
);

/* And <letter-disc> itself, driven: class-body faults surface only on
   construction, so the real element is built here. The points a pointer is moved
   to come from letter-graph.js, so a hit says the element agrees with it. */
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
/* This disc carries no search box, no list and no crumb line. Read off the
   module's own text rather than the shadow root, because the stub builds one
   fragment for all three templates and every element gets a search box in it
   whether its own markup names one or not. */
{
  const tpl = readFileSync(new URL("../web/letter-disc.js", import.meta.url), "utf8");
  for (const gone of ['class="q"', 'class="hits"', 'class="arcs"', 'class="crumb"']) {
    check(!tpl.includes(gone), `letter-disc's markup still carries ${gone}`);
  }
}

check(ld.stats.pairs === 6 && ld.stats.loops === 2, `the element drew ${ld.stats.pairs} arcs`);
check(
  ld.stats.words === 9 && ld.stats.letters === 6,
  `the element counted ${ld.stats.words} words`,
);
/* One fill per arc on the base, in the colour of the letter the arc leaves,
   which is the only way from here to say the arcs were drawn at all. */
check(lBase.drew.fill === 6, `the base filled ${lBase.drew.fill} shapes for 6 arcs`);
check(new Set(lBase.fills).size > 1, "every arc was filled in the same colour");
/* Light before heavy, so the trunks read over the hairlines rather than the
   back of the alphabet reading over the front. Reversing the order fails this. */
let rising = true;
for (let k = 1; k < LL.order.length; k++) {
  if (LL.edges[LL.order[k]].w < LL.edges[LL.order[k - 1]].w) rising = false;
}
check(rising, "the arcs are not drawn light before heavy");

/* At rest the readout counts the picture, since nothing else on this disc does. */
check(
  lGloss.innerHTML.includes("<b>9</b> words over <b>6</b> letters") &&
    lGloss.innerHTML.includes("<b>6</b> arcs"),
  `the resting readout says "${lGloss.innerHTML}"`,
);

/* A pointer on the ring, at the middle of a known end, computed from the
   element's own geometry, so a hit says it and letter-graph.js agree. */
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
   what ties this disc to <word-disc>. */
check(
  lGloss.innerHTML.includes("<b>C → T</b>") && lGloss.innerHTML.includes("cat, cot"),
  `the arc reads "${lGloss.innerHTML}"`,
);
/* A pointer outside the ring is on a letter, which lights everything touching
   it in either direction — the letter's whole part in the picture. */
const tArc = LL.arcs.find(a => a.letter === 19);
fire(lOver, "pointermove", letterPt(tArc));
check(ld.arc === null, "the letter band answered with an arc");
check(
  lGloss.innerHTML.includes("<b>T</b>") && lGloss.innerHTML.includes("3 words start here"),
  `the letter reads "${lGloss.innerHTML}"`,
);

/* A click on an arc drills to the letter it leaves; pointing never does, so a
   hover cannot move what a click landed on. Calling show from #preview fails. */
check(ld.letter === "", `a hover drilled to ${ld.letter}`);
fire(lOver, "click", ringPt(heavyEnd));
check(ld.letter === "C", `clicking the C→T arc drilled to ${ld.letter}`);

/* A letter only highlights, so clicking one leaves the drill where it was. */
fire(lOver, "click", letterPt(tArc));
check(ld.letter === "C", `clicking T's band drilled to ${ld.letter}`);

/* The long arcs are bowed through the middle, so the middle is asked before
   the hub is. The stub answers no, which is what leaves the way out reachable
   on the line below. */
lOver.drew.inPath = 0;
fire(lOver, "pointermove", { offsetX: lmid, offsetY: lmid });
check(lOver.drew.inPath > 0, "the pointer in the middle never asked the arcs");
/* And the hub is the way back out, which is the one thing clicking an arc
   cannot do. */
fire(lOver, "click", { offsetX: lmid, offsetY: lmid });
check(ld.letter === "", `clicking the hub left the disc drilled into ${ld.letter}`);

/* The hub, disc-label.js's halo and baseline rather than a second copy: nothing
   stroked, the ground copies of the ink's own call ringed at one radius about
   the point the ink goes down at, and the ink last. */
fire(lOver, "pointerleave", {});
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

/* Stacked, the column goes and the readout drops under the disc. */
const lFrame = lShadow.querySelector(".frame");
const lStage = lShadow.querySelector(".stage");
lFrame._rect = { width: BOX, height: BOX };
lStage._rect = { width: BOX, height: BOX };
resize();
check(!lFrame.classList.contains("wide"), "a narrowed frame kept the column beside the disc");

/* And back again, the half that firing every callback on every resize could never
   show. Stacked, the stage is a square of the height the flex column leaves, so a
   frame growing wider leaves its box where it was and an element observing only
   its stage gets no callback on the way back out. */
lFrame._rect = { width: BOX + 300, height: BOX };
resize();
check(
  lFrame.classList.contains("wide"),
  "a frame dragged wide again with its stage unmoved stayed in the stacked layout",
);

/* And this disc gives its pixels back too, which here is the two canvases and
   nothing else: it strokes its ribbons straight onto the base, so there is no
   resting picture held beside them the way <word-disc> holds its bundle. */
const lBig = lBase.width;
check(lBig > 0, "the letter disc had no pixels to give back");
await away();
check(
  lBase.width === 0 && lOver.width === 0,
  `a letter disc a screen away kept a ${lBase.width}px canvas`,
);
await new Promise(r => setTimeout(r, 80));
const lWasStage = lStage._rect;
lStage._rect = { width: BOX - 8, height: BOX - 8 };
resize();
check(lBase.width === 0 && lOver.width === 0, "a resize woke a letter disc that was a screen away");
lStage._rect = lWasStage;
nearScreen(true);
check(lBase.width === lBig, `coming back left the letter canvas at ${lBase.width} of ${lBig}`);

/* This disc gives its pixels back the same way, and its base canvas may belong to
   the painter: a dimension cannot be set on a transferred canvas, so the painter
   is asked to empty it. Driven here the painter is on this thread. */
nest._shadow.querySelector(".frame")._rect = { width: BOX + 300, height: BOX };
resize();
const nestBase = nest._shadow.querySelector(".base").width;
check(nestBase > 0, "the nested disc had no pixels to give back");
await away();
check(
  nest._shadow.querySelector(".base").width === 0 &&
    nest._shadow.querySelector(".over").width === 0,
  "a nested disc a screen away kept its canvases",
);
await new Promise(r => setTimeout(r, 80));
const wasNestStage = nest._shadow.querySelector(".stage")._rect;
nest._shadow.querySelector(".stage")._rect = { width: BOX - 8, height: BOX - 8 };
resize();
check(
  nest._shadow.querySelector(".base").width === 0 &&
    nest._shadow.querySelector(".over").width === 0,
  "a resize woke a nested disc that was a screen away",
);
nest._shadow.querySelector(".stage")._rect = wasNestStage;
nearScreen(true);
check(
  nest._shadow.querySelector(".base").width === nestBase,
  `coming back left the nested canvas at ${nest._shadow.querySelector(".base").width}`,
);

/* The definitions, held as the file and an offset per line. An offset out by one
   returns the tail of the line above, which reads as a definition and is
   nobody's, so the lines are what is asserted. */
const { Lines } = await import(mod("disc-lines.js"));
const GLOSS = "a small carnivore\nthe first letter\n(mathematics) a set";
const gl = new Lines(GLOSS);
check(gl.length === 3, `three definitions came back as ${gl.length}`);
check(gl.at(0) === "a small carnivore", `the first line is "${gl.at(0)}"`);
check(gl.at(1) === "the first letter", `the second line is "${gl.at(1)}"`);
check(gl.at(2) === "(mathematics) a set", `the last line is "${gl.at(2)}"`);
check(gl.at(3) === "" && gl.at(-1) === "", "a line the file does not reach came back");
check(new Lines("").length === 0, "an empty file has a line in it");
check(new Lines(["one", "two"]).at(1) === "two", "an array of lines did not come back");
/* And the readout reads one, which is what the element does with them. */
nest.glosses = GLOSS;
nest.zoomTo(0);
check(
  nest._shadow.querySelector(".gloss").textContent === "A small carnivore",
  `the readout says "${nest._shadow.querySelector(".gloss").textContent}"`,
);

/* The balancing flow, kept rather than only solved. `trace` is the solve `chain`
   already does with its working shown, so what is asserted is that the working
   adds up to the answer: every path runs from a surplus letter to a deficit one,
   the pushes clear exactly what was owed, and replaying every step leaves all 26
   letters with as many words leaving as arriving. None of that shows in a chain,
   which is why it is asserted here rather than through one. */
const {
  ALPHA: BANK_ALPHA,
  bands,
  banks,
  KNEE: BANK_KNEE,
  reverses,
  route,
  shipped,
  thin: bankThin,
  walk: bankWalk,
} = await import(mod("balance-bank.js"));

/** Whatever stops `tr` being an account of balancing `words`, or null. */
const unbalanced = (words, tr) => {
  const m = matrix(words).count;
  const y = new Int32Array(26 * 26);
  for (const f of tr.frames) {
    if (!(tr.excess[f.from] > 0) || !(tr.excess[f.to] < 0))
      return `a path runs ${f.from} to ${f.to}, which are not a surplus and a deficit`;
    if (!(f.push > 0) || !(f.cost > 0)) return `a path pushed ${f.push} at a cost of ${f.cost}`;
    const seq = bankWalk(f.steps);
    if (seq[0] !== f.from || seq[seq.length - 1] !== f.to)
      return `a path walks ${seq} where its frame says ${f.from} to ${f.to}`;
    // The cost is what the path leaves discarded: one for every pair it takes a
    // word from, less one for every pair it gives a word back to.
    if (f.steps.reduce((n, s) => n + (s > 0 ? 1 : -1), 0) !== f.cost)
      return `a path of ${f.steps.length} steps came back costing ${f.cost}`;
    for (const s of f.steps) {
      if (s > 0) y[s - 1] += f.push;
      else y[-s - 1] -= f.push;
    }
  }
  for (let i = 0; i < 26 * 26; i++)
    if (y[i] < 0 || y[i] > m[i]) return `cell ${i} comes out discarding ${y[i]} of ${m[i]}`;
  const left = Int32Array.from(tr.excess);
  for (let u = 0; u < 26; u++)
    for (let v = 0; v < 26; v++) {
      const q = y[u * 26 + v];
      if (q) {
        left[u] -= q;
        left[v] += q;
      }
    }
  if (tr.settled && left.some(x => x !== 0)) return `${[...left]} is still owing`;
  let paid = 0;
  for (const f of tr.frames) paid += f.push * f.cost;
  if (paid !== tr.paid) return `the paths cost ${paid} where the trace says ${tr.paid}`;
  return null;
};

const TR = chainTrace(WORDS);
check(TR.settled, "the balancing flow on the test words did not settle");
check(TR.frames.length >= 2, `the test words balance in ${TR.frames.length} augmentations`);
check(unbalanced(WORDS, TR) === null, `the trace is no account of it — ${unbalanced(WORDS, TR)}`);
check(
  shipped(TR.frames, TR.frames.length) === TR.need,
  `${shipped(TR.frames, TR.frames.length)} units shipped against ${TR.need} owed`,
);
check(shipped(TR.frames, 0) === 0, "nothing run had already shipped something");
/* Tracing must not move an answer. FREE was taken before any of this ran. */
check(longestChain(WORDS).words.length === FREE, "tracing the flow moved the chain it comes from");
{
  let total = 0;
  const m = matrix(WORDS).count;
  for (let i = 0; i < 26 * 26; i++) total += m[i];
  check(
    total - TR.paid <= longestChain(WORDS).bound,
    `the circuit keeps ${total - TR.paid}, past the chain's own bound`,
  );
}
check(chainTrace([]).frames.length === 0, "an empty category traced an augmentation");

/* The list the geometry below is cut for. WORDS balances in three paths of one
   unit each, one path a letter, which cannot tell a slot that fills up from one
   that never advances or a push from the count of pushes. Here A ships three
   times, F receives three times, and A to B carries two words, so one push is
   worth more than one band. */
const BWORDS = ["ab", "axb", "ac", "ad", "ef", "gf", "hf"];
const BTR = chainTrace(BWORDS);
check(BTR.settled && BTR.need === 7, `the built list owes ${BTR.need} units, not 7`);
check(unbalanced(BWORDS, BTR) === null, `the built list traced badly — ${unbalanced(BWORDS, BTR)}`);
check(
  shipped(BTR.frames, BTR.frames.length) === BTR.need,
  `${shipped(BTR.frames, BTR.frames.length)} shipped against ${BTR.need} owed`,
);
check(
  BTR.frames.some(f => f.push > 1),
  "no path moved more than one word, so a push cannot be told from a count of them",
);

/* And over lists nobody wrote down, which is where a step signed the wrong way
   would show: it would still ship the right total and walk the wrong graph. */
let traced = 0;
for (let trial = 0; trial < 60; trial++) {
  const alphabet = "abcdef".slice(0, 2 + roll(4));
  const list = new Set();
  for (let i = 0, n = 4 + roll(10); i < n; i++) {
    let word = "";
    for (let j = 0, len = 2 + roll(3); j < len; j++) word += alphabet[roll(alphabet.length)];
    list.add(word);
  }
  const words = [...list];
  const got = chainTrace(words);
  traced += got.frames.length;
  const wrong = unbalanced(words, got);
  if (wrong !== null) {
    check(false, `a random list traced badly — ${wrong}: ${words}`);
    break;
  }
}
check(traced > 0, "60 random lists balanced without a single augmentation");

/* The two columns on their own. A unit of imbalance has to be worth the same
   height on both sides — the ends of a band would not line up otherwise — and
   the column cut into the most slots is the one that fills the span. */
const BANK = banks(BTR.excess, 600, 6);
check(BANK.need === BTR.need, `the bank was cut for ${BANK.need} units against ${BTR.need}`);
check(BANK.left.length > 0 && BANK.right.length > 0, "a bank came back with nothing on one side");
{
  const per = [...BANK.left, ...BANK.right].map(s => s.h / s.units);
  check(
    Math.max(...per) - Math.min(...per) < 1e-9,
    `a unit is worth ${Math.min(...per)} to ${Math.max(...per)} pixels`,
  );
  const tall = BANK.left.length >= BANK.right.length ? BANK.left : BANK.right;
  const short = tall === BANK.left ? BANK.right : BANK.left;
  const fills = tall[tall.length - 1];
  check(
    Math.abs(fills.y0 + fills.h - 600) < 1e-9,
    `the taller column ends at ${fills.y0 + fills.h} of the 600 it was given`,
  );
  const ends = short[short.length - 1];
  check(ends.y0 + ends.h <= 600 + 1e-9, `the shorter column ran to ${ends.y0 + ends.h}`);
}
check(banks(new Int32Array(26), 600, 6).need === 0, "a balanced category owed something");

/* The bands, which are the whole of what a step draws. Each slot is tiled by the
   bands that touch it, in the order the solver found them: no gap, no overlap,
   and the last of them ending where the slot does. A band past its slot is a
   picture saying a letter shipped more than it ever had. */
const LAID = bands(BTR.frames, BANK, BTR.frames.length);
check(LAID.length === BTR.frames.length, `${BTR.frames.length} paths laid ${LAID.length} bands`);
check(bands(BTR.frames, BANK, 0).length === 0, "nothing run laid a band down");
check(bands(BTR.frames, BANK, 1).length === 1, "one augmentation laid more than one band");
check(
  BANK.left.some(slot => LAID.filter(b => b.from === slot.letter).length > 2),
  "no slot holds more than two bands, so the tiling below is nothing to hold",
);
{
  let wrong = null;
  for (const [side, end, at] of [
    [BANK.left, "from", "a"],
    [BANK.right, "to", "b"],
  ]) {
    for (const slot of side) {
      let y = slot.y0;
      for (const b of LAID.filter(one => one[end] === slot.letter)) {
        if (Math.abs(b[at] - y) > 1e-9) wrong = `a band opens at ${b[at]} where ${y} was free`;
        y += b.h;
      }
      if (Math.abs(y - (slot.y0 + slot.h)) > 1e-9)
        wrong = `${slot.letter}'s bands fill to ${y} of a slot ending at ${slot.y0 + slot.h}`;
    }
  }
  check(wrong === null, `the bands do not tile their slots — ${wrong}`);
}

/* A step is signed, and the sign is which way its pair is read. Unsigned, a
   reverse step walks the wrong way and the path comes back naming letters the
   frame does not. */
check(bankWalk([2 * 26 + 19 + 1]).join(",") === "2,19", "a forward step is not read head to tail");
check(
  bankWalk([-(2 * 26 + 19 + 1)]).join(",") === "19,2",
  "a reverse step is not read tail to head",
);
check(bankWalk([]).length === 0, "an empty path walked somewhere");
check(bankThin(BANK_ALPHA, BANK_KNEE) === BANK_ALPHA, "a stack at the knee was thinned");
check(bankThin(BANK_ALPHA, BANK_KNEE * 4) < BANK_ALPHA, "four times the knee was not thinned");
check(bankThin(BANK_ALPHA, BANK_KNEE * 4) > 0, "a large category was thinned to nothing");

/* The lit band's own line, which is the one place a reverse arc is drawn. A band
   is otherwise a sweep from one column to the other and says nothing about the
   arcs between its ends; a recovery shows by direction alone, the leg spending a
   negative arc running right to left where every other leg runs left to right.

   RWORDS is cut for it. Its last path is b→e→c⇠d→a, which banks every letter it
   walks and takes in both columns on the way, and the one before it is b→e→c,
   multi-arc and not lit, which is what stops the counts below reading the same
   whether the lit band alone is routed or all of them are. */
const RWORDS = "bae bbae bbc bbdb be bece cc ce dc dcda eb ebd ec ecac".split(" ");
const RTR = chainTrace(RWORDS);
const RBANK = banks(RTR.excess, 600, 6);
const RLAID = bands(RTR.frames, RBANK, RTR.frames.length);
check(RTR.frames.length === 5, `the routed list balances in ${RTR.frames.length} paths, not 5`);
check(RLAID.length === RTR.frames.length, "a routed band was dropped for want of a slot");
{
  const rev = RTR.frames.length - 1;
  const one = RTR.frames.findIndex(f => f.steps.length === 1);
  check(
    RTR.frames[rev].steps.some(s => s < 0),
    "the routed list's last path recovers nothing",
  );
  check(one >= 0, "the routed list holds no one-arc path");
  // A one-arc path is the plain sweep, so routing it has to move nothing at all.
  const flat = route(RTR.frames[one], RLAID[one], RBANK, 100, 400, 20);
  check(
    flat.length === 2 && flat[0].x === 100 && flat[1].x === 400,
    `a one-arc path routed through ${flat.length} points`,
  );
  const line = route(RTR.frames[rev], RLAID[rev], RBANK, 100, 400, 20);
  const seq = bankWalk(RTR.frames[rev].steps);
  check(
    line.length === seq.length,
    `a ${seq.length}-letter path routed through ${line.length} points`,
  );
  // Both ends stay on the band's own slice, so a routed band tiles its slots
  // exactly as an unrouted one does and the tiling asserted above still holds.
  check(
    line[0].y === 20 + RLAID[rev].a && line[line.length - 1].y === 20 + RLAID[rev].b,
    "a routed band does not open and close on its own slice",
  );
  let wrong = null;
  for (const [i, step] of RTR.frames[rev].steps.entries()) {
    if (line[i + 1] === undefined) {
      wrong = `arc ${i} has no point to run to`;
      break;
    }
    const back = line[i + 1].x < line[i].x;
    if (step > 0 === back)
      wrong = `arc ${i} signed ${Math.sign(step)} runs ${back ? "back" : "on"}`;
  }
  check(wrong === null, `a leg runs against its arc — ${wrong}`);
  /* Every point says which letter it stands on, which is what the element names
     the turns off. Worked out again by counting along the walk it would be right
     only until the first letter route drops. */
  check(
    line.map(p => p.letter).join(",") === seq.join(","),
    `the routed points name ${line.map(p => p.letter)} against a walk of ${seq}`,
  );
  check(
    line.some((p, i) => i > 0 && p.x < line[i - 1].x),
    "the reversing path came back with no leg running right to left",
  );
  // An interior letter is passed through rather than shipped from, so the line
  // crosses the middle of its slot and takes no slice of it. Both columns are
  // walked here, so a lookup built over one of them alone would show.
  const slots = [...RBANK.left, ...RBANK.right];
  for (const [i, v] of seq.slice(1, -1).entries()) {
    const slot = slots.find(one => one.letter === v);
    const at = line[i + 1];
    check(
      at !== undefined && Math.abs(at.y + RLAID[rev].h / 2 - (20 + slot.y0 + slot.h / 2)) < 1e-9,
      `letter ${v} is not crossed at the middle of its slot`,
    );
  }
}
{
  // A balanced letter banks nowhere, so it is dropped rather than drawn at an
  // invented height. a → b → c, where b owes nothing and holds no slot.
  const excess = new Int32Array(26);
  excess[0] = 1;
  excess[2] = -1;
  const bank = banks(excess, 600, 6);
  const band = bands([{ from: 0, to: 2, push: 1 }], bank, 1)[0];
  const cell = (head, tail) => head * 26 + tail + 1;
  const through = route({ steps: [cell(0, 1), cell(1, 2)], cost: 2 }, band, bank, 100, 400, 20);
  check(through.length === 2, `a letter banking nowhere took ${through.length - 2} points`);
}
{
  /* And a drop with a banked letter after it: a → b → c → d, where b owes
     nothing and c banks. The point that survives has to name the letter it
     stands on rather than the next one along, which is the whole reason a point
     carries its letter instead of the element counting along the walk. */
  const excess = new Int32Array(26);
  excess[0] = 1;
  excess[2] = 1;
  excess[3] = -2;
  const bank = banks(excess, 600, 6);
  const band = bands([{ from: 0, to: 3, push: 1 }], bank, 1)[0];
  const cell = (head, tail) => head * 26 + tail + 1;
  const past = route(
    { steps: [cell(0, 1), cell(1, 2), cell(2, 3)], cost: 3 },
    band,
    bank,
    100,
    400,
    20,
  );
  check(
    past.map(p => p.letter).join(",") === "0,2,3",
    `a drop left the points naming ${past.map(p => p.letter)} against 0,2,3`,
  );
}

/* The steps the scrub marks. A mark stands on the step that puts the reversing
   path under the reader, which is one past the frame's own index: reading it off
   the frame would leave every mark a step early, and on a 144-step scrub a step
   is 3.5 px. */
{
  const at = reverses(RTR.frames);
  const want = RTR.frames.flatMap((f, i) => (f.steps.some(s => s < 0) ? [i + 1] : []));
  check(at.join(",") === want.join(","), `the marks are ${at} against ${want}`);
  check(at.length > 0, "the routed list marks nothing, so the element claim below is vacuous");
  check(
    at.every(k => RTR.frames[k - 1].steps.some(s => s < 0)),
    "a mark stands on a step whose path recovers nothing",
  );
  check(reverses([]).length === 0, "an empty trace marked a step");
  check(reverses([{ steps: [1, 2] }]).length === 0, "a path of forward arcs alone was marked");
}

/* <balance-flow>. The transport is the whole of its state — the bands drawn are
   the ones below the step it stands at, and the line under them names the last
   of those — so what is driven here is the keys and the scrub. */
const BalanceFlow = REGISTRY.get("balance-flow");
check(BalanceFlow !== undefined, "balance-flow never reached the registry");

const bf = new BalanceFlow();
bf.connectedCallback();
bf.setAttribute("fit", "");
const bShadow = bf._shadow;
const bStage = bShadow.querySelector(".stage");
bStage._rect = { width: BOX + 300, height: BOX };
const bBase = bShadow.querySelector(".base");
const bGloss = bShadow.querySelector(".gloss");
const bScrub = bShadow.querySelector(".scrub");
for (const k of Object.keys(drew)) drew[k] = 0;
bf.data = { category: "test", words: BWORDS };

check(
  bf.frames === BTR.frames.length,
  `the element found ${bf.frames} paths, not ${BTR.frames.length}`,
);
check(bf.step === bf.frames, `the element opened at step ${bf.step} of ${bf.frames}`);
check(
  bf.stats.need === BTR.need && bf.stats.paid === BTR.paid,
  `the element's figures are ${bf.stats.need}/${bf.stats.paid}, not ${BTR.need}/${BTR.paid}`,
);
/* Two cubics a band and one rectangle a slot, which is how a band drawn twice or
   a slot drawn for a letter that owes nothing would show. */
check(bBase.drew.curve === bf.frames * 2, `${bf.frames} bands drew ${bBase.drew.curve} cubics`);
check(
  bBase.drew.fillRect === BANK.left.length + BANK.right.length,
  `${bBase.drew.fillRect} bank rectangles for ${BANK.left.length + BANK.right.length} slots`,
);
check(
  bGloss.innerHTML.includes("<b>balanced</b>") &&
    bGloss.innerHTML.includes(`<b>${BTR.paid.toLocaleString("en-GB")}</b>`),
  `the balanced readout says "${bGloss.innerHTML}"`,
);

bf.seek(0);
check(bf.step === 0 && bScrub.value === "0", `seek(0) left the element at ${bf.step}`);
check(
  bGloss.innerHTML.includes("nothing shipped yet"),
  `at nothing run it says "${bGloss.innerHTML}"`,
);
bBase.drew.curve = 0;
bf.seek(0);
check(bBase.drew.curve === 0, "nothing run still drew a band");
bf.seek(1);
check(bBase.drew.curve === 2, `one path drew ${bBase.drew.curve / 2} bands`);
{
  /* The line names the augmentation the picture just laid, which is what catches
     a readout describing the step about to run instead. */
  const f = BTR.frames[0];
  const from = String.fromCharCode(65 + f.from),
    to = String.fromCharCode(65 + f.to);
  check(
    bGloss.innerHTML.includes(`<b>${from} → ${to}</b>`),
    `after one step the readout says "${bGloss.innerHTML}"`,
  );
  check(
    bGloss.innerHTML.includes(`push ${f.push} · cost ${f.cost}`),
    `the path line says "${bGloss.innerHTML}"`,
  );
}

/* The event a host binds to, which names letters rather than indices. */
let stepSaid = null;
bf.addEventListener("balance-step", e => {
  stepSaid = e.detail;
});
bf.seek(2);
check(stepSaid?.step === 2, `the element said it was at ${stepSaid?.step} after seeking to 2`);
check(
  stepSaid?.shipped === shipped(BTR.frames, 2),
  `it said ${stepSaid?.shipped} shipped where the trace says ${shipped(BTR.frames, 2)}`,
);
check(
  stepSaid?.from === String.fromCharCode(65 + BTR.frames[1].from),
  `the step names ${stepSaid?.from} where the trace leaves ${BTR.frames[1].from}`,
);
bf.seek(-5);
check(bf.step === 0, `seeking before the start left the element at ${bf.step}`);
bf.seek(bf.frames + 5);
check(bf.step === bf.frames, `seeking past the end left the element at ${bf.step}`);

/* The keys, driven as a browser drives them: the rail is why the shared fragment
   gained one. */
const bKey = cls => fire(bShadow.querySelector(cls), "click", {});
bKey(".first");
check(bf.step === 0, `the first key left the element at ${bf.step}`);
bKey(".next");
check(bf.step === 1, `the next key left the element at ${bf.step}`);
bKey(".prev");
check(bf.step === 0, `the prev key left the element at ${bf.step}`);
bKey(".last");
check(bf.step === bf.frames, `the last key left the element at ${bf.step}`);
bScrub.value = "1";
fire(bScrub, "input", {});
check(bf.step === 1, `the scrub set to 1 left the element at ${bf.step}`);

/* Play rewinds rather than sitting at the balanced end, and the same key stops
   it. Nothing here is timed: a timer left running holds the process open, which
   is the other reason to assert that it stops. */
check(!bf.playing, "the element was playing before anything asked it to");
bKey(".last");
bKey(".play");
check(bf.playing && bf.step === 0, `play from the balanced end left it at ${bf.step}`);
bKey(".play");
check(!bf.playing, "the play key did not stop a run it had started");

/* And at the element: the lit band is the only one routed, so the step standing
   on a multi-arc path draws two cubics a leg and every band below it draws two.
   BWORDS above is one-arc paths throughout, which is what makes the count there
   a claim about the plain sweep being left alone. */
bf.data = { category: "routed", words: RWORDS };
{
  const { HALO_STEPS } = await import(mod("disc-label.js"));
  const legs = n => route(RTR.frames[n - 1], RLAID[n - 1], RBANK, 0, 1, 0).length - 1;
  /* Which letters the element has to name: the ones the lit path walks between
     its ends, less any that bank nowhere. Whether a letter banks is a property of
     the excess rather than of the span, so RBANK answers for the element's own
     bank as well. */
  const banked = new Set([...RBANK.left, ...RBANK.right].map(one => one.letter));
  const turnsOf = n =>
    bankWalk(RTR.frames[n - 1].steps)
      .slice(1, -1)
      .filter(v => banked.has(v))
      .map(v => String.fromCharCode(65 + v));
  const plain = RTR.frames.findIndex(f => f.steps.length === 1) + 1;
  check(legs(RTR.frames.length) > 1, "the lit path routes to one leg, so the counts are vacuous");
  check(legs(RTR.frames.length - 1) > 1, "the path below the last one routes to one leg");
  for (const at of [RTR.frames.length, RTR.frames.length - 1, plain]) {
    bBase.drew.curve = 0;
    bBase.drew.stroke = 0;
    bBase.moves.length = 0;
    bBase.lines.length = 0;
    bBase.curves.length = 0;
    bBase.inks.length = 0;
    bBase.nibs.length = 0;
    bBase.fills.length = 0;
    bBase.text.fill.length = 0;
    bf.seek(at);
    check(
      bBase.drew.curve === (at - 1) * 2 + legs(at) * 2,
      `${at} bands with a ${legs(at)}-leg path lit drew ${bBase.drew.curve} cubics`,
    );
    /* And every band opens on its own slice of the surplus column, which needs
       no scale to say: the slots run down that column in letter order and the
       bands tile each one in the order the solver found them, so sorting the
       openings that way has to put them in ascending order. Handed the other
       end's slice they would come back ordered by where they land. */
    check(bBase.moves.length === at, `${at} bands opened ${bBase.moves.length} paths`);
    /* Lit is an edge as well as an alpha, since the band the readout names can
       be half a pixel tall and an alpha has nothing to raise there. One stroke,
       on the band the readout means, in that band's own ink: a stroke on every
       band would light none of them, and a stroke in another colour would stop
       saying which letter the words left. */
    check(bBase.drew.stroke === 1, `${at} bands went down with ${bBase.drew.stroke} strokes`);
    check(
      bBase.inks[0] === bBase.fills[bBase.fills.length - 1],
      `the lit band is stroked ${bBase.inks[0]} over a fill of ${bBase.fills[bBase.fills.length - 1]}`,
    );
    const nib = bBase.nibs[0] ?? { width: 0, join: "none" };
    check(
      nib.width > 0 && nib.join === "round",
      `the edge goes down ${nib.width}px wide, joined ${nib.join}`,
    );
    /* The lit band's two edges, which is the shape every band is drawn in. Its
       far edge turns back the band's own height below where the near edge
       arrived, and the near edge comes home that same height below where the
       band opened. Both lying on one another would still count as two cubics a
       leg. */
    {
      const near = bBase.curves[bBase.curves.length - legs(at) - 1];
      const home = bBase.curves[bBase.curves.length - 1];
      const tall = bBase.lines[bBase.lines.length - 1].y - near.y;
      check(tall > 0, `the lit band turns back ${tall.toFixed(2)}px below its near edge`);
      check(
        Math.abs(home.y - bBase.moves[bBase.moves.length - 1].y - tall) < 1e-9,
        `the lit band comes home ${(home.y - bBase.moves[bBase.moves.length - 1].y).toFixed(2)}px below where it opened, against ${tall.toFixed(2)}`,
      );
    }
    /* The letters that band turns on, named where it turns. The ink is the band's
       own, so the turn glyphs are the only text on the picture in it: the columns
       and the two headings are muted and the halo is the ground. A one-arc path
       is the plain sweep and names nothing, which is what holds the naming to the
       lit band rather than to every band the picture holds, and the ends are left
       to the columns. */
    {
      const ink = bBase.fills[bBase.fills.length - 1];
      const at2 = bBase.text.fill.flatMap((one, i) => (one.c === ink ? [i] : []));
      const named = at2.map(i => bBase.text.fill[i]);
      const want = turnsOf(at);
      if (at === RTR.frames.length) {
        check(
          want.length > 1,
          `the lit path turns on ${want.length} letters, so the claims are thin`,
        );
      }
      check(
        named.map(one => one.t).join("") === want.join(""),
        `${at} bands named ${named.map(one => one.t)} against turns of ${want}`,
      );
      /* And in three colours across the whole picture: the muted token the columns
         and the two headings go down in, the ground the haloes clear, and the lit
         band's own ink. A second band named would put its own hue in there as a
         fourth, which the count of ink fills above cannot see where it happens to
         leave the same letter as the lit one. */
      const inks = new Set(bBase.text.fill.map(one => one.c));
      check(
        inks.size === (want.length ? 3 : 1),
        `${at} bands put ${inks.size} colours of text on the picture, naming ${want.length} turns`,
      );
      // Over the point it stands on, and above the band's own top edge by one
      // lift throughout: a glyph that changed side by the bend it sits on would
      // be a rule the reader has to work out for every turn.
      const near = bBase.curves.slice(-2 * legs(at), -legs(at)).slice(0, -1);
      check(
        named.length === near.length && named.every((one, i) => one.x === near[i].x),
        `a turn is named at ${named.map(one => one.x.toFixed(1))} against points at ${near.map(one => one.x.toFixed(1))}`,
      );
      const lift = named.map((one, i) => near[i].y - one.y);
      check(
        lift.every(up => up > 0 && Math.abs(up - lift[0]) < 1e-9),
        `the glyphs sit ${lift.map(up => up.toFixed(2))} above their turns`,
      );
      /* And each over a halo, since the line crosses whatever bands the picture
         already holds. HALO_STEPS copies of the same glyph in one other colour,
         every one of them the ring's radius off the ink: a halo in the ink's own
         colour would thicken the glyph rather than clear the ground behind it,
         and one at no radius would not be there at all. */
      for (const [k, i] of at2.entries()) {
        const ring = bBase.text.fill.slice(i - HALO_STEPS, i);
        const off = ring.map(one => Math.hypot(one.x - named[k].x, one.y - named[k].y));
        check(
          ring.length === HALO_STEPS &&
            ring.every(one => one.t === named[k].t && one.c !== ink && one.c === ring[0].c) &&
            off.every(r => r > 0 && Math.abs(r - off[0]) < 1e-9),
          `the glyph ${named[k].t} went down over ${ring.length} copies at ${off.map(r => r.toFixed(2))}`,
        );
      }
    }
    for (const [end, at2, said] of [
      ["from", bBase.moves, "open"],
      ["to", bBase.lines, "close"],
    ]) {
      const down = RTR.frames
        .slice(0, at)
        .map((f, i) => ({ letter: f[end], i }))
        .sort((one, two) => one.letter - two.letter || one.i - two.i)
        .map(one => at2[one.i].y);
      check(
        down.every((y, i) => i === 0 || y > down[i - 1]),
        `the bands ${said} at ${down.map(y => y.toFixed(1))}, which is not down the column`,
      );
    }
  }
}

/* And the marks on the scrub, one a reversing step, placed along the thumb's own
   travel. A mark at a plain percentage of the track would sit half a thumb out
   at one end and half a thumb in at the other, which at 144 steps is two steps
   of error. */
{
  const marks = bShadow.querySelector(".marks");
  const at = reverses(RTR.frames);
  check(
    marks.children.length === at.length,
    `${at.length} reversing steps drew ${marks.children.length} marks`,
  );
  const put = marks.children.map(one => {
    const got = /\*\s*([0-9.]+)\)$/.exec(one.style.left);
    return got ? Number(got[1]) : Number.NaN;
  });
  check(
    put.every((x, i) => Math.abs(x - at[i] / RTR.frames.length) < 1e-9),
    `the marks sit at ${put} of the travel, against ${at.map(k => k / RTR.frames.length)}`,
  );
  /* The travel, both halves of it: a mark opens half a thumb in from the end,
     and its span is the track less a whole thumb. Either half alone still names
     --_thumb and still lands a mark two steps out at one end. */
  check(
    marks.children.every(
      one =>
        one.style.left.includes("var(--_thumb) / 2") &&
        one.style.left.includes("100% - var(--_thumb)"),
    ),
    `a mark is placed at "${marks.children[0]?.style.left}" rather than along the thumb's travel`,
  );
  // A word set with nothing to mark leaves none behind, which is what a
  // rebuild that appends rather than replaces would show.
  bf.data = { category: "plain", words: BWORDS };
  check(
    bShadow.querySelector(".marks").children.length === 0,
    "a list whose paths recover nothing still carries marks",
  );
  bf.data = { category: "routed", words: RWORDS };
}

/* It gives its canvas back a screen away, and stops playing with it: a run
   nobody can see is a timer spending frames on nothing. Coming back does not
   start it again.

   Driven on a list of twenty paths, so the run cannot reach its end inside the
   hold below and finish of its own accord — which is what the claim would
   otherwise be resting on rather than on the sleep. */
const BLONG = [];
for (let v = 1; v <= 20; v++) BLONG.push(`a${String.fromCharCode(97 + v)}`);
bf.data = { category: "long", words: BLONG };
check(bf.frames === 20, `the long list balances in ${bf.frames} augmentations, not 20`);
const bBig = bBase.width;
check(bBig > 0, "the element had no pixels to give back");
bKey(".first");
bKey(".play");
check(bf.playing, "the play key did not start a run");
await away();
check(bBase.width === 0, `an element a screen away kept a ${bBase.width}px canvas`);
check(!bf.playing, "an element a screen away went on playing");
nearScreen(true);
check(bBase.width === bBig, `coming back left the canvas at ${bBase.width} of ${bBig}`);
check(!bf.playing, "coming back into view started a run of its own accord");

/* A change of words is a fresh solve and a fresh transport. */
const BOTHER = ["ant", "toad", "newt", "tern", "nan"];
bf.data = { category: "other", words: BOTHER };
check(
  bf.frames === chainTrace(BOTHER).frames.length && bf.frames > 0,
  `a change of category left ${bf.frames} augmentations`,
);
check(bf.step === bf.frames, `a change of category opened at ${bf.step} of ${bf.frames}`);
bKey(".play");
bf.disconnectedCallback();
check(!bf.playing, "a disconnected element left its run going");

/* embed.html names its modules, elements and data files by hand where web-dist
   finds the modules by glob, so the glob's guarantee stops at the directory's
   edge: a module renamed here would be copied and left unreferenced. */
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
/* Each element stands alone on that page, so a host can lift one section out.
   A section whose module is loaded elsewhere could not be lifted on its own. */
for (const tag of ["hypernym-disc", "word-disc", "letter-disc", "balance-flow"]) {
  check(page.includes(`<${tag}`), `embed.html carries no <${tag}>`);
  check(
    page.includes(`src="${tag}.js"`),
    `embed.html does not load ${tag}.js, so its section cannot be lifted out alone`,
  );
}
/* The word disc's section carries a second element, so lifting it out takes two
   modules rather than one. The binding is an id written twice on that page, and
   a run bound to nothing renders a line saying so rather than failing, which is
   what this catches instead. */
check(page.includes("<word-run"), "embed.html carries no <word-run>");
check(
  page.includes('src="word-run.js"'),
  "embed.html does not load word-run.js, so the run beside the disc would not upgrade",
);
const bound = /<word-run[^>]*\bfor="([^"]+)"/.exec(page);
check(
  bound !== null && page.includes(`id="${bound[1]}"`),
  `embed.html's run follows ${bound ? bound[1] : "nothing"}, which no element on the page is`,
);

/* The page's own control, which is not an element and so is not covered by the
   loop above: it names its index and its module inside script text rather than
   in a src attribute, where nothing else here would look. web-dist stages the
   modules by glob and the index among the word files, so both are there — what
   drifts is the page naming one that is not. */
check(page.includes('id="embed-category"'), "embed.html has no category selector");
check(
  page.includes('"words-index.json"'),
  "embed.html's selector names no index, so it has no categories to offer",
);
const brought = [...page.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)].map(m => m[1]);
check(brought.length > 0, "embed.html's inline script imports nothing");
for (const mod of brought)
  check(
    existsSync(new URL(`../web/${mod}`, import.meta.url)),
    `embed.html imports ${mod}, which web/ does not have`,
  );
/* It writes `src`, so both discs have to be watching that attribute or the
   choice would load nothing. */
for (const tag of ["word-disc.js", "letter-disc.js", "balance-flow.js"]) {
  const text = readFileSync(new URL(`../web/${tag}`, import.meta.url), "utf8");
  check(
    /observedAttributes\s*=\s*\[[^\]]*"src"/.test(text),
    `${tag} does not observe src, so embed.html's category control cannot reach it`,
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
    ` ${LWORDS.length} words make ${LL.pairs} letter arcs,` +
    ` ${CHAINS.cases.length} chains match graph.py and ${chained} more come off random lists`,
);
