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

## Shape

    src/wordchain/
      lexicon.py   WordNet closure, the three polysemy filters, the Word type
      graph.py     letter matrix, letter graph, word graph, trap analysis
      render.py    matplotlib figures
      web.py       pyvis pages
      palette.py   one colour per letter, shared by render and web
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

## Style

Ruff for Python, `nix fmt` for the flake. Comments explain why a choice was
forced, not what a line does.
