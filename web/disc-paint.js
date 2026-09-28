/* The draw pipeline for <hypernym-disc>, with no DOM in it.
 *
 * The same class runs on the main thread and inside disc-worker.js against an
 * OffscreenCanvas, so the fallback cannot drift from the fast path.
 *
 *   const p = new Painter();
 *   p.layout({par, depth, a0, a1, byDepth, maxDepth}, hueDepth);
 *   const stats = p.paint(ctx, {root, w, h, cx, cy, r0, rmax, rw, rings, dpr,
 *                              mode, sat, val, panel});
 *
 * `rings` is how many depths below the root are drawn; what is cut off is one
 * zoom away.
 *
 * The steps are exported as well as run here, so a copy of the disc drawn
 * somewhere a canvas is not (the site renders one to an SVG banner) takes the
 * same hues, runs and ramp: `tints`, then `merge`, then `ramp` and `rampStep`
 * for each piece's value.
 */
// TAU is re-exported so this module's import sites stay as they were.
import { hsv, TAU } from "./disc-colour.js";
export { TAU };
// Below one pixel at its outer edge a wedge cannot be told from its neighbour.
export const MERGE_PX = 1;
// Value steps the density ramp is quantised to, and how far it dips at its
// sparse end. Quantised so the ramped colours stay interned rather than built
// per piece.
export const RAMP_STEPS = 24;
const RAMP_FLOOR = 0.62;
// A whole wedge narrower than this many radians gets no hairline, since one
// down both its edges would cover most of it.
const HAIR_RAD = 0.012;

/** Each node's hue, as a turn and as a unit vector. Above hue-depth a node
   takes its own angle; below it inherits, so each branch reads as one colour
   family. Merged pieces average their members' hues, and hue is an angle, so
   the vectors are what get summed. Radius plays no part, so these survive a
   resize and a zoom.
   @param {{par: ArrayLike<number>, depth: ArrayLike<number>,
     a0: Float64Array, a1: Float64Array}} t
   @param {number} hd
   @returns {Tints} */
export function tints(t, hd) {
  const N = t.depth.length;
  const tint = new Float64Array(N);
  for (let i = 0; i < N; i++)
    tint[i] = t.depth[i] <= hd ? (t.a0[i] + t.a1[i]) / 2 / TAU : tint[t.par[i]];
  const tcos = new Float64Array(N);
  const tsin = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    tcos[i] = Math.cos(tint[i] * TAU);
    tsin[i] = Math.sin(tint[i] * TAU);
  }
  return { tint, tcos, tsin };
}

/** A hue rounded to one of `q` slices of the turn. A blended hue is a
   continuous value and a colour a string to parse, so the canvas interns them.
   @param {number} h @param {number} q @returns {number} */
export function quantise(h, q) {
  const w = ((h % 1) + 1) % 1;
  return Math.round(w * q) / q;
}

/** A piece's value: the ring's own, dimmed with depth so the fringe sits behind
   the trunk, then scaled by its density rung, RAMP_STEPS meaning fully covered.
   @param {number} rel ring below the root @param {number} step
   @param {number} val @returns {number} */
export function ramp(rel, step, val) {
  const base = Math.max(0.22, val * (1 - rel * 0.035));
  return Math.min(1, base * (RAMP_FLOOR + ((1 - RAMP_FLOOR) * step) / RAMP_STEPS));
}

/** The density rung for a piece `count` wedges fell in. Log, because counts run
   1 to 64 and a linear ramp would spend most of its range on the sparse end. A
   count of 0 means a whole wedge, not an empty one, so it takes the top rung.
   @param {number} count @param {number} peak the largest count of the frame
   @returns {number} */
export function rampStep(count, peak) {
  const lg = Math.log(peak);
  return count && lg > 0 ? Math.round((RAMP_STEPS * Math.log(count)) / lg) : RAMP_STEPS;
}

/** Adjacent wedges thinner than a pixel are one shape to the rasteriser,
   which below about 0.1 px draws them as nothing at all, so they are drawn as
   one and take the mean of their hues. Blending rather than matching on
   colour is what lets a run merge above hue-depth 2, where every node takes
   its own angle. A gap between subtrees breaks every run, which keeps the
   fringe reading as many nodes. `dense` then cuts a run at pixel boundaries
   and each piece keeps its own count and its own blend. Runs are found off
   `byDepth`, already sorted by start angle.

   `hueQ` is how many slices the hue is rounded to, and `hair` whether a whole
   wedge gets a hairline, given its angle in the view and its outer radius; by
   default one wider than HAIR_RAD does. A canvas wants a slice a pixel wide at
   the fringe; a file, where each colour is a fill attribute, wants them wider.
   @param {MergeTree} t @param {Tints} tn @param {MergeOptions} o
   @returns {Merged} */
export function merge(t, tn, o) {
  const { root, r0, rw, rings, hueQ, dense } = o;
  const hair = o.hair ?? (span => span > HAIR_RAD);
  const base = t.depth[root];
  const sc = TAU / (t.a1[root] - t.a0[root]);
  /** @type {(i: number) => boolean} */
  const inView = i => {
    const rel = t.depth[i] - base;
    return rel >= 0 && rel < rings && t.a0[i] >= t.a0[root] - 1e-9 && t.a1[i] <= t.a1[root] + 1e-9;
  };
  /** @type {(i: number) => number} */
  const hue = i => quantise(tn.tint[i], hueQ);
  /** @type {Merged} */
  const out = { s0: [], s1: [], d: [], h: [], n: [], w: [], peak: 1 };
  const last = Math.min(t.maxDepth, base + rings - 1);
  for (let d = base; d <= last; d++) {
    const arr = t.byDepth[d];
    const rel = d - base;
    const r1 = r0 + (rel + 1) * rw;
    /** @type {(k: number) => boolean} */
    const thin = k => (t.a1[k] - t.a0[k]) * sc * r1 < MERGE_PX;
    // Hue wraps, so the mean of 0.99 and 0.01 has to come out at 0 rather
    // than 0.5, which is why the members are summed as vectors.
    /** @type {(lo: number, hi: number) => number} */
    const blend = (lo, hi) => {
      if (lo === hi) return hue(arr[lo]);
      let cx = 0,
        cy = 0;
      for (let k = lo; k <= hi; k++) {
        cx += tn.tcos[arr[k]];
        cy += tn.tsin[arr[k]];
      }
      return quantise(Math.atan2(cy, cx) / TAU, hueQ);
    };
    let i = 0;
    while (i < arr.length) {
      if (!inView(arr[i])) {
        i++;
        continue;
      }
      let j = i;
      while (
        thin(arr[j]) &&
        j + 1 < arr.length &&
        inView(arr[j + 1]) &&
        thin(arr[j + 1]) &&
        Math.abs(t.a0[arr[j + 1]] - t.a1[arr[j]]) < 1e-9
      )
        j++;
      const from = t.a0[arr[i]],
        to = t.a1[arr[j]];
      if (j === i || !dense) {
        // A wedge that stayed whole is fully covered, and only it is wide
        // enough to earn a hairline.
        out.s0.push(from);
        out.s1.push(to);
        out.d.push(rel);
        out.h.push(blend(i, j));
        out.n.push(0);
        out.w.push(j === i && hair((to - from) * sc, r1) ? 1 : 0);
      } else {
        const pieces = Math.max(1, Math.round(((to - from) * sc * r1) / MERGE_PX));
        const width = (to - from) / pieces;
        let m = i;
        for (let q = 0; q < pieces; q++) {
          const a = from + q * width,
            b = a + width;
          let count = 0,
            cx = 0,
            cy = 0;
          while (m <= j && (t.a0[arr[m]] + t.a1[arr[m]]) / 2 < b) {
            cx += tn.tcos[arr[m]];
            cy += tn.tsin[arr[m]];
            count++;
            m++;
          }
          if (count > out.peak) out.peak = count;
          out.s0.push(a);
          out.s1.push(b);
          out.d.push(rel);
          // A piece no midpoint fell in lies under one wedge, so it takes
          // that wedge's hue rather than the mean of nothing.
          out.h.push(count ? quantise(Math.atan2(cy, cx) / TAU, hueQ) : hue(arr[Math.min(m, j)]));
          out.n.push(count || 1);
          out.w.push(0);
        }
      }
      i = j + 1;
    }
  }
  return out;
}

/** The tree, flat. Every parent's index is below all of its children's, which
   is what lets `#retint` and `#remerge` be forward loops rather than
   traversals. `byDepth[d]` is that ring sorted by start angle.
   @typedef {object} Tree
   @property {Int32Array} par
   @property {Int16Array} depth
   @property {Float64Array} a0
   @property {Float64Array} a1
   @property {Int32Array[]} byDepth
   @property {number} maxDepth */

/** One frame's worth of geometry and tokens. `sat`, `val` and `panel` arrive as
   the CSS custom properties they were read from, so the numbers are parsed
   here. `rings` left out means every depth below the root.
   @typedef {object} View
   @property {number} root
   @property {number} w
   @property {number} h
   @property {number} cx
   @property {number} cy
   @property {number} r0
   @property {number} rmax
   @property {number} rw
   @property {number} dpr
   @property {string} mode
   @property {string} sat
   @property {string} val
   @property {string} panel
   @property {number} [rings] */

/** What the frame cost, which the element reports and check_web.mjs asserts on.
   @typedef {object} Stats
   @property {number} drawn
   @property {number} drawMs
   @property {number} prepMs
   @property {number} segments
   @property {number} colours
   @property {string} mode */

/** @typedef {{tint: Float64Array, tcos: Float64Array, tsin: Float64Array}} Tints */

/** What `merge` reads of the tree.
   @typedef {object} MergeTree
   @property {ArrayLike<number>} depth
   @property {Float64Array} a0
   @property {Float64Array} a1
   @property {ArrayLike<number>[]} byDepth
   @property {number} maxDepth */

/** @typedef {object} MergeOptions
   @property {number} root the node the view is zoomed to
   @property {number} r0 the hub's radius
   @property {number} rw one ring's width
   @property {number} rings how many rings below the root are drawn
   @property {number} hueQ slices of the turn the hue is rounded to
   @property {boolean} dense cut runs into counted pieces
   @property {(span: number, r1: number) => boolean} [hair] */

/** One entry per piece: its angles, its ring below the root, its hue, how many
   wedges fell in it (0 for a whole wedge) and whether it earns a hairline.
   `peak` is the largest count, which `rampStep` reads.
   @typedef {object} Merged
   @property {number[]} s0
   @property {number[]} s1
   @property {number[]} d
   @property {number[]} h
   @property {number[]} n
   @property {number[]} w
   @property {number} peak */

/** The merged runs, one entry per piece drawn: [s0, s1] its angles, `d` its
   ring, `f` its colour and `w` whether it earns a hairline.
   @typedef {object} Segments
   @property {Float64Array} s0
   @property {Float64Array} s1
   @property {Int16Array} d
   @property {Int32Array} f
   @property {Uint8Array} w */

export class Painter {
  /** @type {Int32Array} */
  #par;
  /** @type {Int16Array} */
  #depth;
  /** @type {Float64Array} */
  #a0;
  /** @type {Float64Array} */
  #a1;
  /** @type {Int32Array[]} */
  #byDepth = [];
  #maxDepth = 0;
  #n = 0;
  #hd = 2;
  /** @type {Float64Array} */
  #tint;
  /** @type {Float64Array} */
  #tcos;
  /** @type {Float64Array} */
  #tsin;
  #tintKey = 0;
  /** @type {string[]} */
  #palette = [];
  /** @type {Map<string, number>} */
  #paletteKey = new Map();
  /** @type {Int32Array} */
  #fillId;
  /** @type {Segments | null} */
  #seg = null;
  #prepKey = "";
  #prepMs = 0;
  #hueQ = 1;
  #sat = 0.55;
  #val = 0.88;
  #root = 0;
  #r0 = 0;
  #rmax = 1;
  #rw = 1;
  #rings = 1;
  #mode = "density";

  /** @param {Tree} l @param {number} hd */
  layout(l, hd = this.#hd) {
    this.#par = l.par;
    this.#depth = l.depth;
    this.#a0 = l.a0;
    this.#a1 = l.a1;
    this.#byDepth = l.byDepth;
    this.#maxDepth = l.maxDepth;
    this.#n = l.depth.length;
    this.#hd = hd;
    this.#retint();
  }
  /** @param {number} hd */
  hueDepth(hd) {
    if (hd !== this.#hd) {
      this.#hd = hd;
      this.#retint();
    }
  }

  #retint() {
    if (!this.#n) return;
    ({
      tint: this.#tint,
      tcos: this.#tcos,
      tsin: this.#tsin,
    } = tints({ par: this.#par, depth: this.#depth, a0: this.#a0, a1: this.#a1 }, this.#hd));
    this.#tintKey++;
  }

  /* Hues are rounded to a slice one pixel wide at the fringe. That is the same
     threshold that decides two wedges cannot be told apart: neighbouring slices
     differ by 0.16°, and a wedge wide enough to read as its own arc cannot
     collide with its neighbour at that step. */
  /** @param {number} i @returns {number} */
  #hue(i) {
    return quantise(this.#tint[i], this.#hueQ);
  }

  /* A colour is a string the canvas has to parse, so they are interned rather
     than rebuilt per piece per frame. `step` is the density rung, RAMP_STEPS
     meaning fully covered. */
  /** @param {number} tint @param {number} rel @param {number} step
     @returns {number} an index into `#palette` */
  #colourId(tint, rel, step) {
    const key = tint + "|" + rel + "|" + step;
    let id = this.#paletteKey.get(key);
    if (id === undefined) {
      id = this.#palette.length;
      this.#palette.push(hsv(tint, this.#sat, ramp(rel, step, this.#val)));
      this.#paletteKey.set(key, id);
    }
    return id;
  }

  #repalette() {
    this.#palette = [];
    this.#paletteKey = new Map();
    this.#fillId = new Int32Array(this.#n);
    this.#hueQ = Math.max(1, Math.round((TAU * this.#rmax) / MERGE_PX));
    // Only the unmerged draw reads a per-node fill; a merged one colours the
    // run, so filling this in would be lookups nothing goes on to read.
    if (this.#mode !== "off") return;
    const base = this.#depth[this.#root];
    for (let i = 0; i < this.#n; i++)
      this.#fillId[i] = this.#colourId(this.#hue(i), this.#depth[i] - base, RAMP_STEPS);
  }

  /* The runs, from `merge`, each given an interned colour. */
  #remerge() {
    if (this.#mode === "off") {
      this.#seg = null;
      return;
    }
    const m = merge(
      {
        depth: this.#depth,
        a0: this.#a0,
        a1: this.#a1,
        byDepth: this.#byDepth,
        maxDepth: this.#maxDepth,
      },
      { tint: this.#tint, tcos: this.#tcos, tsin: this.#tsin },
      {
        root: this.#root,
        r0: this.#r0,
        rw: this.#rw,
        rings: this.#rings,
        hueQ: this.#hueQ,
        dense: this.#mode === "density",
      },
    );
    const f = new Int32Array(m.h.length);
    for (let i = 0; i < f.length; i++)
      f[i] = this.#colourId(m.h[i], m.d[i], rampStep(m.n[i], m.peak));
    this.#seg = {
      s0: Float64Array.from(m.s0),
      s1: Float64Array.from(m.s1),
      d: Int16Array.from(m.d),
      f,
      w: Uint8Array.from(m.w),
    };
  }

  /* Palette and runs survive anything that leaves angles, depths, colours and
     radius alone, so a repeated repaint pays for neither. */
  /** @param {View} v */
  #prepare(v) {
    const key = [
      this.#root,
      this.#tintKey,
      this.#rmax.toFixed(1),
      this.#rings,
      v.sat,
      v.val,
      this.#mode,
    ].join("|");
    if (key === this.#prepKey) return;
    this.#prepKey = key;
    const t0 = performance.now();
    this.#repalette();
    this.#remerge();
    this.#prepMs = performance.now() - t0;
  }

  /** @param {number} i @returns {boolean} */
  #inView(i) {
    const rel = this.#depth[i] - this.#depth[this.#root];
    return (
      rel >= 0 &&
      rel < this.#rings &&
      this.#a0[i] >= this.#a0[this.#root] - 1e-9 &&
      this.#a1[i] <= this.#a1[this.#root] + 1e-9
    );
  }
  /* Zooming is a change of angular scale, not a re-layout: node k's span is
     stretched to a full turn and its depth becomes ring zero. */
  /** @param {number} i @returns {[number, number, number, number]} start and
     end angles, then the inner and outer radius */
  #geom(i) {
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const s = (this.#a0[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const e = (this.#a1[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const d = this.#depth[i] - this.#depth[this.#root];
    return [s, e, this.#r0 + d * this.#rw, this.#r0 + (d + 1) * this.#rw];
  }

  /** @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} g
     @param {View} v
     @returns {Stats | null} null before a layout has been handed in */
  paint(g, v) {
    if (!this.#n) return null;
    // Resizing a canvas clears it, so the size is only written when it moved.
    // The element cannot do this itself once the canvas belongs to a worker.
    const c = g.canvas;
    if (c.width !== v.w || c.height !== v.h) {
      c.width = v.w;
      c.height = v.h;
    }
    this.#root = v.root;
    this.#r0 = v.r0;
    this.#rmax = v.rmax;
    this.#rw = v.rw;
    this.#rings = v.rings ?? this.#maxDepth - this.#depth[v.root] + 1;
    this.#mode = v.mode;
    this.#sat = parseFloat(v.sat);
    this.#val = parseFloat(v.val);
    this.#prepare(v);
    const t0 = performance.now();
    let drawn = 0;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const half = Math.PI / 2;
    let cur = -1;

    /** @type {(s: number, e: number, r0: number, r1: number) => void} */
    const wedge = (s, e, r0, r1) => {
      g.beginPath();
      g.arc(v.cx, v.cy, r1, s, e);
      g.arc(v.cx, v.cy, r0, e, s, true);
      g.closePath();
    };

    if (this.#seg) {
      const { s0, s1, d: sd, f, w } = this.#seg;
      for (let i = 0; i < f.length; i++) {
        const s = (s0[i] - this.#a0[this.#root]) * sc - half;
        const e = (s1[i] - this.#a0[this.#root]) * sc - half;
        wedge(s, e, this.#r0 + sd[i] * this.#rw, this.#r0 + (sd[i] + 1) * this.#rw);
        if (f[i] !== cur) {
          cur = f[i];
          g.fillStyle = this.#palette[cur];
        }
        g.fill();
        drawn++;
        if (w[i]) {
          g.strokeStyle = v.panel;
          g.lineWidth = 0.6;
          g.stroke();
        }
      }
    } else {
      for (let i = 0; i < this.#n; i++) {
        if (!this.#inView(i)) continue;
        const [s, e, r0, r1] = this.#geom(i);
        wedge(s, e, r0, r1);
        if (this.#fillId[i] !== cur) {
          cur = this.#fillId[i];
          g.fillStyle = this.#palette[cur];
        }
        g.fill();
        drawn++;
        // A hairline on a sub-pixel wedge would cover the fill it separates.
        if (e - s > HAIR_RAD) {
          g.strokeStyle = v.panel;
          g.lineWidth = 0.6;
          g.stroke();
        }
      }
    }

    // The hub's ground only. Its label names whatever the pointer is over, so
    // the element paints it on the overlay instead.
    g.beginPath();
    g.arc(v.cx, v.cy, this.#r0 - 3, 0, TAU);
    g.fillStyle = v.panel;
    g.fill();
    return {
      drawn,
      drawMs: performance.now() - t0,
      prepMs: this.#prepMs,
      segments: this.#seg ? this.#seg.f.length : 0,
      colours: this.#palette.length,
      mode: this.#mode,
    };
  }
}
