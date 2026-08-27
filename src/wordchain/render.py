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
from matplotlib.axes import Axes
from matplotlib.collections import PathCollection
from matplotlib.figure import Figure
from matplotlib.patches import Circle, PathPatch
from matplotlib.path import Path

from . import palette
from .config import DEFAULT, Geometry
from .graph import LETTERS, letter_matrix, letter_stats, summary
from .lexicon import Word
from .palette import DARK, Theme

# A point on the unit disc, and a colour as matplotlib wants one.
Point = tuple[float, float]
RGB = tuple[float, float, float]

# Every distance and size the disc figures need is a field on config.Geometry,
# which a figure takes the way it takes a Theme. DEFAULT holds the values they
# were tuned at, and a wordchain.toml overrides any of them.


_SVG_NS = "http://www.w3.org/2000/svg"


def _typeface() -> None:
    """Register the three families once, so `family=` picks up a fallback list."""
    plt.rcParams["font.serif"] = palette.DISPLAY
    plt.rcParams["font.sans-serif"] = palette.BODY
    plt.rcParams["font.monospace"] = palette.DATA
    plt.rcParams["font.family"] = "sans-serif"

    # SVG output embeds each glyph as an outline rather than naming the font.
    # It costs a little size against `svg.fonttype = "none"`, and it means the
    # figure renders the same on a machine that has none of Iowan Old Style,
    # Avenir or Menlo installed — which, given how much of the design rests on
    # those three, is worth more than selectable text.
    plt.rcParams["svg.fonttype"] = "path"


def _hue(letter: str, theme: Theme) -> RGB:
    return palette.rgb(letter, theme)


def _ring(count: int, radius: float = 1.0) -> list[Point]:
    """Positions clockwise from the top, which is how a reader scans a dial."""
    return [
        (
            radius * math.cos(math.pi / 2 - 2 * math.pi * i / count),
            radius * math.sin(math.pi / 2 - 2 * math.pi * i / count),
        )
        for i in range(count)
    ]


def _disc_limit(size_in: float, longest: int, geo: Geometry) -> float:
    """The axis limit that exactly contains the labels and the wedge letters.

    A label's length is fixed in inches by the font, but the axis limit is what
    converts inches into data units, so the limit appears on both sides and the
    two are related by one equation rather than a measurement. Solving it is
    what lets the axes fill the figure, and a figure with no margin is a figure
    matplotlib does not have to draw twice to find out where to crop.
    """
    label_in = longest * geo.label_pt * geo.glyph_width / 72
    crowding = 1 - 2 * label_in / size_in
    return (geo.label_radius + geo.wedge_band) / max(crowding, 0.4)


def _canvas_inches(span: float, geo: Geometry) -> float:
    """How wide the disc has to be for adjacent labels to clear each other.

    A label sits at a fixed radius in data units while its font size is in
    points, so the only thing that buys it room along the ring is a larger
    canvas. Solving for the size that gives every label a full line of leading
    is what lets all 364 words share one radius.

    Sizing up is close to free in vector output, which is priced by element
    count rather than dimensions, and a reader zooms rather than squints.
    """
    arc = geo.label_radius * span
    needed = geo.label_pt * geo.leading * (2 * geo.disc_limit) / (72 * arc)
    return max(9.6, min(30.0, needed))


def _hoist_shared_attributes(out: FilePath) -> None:
    """Lift style and clip-path off the paths in a group and onto the group.

    matplotlib stamps both onto every path element, even though a collection's
    paths share them by construction: a 364-word disc carries 49 distinct style
    strings and one clip across 9713 elements, which is 35% of the file spent on
    identical bytes. Every property involved is inherited in SVG, and clipping a
    group is the same as clipping each of its children by the same path, so the
    rendered result does not change.
    """
    path = FilePath(out)
    if path.suffix.lower() != ".svg":
        return

    import xml.etree.ElementTree as ET

    ET.register_namespace("", _SVG_NS)
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    tree = ET.parse(path)
    for group in tree.getroot().iter(f"{{{_SVG_NS}}}g"):
        children = list(group)
        if len(children) < 2:
            continue
        for attribute in ("style", "clip-path"):
            if attribute in group.attrib:
                continue
            shared = {child.get(attribute) for child in children}
            if len(shared) != 1:
                continue
            value = shared.pop()
            if value is None:
                continue
            group.set(attribute, value)
            for child in children:
                del child.attrib[attribute]
    tree.write(path, encoding="utf-8", xml_declaration=True)


def _fan_key(word: Word) -> tuple[int, str]:
    """Sort key laying a wedge out so its curves leave as a fan.

    Every word in a wedge already shares a first letter, so the letter that
    matters is the one it hands over on. Sorting on that alone starts every
    wedge at A, which is arbitrary once the wedges themselves are a ring: for
    the S wedge it drops the destinations nearest to S into the middle of the
    block and sends the bundle back across itself.

    Rotating the alphabet to begin just before the wedge's own letter puts the
    destinations in the order the ring visits them, counted against the way the
    words themselves are placed. S then runs R, Q, P back to A, wraps to Z, and
    finishes on T. Two chords from one wedge avoid crossing when the nearer
    origin takes the farther destination, so the sequence has to run opposite to
    the placement, and the bundle leaves in one sweep.
    """
    return (ord(word.head) - ord(word.tail) - 1) % 26, word.text


def _curve(start: Point, end: Point, pull: float) -> Path:
    """A cubic from start to end, bowed towards the centre.

    Four control points rather than a sampled polyline. SVG has cubics natively,
    so the curve is exact instead of approximated, the file holds a sixth of the
    coordinates, and nothing has to evaluate the curve to draw it.
    """
    return Path(
        [start, (start[0] * pull, start[1] * pull), (end[0] * pull, end[1] * pull), end],
        [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4],
    )


def _chord(
    ax: Axes,
    start: Point,
    end: Point,
    colour: RGB,
    width: float,
    alpha: float,
    pull: float,
) -> None:
    if start == end:
        # A self-loop has no chord to draw, so it becomes a bubble sitting just
        # outside its own node.
        norm = math.hypot(*start) or 1.0
        centre = (start[0] / norm * 1.075, start[1] / norm * 1.075)
        ax.add_patch(Circle(centre, 0.035, fill=False, ec=colour, lw=width, alpha=alpha, zorder=2))
        return
    ax.add_patch(
        PathPatch(_curve(start, end, pull), fc="none", ec=colour, lw=width, alpha=alpha, zorder=2)
    )


def _blank_disc(
    theme: Theme,
    size: float = 8.4,
    bleed: bool = False,
    limit: float = DEFAULT.disc_limit,
) -> tuple[Figure, Axes]:
    _typeface()
    fig = plt.figure(figsize=(size, size), facecolor=theme.ground)
    # The axes already frames the disc through its own limits, so letting it
    # fill the figure leaves no margin for bbox_inches="tight" to crop. That
    # matters because trimming means measuring, and measuring means drawing all
    # 4856 curves a second time, for 110 ms of the save.
    ax = fig.add_axes((0.0, 0.0, 1.0, 1.0)) if bleed else fig.add_subplot()
    ax.set_facecolor(theme.ground)
    ax.set_aspect("equal")
    ax.set_xlim(-limit, limit)
    ax.set_ylim(-limit, limit)
    ax.axis("off")
    return fig, ax


def _headline(ax: Axes, words: list[Word], theme: Theme) -> None:
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


def chord(
    words: list[Word],
    out: FilePath,
    title: str,
    theme: Theme = DARK,
    chrome: bool = False,
    geometry: Geometry = DEFAULT,
) -> None:
    """The whole game on 26 nodes: one ribbon per letter pair, weighted by words."""
    counts = letter_matrix(words)
    points = _ring(26)
    peak = counts.max() or 1

    fig, ax = _blank_disc(theme, limit=geometry.disc_limit)
    for i, head in enumerate(LETTERS):
        for j, tail in enumerate(LETTERS):
            weight = counts[i, j]
            if not weight:
                continue
            share = math.sqrt(weight / peak)
            _chord(
                ax,
                points[i],
                points[j],
                _hue(head, theme),
                0.4 + 4.0 * share,
                0.20 + 0.45 * share,
                geometry.pull,
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

    if chrome:
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


def matrix(
    words: list[Word], out: FilePath, title: str, theme: Theme = DARK, chrome: bool = False
) -> None:
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
    if chrome:
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


def pressure(
    words: list[Word], out: FilePath, title: str, theme: Theme = DARK, chrome: bool = False
) -> None:
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

    if chrome:
        ax.set_ylabel("words", fontsize=11, color=theme.ink)
        ax.set_title(title, fontsize=19, family="serif", color=theme.ink, pad=16)
        legend = ax.legend(frameon=False, fontsize=9.5, loc="upper right")
        for text in legend.get_texts():
            text.set_color(theme.ink)
        ax.text(
            0,
            -0.13,
            "a letter in red has words ending on it and none starting with it: "
            "the round stops there",
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
    theme: Theme = DARK,
    chrome: bool = False,
    geometry: Geometry = DEFAULT,
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
    wedge_mid: dict[str, float] = {}
    for letter in live:
        block = sorted(grouped[letter], key=_fan_key)
        start = angle
        for word in block:
            angle -= span
            placed[word.text] = (math.cos(angle + span / 2), math.sin(angle + span / 2))
        wedge_mid[letter] = (start + angle) / 2
        angle -= gap

    crowded = len(shown) > 150
    size = _canvas_inches(span, geometry)
    # `limit` is already the word count, so the axis half-width is `reach`.
    reach = _disc_limit(size, max(len(w.text) for w in shown), geometry)
    # Chrome hangs a title and a caption outside the axes, which a full-bleed
    # axes would clip, so that path keeps the margins and the tight crop.
    fig, ax = _blank_disc(theme, size, bleed=not chrome, limit=reach)

    # One collection per starting letter rather than a patch per edge: the
    # colour is constant within a bundle, and 4856 separate artists is slow to
    # draw and slower to save.
    pull = geometry.pull_dense if crowded else geometry.pull
    for letter in live:
        curves = [
            _curve(placed[word.text], placed[successor.text], pull)
            for word in shown
            for successor in grouped[word.tail]
            if word.head == letter and successor.text != word.text
        ]
        if curves:
            ax.add_collection(
                PathCollection(
                    curves,
                    facecolors="none",
                    edgecolors=[_hue(letter, theme)],
                    linewidths=0.5,
                    alpha=theme.edge_alpha if not crowded else theme.edge_alpha * 0.55,
                    zorder=2,
                    transform=ax.transData,
                )
            )

    # One call for all 364 dots. A scatter per word builds the same picture out
    # of 364 PathCollections, which costs twice: once assembling them and again
    # when the renderer walks the list.
    ax.scatter(
        [placed[w.text][0] for w in shown],
        [placed[w.text][1] for w in shown],
        s=6,
        c=[_hue(w.head, theme) for w in shown],
        zorder=3,
        lw=0,
    )

    for word in shown:
        x, y = placed[word.text]
        degrees = math.degrees(math.atan2(y, x))
        flip = 90 < degrees % 360 < 270
        ax.text(
            x * geometry.label_radius,
            y * geometry.label_radius,
            word.text,
            fontsize=geometry.label_pt,
            color=theme.ink,
            rotation=degrees + 180 if flip else degrees,
            rotation_mode="anchor",
            ha="right" if flip else "left",
            va="center",
            zorder=4,
        )

    ring = reach - geometry.wedge_band / 2
    for letter, mid in wedge_mid.items():
        ax.text(
            math.cos(mid) * ring,
            math.sin(mid) * ring,
            letter.upper(),
            ha="center",
            va="center",
            fontsize=15,
            family="monospace",
            fontweight="bold",
            color=_hue(letter, theme),
        )

    if chrome:
        ax.set_title(title, fontsize=21, family="serif", color=theme.ink, pad=20)
        _headline(ax, words, theme)
        dropped = len(words) - len(shown)
        note = f"{len(shown)} commonest words shown"
        if dropped:
            note += f", {dropped} omitted"
        ax.text(0, -reach * 0.98, note, ha="center", fontsize=8.5, color=theme.muted)
    fig.savefig(out, dpi=190, facecolor=theme.ground, bbox_inches="tight" if chrome else None)
    plt.close(fig)
    _hoist_shared_attributes(out)
