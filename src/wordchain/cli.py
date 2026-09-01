"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields, replace
from pathlib import Path
from typing import Any

from .config import (
    _FLAG,
    _SELECTION_BOUNDS,
    FILENAME,
    Config,
    ConfigError,
    Selection,
    as_members,
    resolve,
)
from .graph import LETTERS, letter_stats, summary
from .lexicon import CATEGORIES, UnknownCategory, Word, catalogue, members
from .palette import DARK, THEMES, with_wheel

# Each `[selection]` setting's metavar and its help. The flag's own name and its
# type come off `Selection` and `config._SELECTION_BOUNDS`, so a setting added
# there reaches the command line by being given a line here rather than an
# argparse block of its own, and `tools/check_schema.py` refuses one with no
# line. See `_selection` for how a flag beats the file.
_SELECTION_HELP: dict[str, tuple[str | None, str]] = {
    "min_zipf": (
        "Z",
        "drop words rarer than this on wordfreq's Zipf scale; overrides "
        "[selection] min_zipf, which is 0.0 unless a file says otherwise, and "
        "keeps every word wordfreq knows at all (2.0 is about one occurrence "
        "per ten million words); words wordfreq scores at zero are dropped "
        "whatever this is set to",
    ),
    "min_dominance": (
        "D",
        "for words WordNet has sense-tagged counts for, the share of uses "
        "that must fall inside the category; overrides [selection] "
        "min_dominance, which is 0.2 unless a file says otherwise",
    ),
    "max_rank": (
        "N",
        "for words with no counts, how far down the sense list the category "
        "may sit; overrides [selection] max_rank, which is 2 unless a file "
        "says otherwise",
    ),
    "min_depth": (
        "N",
        "hops below the category root a word must sit, where 1 drops the "
        "category's own name; overrides [selection] min_depth, which is 1 "
        "unless a file says otherwise",
    ),
    "target": (
        "N",
        "relax --min-zipf until the category yields this many words; "
        "overrides [selection] target, which is 60 unless a file says "
        "otherwise, and is inert at the default --min-zipf, since there is "
        "nothing below zero to relax to",
    ),
    "zipf_floor": (
        "Z",
        "never relax past this, however few words a category has; "
        "overrides [selection] zipf_floor, which is 0.0 unless a file says "
        "otherwise, meaning any word wordfreq knows at all",
    ),
    "multiword": (
        None,
        "keep entries like 'polar bear', chained on their outer letters; "
        "overrides [selection] multiword, which is off unless a file says "
        "otherwise, and --no-multiword turns a file's own back off",
    ),
    "limit": (
        "N",
        "words in the disc, or 0 for every word the category has; "
        "overrides [selection] limit, which is 110 unless a file says otherwise",
    ),
}

# The one setting only `build` offers, since it is the only command that draws.
_DRAWN = frozenset({"limit"})


def _selection_args(
    parser: argparse.ArgumentParser, category: bool = True, draws: bool = False
) -> None:
    """The category, every `[selection]` flag the command offers, and the two
    switches every command takes.

    Driven off `Selection` rather than written out, so the flags cannot be a
    setting short of the table a file can move.
    """
    if category:
        parser.add_argument("category", help="category name; see the `categories` command")

    for field in fields(Selection):
        if field.name in _DRAWN and not draws:
            continue
        metavar, help_text = _SELECTION_HELP[field.name]
        flag = "--" + field.name.replace("_", "-")
        # Every flag defaults to None; see `_selection`. `--multiword` is a
        # BooleanOptionalAction so `--no-multiword` can turn a file's own off.
        if field.name == _FLAG:
            parser.add_argument(flag, action=argparse.BooleanOptionalAction, help=help_text)
            continue
        kind, _, _ = _SELECTION_BOUNDS[field.name]
        parser.add_argument(
            flag,
            type=float if kind == "number" else int,
            metavar=metavar,
            help=help_text,
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


def _selection(args: argparse.Namespace) -> Selection:
    """What a command should select with: the flag, then the file, then the
    built-in default.

    Every selection flag defaults to None rather than to its value, so a
    `--target 60` typed out and no `--target` at all reach a file that sets it
    differently as different things; an absent flag is the only one the file
    fills in.
    """
    config: Config = args.settings
    given: dict[str, Any] = {}
    for field in fields(Selection):
        value = getattr(args, field.name, None)
        if value is not None:
            given[field.name] = value
    return replace(config.selection, **given)


def _load(args: argparse.Namespace, category: str | None = None) -> list[Word]:
    """One category's words. `categories` names its own; the rest take the
    positional argument."""
    name = args.category if category is None else category
    try:
        return members(name, **as_members(_selection(args)), cache=not args.no_cache)
    except UnknownCategory:
        sys.exit(f"no such category: {name}\ntry one of: {', '.join(catalogue())}")


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
    # The filter arguments are the ones the other commands take, so the counts
    # match what they would build.
    rows = [(name, len(_load(args, name)), ", ".join(CATEGORIES[name])) for name in catalogue()]
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
    # Only `build` draws, so the other commands never pay matplotlib's import.
    from . import render

    config: Config = args.settings

    # A [palette] table replaces the wheel the theme brought; without one the
    # theme's own stands. The flag wins over the file, dark with neither.
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
        limit=_selection(args).limit,
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
    _selection_args(build, draws=True)
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
    build.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    # Read once here rather than in each command: `categories` loads all 37
    # word lists, and a file parsed per category would be parsed 37 times.
    try:
        args.settings = resolve(args.config)
    except ConfigError as err:
        sys.exit(str(err))
    args.func(args)
