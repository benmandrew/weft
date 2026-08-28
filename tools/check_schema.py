"""Check that `schemas/wordchain.schema.json` still says what `config.py` does.

The schema exists so an editor can validate `wordchain.toml` and complete its
settings, which means it repeats every field name, default, bound and preset
name that `config.py` and `palette.py` already own. A repeated fact drifts, and
a schema that has drifted is worse than none: it accepts a key the tool refuses,
or flags one the tool takes. This walks the two side by side and names every
disagreement rather than stopping at the first, so one run fixes the lot.

Run it with `make check`, or `python tools/check_schema.py`.
"""

from __future__ import annotations

import json
import sys
from dataclasses import fields
from pathlib import Path
from typing import Any

# The private names are the point: the schema repeats what they hold.
from wordchain.config import _TOP, _ZERO_OK, Geometry
from wordchain.palette import DARK, PRESETS, THEMES, Arc

SCHEMA = Path(__file__).resolve().parent.parent / "schemas" / "wordchain.schema.json"

Table = dict[str, Any]


class Report:
    """Every disagreement found, in the order they were looked for."""

    def __init__(self) -> None:
        self.problems: list[str] = []

    def fail(self, message: str) -> None:
        self.problems.append(message)

    def check(self, ok: bool, message: str) -> None:
        if not ok:
            self.fail(message)

    def same(self, where: str, found: object, wanted: object) -> None:
        self.check(found == wanted, f"{where}: schema has {found!r}, code has {wanted!r}")


def _defaults(kind: type) -> dict[str, Any]:
    return {f.name: f.default for f in fields(kind)}


def _properties(report: Report, where: str, table: Table, wanted: set[str]) -> Table:
    """The property block, once its keys are known to be the code's own."""
    found: Table = table.get("properties", {})
    for name in sorted(wanted - set(found)):
        report.fail(f"{where}: the code has {name} and the schema does not")
    for name in sorted(set(found) - wanted):
        report.fail(f"{where}: the schema has {name} and the code does not")
    report.check(
        table.get("additionalProperties") is False,
        f"{where}: additionalProperties has to be false, or a typo passes validation",
    )
    for name, prop in sorted(found.items()):
        report.check(bool(prop.get("description")), f"{where} {name}: no description")
    return found


def _bounds(report: Report, where: str, prop: Table, zero_ok: bool, ceiling: float | None) -> None:
    """A setting refused at zero carries `exclusiveMinimum`, one allowed there `minimum`."""
    low, other = ("minimum", "exclusiveMinimum") if zero_ok else ("exclusiveMinimum", "minimum")
    report.same(f"{where} {low}", prop.get(low), 0)
    report.check(other not in prop, f"{where}: has {other} as well as {low}")
    report.same(f"{where} maximum", prop.get("maximum"), ceiling)
    report.same(f"{where} type", prop.get("type"), "number")


def _geometry(report: Report, table: Table) -> None:
    wanted = _defaults(Geometry)
    props = _properties(report, "[geometry]", table, set(wanted))
    for name, default in wanted.items():
        prop = props.get(name)
        if prop is None:
            continue
        report.same(f"[geometry] {name} default", prop.get("default"), default)
        # Every distance is refused at zero and has no ceiling; a label size or a
        # canvas limit is measured in points and inches, not in fractions.
        _bounds(report, f"[geometry] {name}", prop, zero_ok=False, ceiling=None)


def _palette(report: Report, table: Table) -> None:
    wanted = _defaults(Arc)
    props = _properties(report, "[palette]", table, set(wanted) | {"preset"})

    preset = props.get("preset", {})
    report.same("[palette] preset", preset.get("enum"), sorted(PRESETS))
    docs = preset.get("x-taplo", {}).get("docs", {}).get("enumValues", [])
    report.check(
        len(docs) == len(PRESETS),
        f"[palette] preset: {len(docs)} enumValues for {len(PRESETS)} presets",
    )

    for name, default in wanted.items():
        prop = props.get(name)
        if prop is None:
            continue
        report.same(f"[palette] {name} default", prop.get("default"), default)
        _bounds(report, f"[palette] {name}", prop, name in _ZERO_OK, ceiling=1)

    # A preset and the arc's own numbers are mutually exclusive, which the schema
    # spells out as one `if` that forbids each arc key in turn. Forbidding the
    # key rather than negating the whole table is what makes taplo point at the
    # offending line instead of printing the clause back at you.
    excluded: set[str] = set()
    for rule in table.get("allOf", []):
        report.same("[palette] exclusion if", rule.get("if", {}).get("required"), ["preset"])
        for name, allowed in rule.get("then", {}).get("properties", {}).items():
            report.check(allowed is False, f"[palette] exclusion: {name} is not forbidden")
            excluded.add(name)
    report.same("[palette] exclusion", sorted(excluded), sorted(wanted))


def _theme(report: Report, prop: Table) -> None:
    report.same("theme", prop.get("enum"), sorted(THEMES))
    report.same("theme default", prop.get("default"), DARK.name)


def main() -> int:
    report = Report()
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    props = _properties(report, "the file", schema, set(_TOP))

    if "geometry" in props:
        _geometry(report, props["geometry"])
    if "palette" in props:
        _palette(report, props["palette"])
    if "theme" in props:
        _theme(report, props["theme"])

    if report.problems:
        print(f"{SCHEMA.name} has drifted from config.py:", file=sys.stderr)
        for problem in report.problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"{SCHEMA.name} matches config.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
