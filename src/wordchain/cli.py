"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import render, web
from .graph import LETTERS, letter_stats, summary
from .lexicon import CATEGORIES, UnknownCategory, catalogue, members
from .palette import THEMES


def _selection_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("category", help="category name; see the `categories` command")
    parser.add_argument(
        "--min-zipf",
        type=float,
        default=3.0,
        metavar="Z",
        help="drop words rarer than this on wordfreq's Zipf scale (default 3.0, "
        "about one occurrence per million words)",
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
        "--multiword",
        action="store_true",
        help="keep entries like 'polar bear', chained on their outer letters",
    )


def _load(args: argparse.Namespace):
    try:
        return members(
            args.category,
            min_zipf=args.min_zipf,
            min_dominance=args.min_dominance,
            max_rank=args.max_rank,
            min_depth=args.min_depth,
            allow_multiword=args.multiword,
        )
    except UnknownCategory:
        sys.exit(f"no such category: {args.category}\ntry one of: {', '.join(catalogue())}")


def _report(category: str, words) -> str:
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
    for name in catalogue():
        roots = ", ".join(CATEGORIES[name])
        print(f"  {name:<12} {roots}")


def _cmd_stats(args: argparse.Namespace) -> None:
    print(_report(args.category, _load(args)))


def _cmd_words(args: argparse.Namespace) -> None:
    for word in _load(args):
        print(f"{word.zipf:.2f}  {word.text}")


def _cmd_build(args: argparse.Namespace) -> None:
    words = _load(args)
    if not words:
        sys.exit(f"{args.category} came back empty; try a lower --min-zipf")

    out = Path(args.out) / args.category
    out.mkdir(parents=True, exist_ok=True)
    name = args.category.replace("-", " ")
    theme = THEMES[args.theme]

    render.chord(words, out / "letters.png", f"{name} — the game on 26 letters", theme=theme)
    render.matrix(words, out / "matrix.png", f"{name} — first and last letter counts", theme=theme)
    render.pressure(words, out / "pressure.png", f"{name} — where the letters run dry", theme=theme)
    render.words_disc(
        words, out / "words.png", f"{name} — the word graph", limit=args.limit, theme=theme
    )
    web.letters_page(words, out / "letters.html", f"{name} — the game on 26 letters", theme=theme)
    web.words_page(
        words, out / "words.html", f"{name} — the word graph", limit=args.web_limit, theme=theme
    )

    report = _report(args.category, words)
    (out / "report.txt").write_text(report + "\n")
    (out / "words.csv").write_text(
        "word,zipf,first,last\n"
        + "".join(f"{w.text},{w.zipf:.2f},{w.head},{w.tail}\n" for w in words)
    )

    print(report)
    print(f"\nwritten to {out}/")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="wordchain",
        description="Connection graphs for the word chain game, where each word "
        "must start with the letter the last one ended on.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("categories", help="list the categories and their WordNet roots").set_defaults(
        func=_cmd_categories
    )

    stats = sub.add_parser("stats", help="print the letter analysis")
    _selection_args(stats)
    stats.set_defaults(func=_cmd_stats)

    listing = sub.add_parser("words", help="print the word list")
    _selection_args(listing)
    listing.set_defaults(func=_cmd_words)

    build = sub.add_parser("build", help="write every figure, page and table")
    _selection_args(build)
    build.add_argument("--out", default="out", metavar="DIR", help="output root (default out)")
    build.add_argument(
        "--theme",
        choices=sorted(THEMES),
        default="light",
        help="palette for every figure and page (default light)",
    )
    build.add_argument(
        "--limit", type=int, default=110, metavar="N", help="words in the static disc (default 110)"
    )
    build.add_argument(
        "--web-limit",
        type=int,
        default=260,
        metavar="N",
        help="words in the interactive page (default 260)",
    )
    build.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    args.func(args)
