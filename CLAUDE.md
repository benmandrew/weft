# wordchain

Connection graphs for the word chain game: words from a category, each starting
with the letter the previous one ended on. See @README.md for usage.

## Setup

`direnv allow`, or `nix develop` by hand. Python comes from nixpkgs — no venv,
no pip, no uv. Add a dependency by editing the `pythonEnv` list in `flake.nix`.

`src/` is on `PYTHONPATH` via the shellHook, so `python -m wordchain` works from
the project root without an install step.

Anything the shell needs at load time goes in `shellHook`, and `.envrc` runs it
with `eval "$shellHook"`. nix-direnv caches `nix print-dev-env`, which defines
that variable without executing it, so a hook left to direnv alone never runs.
Keep the hook idempotent: direnv re-runs it on every load.

## Constraints

- WordNet 3.0 comes from `pkgs.wordnet`, symlinked into `.nltk_data/corpora/wordnet`
  by the shellHook. Never call `nltk.download()`; nothing may be fetched at runtime.
- Point nltk at the corpus through `NLTK_DATA` and the standard directory layout,
  not by constructing a `WordNetCorpusReader` on the store path. The reader falls
  back to the global lazy corpus when it resolves sense keys, and that fallback
  ignores its root argument.
- Generated pages must stay self-contained: no external hosts, no CDN tags.
  `web._CDN_TAG` strips the Bootstrap links pyvis emits regardless of
  `cdn_resources="in_line"`.
- `out/` is generated and gitignored. Nothing reads from it.
- Import nltk, wordfreq, networkx and matplotlib at the point of use, never at
  module load. A cache hit must not import the first three, and `stats`,
  `words` and `categories` must not import matplotlib. Moving any of these to
  the top of a file costs 100-300 ms on every invocation that does not need it.
- `.cache/wordchain` holds resolved word lists keyed on the category, the
  filter arguments and the corpus store path. Bump `lexicon._CACHE_FORMAT` when
  the stored shape changes, so stale files miss rather than mislead. Every
  command that resolves a category writes the file and every command reads it,
  so there is nothing to warm by hand and no `warm` subcommand to add.
- `lexicon._wordnet` overrides `map_wn` to skip nltk's multilingual sense-key
  mapping, which is two thirds of the corpus load and unused here. Keep the
  override; the word lists are identical with and without it.
- Wedge order is `render._fan_key`: the tail letter, rotated to start just
  before the wedge's own letter and running backwards. Plain tail-letter order
  starts every wedge at A and makes the bundle cross itself; the direction is
  opposite to the placement because two chords from one wedge avoid crossing
  when the nearer origin takes the farther destination. `web.py` sorts the same
  way.
- Edges are `Path` cubics, never sampled polylines. SVG draws cubics natively,
  so sampling costs build time, file size and accuracy at once.
- `render._hoist_shared_attributes` rewrites the saved SVG to move `style` and
  `clip-path` from path elements onto their parent group. matplotlib repeats
  them per element; hoisting is a third of the file. Verify any change to it by
  rasterising before and after and comparing pixels, not by eye.
- `build` renders one file, SVG unless `--format png`. Vector is the default
  because it writes in half the time, ships at a quarter the size gzipped, and
  zooms. Keep `svg.fonttype = "path"` in `render._typeface`: naming the fonts
  instead would silently substitute a face on any machine without Iowan Old
  Style, Avenir and Menlo.
- `build` renders the word disc and nothing else. The other views in `render.py`
  and the pages in `web.py` are library-only; do not wire them back into the
  command line without asking.
- The disc's geometry lives on `config.Geometry`, which a figure takes as an
  argument the way it takes a `Theme`, never as a module constant. It is read
  from `./wordchain.toml` or from the file `--config` names, and a named file
  must exist. Unknown keys and values that are not positive numbers are refused
  rather than ignored, since an ignored key redraws the same figure. Import
  tomllib and difflib at the point of use. `theme` is a bare key at the top of
  that file rather than a third table, because it names a ground rather than a
  group of distances, and `--theme` on the command line overrides it.
- `schemas/wordchain.schema.json` mirrors `config.py` and `palette.py` by hand,
  so every field name, default, bound, theme name and preset name is written
  twice. `tools/check_schema.py` is what stops the two drifting and `make check`
  runs it; a new or renamed setting reaches the schema in the same commit as the
  code, or the check fails. `taplo.toml` points taplo at the schema, which is
  how an editor validates the file as it is typed, and `wordchain.toml` names it
  again on its first line with `#:schema`, since an editor may never find
  `taplo.toml`. The schema also owns the per-key descriptions and
  `wordchain.toml` carries none, so a new setting is documented there and
  nowhere else.
- The Makefile's `all` renders one SVG per category and takes its parallelism
  from make's own `-j`, never from a `MAKEFLAGS` line in the file. Its target
  list comes from `wordchain categories` at parse time, so every invocation pays
  for that, `make clean` included. A config file reaches it through `CONFIG=`,
  never through a `--config` hardcoded on the recipe line: the variable is both
  the `--config` argument and the prerequisite, and hardcoding the flag as well
  passes it twice.
- The letter colours are a `palette.Wheel` of one or more `Arc`s, carried on the
  `Theme` and read from the same file's `[palette]` table. A preset name and the
  arc's numbers are mutually exclusive, because a preset may hold two arcs and
  one arc's worth of keys cannot be layered over that. Presets are tuned on the
  dark ground; `palette.with_wheel` shifts them for the light one by
  `LIGHT_SHIFT`, which is the offset already separating `LIGHT` from `DARK`, so
  the built-in wheels come out unchanged. `hue_start` and `equalise` are the two
  settings that mean something at zero.

## Shape

    src/wordchain/
      lexicon.py   WordNet closure, the three polysemy filters, the Word type
      graph.py     letter matrix, letter graph, word graph, trap analysis
      render.py    matplotlib figures
      web.py       pyvis pages
      palette.py   Theme tokens, the letter wheel, the font stacks
      config.py    Geometry, the TOML file, its validation
      cli.py       argparse entry point, the text report

    wordchain.toml                 the live config, at the defaults
    schemas/wordchain.schema.json  the same settings for an editor
    taplo.toml                     points taplo at the schema
    tools/check_schema.py          holds the schema to config.py

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

## Known limits

A Zipf of exactly zero is dropped unconditionally in `_resolve`. That is the
line between WordNet's vocabulary and its taxonomy, and it is structural rather
than a tuned threshold — keep it independent of `--min-zipf`.

The frequency cut then slides: `--min-zipf` is the preferred threshold, but a
category yielding fewer than `--target` words relaxes down its own frequency
order to `--zipf-floor`. A single absolute cut is calibrated for the common
categories and guts the rest — flower had 9 words at 3.0 and has 60 now.

WordNet is a lexical database, not a game word list. The filters in `lexicon.py`
cut most of the polysemy noise, and residue survives ("entire" and "royal" are
genuine WordNet animal terms). Tighten via `--min-dominance` / `--max-rank`
rather than by adding a stop-list.

## Checks

`make check` must pass before a commit. It runs `ruff check`, `ruff format
--check` and `mypy` over `src/` and `tools/`, then the two config-file checks:
`taplo check` validates `wordchain.toml` against the schema, which is the check
an editor runs, and `tools/check_schema.py` reads the schema back against
`config.py` and `palette.py`. mypy runs in strict mode over `src/wordchain` and
`tools`, with `mypy_path = src` because `tools/` is not part of the package.
nltk, wordfreq, pyvis and networkx ship no type information and have no stubs
in nixpkgs, so they are declared as untyped imports in `mypy.ini` and the
values crossing those boundaries are annotated by hand — `lexicon.Synset` is
the alias that names the opaque WordNet type rather than leaving a bare `Any`
at each call site.

Pylance reads `pyrightconfig.json`, which pins standard mode, Python 3.12 and
`src/` on the path, and the tree is clean under it. The pyright CLI is not in
the flake, so that check happens in the editor. Strict mode leaves 65 findings,
every one of them `reportUnknown*` or a missing stub for the four untyped
libraries; clearing those means writing stubs, not annotating this code.

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object.

Ruff for Python, `nix fmt` for the flake. Comments explain why a choice was
forced, not what a line does.
