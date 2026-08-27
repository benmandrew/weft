"""One colour per letter, shared by the static figures and the web pages.

A cyclic ramp suits letters on a dial, but the packaged cyclic colormaps vary in
lightness and their pale stretches disappear against the background. Fixing
saturation and value keeps all 26 equally visible.
"""

from __future__ import annotations

import colorsys

from .graph import LETTERS

BACKGROUND = "#faf9f7"
INK = "#1d1d1f"
MUTED = "#8a8a8f"
ALERT = "#c8402f"


def rgb(letter: str, saturation: float = 0.62, value: float = 0.72) -> tuple[float, float, float]:
    return colorsys.hsv_to_rgb(LETTERS.index(letter) / 26, saturation, value)


def hex_of(letter: str, saturation: float = 0.62, value: float = 0.72) -> str:
    r, g, b = rgb(letter, saturation, value)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
