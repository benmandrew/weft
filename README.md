# wordchain

`wordchain` visualises the connection graph of the word chain game. Players take turns naming words from a category, and each word must start with the letter the previous word ended on: *cat*, *tiger*, *rat*, *toad*. The tool pulls a category word list out of WordNet, builds the graph of legal moves, and renders it.

A word runs from its first letter to its last, so every word is an edge between two of 26 letters and the whole game lives on a 26-node graph however large the vocabulary gets. The word-level graph is the *line graph* of that small one, its nodes the edges of the letter graph, joined wherever one word's last letter is another's first.

A spring layout is useless here. Every word ending in A links to every word starting with A, and the resulting edge density defeats any force model, so the word view uses fixed positions instead and groups words into wedges by first letter.

## Setup

The project uses a Nix flake. `direnv allow` activates it on entering the directory, and `nix develop` gives the same shell by hand. Python and its packages (nltk, networkx, matplotlib, numpy, pyvis, wordfreq) come from nixpkgs, so there is no virtualenv, no pip, and no lockfile beyond `flake.lock`.

The shellHook puts `src/` on `PYTHONPATH` and symlinks the WordNet corpus out of the nix store, so `python -m wordchain` works from the project root and nothing is fetched over the network at runtime.

`make check` runs everything that has to pass: ruff, mypy in strict mode over `src/wordchain` and `tools`, the two checks that hold the config file and its schema together, Biome linting and formatting the browser modules and the node tools, and a `nodejs` pass that loads the browser modules as a browser would and draws a synthetic tree with them.

## Commands

```
python -m wordchain categories       # the 37 categories, with word counts
python -m wordchain stats animal     # the letter analysis
python -m wordchain words animal     # the word list with Zipf frequencies
python -m wordchain build animal     # render the word graph
```

`build` writes `out/<category>.svg` and takes `--format svg|png` (default `svg`), `--out DIR` (default `out`), `--theme light|dark`, which overrides the config file's `theme` and stands at dark with neither, and `--limit N`, the words in the disc, 110 unless the config file moves it.

The three selection commands share the filters that decide which words a category yields, among them `--min-zipf`, `--target`, `--min-dominance` and `--max-rank`, so the counts `categories` prints match what `build` would draw. `--min-zipf` stands at zero, so a category yields every word wordfreq knows and the frequency order rather than a cut decides which 110 the disc draws. `--multiword` keeps entries like *polar bear* and chains them on their outer letters, and `--no-multiword` turns them back off. Every command takes `--no-cache` and `--config FILE`.

`make -j` renders every category, one file each, so editing a module redraws all 37 and an untouched tree redraws none. `make clean` removes the output directory, `OUT=` moves it, and `CONFIG=` names a config file.

`make web-dist` gathers everything a page needs to run the disc element into one flat directory, `out/web-dist` unless `DIST=` names another: the five browser modules and the three data files they fetch. The modules are found by glob rather than listed by name, so a site that embeds the disc copies the directory instead of keeping its own list of filenames in step with this one; `index.html` stays behind, as the local harness a host page replaces with its own markup.

## Outputs

`build` writes one file, `out/<category>.svg`: the word graph in wedges by first letter, the 110 commonest words by default. The analysis is a command away, with `stats` printing it and `words` printing the list.

Scalable Vector Graphics (SVG) is the default because the disc zooms, so a label too small to read on screen is one gesture away, and `--format png` renders a raster instead. Glyphs are embedded as outlines rather than named, so the figure renders identically on a machine with none of Iowan Old Style, Avenir or Menlo installed.

## Configuration

Every command loads `./wordchain.toml` when that file exists and uses the built-in defaults otherwise, and `--config FILE` names another, which has to exist. The file is Tom's Obvious Minimal Language (TOML), with a bare `theme` key and three tables: `[geometry]` for the disc's measurements, `[palette]` for the letter colours and `[selection]` for the eight settings that decide which words a category yields and how many of them the disc draws, among them `min_zipf`, `target`, `multiword` and `limit`. All four commands read `[selection]`, so the counts `categories` prints still match what `build` draws, and a flag beats the file for one run, with `--min-zipf 2.0` overriding a file that sets it and `--no-multiword` turning off a file that switched it on. Every key is optional, and anything absent keeps its default. Each setting is documented in `schemas/wordchain.schema.json`, which the file names on its first line, so an editor explains and completes the settings as they are typed. Validation refuses rather than ignores: an unknown key or an out-of-range value stops the build, answered with the closest name from `difflib`.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, disease, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, mineral, plant, reptile, river, sport, tool, toy, tree, vegetable, vehicle, weapon.

A category can be topped up by hand. `EXTRA_WORDS` in `src/wordchain/lexicon.py` maps a category to words added on top of the WordNet closure, for the ones a lexical database misses: *grey* is a lemma of no colour synset, so the colour category offers *gray* alone until somebody writes the other spelling down.
The table ships empty. Such a word bypasses the filters, having been chosen rather than survived them, and it still carries its real wordfreq frequency, so a rare addition sorts to the tail of the list and needs a larger `--limit` to be drawn.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
