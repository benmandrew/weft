"""Write WordNet's noun hierarchy as the flat tree `<hypernym-disc>` reads.

The element nests arcs, and nesting needs a tree, so the hypernym DAG is cut
down to one: every synset keeps its first hypernym and the other 2,313 edges go.
All 82,115 nodes survive that cut; only the cross-links do.

The output is `{"names": "a\\nb\\n...", "par": [-1, 0, 0, ...]}` where `par[i]`
indexes `i`'s parent. Nodes come out ordered by rank, then by descending subtree
size, which guarantees a parent's index is below every one of its children's:
that ordering is the whole contract, and it lets the element compute depths,
leaf counts and angles in flat loops instead of walking the tree.

Rank is the longest path down from `entity.n.01`, not the shortest, so a synset
with two parents sits below the deeper of them and no edge ever points forwards.

    python tools/export_tree.py            # writes out/wordnet-tree.json
    python tools/export_tree.py --out DIR
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path
from typing import Any

from wordchain.lexicon import Synset, _wordnet


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


def _label(name: str) -> str:
    """`domestic_dog.n.01` reads as `domestic dog`. The sense number is dropped
    because the disc shows names, and the caller keeps the index for identity."""
    return name.rsplit(".", 2)[0].replace("_", " ")


def build() -> dict[str, Any]:
    wordnet = _wordnet()
    synsets: list[Synset] = list(wordnet.all_synsets("n"))
    parents = _parents(synsets)
    rank, order = _ranks(parents)
    size = _sizes(parents, order)

    laid_out = sorted(parents, key=lambda name: (rank[name], -size[name], name))
    index = {name: i for i, name in enumerate(laid_out)}
    return {
        "names": "\n".join(_label(name) for name in laid_out),
        "par": [index[parents[name][0]] if parents[name] else -1 for name in laid_out],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="out", type=Path, help="directory to write into")
    args = parser.parse_args()

    tree = build()
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "wordnet-tree.json"
    path.write_text(json.dumps(tree, separators=(",", ":")))

    nodes = len(tree["par"])
    dropped = sum(1 for p in tree["par"] if p < 0)
    print(f"{path}: {nodes} nodes, {nodes - dropped} edges, {path.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
