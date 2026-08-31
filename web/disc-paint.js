/* The draw pipeline for <hypernym-disc>, with no DOM in it.
 *
 * The same class runs on the main thread and inside disc-worker.js against an
 * OffscreenCanvas, so the element has one implementation to keep correct and a
 * fallback that cannot drift from the fast path.
 *
 * It owns the tint, the palette and the merged runs, because all three are
 * derived from the layout and read only by the draw. The element keeps the
 * layout itself, which hit testing, the crumbs and the keyboard all need
 * synchronously.
 *
 *   const p = new Painter();
 *   p.layout({par, depth, a0, a1, byDepth, maxDepth}, hueDepth);
 *   const stats = p.paint(ctx, {root, w, h, cx, cy, r0, rmax, rw, rings, dpr,
 *                              mode, sat, val, panel});
 *
 * `rings` is how many depths below the root are drawn. The element caps it
 * because a deep tree's last rings hold almost nothing — WordNet's depth 19 is
 * one node — and dividing the radius by every depth spends a quarter of it on
 * a fringe too sparse to see. What is cut off is one zoom away.
 */
// TAU and hsv are shared with <word-disc>, which reads the same letter wheel
// and none of the rest of this. Re-exported so the import sites here and in
// hypernym-disc.js stay as they were.
import { hsv, TAU } from "./disc-colour.js";
export { TAU };
// Below one pixel at its outer edge a wedge cannot be told from its neighbour.
export const MERGE_PX = 1;
// Value steps the density ramp is quantised to, and how far it dips at its
// sparse end. 24 steps sits below the eye's threshold on this ramp and keeps
// the interned palette a lookup rather than a string build per piece.
const RAMP_STEPS = 24;
const RAMP_FLOOR = 0.62;

export class Painter {
  #par;
  #depth;
  #a0;
  #a1;
  #byDepth = [];
  #maxDepth = 0;
  #n = 0;
  #hd = 2;
  #tint;
  #tcos;
  #tsin;
  #tintKey = 0;
  #palette = [];
  #paletteKey = new Map();
  #fillId = null;
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
  hueDepth(hd) {
    if (hd !== this.#hd) {
      this.#hd = hd;
      this.#retint();
    }
  }

  /* Above hue-depth a node takes its own angle as a hue; below it inherits, so
     each branch reads as one colour family. Every pass is one forward loop,
     because a parent's index is always lower than its children's. */
  #retint() {
    if (!this.#n) return;
    const N = this.#n;
    this.#tint = new Float64Array(N);
    for (let i = 0; i < N; i++)
      this.#tint[i] =
        this.#depth[i] <= this.#hd
          ? (this.#a0[i] + this.#a1[i]) / 2 / TAU
          : this.#tint[this.#par[i]];
    // Merged pieces average their members' hues, and hue is an angle, so each
    // node's is kept as a vector rather than turned into one per piece per
    // frame. Radius plays no part, so this survives a resize and a zoom.
    this.#tcos = new Float64Array(N);
    this.#tsin = new Float64Array(N);
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
  #quant(h) {
    const w = ((h % 1) + 1) % 1;
    return Math.round(w * this.#hueQ) / this.#hueQ;
  }
  #hue(i) {
    return this.#quant(this.#tint[i]);
  }

  /* A colour is a string, and a string is what the canvas has to parse, so
     they are interned rather than rebuilt per piece per frame. `step` is the
     density rung, RAMP_STEPS meaning fully covered. */
  #colourId(tint, rel, step) {
    const key = tint + "|" + rel + "|" + step;
    let id = this.#paletteKey.get(key);
    if (id === undefined) {
      const base = Math.max(0.22, this.#val * (1 - rel * 0.035));
      const v = base * (RAMP_FLOOR + ((1 - RAMP_FLOOR) * step) / RAMP_STEPS);
      id = this.#palette.length;
      this.#palette.push(hsv(tint, this.#sat, Math.min(1, v)));
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
    // run, so filling this in would be 82,115 lookups nothing goes on to read.
    if (this.#mode !== "off") return;
    const base = this.#depth[this.#root];
    for (let i = 0; i < this.#n; i++)
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
     found off `byDepth`, already sorted by start angle for hit testing. */
  #remerge() {
    if (this.#mode === "off") {
      this.#seg = null;
      return;
    }
    const dense = this.#mode === "density";
    const base = this.#depth[this.#root];
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const s0 = [],
      s1 = [],
      sd = [],
      st = [],
      sn = [],
      sw = [];
    let peak = 1;
    const last = Math.min(this.#maxDepth, base + this.#rings - 1);
    for (let d = base; d <= last; d++) {
      const arr = this.#byDepth[d];
      const rel = d - base;
      const r1 = this.#r0 + (rel + 1) * this.#rw;
      const thin = k => (this.#a1[k] - this.#a0[k]) * sc * r1 < MERGE_PX;
      // Hue wraps, so the mean of 0.99 and 0.01 has to come out at 0 rather
      // than 0.5, which is why the members are summed as vectors.
      const blend = (lo, hi) => {
        if (lo === hi) return this.#hue(arr[lo]);
        let cx = 0,
          cy = 0;
        for (let k = lo; k <= hi; k++) {
          cx += this.#tcos[arr[k]];
          cy += this.#tsin[arr[k]];
        }
        return this.#quant(Math.atan2(cy, cx) / TAU);
      };
      let i = 0;
      while (i < arr.length) {
        if (!this.#inView(arr[i])) {
          i++;
          continue;
        }
        let j = i;
        while (
          thin(arr[j]) &&
          j + 1 < arr.length &&
          this.#inView(arr[j + 1]) &&
          thin(arr[j + 1]) &&
          Math.abs(this.#a0[arr[j + 1]] - this.#a1[arr[j]]) < 1e-9
        )
          j++;
        const from = this.#a0[arr[i]],
          to = this.#a1[arr[j]];
        if (j === i || !dense) {
          // A wedge that stayed whole is fully covered, and only it is wide
          // enough to earn a hairline.
          s0.push(from);
          s1.push(to);
          sd.push(rel);
          st.push(blend(i, j));
          sn.push(0);
          sw.push(j === i && (to - from) * sc > 0.012 ? 1 : 0);
        } else {
          const pieces = Math.max(1, Math.round((to - from) * sc * r1));
          const width = (to - from) / pieces;
          let m = i;
          for (let q = 0; q < pieces; q++) {
            const a = from + q * width,
              b = a + width;
            let count = 0,
              cx = 0,
              cy = 0;
            while (m <= j && (this.#a0[arr[m]] + this.#a1[arr[m]]) / 2 < b) {
              cx += this.#tcos[arr[m]];
              cy += this.#tsin[arr[m]];
              count++;
              m++;
            }
            if (count > peak) peak = count;
            s0.push(a);
            s1.push(b);
            sd.push(rel);
            // A piece no midpoint fell in lies under one wedge, so it takes
            // that wedge's hue rather than the mean of nothing.
            st.push(count ? this.#quant(Math.atan2(cy, cx) / TAU) : this.#hue(arr[Math.min(m, j)]));
            sn.push(count || 1);
            sw.push(0);
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
      f[i] = this.#colourId(
        st[i],
        sd[i],
        sn[i] && lg > 0 ? Math.round((RAMP_STEPS * Math.log(sn[i])) / lg) : RAMP_STEPS,
      );
    this.#seg = {
      s0: Float64Array.from(s0),
      s1: Float64Array.from(s1),
      d: Int16Array.from(sd),
      f,
      w: Uint8Array.from(sw),
    };
  }

  /* Palette and runs survive anything that leaves angles, depths, colours and
     radius alone, so a repeated repaint pays for neither. */
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
  #geom(i) {
    const sc = TAU / (this.#a1[this.#root] - this.#a0[this.#root]);
    const s = (this.#a0[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const e = (this.#a1[i] - this.#a0[this.#root]) * sc - Math.PI / 2;
    const d = this.#depth[i] - this.#depth[this.#root];
    return [s, e, this.#r0 + d * this.#rw, this.#r0 + (d + 1) * this.#rw];
  }

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
        if (e - s > 0.012) {
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
