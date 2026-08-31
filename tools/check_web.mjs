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
const drew = { fillText: 0, stroke: 0, arc: 0, curve: 0, image: 0 };
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
    this.children.push(...kids);
  }
  replaceChildren(...kids) {
    this.children = kids;
    this._html = "";
  }
  set innerHTML(v) {
    this._html = v;
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._html = v;
  }
  get textContent() {
    return this._html;
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
  getBoundingClientRect() {
    return { width: BOX, height: BOX };
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
    this._g = {
      canvas: this,
      font: "10px x",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      textAlign: "",
      textBaseline: "",
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill() {},
      bezierCurveTo: () => drew.curve++,
      stroke: () => drew.stroke++,
      arc: () => drew.arc++,
      fillText: () => drew.fillText++,
      drawImage: () => drew.image++,
      measureText(text) {
        return { width: text.length * PX * (parseFloat(/([\d.]+)px/.exec(this.font)?.[1]) || 10) };
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
  const find = new El("div", "find");
  find.append(new El("input", "q"), new El("ul", "hits"));
  const stage = new El("div", "stage");
  stage.append(new Canvas(), new Canvas());
  stage.children[0].className = "base";
  stage.children[1].className = "over";
  const crumb = new El("div", "crumb");
  crumb.append(new El("span", "head"), new El("span", "tail"));
  frame.append(find, stage, new El("div", "gloss"), crumb);
  const root = new El("div", "");
  root.append(new El("style", ""), frame);
  return root;
};

globalThis.document = {
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
};
const REGISTRY = new Map();
globalThis.customElements = {
  define(name, cls) {
    REGISTRY.set(name, cls);
  },
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.window = { devicePixelRatio: 2 };
globalThis.self = globalThis;
globalThis.postMessage = () => {};

// The square the driven element is given, which every point below is measured
// against. The nested disc's own synthetic view uses it too.
const BOX = 720;

const MODULES = [
  "disc-colour.js",
  "disc-label.js",
  "disc-paint.js",
  "disc-search.js",
  "disc-worker.js",
  "hypernym-disc.js",
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
check(c.replies(L.byHead) === 4, `cat left ${c.replies(L.byHead)} replies, not 4`);

check(!c.legal(at("cat")), "cat is a move from cat");
c.play(at("trout"));
check(!c.legal(at("trout")), "a word ending on its own letter followed itself");

/* A repeat is played and marked, not refused: a widget that silently drops a
   click teaches nothing about the rule it is dropping it for. */
c.play(at("tiger"));
c.play(at("rat"));
const step = c.play(at("tiger"));
check(step?.repeat === true, "a second tiger was not marked a repeat");
check(c.again(c.length - 1) && !c.again(2), "the repeat is marked at the wrong step");
check(c.played(at("tiger")) && !c.played(at("dog")), "played() does not follow the chain");

/* Rewinding puts the counts back, so a word played twice and wound back once
   is still played. */
check(c.length === 5, `the chain is ${c.length} long, not 5`);
c.rewind(3);
check(c.length === 3 && c.played(at("tiger")), "rewinding forgot a word still in the chain");
c.rewind(1);
check(!c.played(at("tiger")), "rewinding past a word left it played");
check(c.undo() === -1 && c.length === 0, "undoing the first step left a chain");
check(c.play(at("emu")) !== null && c.stuck(L.byHead), "emu is not a dead end");
check(c.clear() === -1 && !c.stuck(L.byHead), "clearing left the chain stuck");

/* The sizing, which is one equation with the label size on both sides: a
   label's length is set by its type and the room it has along the ring is set
   by the radius. Solved rather than measured, so what is asserted is that it
   stays inside the square it was given at every count, down to a frame too
   small to draw in. */
const SQUARE = 720,
  WIDE = 5.4; // "milliampere" at 1 px of type, near enough
const fits = got => got.outer + 24 / 2 <= SQUARE / 2 + 0.001 && got.r > 0;

const roomy = solve(wordLayout(WORDS).span, WIDE, SQUARE);
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

const disc = new WordDisc();
disc.connectedCallback();
disc.data = { category: "test", words: WORDS, zipf: WORDS.map((_, i) => 8 - i) };

const shadow = disc._shadow;
const over = shadow.querySelector(".over");
const gloss = shadow.querySelector(".gloss");
const line = shadow.querySelector(".crumb").querySelector(".head");

check(disc.words.join("|") === WORDS.join("|"), `the element drew ${disc.words}`);
check(disc.stats.bundle, "8 words did not get a resting bundle");
check(drew.image === 1, `the bundle was blitted ${drew.image} times, not once`);
check(drew.curve === wordChords(L), `${drew.curve} curves for ${wordChords(L)} chords`);
check(drew.fillText > WORDS.length, "fewer labels were drawn than there are words");

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

/* An illegal word is inert: rat does not follow cat, and clicking it neither
   plays nor clears what is there. */
point("rat");
check(disc.chain.join("|") === "cat", `clicking an illegal word gave ${disc.chain}`);
point("toad");
check(disc.chain.join("|") === "cat|toad", `toad did not follow cat: ${disc.chain}`);

/* The hub is the way back, which is the one thing clicking a word cannot do. */
fire(over, "click", { offsetX: BOX / 2, offsetY: BOX / 2 });
check(disc.chain.join("|") === "cat", `the hub did not undo: ${disc.chain}`);

/* A repeat reaches the line under the disc in the warning colour rather than
   being refused at the click. */
disc.clear();
for (const w of ["cat", "tiger", "rat", "tiger"]) point(w);
check(disc.chain.join("|") === "cat|tiger|rat|tiger", `the cycle gave ${disc.chain}`);
check(line.innerHTML.includes("warn"), "the repeated step is not marked in the chain line");
check((line.innerHTML.match(/warn/g) ?? []).length === 1, "more than the repeated step was marked");

/* The end of the round is said rather than left to be inferred from an empty
   fan: emu hands over on U and nothing in the list starts with one. */
disc.clear();
point("emu");
check(gloss.innerHTML.includes("the round ends here"), `emu read as ${gloss.innerHTML}`);
check(disc.stats.chain === 1, "the dead end was not played");

/* limit 0 is every word rather than none, and past the bundle's ceiling the
   fan is what is left to read. The browser calls this on its own; here it is
   called by hand, which is the same entry point. */
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
disc.setAttribute("limit", "0");
disc.attributeChangedCallback("limit", null, "0");
check(disc.stats.words === CROWD.length, `limit 0 drew ${disc.stats.words} of ${CROWD.length}`);
check(
  disc.stats.chords > 24000 && !disc.stats.bundle,
  `900 words hold ${disc.stats.chords} chords and the bundle is ${disc.stats.bundle}`,
);
check(disc.stats.labelPx === 0, `900 words in a ${BOX}px square kept their labels`);
disc.setAttribute("limit", "40");
disc.attributeChangedCallback("limit", "0", "40");
check(disc.stats.words === 40, `limit 40 drew ${disc.stats.words}`);
check(disc.stats.bundle && disc.stats.labelPx > 0, "40 words lost the bundle or the labels");
disc.repaint();

if (problems.length) {
  for (const said of problems) console.error(`web: ${said}`);
  process.exit(1);
}
console.log(
  `web/: ${MODULES.length} modules load, ${N.toLocaleString("en-GB")} nodes` +
    ` merge to ${dense.drawn.toLocaleString("en-GB")} arcs,` +
    ` ${WORDS.length} words lay out in ${L.live.length} wedges and play`,
);
