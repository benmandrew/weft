"""Matplotlib figures for the letter graph and the word graph."""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path as FilePath

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import PathPatch
from matplotlib.path import Path

from . import palette
from .graph import LETTERS, letter_matrix, letter_stats
from .lexicon import Word
from .palette import ALERT, BACKGROUND, INK, MUTED

# Curves leave each node heading for the centre, so a chord's shape reads as the
# pair of letters it joins rather than as a straight line crossing the disc.
_PULL = 0.32


def _hue(letter: str) -> tuple:
    return palette.rgb(letter)


def _ring(count: int, radius: float = 1.0) -> list[tuple[float, float]]:
    """Positions clockwise from the top, which is how a reader scans a dial."""
    return [
        (
            radius * math.cos(math.pi / 2 - 2 * math.pi * i / count),
            radius * math.sin(math.pi / 2 - 2 * math.pi * i / count),
        )
        for i in range(count)
    ]


def _chord(ax, start, end, colour, width, alpha):
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
        [start, (start[0] * _PULL, start[1] * _PULL), (end[0] * _PULL, end[1] * _PULL), end],
        [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4],
    )
    ax.add_patch(PathPatch(path, fc="none", ec=colour, lw=width, alpha=alpha, zorder=2))


def _blank_disc(size: float = 8.4):
    fig, ax = plt.subplots(figsize=(size, size), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)
    ax.set_aspect("equal")
    ax.set_xlim(-1.32, 1.32)
    ax.set_ylim(-1.32, 1.32)
    ax.axis("off")
    return fig, ax


def chord(words: list[Word], out: FilePath, title: str) -> None:
    """The whole game on 26 nodes: one ribbon per letter pair, weighted by words."""
    counts = letter_matrix(words)
    points = _ring(26)
    peak = counts.max() or 1

    fig, ax = _blank_disc()
    for i, head in enumerate(LETTERS):
        for j, tail in enumerate(LETTERS):
            weight = counts[i, j]
            if not weight:
                continue
            share = math.sqrt(weight / peak)
            _chord(ax, points[i], points[j], _hue(head), 0.4 + 4.0 * share, 0.20 + 0.45 * share)

    stats = {s.letter: s for s in letter_stats(words)}
    for i, letter in enumerate(LETTERS):
        x, y = points[i]
        stat = stats[letter]
        touched = stat.supply + stat.demand
        ax.scatter(
            [x], [y], s=18 + 3.2 * touched, color=_hue(letter), zorder=3, ec=BACKGROUND, lw=1.2
        )
        ax.text(
            x * 1.19,
            y * 1.19,
            letter.upper(),
            ha="center",
            va="center",
            fontsize=14,
            color=ALERT if stat.is_dead_end else INK,
            fontweight="bold" if stat.is_dead_end else "normal",
        )

    ax.set_title(title, fontsize=15, color=INK, pad=16)
    ax.text(
        0,
        -1.28,
        "ribbon width = words carrying that first/last pair · red = nothing starts here",
        ha="center",
        fontsize=9,
        color=MUTED,
    )
    fig.savefig(out, dpi=180, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)


def matrix(words: list[Word], out: FilePath, title: str) -> None:
    """The same counts as a grid, where exact numbers are readable."""
    counts = letter_matrix(words)
    fig, ax = plt.subplots(figsize=(9.2, 8.4), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)
    ax.imshow(np.log1p(counts), cmap="magma_r", aspect="equal")

    ax.set_xticks(range(26), [c.upper() for c in LETTERS], fontsize=9)
    ax.set_yticks(range(26), [c.upper() for c in LETTERS], fontsize=9)
    ax.set_xlabel("last letter — where the word hands over", fontsize=11, color=INK, labelpad=10)
    ax.set_ylabel("first letter — where the word picks up", fontsize=11, color=INK, labelpad=10)
    ax.set_title(title, fontsize=15, color=INK, pad=16)

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
                    color="white" if counts[i, j] > peak * 0.45 else INK,
                )
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(length=0)
    fig.savefig(out, dpi=180, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)


def pressure(words: list[Word], out: FilePath, title: str) -> None:
    """Supply against demand per letter, which is where the traps show up."""
    stats = letter_stats(words)
    positions = np.arange(26)
    fig, ax = plt.subplots(figsize=(11.5, 5.4), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)

    ax.bar(
        positions - 0.2,
        [s.supply for s in stats],
        width=0.4,
        color="#3b6ea5",
        label="words starting with it (your replies)",
    )
    ax.bar(
        positions + 0.2,
        [s.demand for s in stats],
        width=0.4,
        color=ALERT,
        label="words ending with it (how often you land there)",
    )

    ax.set_xticks(positions, [c.upper() for c in LETTERS], fontsize=10)

    # A dead-end caption per bar overruns the 0.4-wide slot it sits in, so the
    # tick label carries the warning instead, matching the chord diagram.
    for label, stat in zip(ax.get_xticklabels(), stats):
        if stat.is_dead_end:
            label.set_color(ALERT)
            label.set_fontweight("bold")
    ax.set_ylabel("words", fontsize=11, color=INK)
    ax.set_title(title, fontsize=15, color=INK, pad=14)
    ax.legend(frameon=False, fontsize=9.5, loc="upper right")
    ax.text(
        0,
        -0.13,
        "a letter in red has words ending on it and none starting with it: the round stops there",
        transform=ax.transAxes,
        fontsize=9,
        color=MUTED,
    )
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(MUTED)
    ax.tick_params(length=0, colors=INK)
    fig.savefig(out, dpi=180, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)


def words_disc(words: list[Word], out: FilePath, title: str, limit: int = 110) -> None:
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
    wedge_mid: dict[str, float] = {}
    for letter in live:
        block = sorted(grouped[letter], key=lambda w: w.text)
        start = angle
        for word in block:
            angle -= span
            placed[word.text] = (math.cos(angle + span / 2), math.sin(angle + span / 2))
        wedge_mid[letter] = (start + angle) / 2
        angle -= gap

    fig, ax = _blank_disc(9.6)
    tails = {word.text: word.tail for word in shown}
    for word in shown:
        for successor in grouped[tails[word.text]]:
            if successor.text != word.text:
                _chord(ax, placed[word.text], placed[successor.text], _hue(word.head), 0.5, 0.13)

    for word in shown:
        x, y = placed[word.text]
        degrees = math.degrees(math.atan2(y, x))
        flip = 90 < degrees % 360 < 270
        ax.text(
            x * 1.02,
            y * 1.02,
            word.text,
            fontsize=6.4,
            color=INK,
            rotation=degrees + 180 if flip else degrees,
            rotation_mode="anchor",
            ha="right" if flip else "left",
            va="center",
        )

    for letter, mid in wedge_mid.items():
        ax.text(
            math.cos(mid) * 1.245,
            math.sin(mid) * 1.245,
            letter.upper(),
            ha="center",
            va="center",
            fontsize=13,
            fontweight="bold",
            color=_hue(letter),
        )

    ax.set_title(title, fontsize=15, color=INK, pad=16)
    dropped = len(words) - len(shown)
    note = f"{len(shown)} commonest words shown"
    if dropped:
        note += f", {dropped} omitted"
    ax.text(0, -1.30, note, ha="center", fontsize=9, color=MUTED)
    fig.savefig(out, dpi=190, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)
