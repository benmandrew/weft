"""The letter graph, the word graph, and the trap analysis over them.

A word runs from its first letter to its last, and the next word must start
where the previous one ended. Every word is therefore an edge between two of 26
letters, and the whole game lives on a 26-node graph no matter how large the
vocabulary is. The word-level graph is the line graph of that one.
"""

from __future__ import annotations

import itertools
import math
import string
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import networkx as nx

import numpy as np

from .lexicon import Word

LETTERS = string.ascii_lowercase
_INDEX = {letter: i for i, letter in enumerate(LETTERS)}


def letter_matrix(words: list[Word]) -> np.ndarray:
    """A 26x26 count indexed [first letter][last letter]."""
    counts = np.zeros((26, 26), dtype=int)
    for word in words:
        counts[_INDEX[word.head], _INDEX[word.tail]] += 1
    return counts


def letter_graph(words: list[Word]) -> nx.DiGraph[str]:
    """26 nodes, one weighted edge per letter pair some word bridges."""
    import networkx as nx

    graph = nx.DiGraph()
    graph.add_nodes_from(LETTERS)
    counts = letter_matrix(words)
    for i, head in enumerate(LETTERS):
        for j, tail in enumerate(LETTERS):
            if counts[i, j]:
                graph.add_edge(head, tail, weight=int(counts[i, j]))
    return graph


def word_graph(words: list[Word]) -> nx.DiGraph[str]:
    """One node per word, an edge wherever one word can follow another."""
    import networkx as nx

    graph = nx.DiGraph()
    for word in words:
        graph.add_node(word.text, zipf=word.zipf)

    by_head: dict[str, list[Word]] = defaultdict(list)
    for word in words:
        by_head[word.head].append(word)

    for word in words:
        for successor in by_head[word.tail]:
            if successor.text != word.text:
                graph.add_edge(word.text, successor.text)
    return graph


@dataclass(frozen=True)
class LetterStat:
    """What one letter is worth to a player who has just been handed it."""

    letter: str
    supply: int  # words starting here: the replies available
    demand: int  # words ending here: how often play lands on it

    @property
    def pressure(self) -> float:
        """Demand per available reply. Above 1 the letter drains faster than it refills."""
        return self.demand / self.supply if self.supply else math.inf

    @property
    def is_dead_end(self) -> bool:
        return self.supply == 0 and self.demand > 0


def letter_stats(words: list[Word]) -> list[LetterStat]:
    """One entry per letter, in alphabetical order."""
    supply: dict[str, int] = defaultdict(int)
    demand: dict[str, int] = defaultdict(int)
    for word in words:
        supply[word.head] += 1
        demand[word.tail] += 1
    return [LetterStat(letter, supply[letter], demand[letter]) for letter in LETTERS]


def live_letters(words: list[Word]) -> set[str]:
    """Letters any word touches at either end."""
    return {word.head for word in words} | {word.tail for word in words}


def core(graph: nx.DiGraph[str]) -> set[str]:
    """The largest strongly connected set of letters.

    Play inside it can continue indefinitely. A letter outside it is somewhere
    the game can arrive and never leave, which is what ends a round.
    """
    import networkx as nx

    components = list(nx.strongly_connected_components(graph))
    return max(components, key=len) if components else set()


def traps(words: list[Word], limit: int = 6) -> list[LetterStat]:
    """Letters ranked by how badly they strand a player, worst first."""
    reachable = [s for s in letter_stats(words) if s.demand > 0]
    return sorted(reachable, key=lambda s: (-s.pressure, -s.demand))[:limit]


def summary(words: list[Word], opening: str | None = None) -> dict[str, Any]:
    """Every scalar the report and the web page need.

    `opening` pins the chain's first word, which asks how far play can still
    run from there rather than how far it can run at all.
    """
    graph = letter_graph(words)
    stats = letter_stats(words)
    chain = longest_chain(words, opening)
    live = live_letters(words)
    inside = core(graph) & live
    return {
        "words": len(words),
        "edges": word_graph(words).number_of_edges(),
        "letter_pairs": graph.number_of_edges(),
        "live_letters": sorted(live),
        "core": sorted(inside),
        "outside_core": sorted(live - inside),
        # A letter can fall outside the core for opposite reasons. Nothing ends
        # in C, so play never arrives there and "cat" is only ever an opening
        # move. Nothing starts with X, so arriving there ends the round.
        "openers_only": [s.letter for s in stats if s.supply > 0 and s.demand == 0],
        "dead_ends": [s.letter for s in stats if s.is_dead_end],
        "traps": [(s.letter, s.demand, s.supply, s.pressure) for s in traps(words)],
        # How far play can run if every word is chosen perfectly. `chain_bound`
        # is what the flow relaxation allows; the chain is the longest either
        # way, and `chain_certified` says whether the two meet.
        "longest_chain": chain.words,
        "chain_bound": chain.bound,
        "chain_certified": chain.certified,
    }


# --- The longest chain -----------------------------------------------------
#
# A chain is a trail in the letter graph: a word is an arc from its first letter
# to its last, and playing a word once is using an arc once. Keeping the most
# words is discarding the fewest, which is a min-cost transshipment on 26 nodes
# — supplies of out minus in, capacities the word counts, unit costs. Every cost
# is non-negative and the matrix is totally unimodular, so the answer comes back
# integral with no solver.
#
# The relaxation says nothing about whether the arcs it keeps form one connected
# run, so it answers with an upper bound. Where the arcs do come back connected
# the bound is attained and the chain is provably the longest there is. Where
# they do not, words crossing to the stranded letters are forced back one at a
# time while that grows the component, then the largest component is kept and
# the rest re-solved. That is a heuristic, and it can stop short, so a chain
# under the bound is handed to `_search`, a branch and bound over the same
# relaxation that either finds a longer chain or proves there is none.
#
# web/word-longest.js is this written a second time, so the browser and the
# report agree on how long a category runs. A change here has to be made there
# as well, and tools/chains.json is what holds the two to the same answers.

_CELLS = 26 * 26
_INF = 1 << 30


@dataclass(frozen=True)
class LongestChain:
    """The longest chain a category allows, and how sure of it we are.

    `bound` is what the flow relaxation permits, counting no connectivity.
    `certified` says the chain reached it. The chain is the longest there is
    either way: one under the bound was proved so by `_search`.
    """

    words: list[str]
    bound: int
    certified: bool

    @property
    def length(self) -> int:
        return len(self.words)


def _excess(m: list[int]) -> list[int]:
    """Words leaving each letter less the words arriving. Loops cancel, so they
    are left out entirely: a loop is free to keep and never unbalances anyone."""
    e = [0] * 26
    for u in range(26):
        for v in range(26):
            if u == v:
                continue
            count = m[u * 26 + v]
            if count:
                e[u] += count
                e[v] -= count
    return e


class _Flow:
    """Min-cost max-flow by successive shortest paths, SPFA finding each one.

    Held as flat parallel lists with the reverse arc at `e ^ 1`, which is what
    lets a path be walked backwards without storing it.
    """

    def __init__(self, n: int) -> None:
        self.n = n
        self.head = [-1] * n
        self.to: list[int] = []
        self.next: list[int] = []
        self.cap: list[int] = []
        self.cost: list[int] = []

    def add(self, u: int, v: int, cap: int, cost: int) -> int:
        e = len(self.to)
        self.to.append(v)
        self.cap.append(cap)
        self.cost.append(cost)
        self.next.append(self.head[u])
        self.head[u] = e
        self.to.append(u)
        self.cap.append(0)
        self.cost.append(-cost)
        self.next.append(self.head[v])
        self.head[v] = e + 1
        return e

    def run(self, source: int, sink: int) -> tuple[int, int]:
        from collections import deque

        flow = 0
        paid = 0
        while True:
            dist = [_INF] * self.n
            prev = [-1] * self.n
            queued = [False] * self.n
            dist[source] = 0
            queued[source] = True
            waiting = deque([source])
            while waiting:
                u = waiting.popleft()
                queued[u] = False
                e = self.head[u]
                while e != -1:
                    if self.cap[e] > 0:
                        v = self.to[e]
                        step = dist[u] + self.cost[e]
                        if step < dist[v]:
                            dist[v] = step
                            prev[v] = e
                            if not queued[v]:
                                queued[v] = True
                                waiting.append(v)
                    e = self.next[e]
            if dist[sink] >= _INF:
                return flow, paid
            push = _INF
            v = sink
            while v != source:
                push = min(push, self.cap[prev[v]])
                v = self.to[prev[v] ^ 1]
            v = sink
            while v != source:
                self.cap[prev[v]] -= push
                self.cap[prev[v] ^ 1] += push
                v = self.to[prev[v] ^ 1]
            flow += push
            paid += push * dist[sink]


def _balanced(m: list[int]) -> tuple[list[int], int] | None:
    """The cheapest discards `y` that leave every letter balanced, or None.

    A unit of flow along `u -> v` is one word of that pair thrown away, so the
    cost is the count of discards and `m - y` is a set of arcs some closed
    circuit can walk.
    """
    excess = _excess(m)
    source, sink = 26, 27
    flow = _Flow(28)
    arc = [-1] * _CELLS
    for u in range(26):
        for v in range(26):
            if u == v:
                continue
            count = m[u * 26 + v]
            if count:
                arc[u * 26 + v] = flow.add(u, v, count, 1)
    need = 0
    for v in range(26):
        if excess[v] > 0:
            flow.add(source, v, excess[v], 0)
            need += excess[v]
        elif excess[v] < 0:
            flow.add(v, sink, -excess[v], 0)
    pushed, cost = flow.run(source, sink)
    if pushed != need:
        return None
    # An arc's flow is what its reverse residual has picked up.
    y = [flow.cap[arc[i] ^ 1] if arc[i] >= 0 else 0 for i in range(_CELLS)]
    return y, cost


@dataclass(frozen=True)
class _Residual:
    """Every way one more or one fewer word can be discarded, as a graph on the
    26 letters. `edges` is (from, to, cost, tag), the tag naming the cell the
    edge moves and `~cell` meaning it moves it back. `out` indexes them by
    source, which is what keeps Dijkstra to one pass over each edge."""

    edges: list[tuple[int, int, int, int]]
    out: list[list[int]]


def _residual(m: list[int], y: list[int]) -> _Residual:
    edges: list[tuple[int, int, int, int]] = []
    out: list[list[int]] = [[] for _ in range(26)]
    for u in range(26):
        for v in range(26):
            if u == v:
                continue  # a loop carries no excess, so it moves nothing
            cell = u * 26 + v
            count = m[cell]
            if not count:
                continue
            if y[cell] < count:
                out[u].append(len(edges))
                edges.append((u, v, 1, cell))
            if y[cell] > 0:
                out[v].append(len(edges))
                edges.append((v, u, -1, ~cell))
    return _Residual(edges, out)


def _potentials(res: _Residual) -> list[int]:
    """Bellman-Ford from an all-zero source, which is what makes the residual
    costs non-negative once reduced and so lets Dijkstra price the rest."""
    pi = [0] * 26
    for _ in range(26):
        moved = False
        for u, v, cost, _tag in res.edges:
            if pi[u] + cost < pi[v]:
                pi[v] = pi[u] + cost
                moved = True
        if not moved:
            break
    return pi


def _dijkstra(res: _Residual, pi: list[int], src: int) -> tuple[list[int], list[int]]:
    """Shortest residual paths out of `src` on reduced costs. Scanning all 26
    for the nearest beats a heap at this size."""
    dist = [_INF] * 26
    parent = [-1] * 26
    done = [False] * 26
    dist[src] = 0
    for _ in range(26):
        u = -1
        best = _INF
        for v in range(26):
            if not done[v] and dist[v] < best:
                best = dist[v]
                u = v
        if u < 0:
            break
        done[u] = True
        for e in res.out[u]:
            _from, v, cost, _tag = res.edges[e]
            step = dist[u] + cost + pi[u] - pi[v]
            if step < dist[v]:
                dist[v] = step
                parent[v] = e
    return dist, parent


def _walk_back(res: _Residual, parent: list[int], y: list[int], s: int, t: int) -> None:
    """Move one unit of discard along the residual path from `t` back to `s`,
    which is what turns the balanced answer into a chain running s to t."""
    v = s
    while v != t:
        e = parent[v]
        if e < 0:
            raise ValueError("the residual path Dijkstra priced is not there")
        source, _to, _cost, tag = res.edges[e]
        if tag >= 0:
            y[tag] += 1
        else:
            y[~tag] -= 1
        v = source


def _components(x: list[int]) -> tuple[Callable[[int], int], list[bool]]:
    """Union-find over the letters some kept arc touches. Path halving, and no
    rank: at 26 nodes the second pointer costs more than it saves."""
    parent = list(range(26))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    touched = [False] * 26
    for u in range(26):
        for v in range(26):
            if x[u * 26 + v] > 0:
                touched[u] = True
                touched[v] = True
                if u != v:
                    a, b = find(u), find(v)
                    if a != b:
                        parent[a] = b
    return find, touched


def _hierholzer(x: list[int], start: int) -> list[int]:
    """The letter sequence of the trail `x` describes. Iterative, since the
    recursive form runs a category's worth of words deep."""
    work = list(x)
    scan = [0] * 26  # each letter's successor pointer, which only advances
    stack = [start]
    circuit: list[int] = []
    while stack:
        v = stack[-1]
        u = scan[v]
        moved = False
        while u < 26:
            if work[v * 26 + u] > 0:
                work[v * 26 + u] -= 1
                stack.append(u)
                moved = True
                break
            u += 1
            scan[v] = u
        if not moved:
            circuit.append(stack.pop())
    circuit.reverse()
    return circuit


@dataclass(frozen=True)
class _Run:
    """One pass of the solver: the arcs kept, where the trail starts, how many
    words that is, the bound it was measured against, and the letters it reached."""

    x: list[int]
    start: int
    words: int
    bound: int
    certified: bool
    keep: list[bool]


def _solve_on(m: list[int], start: int) -> _Run | None:
    total = sum(m)
    if total == 0:
        return None
    base = _balanced(m)
    if base is None:
        return None
    y_base, base_cost = base
    res = _residual(m, y_base)
    pi = _potentials(res)

    # Every start and end option priced off that one solve. A chain from s to t
    # moves supply by a unit at each end, so it costs the balanced answer plus
    # the shortest residual path t -> s; 26 Dijkstras cover the 26 * 25 pairs of
    # distinct letters, and one more candidate is the closed circuit, which
    # starts and ends nowhere. A chain whose two ends are the same letter costs
    # exactly the balanced answer, so the diagonal is that circuit and the
    # `s != t` guard below skips it rather than pricing it 26 times over.
    #
    # An opening letter drops every candidate that opens elsewhere. The circuit
    # survives whatever the letter is, since a closed walk can be rotated to
    # open on any letter it touches, and the `touched` guard below is what
    # decides whether this one does.
    candidates = [(base_cost, -1, -1)]
    paths: list[list[int]] = []
    for t in range(26):
        dist, parent = _dijkstra(res, pi, t)
        paths.append(parent)
        for s in range(26):
            if s != t and dist[s] < _INF and (start < 0 or s == start):
                candidates.append((base_cost + dist[s] - pi[t] + pi[s], s, t))
    # Sorted on the whole tuple rather than on the cost alone, since neither
    # Python nor JavaScript promises anything about ties and a total order is
    # what stops the two halves ever having to agree by luck.
    candidates.sort()
    bound = total - candidates[0][0]

    fragment: _Run | None = None
    split: list[tuple[int, int, list[int], _Held]] = []
    for discards, s, t in candidates:
        # Sorted by discards, so no later candidate can keep more than this
        # one. It also decides which component the next round runs on, and a
        # smaller fragment there can free more words than a larger one: river
        # chains 64 words with this break and 63 without. word-longest.js stops
        # on the same test.
        if fragment is not None and total - discards <= fragment.words:
            break
        y = list(y_base)
        if s >= 0:
            _walk_back(res, paths[t], y, s, t)
        x = [m[i] - y[i] for i in range(_CELLS)]

        held = _held(x, s, start)
        if held is None:
            continue
        if held.whole:
            return _Run(x, held.anchor, held.kept, bound, True, held.keep)
        split.append((discards, s, x, held))
        if fragment is None or held.kept > fragment.words:
            fragment = _fragment(x, held, bound)

    # Joining only once the scan has found nothing whole, so a candidate that
    # is whole as it stands ends the scan before any join is spent.
    for discards, s, x, held in split:
        if fragment is not None and total - discards <= fragment.words:
            break
        x, held = _join(m, x, held, s, start)
        # A join can cost words, so only one that kept everything the candidate
        # priced has reached the bound.
        if held.whole and held.kept == total - discards:
            return _Run(x, held.anchor, held.kept, bound, True, held.keep)
        if fragment is None or held.kept > fragment.words:
            fragment = _fragment(x, held, bound)
    return fragment


def _fragment(x: list[int], held: _Held, bound: int) -> _Run:
    kept_x = [x[i] if held.keep[i // 26] and held.keep[i % 26] else 0 for i in range(_CELLS)]
    return _Run(kept_x, held.anchor, held.kept, bound, False, held.keep)


@dataclass(frozen=True)
class _Held:
    """The component a trail over `x` can walk: the letter it opens on, the
    letters in it, the words among them, whether it is all of `x`, and the
    letters `x` keeps words on outside it."""

    anchor: int
    keep: list[bool]
    kept: int
    whole: bool
    stranded: list[bool]


def _held(x: list[int], s: int, start: int) -> _Held | None:
    find, touched = _components(x)
    if s >= 0:
        anchor = s
    elif start >= 0:
        anchor = start  # the circuit, rotated to open where it was asked to
    else:
        # The circuit opens anywhere, so on its largest component, the lowest
        # letter breaking a tie. Taking the lowest letter outright kept a lone
        # loop on a over a circuit through b and c.
        size = [0] * 26
        for i in range(_CELLS):
            if x[i]:
                size[find(i // 26)] += x[i]
        anchor = -1
        for v in range(26):
            if touched[v] and (anchor < 0 or size[find(v)] > size[find(anchor)]):
                anchor = v
    if anchor < 0 or not touched[anchor]:
        return None
    root = find(anchor)
    keep = [touched[v] and find(v) == root for v in range(26)]
    kept = sum(x[i] for i in range(_CELLS) if keep[i // 26] and keep[i % 26])
    whole = all(keep[v] for v in range(26) if touched[v])
    stranded = [touched[v] and not keep[v] for v in range(26)]
    return _Held(anchor, keep, kept, whole, stranded)


def _join(m: list[int], x: list[int], held: _Held, s: int, start: int) -> tuple[list[int], _Held]:
    """Force discarded words that cross out of the held component back in, one
    at a time, while that grows it.

    A loop never enters the flow, so the flow keeps every loop whatever it
    discards, and can strand one on a letter it cut off at no cost to itself.
    fabric kept aba and alpaca on an a no other kept word reached, and the
    retry on the letters reached dropped a for good: 61 words, where organza in
    and acetate out make 62.

    `x` is an optimal flow, so holding one more word of a pair costs exactly the
    cheapest residual cycle through that word's recovery, which one Dijkstra
    prices. A cycle costing as much as the stranded letters hold cannot grow the
    component and is never walked. A fresh solve per word tried took a
    constrained solve on language from 0.5 ms to 18 ms in the browser, on a
    loop it could never afford to join.
    """
    cap = list(m)
    y = [m[i] - x[i] for i in range(_CELLS)]
    while not held.whole:
        res = _residual(cap, y)
        pi = _potentials(res)
        room = sum(x) - held.kept  # what the stranded letters hold
        trees: dict[int, tuple[list[int], list[int]]] = {}
        best: tuple[list[int], _Held, list[int], int] | None = None
        for cell in range(_CELLS):
            u, v = divmod(cell, 26)
            crosses = (held.keep[u] and held.stranded[v]) or (held.stranded[u] and held.keep[v])
            if not y[cell] or not crosses:
                continue
            if u not in trees:
                trees[u] = _dijkstra(res, pi, u)
            dist, parent = trees[u]
            if dist[v] >= _INF or dist[v] - pi[u] + pi[v] - 1 >= room:
                continue
            ty = list(y)
            ty[cell] -= 1
            _walk_back(res, parent, ty, v, u)
            tx = [m[i] - ty[i] for i in range(_CELLS)]
            th = _held(tx, s, start)
            if th is not None and th.kept > (held if best is None else best[1]).kept:
                best = (tx, th, ty, cell)
        if best is None:
            break
        x, held, y, cell = best
        cap[cell] -= 1
    return x, held


def _relax(lo: list[int], hi: list[int], start: int) -> tuple[int, list[int], int] | None:
    """The most words a balanced trail can keep with each pair's count between
    `lo` and `hi`: the count, the arcs, and the letter it opens on (-1 for a
    closed circuit). None where no such set exists.

    `_balanced` with two changes. Discards are capped at `hi - lo`, and a
    one-unit gate lets one letter keep a surplus of one and another a deficit of
    one for free, which is the open trail's two ends chosen inside the flow
    rather than priced one pair at a time.
    """
    excess = _excess(hi)
    source, sink, gate, out = 26, 27, 28, 29
    flow = _Flow(30)
    arc = [-1] * _CELLS
    for cell in range(_CELLS):
        u, v = divmod(cell, 26)
        if u != v and hi[cell] > lo[cell]:
            arc[cell] = flow.add(u, v, hi[cell] - lo[cell], 1)
    need = 0
    for v in range(26):
        if excess[v] > 0:
            flow.add(source, v, excess[v], 0)
            need += excess[v]
        elif excess[v] < 0:
            flow.add(v, sink, -excess[v], 0)
    opens = [-1] * 26
    for v in range(26):
        if start < 0 or v == start:
            opens[v] = flow.add(v, gate, 1, 0)
        flow.add(out, v, 1, 0)
    flow.add(gate, out, 1, 0)
    pushed, cost = flow.run(source, sink)
    if pushed != need:
        return None
    x = [hi[i] - (flow.cap[arc[i] ^ 1] if arc[i] >= 0 else 0) for i in range(_CELLS)]
    s = next((v for v in range(26) if opens[v] >= 0 and flow.cap[opens[v] ^ 1]), -1)
    return sum(hi) - cost, x, s


def _search(m: list[int], start: int, best: int) -> tuple[list[int], int] | None:
    """The arcs of a chain longer than `best` words and the letter it opens on,
    the longest there is, or None where `best` is already the longest.

    Branch and bound over `_relax`. A node holds per-pair limits, its
    relaxation bounds every chain inside them, and a connected answer that
    touches `start` is a chain by Euler. Otherwise one component C is picked and
    every chain does exactly one of three things: stays on C's letters, stays
    off them, or plays a pair between C and the rest. The third is split over
    the crossing pairs, branch j holding at least one word of pair j and none of
    the pairs before it. Every chain lands in one branch, and every branch rules
    out the answer that split it, so the search is exact and it ends.
    """
    found: tuple[list[int], int] | None = None
    stack = [([0] * _CELLS, list(m))]
    while stack:
        lo, hi = stack.pop()
        relaxed = _relax(lo, hi, start)
        if relaxed is None or relaxed[0] <= best:
            continue
        kept, x, s = relaxed
        find, touched = _components(x)
        roots = {find(v) for v in range(26) if touched[v]}
        if start >= 0 and not touched[start]:
            # The gate keeps a word leaving `start` for free, so an untouched
            # start has none left, and only the empty chain lives here.
            continue
        if len(roots) == 1:
            # A circuit opens wherever it was asked to, or on any letter it has.
            opener = s if s >= 0 else start if start >= 0 else touched.index(True)
            best, found = kept, (x, opener)
            continue
        size = dict.fromkeys(roots, 0)
        for i in range(_CELLS):
            if x[i]:
                size[find(i // 26)] += x[i]
        # The smallest piece not holding the opening, since staying off it
        # loses the least and that branch is tried first.
        held = find(start) if start >= 0 else -1
        root = min((r for r in roots if r != held), key=lambda r: (size[r], r))
        inside = [touched[v] and find(v) == root for v in range(26)]
        crossing = [i for i in range(_CELLS) if hi[i] and inside[i // 26] != inside[i % 26]]
        branches: list[tuple[list[int], list[int]]] = []
        # Off C, then on C, where the opening allows each.
        for on in (False, True):
            if start >= 0 and inside[start] != on:
                continue
            side = [inside[i // 26] == on and inside[i % 26] == on for i in range(_CELLS)]
            if any(lo[i] and not side[i] for i in range(_CELLS)):
                continue  # a pair held at one or more is on the other side
            branches.append((lo, [hi[i] if side[i] else 0 for i in range(_CELLS)]))
        barred = list(hi)
        for cell in crossing:
            forced = list(lo)
            forced[cell] = max(forced[cell], 1)
            branches.append((forced, list(barred)))
            barred[cell] = 0
        stack.extend(reversed(branches))
    return found


def _solve_matrix(m: list[int], start: int = -1) -> tuple[list[int], int]:
    """The letter sequence of the longest chain found, and the upper bound.

    A fragmented answer is retried on the letters it did reach, this time at
    full capacity rather than at what the fragment kept, which is what recovers
    the words the discarded components were holding hostage.

    `start` names the letter the chain has to open on, or -1 for any. A letter
    no word leaves is short cut rather than solved. The general path answers the
    same, since a trail opening at f wants an arc leaving f and balance then
    denies every candidate, but it spends a flow solve and 26 Dijkstras to say
    so. word-longest.js short cuts on the same test.
    """
    if start >= 0 and not any(m[start * 26 + v] for v in range(26)):
        return [], 0
    best: _Run | None = None
    bound = 0
    current = m
    for _ in range(26):
        run = _solve_on(current, start)
        if run is None:
            break
        if best is None:
            bound = run.bound  # the first round is the only one bounding all of m
        if best is None or run.words > best.words:
            best = run
        if run.certified:
            break
        following = [0] * _CELLS
        shrunk = False
        left = 0
        for u in range(26):
            for v in range(26):
                cell = u * 26 + v
                if run.keep[u] and run.keep[v]:
                    following[cell] = current[cell]
                    left += following[cell]
                elif current[cell]:
                    shrunk = True
        if not shrunk or left == 0:
            break
        current = following
    if best is None:
        return [], bound
    if best.words < bound:
        longer = _search(m, start, best.words)
        if longer is not None:
            return _hierholzer(*longer), bound
    return _hierholzer(best.x, best.start), bound


def longest_chain(words: list[Word], opening: str | None = None) -> LongestChain:
    """The longest chain the category allows, with the bound it was proved to.

    The words are named after the letters are, so a pair of words spanning the
    same two letters is interchangeable and only the arc has to be solved for.

    `opening` names a word the chain has to open on, which is the question a
    player standing on a word is asking. The word is spent before the rest is
    solved and the answer is measured against a bound of its own, so a chain
    forced through a bad opening still says whether it is the longest one that
    opening allows.
    """
    counts = letter_matrix(words)
    m = [int(counts[u, v]) for u in range(26) for v in range(26)]
    buckets: list[list[str]] = [[] for _ in range(_CELLS)]
    for word in words:
        buckets[_INDEX[word.head] * 26 + _INDEX[word.tail]].append(word.text)

    start, first = -1, []
    if opening is not None:
        cell = _INDEX[opening[0]] * 26 + _INDEX[opening[-1]]
        if opening not in buckets[cell]:
            raise ValueError(f"{opening!r} is not one of the words to chain")
        # Spent before the rest is solved, and taken out of its bucket so the
        # naming below cannot hand it out a second time.
        buckets[cell].remove(opening)
        m[cell] -= 1
        start, first = _INDEX[opening[-1]], [opening]

    letters, bound = _solve_matrix(m, start)
    scan = [0] * _CELLS
    chain: list[str] = []
    for head, tail in itertools.pairwise(letters):
        cell = head * 26 + tail
        chain.append(buckets[cell][scan[cell]])
        scan[cell] += 1
    chain = first + chain
    return LongestChain(chain, bound + len(first), len(chain) == bound + len(first))
