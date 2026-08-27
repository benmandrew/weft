"""Themes and the per-letter colour wheel, shared by the figures and the pages.

A cyclic ramp suits letters on a dial, but the packaged cyclic colormaps vary in
lightness and their pale stretches disappear against the background. Fixing
saturation and value keeps all 26 equally visible, and lets a dark theme lift
the whole wheel by moving one number.

The wheel itself is a `Wheel` of one or more `Arc`s rather than a hardcoded full
turn, so a category can be drawn on a quarter of the circle or on two arcs that
split the alphabet. `config.py` reads one out of the TOML file.
"""

from __future__ import annotations

import colorsys
import math
from dataclasses import dataclass, replace
from functools import cache

from .graph import LETTERS

# Rec. 709, which is what the eye does with the three primaries. Only the ratio
# between two letters matters here, so the transfer function is left out.
_LUMA = (0.2126, 0.7152, 0.0722)

RGB = tuple[float, float, float]


def _luma(colour: RGB) -> float:
    return sum(c * w for c, w in zip(colour, _LUMA, strict=True))


@dataclass(frozen=True)
class Arc:
    """A stretch of hue the letters are spread along, at fixed saturation.

    The defaults are the full turn the wheel has always been. A span of exactly
    1.0 closes the circle, which puts the first and last letter one step apart
    and makes them read as the same hue; a span a little under 1 separates them.
    """

    hue_start: float = 0.0
    hue_span: float = 1.0
    saturation: float = 0.55
    value: float = 0.88

    # How far each letter's value is pulled towards a common luma, from 0 for
    # none to 1 for equal. A fixed-saturation wheel spans about 1.9x in luma, so
    # a yellow bundle drawn at the same alpha as a blue one overwhelms it.
    # Correction can only take brightness away, so 1 sends the greens olive.
    equalise: float = 0.0

    def hue(self, index: int, count: int) -> float:
        return (self.hue_start + self.hue_span * index / count) % 1.0

    def colour(self, index: int, count: int) -> RGB:
        hue = self.hue(index, count)
        if not self.equalise:
            return colorsys.hsv_to_rgb(hue, self.saturation, self.value)
        target = _mean_luma(self.hue_start, self.hue_span, self.saturation, count)
        full = _luma(colorsys.hsv_to_rgb(hue, self.saturation, 1.0))
        scale = (target / full) ** self.equalise
        return colorsys.hsv_to_rgb(hue, self.saturation, min(1.0, self.value * scale))


@cache
def _mean_luma(start: float, span: float, saturation: float, count: int) -> float:
    """The geometric mean luma of an arc at full value, which is what `equalise`
    pulls towards. Geometric rather than arithmetic because the correction is a
    ratio, so the mean has to be one too."""
    arc = Arc(start, span, saturation, 1.0)
    hues = (arc.hue(i, count) for i in range(count))
    logs = [math.log(_luma(colorsys.hsv_to_rgb(hue, saturation, 1.0))) for hue in hues]
    return math.exp(sum(logs) / count)


@dataclass(frozen=True)
class Wheel:
    """One or more arcs, dividing the alphabet evenly between them."""

    arcs: tuple[Arc, ...] = (Arc(),)

    def colour(self, index: int, count: int) -> RGB:
        parts = len(self.arcs)
        which = index * parts // count
        low = which * count // parts
        high = (which + 1) * count // parts
        return self.arcs[which].colour(index - low, high - low)

    def shifted(self, saturation: float, value: float) -> Wheel:
        return Wheel(
            tuple(
                replace(
                    arc,
                    saturation=min(1.0, max(0.01, arc.saturation + saturation)),
                    value=min(1.0, max(0.01, arc.value + value)),
                )
                for arc in self.arcs
            )
        )


# Every preset is tuned against the dark ground, which is what `build` draws on
# by default. The light theme takes the same wheel with more saturation and less
# value, which is exactly what separates the two built-in wheels below.
LIGHT_SHIFT = (0.07, -0.28)

PRESETS: dict[str, Wheel] = {
    # The full turn the tool has always drawn.
    "spectrum": Wheel((Arc(),)),
    # The same turn with the luma spread cut from 1.86x to 1.38x, and the span
    # short of a full circle so A and Z stop matching.
    "even": Wheel((Arc(0.0, 0.92, 0.58, 0.82, equalise=0.65),)),
    # A quarter turn each. Adjacent letters stop being separable and the sweep
    # across the disc becomes the thing you read instead.
    "ember": Wheel((Arc(0.94, 0.26, 0.68, 0.92),)),
    "tide": Wheel((Arc(0.42, 0.32, 0.62, 0.92),)),
    # Two short arcs, warm for A-M and cool for N-Z, so every curve that crosses
    # between the halves of the alphabet is visible as a crossing.
    "duotone": Wheel((Arc(0.95, 0.16, 0.66, 0.90), Arc(0.46, 0.22, 0.60, 0.92))),
}


@dataclass(frozen=True)
class Theme:
    """Every colour a figure needs, and the wheel the letters come off."""

    name: str
    ground: str  # page behind everything
    panel: str  # blocks that sit on the ground
    ink: str  # titles and word labels
    muted: str  # captions
    faint: str  # leader lines, hairlines
    dead: str  # a letter no word starts with
    live: str  # words available from a letter
    wheel: Wheel
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
    wheel=PRESETS["spectrum"].shifted(*LIGHT_SHIFT),
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
    wheel=PRESETS["spectrum"],
    edge_alpha=0.20,
)

THEMES = {"light": LIGHT, "dark": DARK}

# Typography, in fallback order. The first name in each list is what a macOS
# machine will pick up; the last is bundled with matplotlib, so a figure still
# renders on a host with none of the others.
DISPLAY = ["Iowan Old Style", "Palatino", "Georgia", "DejaVu Serif"]
BODY = ["Avenir Next", "Avenir", "Helvetica Neue", "DejaVu Sans"]
DATA = ["Menlo", "SF Mono", "DejaVu Sans Mono"]


def with_wheel(theme: Theme, wheel: Wheel) -> Theme:
    """The theme drawn with a different wheel, shifted if the ground is light."""
    return replace(theme, wheel=wheel.shifted(*LIGHT_SHIFT) if theme.name == "light" else wheel)


def rgb(letter: str, theme: Theme) -> RGB:
    return theme.wheel.colour(LETTERS.index(letter), len(LETTERS))


def hex_of(letter: str, theme: Theme) -> str:
    r, g, b = rgb(letter, theme)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
