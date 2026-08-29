"""Write WordNet's noun hierarchy as the flat tree `<hypernym-disc>` reads.

The element nests arcs, and nesting needs a tree, so the hypernym DAG is cut
down to one: every synset keeps its first hypernym and the other 2,313 edges go.
All 82,115 nodes survive that cut; only the cross-links do.

The output is three files, because the disc lays itself out without reading a
single name. `wordnet-tree.json` is `{"par": [-1, 0, 0, ...]}` where `par[i]`
indexes `i`'s parent, `wordnet-names.txt` is the names for those same indices
one per line, and `wordnet-glosses.txt` the definitions. Structure is 42 KB
over the wire against 311 KB of names, so splitting them lets the element paint
from the smaller file and fetch the rest afterwards.

The glosses file holds a line per node, index-aligned with the other two. It
carries every synset rather than only the ones that can be a root, because the
definition follows the pointer as well as the crumb path, and two thirds of the
nodes the pointer lands on are leaves.

Nodes come out in preorder over the first-parent tree, which guarantees a
parent's index is below every one of its children's: that ordering is the whole
contract, and it lets the element compute depths, leaf counts and angles in flat
loops instead of walking the tree. Siblings are visited by rank, then by
descending subtree size, which is the wedge order the disc draws, so every node
keeps the depth and the angle span it had under the rank-major sort this
replaced.

Rank is the longest path down from `entity.n.01`, not the shortest, so a synset
with two parents sits below the deeper of them. Preorder holds the contract up
now, and rank still earns its keep three times over: it finds a cycle in the
DAG, it orders the reverse pass that totals subtree sizes, and it leads the
sibling key, where 379 of the 16,933 sibling groups hold nodes of differing
rank.

    python tools/export_tree.py            # writes the three files into out/
    python tools/export_tree.py --out DIR
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from collections.abc import Callable
from pathlib import Path

from wordchain.lexicon import Synset, _wordnet

Key = tuple[int, int, str]


def _parents(synsets: list[Synset]) -> dict[str, list[str]]:
    """Every synset's hypernyms, classes and instances alike.

    `instance_hypernyms` carries 9.4% of the nouns -- Paris under city, every
    named river -- and nltk keeps it out of `hypernyms`, so asking for one
    without the other silently drops them.
    """
    return {
        synset.name(): [h.name() for h in synset.hypernyms()]
        + [h.name() for h in synset.instance_hypernyms()]
        for synset in synsets
    }


def _ranks(parents: dict[str, list[str]]) -> tuple[dict[str, int], list[str]]:
    """Longest path from a root, by Kahn's algorithm.

    Iterative rather than recursive: the deepest chain is 19 long but the
    recursion would be 82,115 frames in the worst ordering.
    """
    children: dict[str, list[str]] = {name: [] for name in parents}
    for name, above in parents.items():
        for parent in above:
            children[parent].append(name)

    remaining = {name: len(above) for name, above in parents.items()}
    rank = dict.fromkeys(parents, 0)
    queue = deque(name for name, count in remaining.items() if count == 0)
    order: list[str] = []
    while queue:
        name = queue.popleft()
        order.append(name)
        for child in children[name]:
            rank[child] = max(rank[child], rank[name] + 1)
            remaining[child] -= 1
            if remaining[child] == 0:
                queue.append(child)
    if len(order) != len(parents):
        raise SystemExit("the hypernym graph has a cycle, which it should not")
    return rank, order


def _sizes(parents: dict[str, list[str]], order: list[str]) -> dict[str, int]:
    """Subtree size on the first-parent tree, counted against the topological
    order reversed, so every child is totalled before its parent."""
    size = dict.fromkeys(parents, 1)
    for name in reversed(order):
        above = parents[name]
        if above:
            size[above[0]] += size[name]
    return size


def _gloss(synset: Synset) -> str:
    """One line, since the file is positional. WordNet writes no newline into a
    definition, but a stray one would silently shift every index below it."""
    return str(synset.definition() or "").replace("\n", " ")


def _label(name: str) -> str:
    """`domestic_dog.n.01` reads as `domestic dog`. The sense number is dropped
    because the disc shows names, and the caller keeps the index for identity."""
    return name.rsplit(".", 2)[0].replace("_", " ")


def _preorder(parents: dict[str, list[str]], key: Callable[[str], Key]) -> list[str]:
    """Depth-first over the first-parent tree, visiting siblings in `key` order.

    Preorder satisfies the contract on its own: a node is emitted before its
    whole subtree, so every parent's index is below all of its children's
    without any appeal to rank. It also puts each subtree in a contiguous run of
    indices, so one wedge's glosses could be served as a byte range rather than
    82,115 scattered lines. Nothing serves them that way yet.

    Contiguity pays on its own, taking the glosses from 1,428 KB brotli to
    1,329 KB, since siblings share their phrasing -- a genus and its species
    read alike -- and the compressor sees that only where they sit together.
    `par` is near-monotonic in preorder rather than scattered, which takes the
    tree file from 129 KB to 42 KB.

    Iterative rather than recursive: the first-parent tree is 19 deep, but a
    chain that ran the other way would be 82,115 frames.
    """
    children: dict[str, list[str]] = {}
    for name, above in parents.items():
        children.setdefault(above[0] if above else "", []).append(name)
    for below in children.values():
        below.sort(key=key)

    laid_out: list[str] = []
    stack = children.get("", [])[::-1]
    while stack:
        name = stack.pop()
        laid_out.append(name)
        stack.extend(reversed(children.get(name, [])))
    if len(laid_out) != len(parents):
        raise SystemExit("the first-parent tree does not reach every synset")
    return laid_out


def build() -> tuple[list[str], list[int], list[str]]:
    """The names, the parent indices and the glosses, in the order the contract
    requires."""
    wordnet = _wordnet()
    synsets: list[Synset] = list(wordnet.all_synsets("n"))
    parents = _parents(synsets)
    rank, order = _ranks(parents)
    size = _sizes(parents, order)

    # Sibling order is wedge order, so the key stays the one the whole file used
    # to be sorted by: all 82,115 nodes keep their depth and their angle span,
    # and preorder is a permutation of the indices and nothing else.
    laid_out = _preorder(parents, lambda name: (rank[name], -size[name], name))
    index = {name: i for i, name in enumerate(laid_out)}
    gloss = {synset.name(): _gloss(synset) for synset in synsets}
    return (
        [_label(name) for name in laid_out],
        [index[parents[name][0]] if parents[name] else -1 for name in laid_out],
        [gloss[name] for name in laid_out],
    )


def _kb(path: Path) -> str:
    return f"{path.stat().st_size / 1024:.0f} KB"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="out", type=Path, help="directory to write into")
    args = parser.parse_args()

    names, par, glosses = build()
    args.out.mkdir(parents=True, exist_ok=True)
    structure = args.out / "wordnet-tree.json"
    labels = args.out / "wordnet-names.txt"
    defs = args.out / "wordnet-glosses.txt"
    structure.write_text(json.dumps({"par": par}, separators=(",", ":")))
    labels.write_text("\n".join(names))
    defs.write_text("\n".join(glosses))

    roots = sum(1 for parent in par if parent < 0)
    written = sum(1 for gloss in glosses if gloss)
    print(f"{structure}: {len(par)} nodes, {len(par) - roots} edges, {_kb(structure)}")
    print(f"{labels}: {len(names)} names, {_kb(labels)}")
    print(f"{defs}: {written} glosses over {len(glosses)} lines, {_kb(defs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
