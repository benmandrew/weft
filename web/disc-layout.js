/* The tree laid out as a disc, with no DOM in it.
 *
 * <hypernym-disc> lays its tree out with this, and so does anything else that
 * wants the same disc, which is what stops a copy drawn elsewhere drifting
 * from the element:
 *
 *   const t = layoutTree(par);   // par[i] < i, par[0] === -1
 *   t.a0[i], t.a1[i]             // node i's wedge, anticlockwise from angle 0
 *
 * A node's angular share is its leaf count, so a wide wedge is a branch with a
 * lot under it rather than one with a lot directly beneath it. Every pass is
 * one forward or one backward loop, because a parent's index is always lower
 * than its children's.
 */
import { TAU } from "./disc-colour.js";

/** `kidOff[i + 1] - kidOff[i]` is node i's child count and the leaf test both,
   and its children are `kidIdx` from `kidOff[i]`, in the order the disc draws
   them. `byDepth[d]` is ring d sorted by start angle.
   @typedef {object} TreeLayout
   @property {Int32Array} kidOff
   @property {Int32Array} kidIdx
   @property {Int16Array} depth
   @property {Int32Array} leaves
   @property {Float64Array} a0
   @property {Float64Array} a1
   @property {Int32Array[]} byDepth
   @property {number} maxDepth */

/** @param {ArrayLike<number>} par @returns {TreeLayout} */
export function layoutTree(par) {
  const N = par.length;
  // Counting sort into one flat array. Children come out in index order
  // within each parent, which is the order the angles below are laid in.
  const kidOff = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) if (par[i] >= 0) kidOff[par[i] + 1]++;
  for (let i = 0; i < N; i++) kidOff[i + 1] += kidOff[i];
  const at = Int32Array.from(kidOff.subarray(0, N));
  const kidIdx = new Int32Array(kidOff[N]);
  for (let i = 0; i < N; i++) if (par[i] >= 0) kidIdx[at[par[i]]++] = i;

  const depth = new Int16Array(N);
  const leaves = new Int32Array(N);
  for (let i = 0; i < N; i++) depth[i] = par[i] < 0 ? 0 : depth[par[i]] + 1;
  for (let i = N - 1; i >= 0; i--) {
    if (kidOff[i] === kidOff[i + 1]) leaves[i] = 1;
    if (par[i] >= 0) leaves[par[i]] += leaves[i];
  }
  const a0 = new Float64Array(N);
  const a1 = new Float64Array(N);
  if (N) a1[0] = TAU;
  for (let i = 0; i < N; i++) {
    let a = a0[i];
    const w = (a1[i] - a0[i]) / leaves[i];
    for (let k = kidOff[i]; k < kidOff[i + 1]; k++) {
      const c = kidIdx[k];
      a0[c] = a;
      a += leaves[c] * w;
      a1[c] = a;
    }
  }
  let maxDepth = 0;
  for (let i = 0; i < N; i++) if (depth[i] > maxDepth) maxDepth = depth[i];
  /** @type {number[][]} */
  const rings = Array.from({ length: maxDepth + 1 }, () => []);
  for (let i = 0; i < N; i++) rings[depth[i]].push(i);
  for (const arr of rings) arr.sort((x, y) => a0[x] - a0[y]);
  // Typed, because these cross to the worker whole and a nested plain array
  // of numbers is the slowest thing structured clone can be handed.
  const byDepth = rings.map(arr => Int32Array.from(arr));
  return { kidOff, kidIdx, depth, leaves, a0, a1, byDepth, maxDepth };
}
