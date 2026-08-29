"""The disc's settings, as dataclasses and as a TOML file.

Eight numbers decide where the word disc puts things, and the good value for
each depends on the category: 895 animals and 60 flowers do not want the same
label size or the same curve pull. They sat in `render.py` as module constants,
which meant editing the source to try a different figure, so they moved onto a
frozen `Geometry` that a figure takes the way it already takes a `Theme`.

The wheel that maps 26 letters to 26 hues went the same way. `[palette]` either
names one of the presets in `palette.py` or gives the numbers for a single arc.

`[selection]` is the third table, and it holds the command line's own defaults:
which words a category yields and how many of them the disc draws. A flag beats
the file for one run, and every command reads the table rather than `build`
alone, so the count `categories` prints stays the list `stats` analyses.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields
from pathlib import Path

from .palette import PRESETS, THEMES, Arc, Wheel


class ConfigError(Exception):
    """A config file that exists but does not say what it has to."""


@dataclass(frozen=True)
class Geometry:
    """Every distance and size the disc figures need.

    The defaults are the values the figures were tuned at, so a `Geometry()`
    with no file behind it draws what the tool drew before the file existed.
    """

    # How far a chord's control points sit toward the centre, as a fraction of
    # the radius. Curves leave each node heading inwards, so a chord reads as
    # the pair of letters it joins rather than as a line across the disc.
    pull: float = 0.32

    # The same for the word disc once it passes 150 words. Tighter than `pull`
    # because 4856 curves through a wide middle read as fog.
    pull_dense: float = 0.20

    # Where the word labels start, as a fraction of the dot ring.
    label_radius: float = 1.015

    # Label size in points. It also sets the canvas, because a label's length is
    # fixed in inches by the font and only a wider figure buys it room.
    label_pt: float = 6.8

    # Clear space each label demands along the ring, in multiples of its own
    # size. It decides when two neighbours count as touching.
    leading: float = 1.22

    # Room kept outside the labels for the wedge letter, in data units, and the
    # mean glyph width as a fraction of the font size. The second only reserves
    # space, so erring high costs a little margin and nothing else.
    wedge_band: float = 0.075
    glyph_width: float = 0.58

    # Half the width of a disc's axes, in data units, for the figures that reach
    # a known radius. `words_disc` solves for its own.
    disc_limit: float = 1.34


DEFAULT = Geometry()


@dataclass(frozen=True)
class Selection:
    """Which words a category yields, and how many of them the disc draws.

    These are the command line's own defaults, held here so a file can move
    them. Every command reads them, not just `build`: `categories` prints the
    count `stats` analyses and `build` draws from, and a table only `build`
    honoured would put the three out of step.
    """

    # Words rarer than this on wordfreq's Zipf scale are dropped. Zero keeps
    # every word wordfreq knows at all, which is the line WordNet's taxonomy
    # sits below rather than a tuned threshold.
    min_zipf: float = 0.0

    # Where a word has sense-tagged counts, the share of its uses that must fall
    # inside the category; where it has none, how far down the sense list the
    # category may sit.
    min_dominance: float = 0.2
    max_rank: int = 2

    # Hops below the category root a word must sit. One drops the root's own
    # lemmas, which are the category's name.
    min_depth: int = 1

    # A category yielding fewer than `target` words relaxes min_zipf down its
    # own frequency order, never past `zipf_floor`.
    target: int = 60
    zipf_floor: float = 0.0

    # Whether "polar bear" is a word, chained on its outer letters.
    multiword: bool = False

    # Words in the disc, commonest first. Only `build` reads it.
    limit: int = 110


DEFAULT_SELECTION = Selection()


@dataclass(frozen=True)
class Config:
    """What a file says. A wheel of None leaves the theme's own alone, and a
    theme of None leaves the command line's own."""

    geometry: Geometry = DEFAULT
    selection: Selection = DEFAULT_SELECTION
    wheel: Wheel | None = None
    theme: str | None = None


# The file a `build` picks up on its own, from the directory it runs in.
FILENAME = "wordchain.toml"

_GEOMETRY = "geometry"
_PALETTE = "palette"
_SELECTION = "selection"
_THEME = "theme"
_TABLES = (_GEOMETRY, _PALETTE, _SELECTION)
# `theme` names a ground rather than a group of distances, so it is a bare key
# beside the two tables rather than a lone member of a third.
_TOP = (_THEME, *_TABLES)

# `hue_start` of 0 is the top of the circle and `equalise` of 0 is no
# correction, so unlike every other setting these two mean something at zero.
_ZERO_OK = frozenset({"hue_start", "equalise"})

# Every numeric `[selection]` setting, as the JSON type it takes, the lowest
# value it allows and the highest if it has one. The validator below reads this
# and so does `tools/check_schema.py`, which is what stops the schema's bounds
# drifting from the ones actually enforced. Unlike `[geometry]`, each of these
# allows its own minimum: a `min_zipf` of 0 is the whole vocabulary, a
# `min_dominance` of 0 asks nothing of a word's senses, and a `target` of 0
# relaxes nothing. `limit` is the exception and starts at 1, since a disc of no
# words is a blank page. The Zipf ceiling is 8 because the scale runs out there —
# "the" scores 7.7 — so anything above it empties every category.
_SELECTION_BOUNDS: dict[str, tuple[str, float, float | None]] = {
    "min_zipf": ("number", 0.0, 8.0),
    "min_dominance": ("number", 0.0, 1.0),
    "max_rank": ("integer", 0, None),
    "min_depth": ("integer", 0, None),
    "target": ("integer", 0, None),
    "zipf_floor": ("number", 0.0, 8.0),
    "limit": ("integer", 1, None),
}

# The one setting in the table that is a state rather than a quantity.
_FLAG = "multiword"


def _names(kind: type) -> list[str]:
    return [f.name for f in fields(kind)]


def _suggest(key: str, names: list[str], noun: str = "settings") -> str:
    """Name the closest of them, or all of them. A refusal should say what would work."""
    from difflib import get_close_matches

    near = get_close_matches(key, names, n=1, cutoff=0.6)
    if near:
        return f"; did you mean {near[0]}?"
    return f"; the {noun} are " + ", ".join(names)


def _float(table: str, key: str, value: object) -> float:
    # TOML writes 1 as an int and 1.0 as a float, and both mean the same
    # distance here. bool is an int subclass, and `pull = true` is a mistake.
    if isinstance(value, bool) or not isinstance(value, int | float):
        kind = type(value).__name__
        raise ConfigError(f"[{table}] {key} must be a number, not a {kind}")
    # TOML has nan and inf literals, and both survive float() into a figure
    # that draws nothing and says why nowhere.
    number = float(value)
    if not math.isfinite(number):
        raise ConfigError(f"[{table}] {key} must be a finite number, not {value}")
    return number


def _number(key: str, value: object) -> float:
    number = _float(_GEOMETRY, key, value)
    if number <= 0:
        raise ConfigError(f"[{_GEOMETRY}] {key} must be a positive number, not {value}")
    return number


def _fraction(key: str, value: object) -> float:
    """A hue, a saturation, a value or a correction: all of them run 0 to 1."""
    number = _float(_PALETTE, key, value)
    zero_ok = key in _ZERO_OK
    if number > 1.0 or number < 0.0 or (number == 0.0 and not zero_ok):
        wants = "0 and 1" if zero_ok else "0 and 1, and above 0"
        raise ConfigError(f"[{_PALETTE}] {key} must be between {wants}, not {value}")
    return number


def _setting(key: str, value: object) -> float | int:
    """One numeric `[selection]` setting, against the bounds declared above."""
    kind, low, high = _SELECTION_BOUNDS[key]
    if kind == "integer":
        # A count of senses or of words. bool is an int subclass, and
        # `max_rank = true` is a mistake rather than a 1.
        if isinstance(value, bool) or not isinstance(value, int):
            got = type(value).__name__
            raise ConfigError(f"[{_SELECTION}] {key} must be a whole number, not a {got}")
        number: float = value
    else:
        number = _float(_SELECTION, key, value)
    if number < low or (high is not None and number > high):
        wants = f"between {low} and {high}" if high is not None else f"{low} or more"
        raise ConfigError(f"[{_SELECTION}] {key} must be {wants}, not {value}")
    return int(number) if kind == "integer" else number


def _flag(key: str, value: object) -> bool:
    if not isinstance(value, bool):
        got = type(value).__name__
        raise ConfigError(f"[{_SELECTION}] {key} must be true or false, not a {got}")
    return value


def _selection(table: dict[str, object]) -> Selection:
    valid = _names(Selection)
    values: dict[str, object] = {}
    for key, value in table.items():
        if key not in valid:
            raise ConfigError(f"[{_SELECTION}] has no setting called {key}{_suggest(key, valid)}")
        values[key] = _flag(key, value) if key == _FLAG else _setting(key, value)
    return Selection(**values)  # type: ignore[arg-type]


def _theme(value: object) -> str:
    """The ground a figure draws on, which the two built-in themes name."""
    if not isinstance(value, str):
        kind = type(value).__name__
        raise ConfigError(f"{_THEME} must be a name in quotes, not a {kind}")
    if value not in THEMES:
        near = _suggest(value, sorted(THEMES), "themes")
        raise ConfigError(f"there is no theme called {value}{near}")
    return value


def _geometry(table: dict[str, object]) -> Geometry:
    valid = _names(Geometry)
    values: dict[str, float] = {}
    for key, value in table.items():
        if key not in valid:
            raise ConfigError(f"[{_GEOMETRY}] has no setting called {key}{_suggest(key, valid)}")
        values[key] = _number(key, value)
    return Geometry(**values)


def _wheel(table: dict[str, object]) -> Wheel:
    """A preset by name, or the numbers for one arc. Never both.

    A preset can hold two arcs, as `duotone` does, and there is no honest way to
    layer one arc's worth of keys over that — so naming a preset and tuning it
    in the same table is refused rather than half-applied.
    """
    valid = _names(Arc)
    keys = set(table)
    if "preset" in keys:
        rest = sorted(keys - {"preset"})
        if rest:
            raise ConfigError(
                f"[{_PALETTE}] preset cannot be combined with {rest[0]}; "
                f"name a preset or give the arc's numbers, not both"
            )
        name = table["preset"]
        if not isinstance(name, str):
            kind = type(name).__name__
            raise ConfigError(f"[{_PALETTE}] preset must be a name in quotes, not a {kind}")
        if name not in PRESETS:
            near = _suggest(name, list(PRESETS), "presets")
            raise ConfigError(f"[{_PALETTE}] has no preset called {name}{near}")
        return PRESETS[name]

    values: dict[str, float] = {}
    for key, value in table.items():
        if key not in valid:
            known = [*valid, "preset"]
            raise ConfigError(f"[{_PALETTE}] has no setting called {key}{_suggest(key, known)}")
        values[key] = _fraction(key, value)
    return Wheel((Arc(**values),))


def from_mapping(data: dict[str, object]) -> Config:
    """Build a `Config` from a parsed file, rejecting anything unrecognised.

    A key the tool ignores is worse than one it refuses: the figure comes back
    unchanged and the file looks like it should have changed it.
    """
    unknown = sorted(set(data) - set(_TOP))
    if unknown:
        tables = [f"[{name}]" for name in _TABLES]
        held = ", ".join([_THEME, *tables[:-1]]) + f" and {tables[-1]}"
        raise ConfigError(f"unknown setting: {unknown[0]}; the file holds {held}")

    for name in _TABLES:
        if name in data and not isinstance(data[name], dict):
            raise ConfigError(f"[{name}] must be a table")

    geometry = _geometry(data.get(_GEOMETRY, {}))  # type: ignore[arg-type]
    selection = _selection(data.get(_SELECTION, {}))  # type: ignore[arg-type]
    palette = data.get(_PALETTE)
    theme = _theme(data[_THEME]) if _THEME in data else None
    return Config(
        geometry=geometry,
        selection=selection,
        wheel=_wheel(palette) if isinstance(palette, dict) else None,
        theme=theme,
    )


def load(path: Path) -> Config:
    """Read one TOML file. Every error carries the path, since a build names none."""
    # tomllib is 5 ms to import and a checkout may have no file at all, so it
    # stays here rather than at module load, for the same reason nltk does.
    import tomllib

    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except OSError as err:
        raise ConfigError(f"{path}: {err.strerror or err}") from err
    except tomllib.TOMLDecodeError as err:
        raise ConfigError(f"{path}: {err}") from err
    try:
        return from_mapping(data)
    except ConfigError as err:
        raise ConfigError(f"{path}: {err}") from err


def resolve(explicit: str | None, root: Path | None = None) -> Config:
    """The geometry and wheel a command should draw with.

    A named file has to exist, because a `--config` that silently falls back to
    the defaults is a typo that costs a render to notice. The one found by
    looking does not, since a checkout without one still has to draw.

    Every command calls this, not just `build`, since `[selection]` decides the
    word list that `categories` counts and `stats` analyses as much as the one
    `build` draws.
    """
    if explicit is not None:
        return load(Path(explicit))
    found = (root or Path.cwd()) / FILENAME
    return load(found) if found.is_file() else Config()
