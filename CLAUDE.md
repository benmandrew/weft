# wordchain

Connection graphs for the word chain game: words from a category, each starting
with the letter the previous one ended on. See @README.md for usage.

## Setup

`direnv allow`, or `nix develop` by hand. Python comes from nixpkgs — no venv,
no pip, no uv. Add a dependency to the `pythonEnv` list in `flake.nix`. `src/`
is on `PYTHONPATH` via the shellHook, so `python -m wordchain` runs from the
project root with no install step.

Anything the shell needs at load time goes in `shellHook`, which `.envrc` runs
with `eval "$shellHook"`: nix-direnv caches `nix print-dev-env`, which defines
that variable without executing it, so a hook left to direnv alone never runs.
Keep the hook idempotent, since direnv re-runs it on every load.

## Constraints

- WordNet 3.0 is `pkgs.wordnet`, symlinked into `.nltk_data/corpora/wordnet` by
  the shellHook. Never call `nltk.download()`; nothing may be fetched at
  runtime. Reach the corpus through `NLTK_DATA` and the standard directory
  layout, never a `WordNetCorpusReader` built on the store path: the reader
  falls back to the global lazy corpus for sense keys, ignoring its root.
- Keep `lexicon._wordnet`'s `map_wn` override, which skips nltk's multilingual
  sense-key mapping — two thirds of the corpus load, unused here, and the word
  lists are identical without it.
- Generated pages stay self-contained: no external hosts, no CDN tags.
  `web._CDN_TAG` strips the Bootstrap links pyvis emits regardless of
  `cdn_resources="in_line"`.
- `out/` is generated and gitignored; nothing reads from it.
- Import nltk, wordfreq, networkx, matplotlib, tomllib and difflib at the point
  of use, never at module load: a top-of-file import costs 100-300 ms on every
  invocation that does not need it. A cache hit must not import the first three,
  and `stats`, `words` and `categories` must not import matplotlib.
- `.cache/wordchain` keys resolved word lists on the category, the filter
  arguments and the corpus store path. Bump `lexicon._CACHE_FORMAT` when the
  stored shape changes, so stale files miss rather than mislead. Every command
  reads and writes it, so there is nothing to warm by hand and no `warm`
  subcommand to add.
- Wedge order is `render._fan_key`, and `web.py` sorts the same way: the tail
  letter, rotated to start just before the wedge's own letter, running
  backwards. Plain tail-letter order starts every wedge at A and makes the
  bundle cross itself; the direction is opposite to the placement because two
  chords from one wedge avoid crossing when the nearer origin takes the farther
  destination.
- Edges are `Path` cubics, never sampled polylines: SVG draws cubics natively,
  so sampling costs build time, file size and accuracy at once.
- `render._hoist_shared_attributes` moves `style` and `clip-path` off path
  elements onto their group in the saved SVG, because matplotlib repeats them
  per element and hoisting is a third of the file. Verify any change to it by
  rasterising before and after and comparing pixels, not by eye.
- `build` renders one file and one view, the word disc, SVG unless `--format
  png`: vector writes in half the time, ships at a quarter the size gzipped, and
  zooms. The other views in `render.py` and the pages in `web.py` are
  library-only; do not wire them back into the command line without asking. Keep
  `svg.fonttype = "path"` in `render._typeface`, since naming the fonts would
  silently substitute a face on any machine without Iowan Old Style, Avenir and
  Menlo.
- Geometry lives on `config.Geometry` and the letter colours on a
  `palette.Wheel` of one or more `Arc`s carried by the `Theme`; a figure takes
  each as an argument, never as a module constant. The config file is
  `./wordchain.toml` or the file `--config` names, which must exist. `theme` is
  a bare key at the top rather than a third table, because it names a ground
  rather than a group of distances, and `--theme` overrides it.
- Unknown keys and values that are not positive numbers are refused, never
  ignored, since an ignored key redraws the same figure; `hue_start` and
  `equalise` are the two settings that mean something at zero. In `[palette]` a
  preset name and the arc's numbers are mutually exclusive, because a preset may
  hold two arcs and one arc's worth of keys cannot be layered over that. Presets
  are tuned on the dark ground, and `palette.with_wheel` shifts them for the
  light one by `LIGHT_SHIFT`, the offset already separating `LIGHT` from `DARK`,
  so the built-in wheels come out unchanged.
- `schemas/wordchain.schema.json` mirrors `config.py` and `palette.py` by hand —
  every field name, default, bound, theme name and preset name written twice —
  and `tools/check_schema.py` under `make check` is what stops the two drifting:
  a new or renamed setting reaches the schema in the same commit as the code, or
  the check fails. `taplo.toml` points taplo at the schema, which is how an
  editor validates the file as it is typed, and `wordchain.toml` names it again
  on its first line with `#:schema`, since an editor may never find
  `taplo.toml`. The schema owns the per-key descriptions and `wordchain.toml`
  carries none, so a new setting is documented there and nowhere else.
- `<hypernym-disc>` reads a tree as `{names, par}` with every parent's index
  below its children's. That ordering is the whole contract: it lets the element
  find depths, leaf counts and angles in flat loops instead of a traversal, so
  82,115 nodes lay out in one frame. Nesting needs a tree and the hypernyms are
  a DAG, so `export_tree.py` keeps each synset's first hypernym and drops the
  other 2,313 edges; every node survives, only cross-links go. The file is
  generated into `out/` and never committed. Hit testing binary-searches the
  nodes at one depth by start angle, and zooming rescales angles rather than
  laying out again, so neither needs a spatial index. Nothing in `all` depends
  on any of it.
- The Makefile's `all` renders one SVG per category and takes its parallelism
  from make's own `-j`, never from a `MAKEFLAGS` line in the file. Its target
  list comes from `wordchain categories` at parse time, so every invocation pays
  for that, `make clean` included. A config file reaches it through `CONFIG=`,
  never a `--config` hardcoded on the recipe line: the variable is both the
  argument and the prerequisite, and hardcoding the flag passes it twice.

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

    web/hypernym-disc.js           the nested-arc element, no dependencies
    tools/export_tree.py           writes out/wordnet-tree.json for it

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

## Known limits

A Zipf of exactly zero is dropped unconditionally in `_resolve`, as the line
between WordNet's vocabulary and its taxonomy. That is structural rather than a
tuned threshold — keep it independent of `--min-zipf`.

The frequency cut then slides: a category yielding fewer than `--target` words
relaxes from `--min-zipf` down its own frequency order to `--zipf-floor`. One
absolute cut is calibrated for the common categories and guts the rest — flower
had 9 words at 3.0 and has 60 now.

WordNet is a lexical database, not a game word list, so residue survives the
filters in `lexicon.py` ("entire" and "royal" are genuine WordNet animal terms).
Tighten via `--min-dominance` / `--max-rank`, not by adding a stop-list.

## Checks

`make check` must pass before a commit: `ruff check`, `ruff format --check` and
`mypy` over `src/` and `tools/`, then `taplo check`, which validates
`wordchain.toml` against the schema as an editor would, and
`tools/check_schema.py`, which reads the schema back against `config.py` and
`palette.py`. mypy is strict over `src/wordchain` and `tools`, with `mypy_path =
src` because `tools/` is not part of the package. nltk, wordfreq, pyvis and
networkx ship no type information and have no stubs in nixpkgs, so `mypy.ini`
declares them untyped and the values crossing those boundaries are annotated by
hand — `lexicon.Synset` names the opaque WordNet type rather than leaving a bare
`Any` at each call site.

Pylance reads `pyrightconfig.json`, which pins standard mode, Python 3.12 and
`src/` on the path, and the tree is clean under it; the pyright CLI is not in
the flake, so that check happens in the editor. Strict mode leaves 65 findings,
every one a `reportUnknown*` or a missing stub for those four libraries, and
clearing them means writing stubs rather than annotating this code.

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object. Ruff for Python, `nix
fmt` for the flake. Comments explain why a choice was forced, not what a line
does.
