"""Check `graph.py`'s longest_chain against the fixed answers in chains.json.

The solver is written twice, once here and once in `web/word-longest.js`, so the
report and the browser agree on how far a category runs. A repeated algorithm
drifts, and this one drifts quietly: both halves keep returning a legal chain,
one of them just stops finding the longest. `tools/chains.json` is what pins
them together — every case there names the chain word for word, so a tie broken
the other way fails rather than passing with a shorter answer.

A frozen case holds whatever the solver answered when it was frozen, so it
cannot tell a short chain from the longest. The `oracle` in chains.json can: it
draws lists small enough to try every chain and holds the solver to the longest,
free and under an opening word. Both halves draw the same lists from one seed.

This is the Python half. `tools/check_web.mjs` runs the same cases through the
JavaScript. Both name every disagreement rather than stopping at the first.

Run it with `make check`, or `python tools/check_chain.py`.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from weft.graph import longest_chain
from weft.lexicon import Word

CASES = Path(__file__).with_name("chains.json")


def _legal(chain: list[str], words: list[str], opening: str | None) -> str | None:
    """Whatever stops `chain` being playable from `words`, or None."""
    pool = set(words)
    played: set[str] = set()
    if opening is not None and chain[:1] != [opening]:
        return f"it was to open on {opening!r} and opens on {chain[:1]}"
    for i, word in enumerate(chain):
        if word not in pool:
            return f"{word!r} is not in the list"
        if word in played:
            return f"{word!r} is played twice"
        if i and chain[i - 1][-1] != word[0]:
            return f"{chain[i - 1]!r} does not hand over to {word!r}"
        played.add(word)
    return None


class _Draw:
    """The generator check_web.mjs draws with, so both halves face the same
    lists: a 31-bit linear congruential step, reduced modulo `n`."""

    def __init__(self, seed: int) -> None:
        self.state = seed

    def __call__(self, n: int) -> int:
        self.state = (self.state * 1103515245 + 12345) & 0x7FFFFFFF
        return self.state % n


def _drawn(oracle: dict[str, int]) -> Iterator[tuple[list[str], str]]:
    """Each list the oracle names, with the word it opens on. A word is its two
    letters with its index between them, so no two words share a spelling."""
    draw = _Draw(oracle["seed"])
    for _ in range(oracle["lists"]):
        alphabet = "abcdefgh"[: 2 + draw(oracle["letters"] - 1)]
        count = 1 + draw(oracle["words"])
        words = []
        for i in range(count):
            # One word in `loops` is a loop, far more than chance would draw,
            # since a loop is what the flow can strand.
            head = alphabet[draw(len(alphabet))]
            tail = head if draw(oracle["loops"]) == 0 else alphabet[draw(len(alphabet))]
            words.append(head + str(i) + tail)
        yield words, words[draw(count)]


def _longest(words: list[str], opening: str | None) -> int:
    """The longest chain by trying every one, which only a list this small allows."""
    leaving: defaultdict[str, list[int]] = defaultdict(list)
    for i, word in enumerate(words):
        leaving[word[0]].append(i)
    played = [False] * len(words)

    def on(i: int) -> int:
        played[i] = True
        best = 1 + max((on(j) for j in leaving[words[i][-1]] if not played[j]), default=0)
        played[i] = False
        return best

    firsts = range(len(words)) if opening is None else [words.index(opening)]
    return max((on(i) for i in firsts), default=0)


def _oracle(oracle: dict[str, int]) -> tuple[list[str], int]:
    """Every drawn list the solver chains short of the longest, and how many
    chains were checked."""
    problems: list[str] = []
    checked = 0
    for words, opener in _drawn(oracle):
        for opening in (None, opener):
            found = longest_chain([Word(text, 0.0) for text in words], opening)
            best = _longest(words, opening)
            checked += 1
            label = f"{words}" + ("" if opening is None else f" opening on {opening!r}")
            broken = _legal(found.words, words, opening)
            if broken is not None:
                problems.append(f"oracle: {label} chained something unplayable — {broken}")
            elif found.length != best:
                problems.append(f"oracle: {label} chained {found.length} where {best} exist")
            elif found.bound < best:
                problems.append(f"oracle: {label} bound {found.bound} under a chain of {best}")
    return problems, checked


def main() -> int:
    fixture = json.loads(CASES.read_text())
    cases: list[dict[str, Any]] = fixture["cases"]
    problems, checked = _oracle(fixture["oracle"])
    # A case constrained to an opening word names the list it shares rather than
    # carrying a second copy of it.
    lists = {case["name"]: case["words"] for case in cases if "words" in case}
    for case in cases:
        name = case["name"]
        words: list[str] = case["words"] if "words" in case else lists[case["like"]]
        opening: str | None = case.get("opening")
        found = longest_chain([Word(text, 0.0) for text in words], opening)
        broken = _legal(found.words, words, opening)
        if broken is not None:
            problems.append(f"{name}: the chain is not playable — {broken}")
        if found.words != case["chain"]:
            wanted: list[str] = case["chain"]
            parted = next(
                (i for i, word in enumerate(found.words) if wanted[i : i + 1] != [word]),
                len(found.words),
            )
            if parted < len(wanted):
                problems.append(
                    f"{name}: chain of {len(found.words)} where chains.json holds "
                    f"{len(wanted)}, and parts from it at {parted}: "
                    f"{found.words[parted]!r} for {wanted[parted]!r}"
                )
            else:
                problems.append(
                    f"{name}: chain of {len(found.words)} where chains.json holds {len(wanted)}"
                )
        if found.bound != case["bound"]:
            problems.append(f"{name}: bound {found.bound}, where chains.json holds {case['bound']}")
        if found.certified != case["certified"]:
            problems.append(
                f"{name}: certified {found.certified}, where chains.json holds {case['certified']}"
            )
    if problems:
        print(f"graph.py has drifted from {CASES.name}:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    total = sum(len(case["chain"]) for case in cases)
    print(
        f"graph.py matches {CASES.name}: {len(cases)} cases, {total} words chained,"
        f" and the longest of {checked} drawn chains"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
