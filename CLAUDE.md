# chain

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
  tomllib and difflib at the point of use.

## Shape

    src/wordchain/
      lexicon.py   WordNet closure, the three polysemy filters, the Word type
      graph.py     letter matrix, letter graph, word graph, trap analysis
      render.py    matplotlib figures
      web.py       pyvis pages
      palette.py   Theme tokens, the letter wheel, the font stacks
      config.py    Geometry, the TOML file, its validation
      cli.py       argparse entry point, the text report

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

## Known limits

WordNet is a lexical database, not a game word list. The filters in `lexicon.py`
cut most of the polysemy noise, and residue survives ("entire" and "royal" are
genuine WordNet animal terms). Tighten via `--min-dominance` / `--max-rank`
rather than by adding a stop-list.

## Checks

`ruff check src/`, `ruff format src/` and `mypy` must all pass before a commit.
mypy runs in strict mode over `src/wordchain`. nltk, wordfreq, pyvis and
networkx ship no type information and have no stubs in nixpkgs, so they are
declared as untyped imports in `mypy.ini` and the values crossing those
boundaries are annotated by hand — `lexicon.Synset` is the alias that names the
opaque WordNet type rather than leaving a bare `Any` at each call site.

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object.

Ruff for Python, `nix fmt` for the flake. Comments explain why a choice was
forced, not what a line does.
