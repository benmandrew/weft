"""Write WordNet's noun hierarchy as the flat tree `<hypernym-disc>` reads.

Nesting needs a tree and the hypernyms are a DAG, so every synset keeps its
first hypernym and the cross-links go. Every node survives that cut.

The output is three files, since the disc lays itself out without reading a
name: `wordnet-tree.json`, `{"par": [-1, 0, 0, ...]}` where `par[i]` indexes
`i`'s parent; `wordnet-names.txt`, one name per line; and
`wordnet-glosses.txt`, one definition per line. All three are positional and
index-aligned, with no key to catch a mismatch.

Nodes come out in preorder over the first-parent tree, which puts every
parent's index below all of its children's. That ordering is the whole
contract: it lets the element find depths, leaf counts and angles in flat loops
rather than by traversal. Siblings are visited by rank, then by descending
subtree size, which is the wedge order the disc draws; rank is the longest path
down from `entity.n.01`, so a synset with two parents sits below the deeper.

    python tools/export_tree.py            # writes the three files into out/
    python tools/export_tree.py --out DIR
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from collections.abc import Callable
from pathlib import Path

from weft.lexicon import Synset, _wordnet

Key = tuple[int, int, str]


def _parents(synsets: list[Synset]) -> dict[str, list[str]]:
    """Every synset's hypernyms, classes and instances alike.

    nltk keeps `instance_hypernyms` -- Paris under city, every named river --
    out of `hypernyms`, so asking for one without the other drops them.
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

    A node is emitted before its whole subtree, which satisfies the export's
    contract on its own, and each subtree lands in a contiguous run of indices,
    which is what compresses and what a byte range would need.

    Iterative rather than recursive: the tree is shallow, but a chain running
    the other way would be one frame per synset.
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


def layout() -> tuple[list[Synset], dict[str, list[str]], list[str]]:
    """Every noun synset, its hypernyms, and the synset names in export order.

    `export_table.py` indexes its word table by position in this order, so the
    two exporters share this function rather than each deriving the order.
    """
    wordnet = _wordnet()
    synsets: list[Synset] = list(wordnet.all_synsets("n"))
    parents = _parents(synsets)
    rank, order = _ranks(parents)
    size = _sizes(parents, order)

    # Sibling order is wedge order, so changing this key moves the layout.
    laid_out = _preorder(parents, lambda name: (rank[name], -size[name], name))
    return synsets, parents, laid_out


def build() -> tuple[list[str], list[int], list[str]]:
    """The names, the parent indices and the glosses, in the order the contract
    requires."""
    synsets, parents, laid_out = layout()
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
    parser = argparse.ArgumentParser(description=(__doc__ or "").partition("\n")[0])
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
