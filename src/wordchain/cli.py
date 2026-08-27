"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import FILENAME, ConfigError, resolve
from .graph import LETTERS, letter_stats, summary
from .lexicon import CATEGORIES, UnknownCategory, Word, catalogue, members
from .palette import THEMES


def _selection_args(parser: argparse.ArgumentParser, category: bool = True) -> None:
    if category:
        parser.add_argument("category", help="category name; see the `categories` command")
    parser.add_argument(
        "--min-zipf",
        type=float,
        default=2.0,
        metavar="Z",
        help="drop words rarer than this on wordfreq's Zipf scale (default 2.0, "
        "about one occurrence per ten million words); words wordfreq scores at "
        "zero are dropped whatever this is set to",
    )
    parser.add_argument(
        "--min-dominance",
        type=float,
        default=0.2,
        metavar="D",
        help="for words WordNet has sense-tagged counts for, the share of uses "
        "that must fall inside the category (default 0.2)",
    )
    parser.add_argument(
        "--max-rank",
        type=int,
        default=2,
        metavar="N",
        help="for words with no counts, how far down the sense list the category "
        "may sit (default 2)",
    )
    parser.add_argument(
        "--min-depth",
        type=int,
        default=1,
        metavar="N",
        help="hops below the category root a word must sit; 1 drops the category's "
        "own name (default 1)",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=60,
        metavar="N",
        help="relax --min-zipf until the category yields this many words "
        "(default 60); categories with more common words than this ignore it",
    )
    parser.add_argument(
        "--zipf-floor",
        type=float,
        default=0.0,
        metavar="Z",
        help="never relax past this, however few words a category has "
        "(default 0.0, meaning any word wordfreq knows at all)",
    )
    parser.add_argument(
        "--multiword",
        action="store_true",
        help="keep entries like 'polar bear', chained on their outer letters",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="resolve the words from WordNet even if a cached list exists",
    )


def _load_named(args: argparse.Namespace, category: str) -> list[Word]:
    args.category = category
    return _load(args)


def _load(args: argparse.Namespace) -> list[Word]:
    try:
        return members(
            args.category,
            min_zipf=args.min_zipf,
            min_dominance=args.min_dominance,
            max_rank=args.max_rank,
            min_depth=args.min_depth,
            allow_multiword=args.multiword,
            target=args.target,
            zipf_floor=args.zipf_floor,
            cache=not args.no_cache,
        )
    except UnknownCategory:
        sys.exit(f"no such category: {args.category}\ntry one of: {', '.join(catalogue())}")


def _report(category: str, words: list[Word]) -> str:
    facts = summary(words)
    stats = {s.letter: s for s in letter_stats(words)}
    lines = [
        f"{category} — {facts['words']} words, {facts['edges']} playable moves between them",
        f"letter pairs in use: {facts['letter_pairs']} of a possible 676",
        "",
        "  letters in play   " + " ".join(letter.upper() for letter in facts["live_letters"]),
        "  endless core      " + " ".join(letter.upper() for letter in facts["core"]),
    ]
    if facts["openers_only"]:
        lines.append(
            "  openers only      "
            + " ".join(letter.upper() for letter in facts["openers_only"])
            + "   (no word ends here, so play never arrives)"
        )
    if facts["dead_ends"]:
        lines.append(
            "  dead ends         "
            + " ".join(letter.upper() for letter in facts["dead_ends"])
            + "   (no word starts here, so play never leaves)"
        )

    lines += ["", "  worst traps"]
    for letter, demand, supply, pressure in facts["traps"]:
        verdict = "no reply exists" if supply == 0 else f"{pressure:.1f} landings per reply"
        examples = ", ".join(w.text for w in words if w.tail == letter)[:52]
        lines.append(
            f"    {letter.upper()}  {demand:3d} end  {supply:3d} start   {verdict:<24} {examples}"
        )

    unused = [
        letter.upper()
        for letter in LETTERS
        if stats[letter].supply == 0 and stats[letter].demand == 0
    ]
    if unused:
        lines += ["", "  never touched     " + " ".join(unused)]
    return "\n".join(lines)


def _cmd_categories(args: argparse.Namespace) -> None:
    # Counting means resolving every category, so this pays the WordNet load
    # once and 57 ms per category after it. The filter arguments are the same
    # ones the other commands take, so the counts match what they would build.
    rows = [
        (name, len(_load_named(args, name)), ", ".join(CATEGORIES[name])) for name in catalogue()
    ]
    name_width = max(len(row[0]) for row in rows)
    count_width = max(len("words"), max(len(str(row[1])) for row in rows))

    if args.headers:
        print(f"{'category':<{name_width}}  {'words':>{count_width}}  wordnet roots")
        print(f"{'-' * name_width}  {'-' * count_width}  {'-' * 13}")
    for name, count, roots in rows:
        print(f"{name:<{name_width}}  {count:>{count_width}}  {roots}")


def _cmd_stats(args: argparse.Namespace) -> None:
    print(_report(args.category, _load(args)))


def _cmd_words(args: argparse.Namespace) -> None:
    for word in _load(args):
        print(f"{word.zipf:.2f}  {word.text}")


def _cmd_build(args: argparse.Namespace) -> None:
    # matplotlib costs about 290 ms to import and only `build` draws anything,
    # so `stats`, `words` and `categories` should never pay for it.
    from . import render

    try:
        geometry = resolve(args.config)
    except ConfigError as err:
        sys.exit(str(err))

    words = _load(args)
    if not words:
        sys.exit(f"{args.category} came back empty; try a lower --min-zipf")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = args.category.replace("-", " ")

    target = out / f"{args.category}.{args.format}"
    render.words_disc(
        words,
        target,
        f"{name} — the word graph",
        limit=args.limit,
        theme=THEMES[args.theme],
        chrome=args.chrome,
        geometry=geometry,
    )
    print(target)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="wordchain",
        description="Connection graphs for the word chain game, where each word "
        "must start with the letter the last one ended on.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    categories = sub.add_parser("categories", help="list the categories, with word counts")
    _selection_args(categories, category=False)
    categories.add_argument(
        "--headers", action="store_true", help="print a header row above the table"
    )
    categories.set_defaults(func=_cmd_categories)

    stats = sub.add_parser("stats", help="print the letter analysis")
    _selection_args(stats)
    stats.set_defaults(func=_cmd_stats)

    listing = sub.add_parser("words", help="print the word list")
    _selection_args(listing)
    listing.set_defaults(func=_cmd_words)

    build = sub.add_parser("build", help="render the word graph")
    _selection_args(build)
    build.add_argument("--out", default="out", metavar="DIR", help="output directory (default out)")
    build.add_argument(
        "--format",
        choices=("svg", "png"),
        default="svg",
        help="vector or raster (default svg, which is faster to write, smaller "
        "over the wire, and zoomable)",
    )
    build.add_argument(
        "--chrome",
        action="store_true",
        help="add the title, caption and headline figures to the image",
    )
    build.add_argument(
        "--theme",
        choices=sorted(THEMES),
        default="dark",
        help="palette for the figure (default dark)",
    )
    build.add_argument(
        "--limit", type=int, default=110, metavar="N", help="words in the disc (default 110)"
    )
    build.add_argument(
        "--config",
        metavar="FILE",
        help=f"TOML file of disc geometry; without it, ./{FILENAME} is used when "
        "it exists and the built-in defaults otherwise",
    )
    build.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    args.func(args)
