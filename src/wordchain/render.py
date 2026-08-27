"""Matplotlib figures for the letter graph and the word graph."""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path as FilePath

import matplotlib

# Selecting the backend has to happen before pyplot is imported, so this block
# stays split and stays in this order.
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from matplotlib.patches import PathPatch
from matplotlib.path import Path

from . import palette
from .graph import LETTERS, letter_matrix, letter_stats, summary
from .lexicon import Word
from .palette import LIGHT, Theme

# Curves leave each node heading for the centre, so a chord's shape reads as the
# pair of letters it joins rather than as a straight line crossing the disc.
_PULL = 0.32

# Bezier control points sit this fraction of the way in for the word graph. It
# is tighter than _PULL because 4856 curves through a wide middle read as fog.
_PULL_DENSE = 0.20


def _typeface() -> None:
    """Register the three families once, so `family=` picks up a fallback list."""
    plt.rcParams["font.serif"] = palette.DISPLAY
    plt.rcParams["font.sans-serif"] = palette.BODY
    plt.rcParams["font.monospace"] = palette.DATA
    plt.rcParams["font.family"] = "sans-serif"


def _hue(letter: str, theme: Theme) -> tuple:
    return palette.rgb(letter, theme)


def _ring(count: int, radius: float = 1.0) -> list[tuple[float, float]]:
    """Positions clockwise from the top, which is how a reader scans a dial."""
    return [
        (
            radius * math.cos(math.pi / 2 - 2 * math.pi * i / count),
            radius * math.sin(math.pi / 2 - 2 * math.pi * i / count),
        )
        for i in range(count)
    ]


def _by_tail(word: Word):
    """Sort key placing words that hand over to the same letter side by side.

    Ordinary alphabetical order sorts a wedge on its second letter onwards,
    which is arbitrary here: every word in the wedge already shares a first
    letter, and the letter that matters is the one it ends on. Reversing the
    word sorts on the last letter first, so all the words leading to T sit
    together and their curves leave the wedge as one bundle instead of crossing
    each other on the way out.
    """
    return word.text[::-1]


def _bezier(start, end, pull: float, steps: int = 24) -> np.ndarray:
    """A cubic curve from start to end, bowed towards the centre."""
    c0 = (start[0] * pull, start[1] * pull)
    c1 = (end[0] * pull, end[1] * pull)
    t = np.linspace(0, 1, steps).reshape(-1, 1)
    p0, p3 = np.array(start), np.array(end)
    return (
        (1 - t) ** 3 * p0
        + 3 * (1 - t) ** 2 * t * np.array(c0)
        + 3 * (1 - t) * t**2 * np.array(c1)
        + t**3 * p3
    )


def _chord(ax, start, end, colour, width, alpha, pull: float = _PULL):
    if start == end:
        # A self-loop has no chord to draw, so it becomes a bubble sitting just
        # outside its own node.
        norm = math.hypot(*start) or 1.0
        centre = (start[0] / norm * 1.075, start[1] / norm * 1.075)
        ax.add_patch(
            plt.Circle(centre, 0.035, fill=False, ec=colour, lw=width, alpha=alpha, zorder=2)
        )
        return
    path = Path(
        [start, (start[0] * pull, start[1] * pull), (end[0] * pull, end[1] * pull), end],
        [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4],
    )
    ax.add_patch(PathPatch(path, fc="none", ec=colour, lw=width, alpha=alpha, zorder=2))


def _blank_disc(theme: Theme, size: float = 8.4):
    _typeface()
    fig, ax = plt.subplots(figsize=(size, size), facecolor=theme.ground)
    ax.set_facecolor(theme.ground)
    ax.set_aspect("equal")
    ax.set_xlim(-1.34, 1.34)
    ax.set_ylim(-1.34, 1.34)
    ax.axis("off")
    return fig, ax


def _headline(ax, words: list[Word], theme: Theme) -> None:
    """The masthead figures, set into the disc's empty bottom-left corner."""
    facts = summary(words)
    worst = next(((letter, p) for letter, _, s, p in facts["traps"] if s), None)
    rows = [
        (f"{facts['words']}", "words"),
        (f"{facts['edges']:,}", "legal moves"),
        (f"{facts['letter_pairs']}/676", "letter pairs used"),
    ]
    if facts["dead_ends"]:
        rows.append(("  ".join(x.upper() for x in facts["dead_ends"]), "dead ends"))
    if worst:
        rows.append((f"{worst[1]:.1f}", f"worst pressure ({worst[0].upper()})"))

    y = -0.86
    for value, label in rows:
        dead = label == "dead ends"
        ax.text(
            -1.32,
            y,
            value,
            fontsize=15,
            family="monospace",
            color=theme.dead if dead else theme.ink,
            va="baseline",
        )
        ax.text(-1.32, y - 0.055, label.upper(), fontsize=6.4, color=theme.muted, va="baseline")
        y -= 0.145


def chord(words: list[Word], out: FilePath, title: str, theme: Theme = LIGHT) -> None:
    """The whole game on 26 nodes: one ribbon per letter pair, weighted by words."""
    counts = letter_matrix(words)
    points = _ring(26)
    peak = counts.max() or 1

    fig, ax = _blank_disc(theme)
    for i, head in enumerate(LETTERS):
        for j, tail in enumerate(LETTERS):
            weight = counts[i, j]
            if not weight:
                continue
            share = math.sqrt(weight / peak)
            _chord(
                ax, points[i], points[j], _hue(head, theme), 0.4 + 4.0 * share, 0.20 + 0.45 * share
            )

    stats = {s.letter: s for s in letter_stats(words)}
    for i, letter in enumerate(LETTERS):
        x, y = points[i]
        stat = stats[letter]
        touched = stat.supply + stat.demand
        ax.scatter(
            [x],
            [y],
            s=18 + 3.2 * touched,
            color=_hue(letter, theme),
            zorder=3,
            ec=theme.ground,
            lw=1.2,
        )
        ax.text(
            x * 1.19,
            y * 1.19,
            letter.upper(),
            ha="center",
            va="center",
            fontsize=15,
            family="monospace",
            color=theme.dead if stat.is_dead_end else theme.ink,
            fontweight="bold" if stat.is_dead_end else "normal",
        )

    ax.set_title(title, fontsize=19, family="serif", color=theme.ink, pad=18)
    ax.text(
        0,
        -1.30,
        "ribbon width = words carrying that first/last pair · red = nothing starts here",
        ha="center",
        fontsize=8.5,
        color=theme.muted,
    )
    fig.savefig(out, dpi=180, facecolor=theme.ground, bbox_inches="tight")
    plt.close(fig)


def matrix(words: list[Word], out: FilePath, title: str, theme: Theme = LIGHT) -> None:
    """The same counts as a grid, where exact numbers are readable."""
    _typeface()
    counts = letter_matrix(words)
    fig, ax = plt.subplots(figsize=(9.2, 8.4), facecolor=theme.ground)
    ax.set_facecolor(theme.ground)
    ax.imshow(
        np.log1p(counts), cmap="magma_r" if theme.name == "light" else "magma", aspect="equal"
    )

    ax.set_xticks(range(26), [c.upper() for c in LETTERS], fontsize=9, family="monospace")
    ax.set_yticks(range(26), [c.upper() for c in LETTERS], fontsize=9, family="monospace")
    ax.set_xlabel(
        "last letter — where the word hands over", fontsize=11, color=theme.ink, labelpad=10
    )
    ax.set_ylabel(
        "first letter — where the word picks up", fontsize=11, color=theme.ink, labelpad=10
    )
    ax.set_title(title, fontsize=19, family="serif", color=theme.ink, pad=18)

    peak = counts.max() or 1
    for i in range(26):
        for j in range(26):
            if counts[i, j]:
                ax.text(
                    j,
                    i,
                    counts[i, j],
                    ha="center",
                    va="center",
                    fontsize=6.5,
                    family="monospace",
                    color=theme.ground if counts[i, j] > peak * 0.45 else theme.ink,
                )
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(length=0, colors=theme.ink)
    fig.savefig(out, dpi=180, facecolor=theme.ground, bbox_inches="tight")
    plt.close(fig)


def pressure(words: list[Word], out: FilePath, title: str, theme: Theme = LIGHT) -> None:
    """Supply against demand per letter, which is where the traps show up."""
    _typeface()
    stats = letter_stats(words)
    positions = np.arange(26)
    fig, ax = plt.subplots(figsize=(11.5, 5.4), facecolor=theme.ground)
    ax.set_facecolor(theme.ground)

    ax.bar(
        positions - 0.2,
        [s.supply for s in stats],
        width=0.4,
        color=theme.live,
        label="words starting with it (your replies)",
    )
    ax.bar(
        positions + 0.2,
        [s.demand for s in stats],
        width=0.4,
        color=theme.dead,
        label="words ending with it (how often you land there)",
    )

    ax.set_xticks(positions, [c.upper() for c in LETTERS], fontsize=11, family="monospace")

    # A dead-end caption per bar overruns the 0.4-wide slot it sits in, so the
    # tick label carries the warning instead, matching the chord diagram.
    for label, stat in zip(ax.get_xticklabels(), stats):
        if stat.is_dead_end:
            label.set_color(theme.dead)
            label.set_fontweight("bold")

    ax.set_ylabel("words", fontsize=11, color=theme.ink)
    ax.set_title(title, fontsize=19, family="serif", color=theme.ink, pad=16)
    legend = ax.legend(frameon=False, fontsize=9.5, loc="upper right")
    for text in legend.get_texts():
        text.set_color(theme.ink)
    ax.text(
        0,
        -0.13,
        "a letter in red has words ending on it and none starting with it: the round stops there",
        transform=ax.transAxes,
        fontsize=9,
        color=theme.muted,
    )
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(theme.faint)
    ax.tick_params(length=0, colors=theme.ink)
    fig.savefig(out, dpi=180, facecolor=theme.ground, bbox_inches="tight")
    plt.close(fig)


def words_disc(
    words: list[Word],
    out: FilePath,
    title: str,
    limit: int = 110,
    theme: Theme = LIGHT,
) -> None:
    """The word graph, laid out in wedges by first letter.

    A spring layout of this graph is a hairball: every word ending in A links to
    every word starting with A, so the edge density defeats any force model.
    Grouping by first letter puts the structure back, because the bundles of
    curves between two wedges are exactly the letter graph's ribbons.
    """
    shown = sorted(words, key=lambda w: (-w.zipf, w.text))[:limit]
    grouped: dict[str, list[Word]] = defaultdict(list)
    for word in shown:
        grouped[word.head].append(word)

    live = [letter for letter in LETTERS if grouped[letter]]
    gap = math.radians(3.5)
    span = (2 * math.pi - gap * len(live)) / max(len(shown), 1)

    angle = math.pi / 2
    placed: dict[str, tuple[float, float]] = {}
    order: dict[str, int] = {}
    wedge_mid: dict[str, float] = {}
    for letter in live:
        block = sorted(grouped[letter], key=_by_tail)
        start = angle
        for word in block:
            angle -= span
            placed[word.text] = (math.cos(angle + span / 2), math.sin(angle + span / 2))
            order[word.text] = len(order)
        wedge_mid[letter] = (start + angle) / 2
        angle -= gap

    # Labels sit at a fixed radius in data coordinates while their font size is
    # in points, so the only way to fit more of them is a larger canvas. Below
    # about 110 words the default disc has room to spare.
    crowded = len(shown) > 150
    fig, ax = _blank_disc(theme, min(20.0, 9.6 + max(0, len(shown) - 110) * 0.022))

    # One LineCollection per starting letter rather than a patch per edge: the
    # colour is constant within a bundle, and 4856 separate artists is slow to
    # draw and slower to save.
    pull = _PULL_DENSE if crowded else _PULL
    for letter in live:
        segments = [
            _bezier(placed[word.text], placed[successor.text], pull)
            for word in shown
            for successor in grouped[word.tail]
            if word.head == letter and successor.text != word.text
        ]
        if segments:
            ax.add_collection(
                LineCollection(
                    segments,
                    colors=[_hue(letter, theme)],
                    linewidths=0.5,
                    alpha=theme.edge_alpha if not crowded else theme.edge_alpha * 0.55,
                    zorder=2,
                )
            )

    for word in shown:
        x, y = placed[word.text]
        ax.scatter([x], [y], s=6, color=_hue(word.head, theme), zorder=3, lw=0)

        # Adjacent labels collide at their inner ends, where the circumference
        # is smallest. Alternating two radii doubles the room each one has
        # against its same-tier neighbours, and a leader line keeps the outer
        # tier attached to the dot it belongs to.
        tier = order[word.text] % 2 if crowded else 0
        radius = 1.015 + tier * 0.058
        if tier:
            ax.plot(
                [x * 1.005, x * (radius - 0.004)],
                [y * 1.005, y * (radius - 0.004)],
                color=theme.faint,
                lw=0.4,
                zorder=1,
            )
        degrees = math.degrees(math.atan2(y, x))
        flip = 90 < degrees % 360 < 270
        ax.text(
            x * radius,
            y * radius,
            word.text,
            fontsize=6.2 if crowded else 6.8,
            color=theme.ink,
            rotation=degrees + 180 if flip else degrees,
            rotation_mode="anchor",
            ha="right" if flip else "left",
            va="center",
            zorder=4,
        )

    for letter, mid in wedge_mid.items():
        ax.text(
            math.cos(mid) * 1.255,
            math.sin(mid) * 1.255,
            letter.upper(),
            ha="center",
            va="center",
            fontsize=15,
            family="monospace",
            fontweight="bold",
            color=_hue(letter, theme),
        )

    ax.set_title(title, fontsize=21, family="serif", color=theme.ink, pad=20)
    _headline(ax, words, theme)
    dropped = len(words) - len(shown)
    note = f"{len(shown)} commonest words shown"
    if dropped:
        note += f", {dropped} omitted"
    ax.text(0, -1.31, note, ha="center", fontsize=8.5, color=theme.muted)
    fig.savefig(out, dpi=190, facecolor=theme.ground, bbox_inches="tight")
    plt.close(fig)
