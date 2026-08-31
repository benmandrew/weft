"""Write each category's playable words as the JSON `<word-disc>` reads.

One file per category, `words-<category>.json`, holding

    {"category": "animal", "words": ["dog", …], "zipf": [5.27, …]}

in the order `render.py` draws: commonest first, ties by spelling. The element
cuts that list at its own `limit`, so one file serves every count the disc can
be asked for and a host changing the attribute refetches nothing.

Names are flat rather than nested in a directory because `make web-dist` stages
everything a page needs side by side, and the modules find each other by
relative path there.

A thirty-eighth file, `words-index.json`, lists the categories with their word
counts and their WordNet roots, which is what lets a page offer a picker
without fetching all 37.

The selection arguments are the command line's own, read through the same
`[selection]` table, so what the element draws is what `build` would draw and
what `categories` would count.

    python tools/export_words.py                    # every category, into out/
    python tools/export_words.py --out DIR animal bird
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from wordchain.config import ConfigError, resolve
from wordchain.lexicon import CATEGORIES, Word, catalogue, members


def _ranked(words: list[Word]) -> list[Word]:
    """Commonest first, ties by spelling, which is `words_disc`'s own sort."""
    return sorted(words, key=lambda w: (-w.zipf, w.text))


def _write(path: Path, payload: object) -> int:
    path.write_text(json.dumps(payload, separators=(",", ":")))
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").partition("\n")[0])
    parser.add_argument(
        "category",
        nargs="*",
        help="categories to write; every one of them without any",
    )
    parser.add_argument("--out", default="out", type=Path, help="directory to write into")
    parser.add_argument("--config", metavar="FILE", help="TOML file of settings")
    parser.add_argument(
        "--no-cache", action="store_true", help="resolve from WordNet even if a list is cached"
    )
    args = parser.parse_args()

    try:
        settings = resolve(args.config)
    except ConfigError as err:
        print(err, file=sys.stderr)
        return 1

    wanted = args.category or catalogue()
    unknown = [name for name in wanted if name not in CATEGORIES]
    if unknown:
        print(f"no such category: {', '.join(unknown)}", file=sys.stderr)
        print(f"try one of: {', '.join(catalogue())}", file=sys.stderr)
        return 1

    chosen = settings.selection
    args.out.mkdir(parents=True, exist_ok=True)
    index: list[dict[str, object]] = []
    total = counted = 0
    for name in wanted:
        words = _ranked(
            members(
                name,
                min_zipf=chosen.min_zipf,
                min_dominance=chosen.min_dominance,
                max_rank=chosen.max_rank,
                min_depth=chosen.min_depth,
                allow_multiword=chosen.multiword,
                target=chosen.target,
                zipf_floor=chosen.zipf_floor,
                cache=not args.no_cache,
            )
        )
        total += _write(
            args.out / f"words-{name}.json",
            {
                "category": name,
                "words": [word.text for word in words],
                # Two decimals: the Zipf scale runs 0 to 8 and the list is only
                # ever sorted by it, so the third would be bytes nothing reads.
                "zipf": [round(word.zipf, 2) for word in words],
            },
        )
        index.append({"name": name, "words": len(words), "roots": list(CATEGORIES[name])})
        counted += len(words)

    total += _write(args.out / "words-index.json", index)
    print(
        f"{args.out}/words-*.json: {len(index)} categories, {counted} words, {total / 1024:.0f} KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
