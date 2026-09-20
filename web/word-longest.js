/* The longest chain a category allows, with no DOM in it: how far play can run
 * if every word is chosen perfectly and none is repeated.
 *
 * A chain is a trail in the letter graph — a word is an arc from its first
 * letter to its last, and playing a word once is using an arc once. Keeping the
 * most words is discarding the fewest, which is a min-cost transshipment on 26
 * nodes: supplies of out minus in, capacities the word counts, unit costs.
 * Every cost is non-negative and the matrix is totally unimodular, so the answer
 * comes back integral with no solver.
 *
 * The relaxation says nothing about whether the arcs it keeps form one connected
 * run, so it answers with an upper bound. Where they do come back connected the
 * bound is attained and the chain is provably the longest there is; where they
 * do not, the largest component is kept and the rest solved again, and the gap
 * is reported rather than hidden.
 *
 * graph.py's `longest_chain` is this written a second time, so the browser and
 * the report agree on how far a category runs. A change here has to be made
 * there as well, and tools/chains.json is what holds the two to the same
 * answers — including the tie-breaks, since two chains of different length can
 * price identically and the order candidates are tried in decides which is
 * found.
 *
 *   const L = chain(["cat", "toad", "dog"]);
 *   L.words        // the chain itself
 *   L.certified    // whether it is provably the longest
 */
import { LETTERS, matrix } from "./letter-graph.js";

const CELLS = LETTERS * LETTERS;
const INF = 1 << 30;
const A = "a".charCodeAt(0);

/** Words leaving each letter less the words arriving. Loops are left out
   entirely: a loop is free to keep and unbalances nobody.
   @param {Int32Array} m @returns {Int32Array} */
function excess(m) {
  const e = new Int32Array(LETTERS);
  for (let u = 0; u < LETTERS; u++) {
    for (let v = 0; v < LETTERS; v++) {
      if (u === v) continue;
      const count = m[u * LETTERS + v];
      if (count) {
        e[u] += count;
        e[v] -= count;
      }
    }
  }
  return e;
}

/** One augmenting path of the balancing flow: how many words it discards, what
   each of them costs, the surplus letter it leaves and the deficit letter it
   reaches, and the letter pairs it moved between the two. A step is `cell + 1`
   where it discards one more word of that pair and `-(cell + 1)` where it
   recovers one, since cell 0 has no sign of its own.
   @typedef {object} Augmentation
   @property {number} push
   @property {number} cost
   @property {number} from
   @property {number} to
   @property {number[]} steps */

/* Min-cost max-flow by successive shortest paths, SPFA finding each one. Held
   as flat parallel arrays with the reverse arc at `e ^ 1`, which is what lets a
   path be walked backwards without storing it. */
class Flow {
  /** @param {number} n @param {number} edges */
  constructor(n, edges) {
    this.n = n;
    this.head = new Int32Array(n).fill(-1);
    this.to = new Int32Array(2 * edges);
    this.next = new Int32Array(2 * edges);
    this.cap = new Int32Array(2 * edges);
    this.cost = new Int32Array(2 * edges);
    this.used = 0;
    /** The letter pair each arc moves, for a run that was asked to say what it
       did. Null until `label` is called, so an ordinary solve allocates none of
       it and the traced one pays 704 ints.
       @type {Int32Array | null} */
    this.cell = null;
  }

  /** Name the letter pair arc `e` moves. The reverse arc shares the name, since
     `e ^ 1` moves the same pair the other way.
     @param {number} e @param {number} cell @returns {void} */
  label(e, cell) {
    if (!this.cell) this.cell = new Int32Array(this.to.length >> 1).fill(-1);
    this.cell[e >> 1] = cell;
  }

  /** @param {number} u @param {number} v @param {number} cap @param {number} cost
      @returns {number} */
  add(u, v, cap, cost) {
    const e = this.used;
    this.to[e] = v;
    this.cap[e] = cap;
    this.cost[e] = cost;
    this.next[e] = this.head[u];
    this.head[u] = e;
    this.to[e + 1] = u;
    this.cap[e + 1] = 0;
    this.cost[e + 1] = -cost;
    this.next[e + 1] = this.head[v];
    this.head[v] = e + 1;
    this.used += 2;
    return e;
  }

  /** `log`, where a caller hands one in, collects a frame per augmenting path.
      Recording reads the path the push has already been applied along, so it
      changes nothing about which path is found or what it costs.
      @param {number} source @param {number} sink @param {Augmentation[]} [log]
      @returns {{ flow: number, paid: number }} */
  run(source, sink, log) {
    const { n, head, to, next, cap, cost } = this;
    const dist = new Int32Array(n),
      prev = new Int32Array(n),
      queued = new Uint8Array(n);
    // SPFA holds at most one entry per node, so the ring can never overrun.
    const ring = new Int32Array(4 * n + 16);
    let flow = 0,
      paid = 0;
    for (;;) {
      dist.fill(INF);
      prev.fill(-1);
      queued.fill(0);
      dist[source] = 0;
      queued[source] = 1;
      let read = 0,
        write = 0,
        waiting = 0;
      ring[write++] = source;
      waiting++;
      while (waiting > 0) {
        const u = ring[read++];
        if (read === ring.length) read = 0;
        waiting--;
        queued[u] = 0;
        for (let e = head[u]; e !== -1; e = next[e]) {
          if (cap[e] <= 0) continue;
          const v = to[e],
            step = dist[u] + cost[e];
          if (step < dist[v]) {
            dist[v] = step;
            prev[v] = e;
            if (!queued[v]) {
              queued[v] = 1;
              ring[write++] = v;
              if (write === ring.length) write = 0;
              waiting++;
            }
          }
        }
      }
      if (dist[sink] >= INF) return { flow, paid };
      let push = INF;
      for (let v = sink; v !== source; v = to[prev[v] ^ 1]) push = Math.min(push, cap[prev[v]]);
      for (let v = sink; v !== source; v = to[prev[v] ^ 1]) {
        cap[prev[v]] -= push;
        cap[prev[v] ^ 1] += push;
      }
      if (log) log.push(augmentation(this, source, sink, prev, push, dist[sink]));
      flow += push;
      paid += push * dist[sink];
    }
  }
}

/** The path just pushed along, as the letter pairs it moved and the two letters
   it ran between. `prev[v]` is the arc into v, so walking back from the sink is
   the path in reverse; the nodes come out [sink, deficit, …, surplus], and the
   source and sink arcs carry no pair, which is what leaves the letters alone in
   `steps`.
   @param {Flow} flow @param {number} source @param {number} sink
   @param {Int32Array} prev @param {number} push @param {number} cost
   @returns {Augmentation} */
function augmentation(flow, source, sink, prev, push, cost) {
  const { to, cell } = flow;
  /** @type {number[]} */
  const steps = [];
  /** @type {number[]} */
  const nodes = [];
  for (let v = sink; v !== source; v = to[prev[v] ^ 1]) {
    const e = prev[v];
    const pair = cell ? cell[e >> 1] : -1;
    // An even arc discards one more word of its pair and an odd one recovers
    // one. The cell is shifted by one because cell 0 has no sign of its own.
    if (pair >= 0) steps.push((e & 1) === 0 ? pair + 1 : -(pair + 1));
    nodes.push(v);
  }
  steps.reverse();
  return { push, cost, from: nodes[nodes.length - 1], to: nodes[1], steps };
}

/** The cheapest discards `y` that leave every letter balanced, or null where no
   such set exists. A unit of flow along u -> v is one word of that pair thrown
   away, so the cost counts discards and `m - y` is a set of arcs some closed
   circuit can walk.
   `log`, where a caller hands one in, comes back holding the augmenting paths
   that got there, in the order they were found.
   @param {Int32Array} m @param {Augmentation[]} [log]
   @returns {{ y: Int32Array, cost: number } | null} */
function balanced(m, log) {
  const e = excess(m);
  const source = LETTERS,
    sink = LETTERS + 1;
  const flow = new Flow(LETTERS + 2, CELLS + LETTERS + 2);
  const arc = new Int32Array(CELLS).fill(-1);
  for (let u = 0; u < LETTERS; u++) {
    for (let v = 0; v < LETTERS; v++) {
      if (u === v) continue;
      const count = m[u * LETTERS + v];
      if (count) {
        const cell = u * LETTERS + v;
        arc[cell] = flow.add(u, v, count, 1);
        if (log) flow.label(arc[cell], cell);
      }
    }
  }
  let need = 0;
  for (let v = 0; v < LETTERS; v++) {
    if (e[v] > 0) {
      flow.add(source, v, e[v], 0);
      need += e[v];
    } else if (e[v] < 0) flow.add(v, sink, -e[v], 0);
  }
  const pushed = flow.run(source, sink, log);
  if (pushed.flow !== need) return null;
  const y = new Int32Array(CELLS);
  // An arc's flow is what its reverse residual has picked up.
  for (let i = 0; i < CELLS; i++) if (arc[i] >= 0) y[i] = flow.cap[arc[i] ^ 1];
  return { y, cost: pushed.paid };
}

/** Every way one more or one fewer word can be discarded, as a graph on the 26
   letters. `tag` names the cell an edge moves, and `~cell` means it moves it
   back; `out` indexes the edges by source, which is what keeps Dijkstra to one
   pass over each.
   @typedef {object} Residual
   @property {Int32Array} from
   @property {Int32Array} to
   @property {Int32Array} cost
   @property {Int32Array} tag
   @property {number[][]} out */

/** @param {Int32Array} m @param {Int32Array} y @returns {Residual} */
function residual(m, y) {
  const from = [],
    to = [],
    cost = [],
    tag = [];
  /** @type {number[][]} */
  const out = Array.from({ length: LETTERS }, () => []);
  for (let u = 0; u < LETTERS; u++) {
    for (let v = 0; v < LETTERS; v++) {
      if (u === v) continue; // a loop carries no excess, so it moves nothing
      const cell = u * LETTERS + v,
        count = m[cell];
      if (!count) continue;
      if (y[cell] < count) {
        out[u].push(from.length);
        from.push(u);
        to.push(v);
        cost.push(1);
        tag.push(cell);
      }
      if (y[cell] > 0) {
        out[v].push(from.length);
        from.push(v);
        to.push(u);
        cost.push(-1);
        tag.push(~cell);
      }
    }
  }
  return {
    from: Int32Array.from(from),
    to: Int32Array.from(to),
    cost: Int32Array.from(cost),
    tag: Int32Array.from(tag),
    out,
  };
}

/** Bellman-Ford from an all-zero source, which is what makes the residual costs
   non-negative once reduced and so lets Dijkstra price the rest.
   @param {Residual} res @returns {Int32Array} */
function potentials(res) {
  const pi = new Int32Array(LETTERS);
  for (let pass = 0; pass < LETTERS; pass++) {
    let moved = false;
    for (let e = 0; e < res.from.length; e++) {
      const step = pi[res.from[e]] + res.cost[e];
      if (step < pi[res.to[e]]) {
        pi[res.to[e]] = step;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pi;
}

/** Shortest residual paths out of `src` on reduced costs. Scanning all 26 for
   the nearest beats a heap at this size.
   @param {Residual} res @param {Int32Array} pi @param {number} src
   @returns {{ dist: Int32Array, parent: Int32Array }} */
function dijkstra(res, pi, src) {
  const dist = new Int32Array(LETTERS).fill(INF);
  const parent = new Int32Array(LETTERS).fill(-1);
  const done = new Uint8Array(LETTERS);
  dist[src] = 0;
  for (let iter = 0; iter < LETTERS; iter++) {
    let u = -1,
      best = INF;
    for (let v = 0; v < LETTERS; v++)
      if (!done[v] && dist[v] < best) {
        best = dist[v];
        u = v;
      }
    if (u < 0) break;
    done[u] = 1;
    for (const e of res.out[u]) {
      const v = res.to[e];
      const step = dist[u] + res.cost[e] + pi[u] - pi[v];
      if (step < dist[v]) {
        dist[v] = step;
        parent[v] = e;
      }
    }
  }
  return { dist, parent };
}

/** Move one unit of discard along the residual path from `t` back to `s`, which
   is what turns the balanced answer into a chain running s to t.
   @param {Residual} res @param {Int32Array} parent @param {Int32Array} y
   @param {number} s @param {number} t @returns {void} */
function walkBack(res, parent, y, s, t) {
  let v = s;
  while (v !== t) {
    const e = parent[v];
    if (e < 0) throw new Error("the residual path Dijkstra priced is not there");
    const tag = res.tag[e];
    if (tag >= 0) y[tag]++;
    else y[~tag]--;
    v = res.from[e];
  }
}

/** Union-find over the letters some kept arc touches. Path halving, and no
   rank: at 26 nodes the second pointer costs more than it saves.
   @param {Int32Array} x
   @returns {{ find: (a: number) => number, touched: Uint8Array }} */
export function components(x) {
  const parent = new Int32Array(LETTERS);
  for (let i = 0; i < LETTERS; i++) parent[i] = i;
  /** @param {number} a @returns {number} */
  const find = a => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const touched = new Uint8Array(LETTERS);
  for (let u = 0; u < LETTERS; u++) {
    for (let v = 0; v < LETTERS; v++) {
      if (x[u * LETTERS + v] > 0) {
        touched[u] = 1;
        touched[v] = 1;
        if (u !== v) {
          const a = find(u),
            b = find(v);
          if (a !== b) parent[a] = b;
        }
      }
    }
  }
  return { find, touched };
}

/** The letter sequence the trail `x` describes. Iterative, since the recursive
   form runs a category's worth of words deep and the stack does not hold.
   @param {Int32Array} x @param {number} start @returns {number[]} */
export function hierholzer(x, start) {
  const work = Int32Array.from(x);
  const scan = new Int32Array(LETTERS); // each letter's pointer, only advancing
  const stack = [start];
  /** @type {number[]} */
  const circuit = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    let u = scan[v],
      moved = false;
    while (u < LETTERS) {
      if (work[v * LETTERS + u] > 0) {
        work[v * LETTERS + u]--;
        stack.push(u);
        moved = true;
        break;
      }
      scan[v] = ++u;
    }
    if (!moved) {
      const done = stack.pop();
      if (done !== undefined) circuit.push(done);
    }
  }
  return circuit.reverse();
}

/** One pass of the solver: the arcs kept, where the trail starts, how many
   words that is, the bound it was measured against, and the letters it reached.
   @typedef {object} Run
   @property {Int32Array} x
   @property {number} start
   @property {number} words
   @property {number} bound
   @property {boolean} certified
   @property {Uint8Array} keep */

/** @param {Int32Array} m @param {number} start @returns {Run | null} */
function solveOn(m, start) {
  let total = 0;
  for (let i = 0; i < CELLS; i++) total += m[i];
  if (total === 0) return null;
  const base = balanced(m);
  if (!base) return null;
  const res = residual(m, base.y);
  const pi = potentials(res);

  // Every start and end option priced off that one solve. A chain from s to t
  // moves supply by a unit at each end, so it costs the balanced answer plus
  // the shortest residual path t -> s; 26 Dijkstras cover all 676 pairs, and a
  // 677th candidate is the closed circuit, which starts and ends nowhere.
  //
  // An opening letter drops every candidate that opens elsewhere. The circuit
  // survives whatever the letter is, since a closed walk can be rotated to open
  // on any letter it touches, and the `touched` guard below is what decides
  // whether this one does.
  /** @type {[number, number, number][]} */
  const candidates = [[base.cost, -1, -1]];
  /** @type {Int32Array[]} */
  const paths = [];
  for (let t = 0; t < LETTERS; t++) {
    const { dist, parent } = dijkstra(res, pi, t);
    paths.push(parent);
    for (let s = 0; s < LETTERS; s++)
      if (s !== t && dist[s] < INF && (start < 0 || s === start))
        candidates.push([base.cost + dist[s] - pi[t] + pi[s], s, t]);
  }
  // Sorted on all three rather than on the cost alone: graph.py sorts tuples
  // and neither language promises anything about ties, so a total order is what
  // stops the two halves ever having to agree by luck. No word list here needs
  // it — 37 categories and 3,000 random ones answer the same either way.
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const bound = total - candidates[0][0];

  /** @type {Run | null} */
  let fragment = null;
  for (const [discards, s, t] of candidates) {
    // Sorted by discards, so no later candidate can keep more than this one.
    // It also decides which component tier 2 runs on, and a smaller fragment
    // there can free more words than a larger one: river chains 64 words with
    // this break and 63 without. graph.py stops on the same test.
    if (fragment && total - discards <= fragment.words) break;
    const y = Int32Array.from(base.y);
    if (s >= 0) walkBack(res, paths[t], y, s, t);
    const x = new Int32Array(CELLS);
    for (let i = 0; i < CELLS; i++) x[i] = m[i] - y[i];

    const { find, touched } = components(x);
    let anchor = s;
    // The circuit, rotated to open where it was asked to.
    if (anchor < 0 && start >= 0) anchor = start;
    if (anchor < 0) for (let v = 0; v < LETTERS && anchor < 0; v++) if (touched[v]) anchor = v;
    if (anchor < 0 || !touched[anchor]) continue;
    const root = find(anchor);
    const keep = new Uint8Array(LETTERS);
    let split = false;
    for (let v = 0; v < LETTERS; v++) {
      if (!touched[v]) continue;
      if (find(v) === root) keep[v] = 1;
      else split = true;
    }
    if (!split) return { x, start: anchor, words: total - discards, bound, certified: true, keep };

    const kept = new Int32Array(CELLS);
    let held = 0;
    for (let u = 0; u < LETTERS; u++) {
      if (!keep[u]) continue;
      for (let v = 0; v < LETTERS; v++)
        if (keep[v]) {
          kept[u * LETTERS + v] = x[u * LETTERS + v];
          held += x[u * LETTERS + v];
        }
    }
    if (!fragment || held > fragment.words)
      fragment = { x: kept, start: anchor, words: held, bound, certified: false, keep };
  }
  return fragment;
}

/** The letter sequence of the longest chain found, and the upper bound.
   A fragmented answer is tried again on the letters it did reach, this time at
   full capacity rather than at what the fragment kept, which is what recovers
   the words the discarded components were holding hostage.
   `start` names the letter the chain has to open on, or -1 for any. A letter no
   word leaves is short cut rather than solved. The general path answers the
   same — a trail opening at f wants an arc leaving f, and balance then denies
   every candidate — but it spends a flow solve and 26 Dijkstras to say so:
   0.05 ms against 0.56 on animal, over the 11 of its 1,582 words that end on a
   letter nothing starts with. Nothing downstream can tell the two apart, so
   check_web.mjs cannot either.
   @param {Int32Array} m @param {number} [start] @returns {{ letters: number[], bound: number }} */
export function longest(m, start = -1) {
  if (start >= 0) {
    let out = 0;
    for (let v = 0; v < LETTERS; v++) out += m[start * LETTERS + v];
    if (out === 0) return { letters: [], bound: 0 };
  }
  /** @type {Run | null} */
  let best = null;
  let bound = 0;
  let current = m;
  for (let round = 0; round < LETTERS; round++) {
    const run = solveOn(current, start);
    if (!run) break;
    if (!best) bound = run.bound; // the first round is the only one bounding all of m
    if (!best || run.words > best.words) best = run;
    if (run.certified) break;
    const following = new Int32Array(CELLS);
    let shrunk = false,
      left = 0;
    for (let u = 0; u < LETTERS; u++) {
      for (let v = 0; v < LETTERS; v++) {
        const cell = u * LETTERS + v;
        if (run.keep[u] && run.keep[v]) {
          following[cell] = current[cell];
          left += following[cell];
        } else if (current[cell]) shrunk = true;
      }
    }
    if (!shrunk || left === 0) break;
    current = following;
  }
  if (!best) return { letters: [], bound };
  return { letters: hierholzer(best.x, best.start), bound };
}

/** The words of each letter pair, indexed [head * 26 + tail] the way
   letter-graph.js's `matrix` counts them. The text is stored as it came in and
   never rewritten, so a multiword entry comes back out of a chain spelled the
   way the category spells it.
   @param {Iterable<string>} words @returns {string[][]} */
export function buckets(words) {
  /** @type {string[][]} */
  const held = Array.from({ length: CELLS }, () => []);
  for (const word of words) {
    if (!word) continue;
    const h = word.charCodeAt(0) - A,
      t = word.charCodeAt(word.length - 1) - A;
    if (h < 0 || h >= LETTERS || t < 0 || t >= LETTERS) continue;
    held[h * LETTERS + t].push(word);
  }
  return held;
}

/** The longest chain a word list allows, with the bound it was proved to.
   The words are named after the letters are: two words spanning the same pair
   are interchangeable, so only the arc has to be solved for.
   @typedef {object} Longest
   @property {string[]} words
   @property {number} bound
   @property {boolean} certified */

/** The words a letter walk names, drawn from `held` in the order they were
   given. Two words spanning the same pair are interchangeable, so which of them
   comes out is the order the caller handed them in and nothing more.
   @param {number[]} letters @param {string[][]} held @returns {string[]} */
export function name(letters, held) {
  const scan = new Int32Array(CELLS);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + 1 < letters.length; i++) {
    const cell = letters[i] * LETTERS + letters[i + 1];
    out.push(held[cell][scan[cell]++]);
  }
  return out;
}

/** `opening` names a word the chain has to open on, which is the question a
   player standing on a word is asking. The word is spent before the rest is
   solved and the answer is measured against a bound of its own, so a chain
   forced through a bad opening still says whether it is the longest that
   opening allows.
   @param {string[]} words @param {string} [opening] @returns {Longest} */
export function chain(words, opening) {
  const m = Int32Array.from(matrix(words).count);
  const held = buckets(words);
  /** @type {string[]} */
  let first = [];
  let start = -1;
  if (opening !== undefined) {
    const cell =
      (opening.charCodeAt(0) - A) * LETTERS + (opening.charCodeAt(opening.length - 1) - A);
    const seat = cell >= 0 && cell < CELLS ? held[cell].indexOf(opening) : -1;
    if (seat < 0) throw new Error(`${opening} is not one of the words to chain`);
    // Spent before the rest is solved, and taken out of its bucket so the
    // naming below cannot hand it out a second time.
    held[cell].splice(seat, 1);
    m[cell]--;
    first = [opening];
    start = opening.charCodeAt(opening.length - 1) - A;
  }
  const { letters, bound } = longest(m, start);
  const out = first.concat(name(letters, held));
  const whole = bound + first.length;
  return { words: out, bound: whole, certified: out.length === whole };
}

/** The balancing flow as it runs rather than as it ends: what each letter opens
   out of balance by, how much of that has to be shipped, what the balanced
   answer costs in words, and one frame per augmenting path in the order they
   were found. `settled` is false where the surplus could not all reach a
   deficit, which leaves the frames a partial account rather than a wrong one.
   @typedef {object} Trace
   @property {Int32Array} excess
   @property {number} need
   @property {number} paid
   @property {boolean} settled
   @property {Augmentation[]} frames */

/** The solve `chain` already does, with the working shown. Nothing here moves
   an answer — the trace is read off the paths the flow takes anyway — so
   graph.py needs no counterpart and tools/chains.json holds nothing about it.
   @param {Iterable<string>} words @returns {Trace} */
export function trace(words) {
  const m = Int32Array.from(matrix(words).count);
  const e = excess(m);
  let need = 0;
  for (let v = 0; v < LETTERS; v++) if (e[v] > 0) need += e[v];
  /** @type {Augmentation[]} */
  const frames = [];
  const got = balanced(m, frames);
  return { excess: e, need, paid: got ? got.cost : 0, settled: got !== null, frames };
}
