"""Write the table a page derives any synset's word list from.

`words-<category>.json` holds 37 lists chosen by name. A page offering the
category under whatever node the reader has zoomed `<hypernym-disc>` to cannot
fetch a file per node: 12,224 nodes have a playable word below them, and their
lists come to about 4.9 MB of JSON. So this writes the facts every one of those
lists is computed from, once, and `web/word-source.js` does the computing.

Every filter in `lexicon._resolve` is a fact about one (word, synset) pair or a
sum over the pairs inside a category, which is what makes that possible:

- a word is a candidate where one of its synsets lies inside, which is the
  pair's `member` bit;
- a word with sense-tagged counts passes where the counts inside make up
  `min_dominance` of its total, so each pair carries its count and each word
  its total;
- a word with none passes where one of its first `max_rank + 1` senses lies
  inside, which is the pair's `early` bit, and why `max_rank` is fixed here
  rather than read by the page;
- the Zipf cuts read one number per word.

Pairs are grouped by synset in export order, which is `export_tree.py`'s
preorder, so a subtree's pairs are one contiguous run. The tree keeps only each
synset's first hypernym, so the rest travel as `extra` edges and the page closes
over them. The file is

    {"format": 1, "nodes": 82115, "tree": 612554944, "selection": {...},
     "zipf": [[centi-Zipf, run], ...], "tagged": [...],
     "head": [...], "word": [...], "flag": [...], "count": [...],
     "extra": [child, parent, ...], "text": [...], "categories": {...}}

with words numbered commonest first, ties by spelling, which is the order the
category files hold them in, so an output sorted by id needs no Zipf to sort
by. `zipf` gives the values as runs over that order. `head[i]` is how many
pairs synset `i` holds, and `word`, `flag` and `count` run over the pairs. A
flag of 4 marks the synset whose label in `wordnet-names.txt` spells the word,
which a page holding the disc has already fetched; `text` spells the rest, in
id order. `tree` fingerprints the parent array the table was written against,
which the page checks against the one it holds. `categories` places the 37
named categories on the tree, with any `EXTRA_WORDS` the check must leave out,
for `tools/check_words.mjs`, which holds this file to theirs.

    python tools/export_table.py                 # into out/
    python tools/export_table.py --out DIR --config weft.toml
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from export_tree import _label, layout

from weft.config import ConfigError, resolve
from weft.lexicon import _PLAYABLE, CATEGORIES, EXTRA_WORDS, Synset, _wordnet

FORMAT = 1
MEMBER, EARLY, LABEL = 1, 2, 4


def fingerprint(par: list[int]) -> int:
    """32-bit FNV-1a over the tree's parent indices, each offset by one so the
    root's -1 hashes as zero. `web/word-source.js` computes the same over the
    tree it is handed and refuses a table written against another: the two
    exports are positional, and a mismatch reads as plausible nonsense rather
    than an error."""
    h = 0x811C9DC5
    for parent in par:
        h ^= parent + 1
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _text(name: str) -> str:
    return name.replace("_", " ").lower()


def build(max_rank: int, multiword: bool) -> tuple[dict[str, object], int, int]:
    """The table, for words resolved with these two settings, and how many
    words and pairs it holds. The other selection settings are the page's to
    apply."""
    from wordfreq import zipf_frequency

    wordnet = _wordnet()
    synsets, parents, laid_out = layout()
    index = {name: i for i, name in enumerate(laid_out)}

    # Every word any category could yield. A Zipf of zero is where WordNet's
    # vocabulary ends and its taxonomy begins, and `_resolve` drops it whatever
    # the thresholds, so it is dropped here too.
    zipf: dict[str, float] = {}
    for synset in synsets:
        for lemma in synset.lemmas():
            text = _text(lemma.name())
            if text in zipf or len(text) < 2 or not _PLAYABLE.fullmatch(text):
                continue
            if " " in text and not multiword:
                continue
            z = zipf_frequency(text, "en")
            if z > 0.0:
                zipf[text] = z

    # One row per sense `_in_category` would read: the sense list is
    # `wordnet.synsets`, which also answers through morphy, so a sense need not
    # hold the word itself to count towards its rank.
    tagged: dict[str, int] = {}
    pairs: list[tuple[int, str, int, int]] = []
    for text in zipf:
        senses: list[Synset] = wordnet.synsets(text.replace(" ", "_"), pos=wordnet.NOUN)
        total = 0
        for rank, sense in enumerate(senses):
            own = [lemma for lemma in sense.lemmas() if _text(lemma.name()) == text]
            count = sum(int(lemma.count()) for lemma in own)
            total += count
            bits = (MEMBER if own else 0) | (EARLY if rank <= max_rank else 0)
            pairs.append((index[sense.name()], text, bits, count))
        tagged[text] = total

    # `synsets()` finds a word through the lemma index, which holds every
    # synset the word is a lemma of. Were one missing, no pair would make the
    # word a candidate there and the page would silently drop it.
    held = {(pair[0], pair[1]) for pair in pairs if pair[2] & MEMBER}
    for synset in synsets:
        for lemma in synset.lemmas():
            text = _text(lemma.name())
            if text in zipf and (index[synset.name()], text) not in held:
                raise SystemExit(f"{synset.name()} holds {text!r} but is not among its senses")

    # A pair that can neither make its word a candidate nor move the test on
    # it changes no answer, so it is not shipped.
    kept = [
        pair
        for pair in pairs
        if pair[2] & MEMBER
        or (tagged[pair[1]] and pair[3])
        or (not tagged[pair[1]] and pair[2] & EARLY)
    ]
    kept.sort(key=lambda pair: (pair[0], pair[1]))

    words = sorted(zipf, key=lambda text: (-zipf[text], text))
    number = {text: i for i, text in enumerate(words)}

    head = [0] * len(laid_out)
    flag: list[int] = []
    spelt: set[str] = set()
    for node, text, bits, _ in kept:
        head[node] += 1
        if text not in spelt and _text(_label(laid_out[node])) == text:
            spelt.add(text)
            bits |= LABEL
        flag.append(bits)

    runs: list[list[int]] = []
    for text in words:
        centi = round(zipf[text] * 100)
        if runs and runs[-1][0] == centi:
            runs[-1][1] += 1
        else:
            runs.append([centi, 1])

    extra = [
        (index[name], index[parent]) for name, above in parents.items() for parent in above[1:]
    ]
    extra.sort(key=lambda edge: (edge[1], edge[0]))

    par = [index[parents[name][0]] if parents[name] else -1 for name in laid_out]
    table: dict[str, object] = {
        "format": FORMAT,
        "nodes": len(laid_out),
        "tree": fingerprint(par),
        "zipf": runs,
        "tagged": [tagged[text] for text in words],
        "head": head,
        "word": [number[pair[1]] for pair in kept],
        "flag": flag,
        "count": [pair[3] for pair in kept],
        "extra": [i for edge in extra for i in edge],
        "text": [text for text in words if text not in spelt],
        "categories": {
            name: {
                "at": [index[wordnet.synset(root).name()] for root in roots],
                **({"extra": list(EXTRA_WORDS[name])} if name in EXTRA_WORDS else {}),
            }
            for name, roots in CATEGORIES.items()
        },
    }
    return table, len(words), len(kept)


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").partition("\n")[0])
    parser.add_argument("--out", default="out", type=Path, help="directory to write into")
    parser.add_argument("--config", metavar="FILE", help="TOML file of settings")
    args = parser.parse_args()

    try:
        selection = resolve(args.config).selection
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 1

    table, words, pairs = build(selection.max_rank, selection.multiword)
    table["selection"] = {
        "min_zipf": selection.min_zipf,
        "min_dominance": selection.min_dominance,
        "max_rank": selection.max_rank,
        "min_depth": selection.min_depth,
        "target": selection.target,
        "zipf_floor": selection.zipf_floor,
        "multiword": selection.multiword,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "wordnet-words.json"
    path.write_text(json.dumps(table, separators=(",", ":")))
    print(f"{path}: {words} words, {pairs} pairs, {path.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
