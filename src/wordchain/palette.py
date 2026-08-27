"""Themes and the per-letter colour wheel, shared by the figures and the pages.

A cyclic ramp suits letters on a dial, but the packaged cyclic colormaps vary in
lightness and their pale stretches disappear against the background. Fixing
saturation and value keeps all 26 equally visible, and lets a dark theme lift
the whole wheel by moving one number.
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass

from .graph import LETTERS


@dataclass(frozen=True)
class Theme:
    """Every colour a figure needs, and the two knobs that drive the wheel."""

    name: str
    ground: str  # page behind everything
    panel: str  # blocks that sit on the ground
    ink: str  # titles and word labels
    muted: str  # captions
    faint: str  # leader lines, hairlines
    dead: str  # a letter no word starts with
    live: str  # words available from a letter
    saturation: float
    value: float
    edge_alpha: float  # opacity floor for the densest word graphs


LIGHT = Theme(
    name="light",
    ground="#eef1f0",
    panel="#fbfcfc",
    ink="#131a1b",
    muted="#5d6d6e",
    faint="#b3c0bf",
    dead="#b8342a",
    live="#2c7359",
    saturation=0.62,
    value=0.60,
    edge_alpha=0.16,
)

DARK = Theme(
    name="dark",
    ground="#0c1112",
    panel="#141b1c",
    ink="#e7eded",
    muted="#90a1a1",
    faint="#33413f",
    dead="#e8705f",
    live="#59b491",
    saturation=0.55,
    value=0.88,
    edge_alpha=0.20,
)

THEMES = {"light": LIGHT, "dark": DARK}

# Typography, in fallback order. The first name in each list is what a macOS
# machine will pick up; the last is bundled with matplotlib, so a figure still
# renders on a host with none of the others.
DISPLAY = ["Iowan Old Style", "Palatino", "Georgia", "DejaVu Serif"]
BODY = ["Avenir Next", "Avenir", "Helvetica Neue", "DejaVu Sans"]
DATA = ["Menlo", "SF Mono", "DejaVu Sans Mono"]


def rgb(letter: str, theme: Theme) -> tuple[float, float, float]:
    return colorsys.hsv_to_rgb(LETTERS.index(letter) / 26, theme.saturation, theme.value)


def hex_of(letter: str, theme: Theme) -> str:
    r, g, b = rgb(letter, theme)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
