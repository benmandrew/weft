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
- `<hypernym-disc>` reads a tree as `par`, an array where every parent's index
  is below all of its children's. That ordering is the whole contract: it lets
  the element find depths, leaf counts and angles in flat loops instead of a
  traversal, so 82,115 nodes lay out in one frame. Nesting needs a tree and the
  hypernyms are a DAG, so `export_tree.py` keeps each synset's first hypernym
  and drops the other 2,313 edges; every node survives, only cross-links go.
- The layout never reads a name, so the export is two files and the element
  fetches them in that order: `wordnet-tree.json` is the structure at 129 KB
  brotli, `wordnet-names.txt` the names for the same indices at 306 KB. First
  paint waits on the smaller one and a node answers to `#index` until the
  larger arrives, which is why `start` is re-resolved when it does. Both are
  generated into `out/` and never committed. Keep them index-aligned: the names
  file is positional, with no key to catch a mismatch.
- Hit testing binary-searches the nodes at one depth by start angle, and zooming
  rescales angles rather than laying out again, so neither needs a spatial
  index. `make serve` watches `web/` and reloads the browser on save. Nothing in
  `all` depends on any of it.
- The draw path has been measured, and its choices are not obvious. Colours are
  interned into a palette once per theme and root rather than built per node per
  frame, since the string is what canvas has to parse; that alone was a fifth of
  the frame. `merge` then decides how sub-pixel wedges are drawn: `density` (the
  default) merges adjacent runs thinner than a pixel and cuts each run back up
  at pixel boundaries, `on` merges each run flat, `off` draws every node.
  Density takes 82,115 arcs to about 8,500 and the frame to a fifteenth; `on`
  reaches 6,800 and is only there for comparison. Gaps between subtrees break
  every run, so the fringe still reads as many nodes. All of it is cached on
  root, tint, radius, theme and the mode, so a repeated repaint pays nothing.
- A merged piece takes the circular mean of its members' hues, which is what
  lets a run ignore colour. Matching on colour instead left nothing to merge
  above `hue-depth` 2, since above that depth every node takes its own angle as
  its hue and no two neighbours ever share a fill, so the draw paid all 82,115
  arcs and interned 82,115 colour strings. Blending holds it at 7,823 arcs at
  every hue depth, 0 through 19, and takes the palette at hue-depth 19 to 7,329
  strings. Hue wraps, so the mean has to be a vector sum rather than an average.
  `#retint` keeps each node's hue as a cosine and a sine, so a piece costs two
  adds per member instead of trigonometry per frame. The blended hue is then
  rounded to a slice one pixel wide at the fringe, because a continuous hue
  cannot be interned; neighbouring slices differ by 0.16°, and a wedge wide
  enough to read as its own arc cannot collide with its neighbour at that step.
  Only `merge=off` fills in a per-node colour now, since the other two modes
  colour the run and filling it in would be 82,115 lookups nothing reads.
- Merging gains accuracy rather than spending it, because the rasteriser has a
  cliff. Coverage for abutting wedges falls smoothly from 0.903 at 2 px to 0.580
  at 0.25 px and then to exactly zero before 0.1 px, where every pixel comes out
  blank. A merged run's members are 0.0225 px wide at the median, far past that
  edge, so against `merge=off` merging paints 21,450 pixels that were dropped
  altogether and loses 5. Do not try to imitate the old washing-out by tinting:
  no flat alpha fits a hard zero and a partial value at once, and a sweep bottoms
  out at 0.50 for an 8% RMS gain.
- The density ramp encodes density, not coverage. Wedges tile a run exactly, so
  true coverage inside one is 100% everywhere and there is no brightness
  variation to recover. What varies is how many wedges fall in a pixel, from 1
  to 64, and value ramps over the log of that across RAMP_STEPS rungs down to
  RAMP_FLOOR. Log because a linear ramp spends its range on the sparse end, and
  quantised because that keeps the ramped colours interned rather than built per
  piece, which is the difference between 4 ms and 8.5 ms. A piece counting zero
  is a whole wedge rather than an empty one and takes the top rung, otherwise
  every wide inner arc dims to the floor.
- Do not batch the draw into one path per colour. It looks like the obvious win,
  145 fills against 82,115, and it is eight times slower: each colour's path
  holds hundreds of subpaths scattered across the whole disc, so the rasteriser
  covers the full bounding box once per colour.
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
    web/index.html                 its harness, with the render timings
    tools/export_tree.py           writes the tree and names for it
    tools/serve.py                 serves web/ and reloads it on save

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
