"""The disc's geometry, as a dataclass and as a TOML file.

Eight numbers decide where the word disc puts things, and the good value for
each depends on the category: 895 animals and 60 flowers do not want the same
label size or the same curve pull. They sat in `render.py` as module constants,
which meant editing the source to try a different figure, so they moved onto a
frozen `Geometry` that a figure takes the way it already takes a `Theme`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, fields
from pathlib import Path


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

# The file a `build` picks up on its own, from the directory it runs in.
FILENAME = "wordchain.toml"

# One table, so the file has somewhere to grow a second one later.
_TABLE = "geometry"


def _names() -> list[str]:
    return [f.name for f in fields(Geometry)]


def _suggest(key: str) -> str:
    """Name the closest field, or all of them. A refusal should say what would work."""
    from difflib import get_close_matches

    near = get_close_matches(key, _names(), n=1, cutoff=0.6)
    if near:
        return f"; did you mean {near[0]}?"
    return "; the settings are " + ", ".join(_names())


def _number(key: str, value: object) -> float:
    # TOML writes 1 as an int and 1.0 as a float, and both mean the same
    # distance here. bool is an int subclass, and `pull = true` is a mistake.
    if isinstance(value, bool) or not isinstance(value, int | float):
        kind = type(value).__name__
        raise ConfigError(f"[{_TABLE}] {key} must be a number, not a {kind}")
    # TOML has nan and inf literals, and both survive float() into a figure
    # that draws nothing and says why nowhere.
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ConfigError(f"[{_TABLE}] {key} must be a positive number, not {value}")
    return number


def from_mapping(data: dict[str, object]) -> Geometry:
    """Build a `Geometry` from a parsed file, rejecting anything unrecognised.

    A key the tool ignores is worse than one it refuses: the figure comes back
    unchanged and the file looks like it should have changed it.
    """
    unknown = sorted(set(data) - {_TABLE})
    if unknown:
        raise ConfigError(f"unknown table: {unknown[0]}; the only one is [{_TABLE}]")

    table = data.get(_TABLE, {})
    if not isinstance(table, dict):
        raise ConfigError(f"[{_TABLE}] must be a table")

    valid = set(_names())
    values: dict[str, float] = {}
    for key, value in table.items():
        if key not in valid:
            raise ConfigError(f"[{_TABLE}] has no setting called {key}{_suggest(key)}")
        values[key] = _number(key, value)
    return Geometry(**values)


def load(path: Path) -> Geometry:
    """Read one TOML file. Every error carries the path, since a build names none."""
    # tomllib is 5 ms to import and only `build` reads a config, so it stays
    # here rather than at module load, for the same reason nltk does.
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


def resolve(explicit: str | None, root: Path | None = None) -> Geometry:
    """The geometry a command should draw with.

    A named file has to exist, because a `--config` that silently falls back to
    the defaults is a typo that costs a render to notice. The one found by
    looking does not, since the whole point is that most runs have no file.
    """
    if explicit is not None:
        return load(Path(explicit))
    found = (root or Path.cwd()) / FILENAME
    return load(found) if found.is_file() else DEFAULT
