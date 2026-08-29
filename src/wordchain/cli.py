"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TypeVar

from .config import FILENAME, ConfigError, resolve
from .graph import LETTERS, letter_stats, summary
from .lexicon import CATEGORIES, UnknownCategory, Word, catalogue, members
from .palette import DARK, THEMES, with_wheel

T = TypeVar("T")


def _selection_args(parser: argparse.ArgumentParser, category: bool = True) -> None:
    if category:
        parser.add_argument("category", help="category name; see the `categories` command")
    parser.add_argument(
        "--min-zipf",
        type=float,
        metavar="Z",
        help="drop words rarer than this on wordfreq's Zipf scale; overrides "
        "[selection] min_zipf, which is 0.0 unless a file says otherwise, and "
        "keeps every word wordfreq knows at all (2.0 is about one occurrence "
        "per ten million words); words wordfreq scores at zero are dropped "
        "whatever this is set to",
    )
    parser.add_argument(
        "--min-dominance",
        type=float,
        metavar="D",
        help="for words WordNet has sense-tagged counts for, the share of uses "
        "that must fall inside the category; overrides [selection] "
        "min_dominance, which is 0.2 unless a file says otherwise",
    )
    parser.add_argument(
        "--max-rank",
        type=int,
        metavar="N",
        help="for words with no counts, how far down the sense list the category "
        "may sit; overrides [selection] max_rank, which is 2 unless a file "
        "says otherwise",
    )
    parser.add_argument(
        "--min-depth",
        type=int,
        metavar="N",
        help="hops below the category root a word must sit, where 1 drops the "
        "category's own name; overrides [selection] min_depth, which is 1 "
        "unless a file says otherwise",
    )
    parser.add_argument(
        "--target",
        type=int,
        metavar="N",
        help="relax --min-zipf until the category yields this many words; "
        "overrides [selection] target, which is 60 unless a file says "
        "otherwise, and is inert at the default --min-zipf, since there is "
        "nothing below zero to relax to",
    )
    parser.add_argument(
        "--zipf-floor",
        type=float,
        metavar="Z",
        help="never relax past this, however few words a category has; "
        "overrides [selection] zipf_floor, which is 0.0 unless a file says "
        "otherwise, meaning any word wordfreq knows at all",
    )
    parser.add_argument(
        "--multiword",
        action=argparse.BooleanOptionalAction,
        help="keep entries like 'polar bear', chained on their outer letters; "
        "overrides [selection] multiword, which is off unless a file says "
        "otherwise, and --no-multiword turns a file's own back off",
    )
    parser.add_argument(
        "--config",
        metavar="FILE",
        help=f"TOML file of settings; without it, ./{FILENAME} is used when it "
        "exists and the built-in defaults otherwise",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="resolve the words from WordNet even if a cached list exists",
    )


def _chosen(flag: T | None, fallback: T) -> T:
    """The flag if it was given, the file's setting otherwise.

    Every selection flag defaults to None rather than to its value, since a
    `--target 60` typed out and no `--target` at all have to reach a file that
    sets it differently as different things.
    """
    return fallback if flag is None else flag


def _load_named(args: argparse.Namespace, category: str) -> list[Word]:
    args.category = category
    return _load(args)


def _load(args: argparse.Namespace) -> list[Word]:
    chosen = args.settings.selection
    try:
        return members(
            args.category,
            min_zipf=_chosen(args.min_zipf, chosen.min_zipf),
            min_dominance=_chosen(args.min_dominance, chosen.min_dominance),
            max_rank=_chosen(args.max_rank, chosen.max_rank),
            min_depth=_chosen(args.min_depth, chosen.min_depth),
            allow_multiword=_chosen(args.multiword, chosen.multiword),
            target=_chosen(args.target, chosen.target),
            zipf_floor=_chosen(args.zipf_floor, chosen.zipf_floor),
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

    config = args.settings

    # A [palette] table replaces the wheel the theme brought; without one the
    # theme's own stands, so a file that only sets geometry changes no colour.
    # The flag wins over the file, and the dark ground stands with neither.
    theme = THEMES[args.theme or config.theme or DARK.name]
    if config.wheel is not None:
        theme = with_wheel(theme, config.wheel)

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
        limit=_chosen(args.limit, config.selection.limit),
        theme=theme,
        chrome=args.chrome,
        geometry=config.geometry,
    )


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
        help="ground for the figure; overrides the config file's theme, which "
        "is dark unless a file says otherwise",
    )
    build.add_argument(
        "--limit",
        type=int,
        metavar="N",
        help="words in the disc; overrides [selection] limit, which is 110 "
        "unless a file says otherwise",
    )
    build.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    # Read once here rather than in each command: `categories` loads all 37
    # word lists, and a file parsed per category would be parsed 37 times.
    try:
        args.settings = resolve(args.config)
    except ConfigError as err:
        sys.exit(str(err))
    args.func(args)
