"""Interactive pages, built with pyvis over vis.js.

The static figures answer "what shape is this category". These answer "what can
I play next", which needs a pointer: hovering a node lights its edges, and that
is the question the game actually asks.
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path

from pyvis.network import Network

from .graph import LETTERS, letter_stats, live_letters
from .lexicon import Word
from .palette import DARK, Theme, hex_of

# pyvis defaults to pulling vis-network from a CDN. Inlining it costs about
# 700 kB per page and buys a file that works offline and inside a sandbox that
# blocks external hosts.
_RESOURCES = "in_line"

_PHYSICS_OFF = {
    "physics": {"enabled": False},
    "interaction": {"hover": True, "hoverConnectedEdges": True, "tooltipDelay": 90},
    "edges": {"color": {"inherit": False}, "smooth": {"type": "curvedCW", "roundness": 0.18}},
}


def _canvas(theme: Theme, height: str = "820px") -> Network:
    net = Network(
        height=height,
        width="100%",
        directed=True,
        bgcolor=theme.ground,
        font_color=theme.ink,
        cdn_resources=_RESOURCES,
    )
    net.set_options(json.dumps(_PHYSICS_OFF))
    return net


def letters_page(words: list[Word], out: Path, title: str, theme: Theme = DARK) -> None:
    """26 letter nodes on a ring, one edge per first/last pair."""
    stats = {s.letter: s for s in letter_stats(words)}
    live = live_letters(words)
    net = _canvas(theme)

    radius = 360
    for i, letter in enumerate(LETTERS):
        stat = stats[letter]
        angle = math.pi / 2 - 2 * math.pi * i / 26
        pressure = "no way out" if stat.supply == 0 else f"{stat.pressure:.1f} landings per reply"
        net.add_node(
            letter,
            label=letter.upper(),
            title=(
                f"{letter.upper()}\n{stat.demand} words end here\n"
                f"{stat.supply} words start here\n{pressure}"
            ),
            color=theme.dead if stat.is_dead_end else hex_of(letter, theme),
            size=8 + 1.6 * math.sqrt(stat.supply + stat.demand) * 3,
            x=int(radius * math.cos(angle)),
            y=int(-radius * math.sin(angle)),
            physics=False,
            font={"size": 22, "color": theme.ink},
            opacity=1.0 if letter in live else 0.25,
        )

    pairs: dict[tuple[str, str], int] = defaultdict(int)
    for word in words:
        pairs[(word.head, word.tail)] += 1
    peak = max(pairs.values(), default=1)

    for (head, tail), count in pairs.items():
        examples = [w.text for w in words if w.head == head and w.tail == tail][:6]
        net.add_edge(
            head,
            tail,
            value=count,
            width=0.6 + 7 * math.sqrt(count / peak),
            color=hex_of(head, theme),
            title=f"{count} word{'s' if count != 1 else ''}: " + ", ".join(examples),
        )

    net.save_graph(str(out))
    _finish(out, title, "Hover a letter to light every pair it takes part in.", theme)


def words_page(
    words: list[Word], out: Path, title: str, limit: int = 260, theme: Theme = DARK
) -> None:
    """One node per word, grouped into wedges by first letter.

    Positions are fixed rather than force-directed. Every word ending in A links
    to every word starting with A, so the edge density defeats a force model and
    produces the same hairball whichever seed it starts from.
    """
    shown = sorted(words, key=lambda w: (-w.zipf, w.text))[:limit]
    grouped: dict[str, list[Word]] = defaultdict(list)
    for word in shown:
        grouped[word.head].append(word)

    present = [letter for letter in LETTERS if grouped[letter]]
    gap = math.radians(4.0)
    span = (2 * math.pi - gap * len(present)) / max(len(shown), 1)

    net = _canvas(theme, "880px")
    radius = 430
    angle = math.pi / 2
    for letter in present:
        for word in sorted(
            grouped[letter], key=lambda w: ((ord(w.head) - ord(w.tail) - 1) % 26, w.text)
        ):
            angle -= span
            successors = len(grouped.get(word.tail, ()))
            net.add_node(
                word.text,
                label=word.text,
                title=(
                    f"{word.text}\nends in {word.tail.upper()} — "
                    f"{successors} of the shown words follow it"
                ),
                color=hex_of(letter, theme),
                size=7 + 1.4 * word.zipf,
                x=int(radius * math.cos(angle + span / 2)),
                y=int(-radius * math.sin(angle + span / 2)),
                physics=False,
                font={"size": 13, "color": theme.ink},
            )
        angle -= gap

    for word in shown:
        for successor in grouped.get(word.tail, ()):
            if successor.text != word.text:
                net.add_edge(
                    word.text,
                    successor.text,
                    width=0.4,
                    color={"color": hex_of(word.head, theme), "opacity": 0.22},
                )

    net.save_graph(str(out))
    dropped = len(words) - len(shown)
    note = "Hover a word to light everything that can follow it."
    if dropped:
        note += f" Showing the {len(shown)} commonest of {len(words)}."
    _finish(out, title, note, theme)


# pyvis links these from a CDN even under cdn_resources="in_line", which only
# governs vis-network. Nothing on the page uses Bootstrap: it styles the filter
# and config widgets, which these pages do not switch on.
_CDN_TAG = re.compile(r"\s*<(?:link|script)[^>]*cdn\.jsdelivr\.net[^>]*>(?:</script>)?")


def _finish(out: Path, title: str, note: str, theme: Theme) -> None:
    """Add a heading and cut the CDN tags; pyvis writes a bare canvas."""
    banner = (
        f'<div style="font:600 20px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        f'color:{theme.ink};padding:20px 24px 4px">{title}</div>'
        f'<div style="font:400 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;'
        f'color:{theme.muted};padding:0 24px 12px">{note}</div>'
    )
    html = _CDN_TAG.sub("", out.read_text())
    html = html.replace("<body>", f"<body style='background:{theme.ground};margin:0'>{banner}", 1)
    out.write_text(html)
