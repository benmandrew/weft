"""Check `graph.py`'s longest_chain against the fixed answers in chains.json.

The solver is written twice, once here and once in `web/word-longest.js`, so the
report and the browser agree on how far a category runs. A repeated algorithm
drifts, and this one drifts quietly: both halves keep returning a legal chain,
one of them just stops finding the longest. `tools/chains.json` is what pins
them together — every case there names the chain word for word, so a tie broken
the other way fails rather than passing with a shorter answer.

This is the Python half. `tools/check_web.mjs` runs the same cases through the
JavaScript. Both name every disagreement rather than stopping at the first.

Run it with `make check`, or `python tools/check_chain.py`.
"""

from __future__ import annotations

import json
import sys
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


def main() -> int:
    cases: list[dict[str, Any]] = json.loads(CASES.read_text())["cases"]
    problems: list[str] = []
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
    print(f"graph.py matches {CASES.name}: {len(cases)} cases, {total} words chained")
    return 0


if __name__ == "__main__":
    sys.exit(main())
