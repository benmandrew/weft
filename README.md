# weft

`weft` draws WordNet as circular diagrams: the *hypernym* taxonomy as nested arcs, the word chain game on one category's words, and the 26-letter graph under that category. In the chain game each word starts with the letter the previous one ended on, as in *cat*, *tiger*, *rat*, *toad*. A word is therefore an edge from its first letter to its last, so the game lives on a 26-node graph whatever the size of the vocabulary.

The command line renders the word chain disc to a file. The browser draws every view as a *custom element*.

## Setup

The project uses a Nix flake. `direnv allow` activates it on entering the directory, and `nix develop` gives the same shell by hand. Python, its packages and the WordNet 3.0 corpus all come from nixpkgs, so there is no virtualenv and nothing is downloaded at runtime. `python -m weft` runs from the project root.

## Commands

```
python -m weft categories       # the 37 categories, with word counts
python -m weft stats animal     # the letter analysis
python -m weft words animal     # the word list with Zipf frequencies
python -m weft build animal     # render the word disc to out/animal.svg
```

`build` draws the category's words in wedges by first letter. Its own flags:

- `--format svg|png`, default `svg`. The SVG (Scalable Vector Graphics) file embeds its glyphs as outlines, so it renders identically without the fonts installed.
- `--out DIR`, default `out`.
- `--theme light|dark`, default dark.
- `--limit N`, the number of words drawn, commonest first: 110 by default and every word at 0. The canvas grows until adjacent labels clear each other, and past 30 inches the type shrinks instead.
- `--chrome` adds a title, caption and headline figures.

`stats` prints the letters in play, the core play can circle forever, the dead ends and the worst traps.

All four commands share the filters that decide which words a category yields, among them `--min-zipf`, `--target`, `--min-dominance` and `--max-rank`; `--help` describes each. `--multiword` keeps entries such as *polar bear*, chained on their outer letters. Every command also takes `--config FILE` and `--no-cache`.

## Configuration

Every command reads `./weft.toml` when it exists, or the file `--config` names. The file is TOML (Tom's Obvious Minimal Language) with a bare `theme` key and three tables: `[geometry]` for the disc's measurements, `[palette]` for the letter colours and `[selection]` for the filters and `limit`. Every key is optional, and a command-line flag beats the file for one run, so `--no-multiword` turns off a file's `multiword = true`. An unknown key or an out-of-range value stops the command with the closest valid name. `schemas/weft.schema.json` documents every setting, and `weft.toml` names it on its first line so an editor completes keys.

## Make targets

- `make check` runs the linters, type checkers and tests for the Python and JavaScript alike.
- `make -j` renders one SVG per category. `OUT=` moves the output directory, `CONFIG=` names a config file, and `make clean` removes the output.
- `make words`, `make tree` and `make table` write the data the browser elements read: a JSON (JavaScript Object Notation) file per category with an index, the hypernym tree with its names and glosses, and the word table the `tree` attribute below derives words from.
- `make serve` serves the harnesses and reloads on save: `/` for the hypernym disc, `/words.html`, `/letters.html`, `/balance.html`, and `/embed.html` for every element on one page.
- `make web-dist` gathers the modules, the data, `embed.html` and a `preload.json` mapping each element to the modules it imports into one flat directory, `out/web-dist` unless `DIST=` names another. Copy it whole and serve it from anywhere.

## Browser elements

Each element is one JavaScript module in `web/`, and the comment at the top of its file lists its attributes, properties, events and styling properties.

`<word-disc>`, `<letter-disc>` and `<balance-flow>` read a `words-<category>.json` named by `src`, so a page carrying all three fetches one file. Three attributes shared by those elements change the category:

- `index-src`, naming `words-index.json`, adds a category picker.
- `tree`, naming a `<hypernym-disc>` by id, adds the node that disc is on to the picker, with its words derived in the page from `wordnet-words.json`.
- `group` makes every element sharing its value change category together.

### `<word-disc>`

The playable form of `build`'s disc. It draws every word in the file unless `limit` caps the count.

Clicking a word lights the words that can follow it, which is one whole wedge, since the words that follow *cat* are those starting with T. Clicking one of those carries the chain on. Pointing at a word draws its *fan* of chords to its followers, which holds still as the pointer moves inwards, so a chord can be followed and clicked. A search box reaches a word by name, and a wide window adds a column of every legal move. A word already played is not a move.

The line under the disc is the chain so far. Clicking a step winds play back to it, clicking the category clears the chain, and clicking the empty centre takes one step back. The line above names the current word and counts its replies, and prices perfect play: the longest chain at rest, how far it still runs from the current word, and what a move under the pointer would leave. `hint="off"` drops those figures and the solve behind them.

### `<word-run>`

`<word-run for="disc">` follows the `<word-disc>` with that id and prints the chain played so far in the accent colour, then the longest continuation over the words left. A long run shows `ends` words at each end, 4 by default, with a count of the hidden ones between.

### `<letter-disc>`

The 26 letters sit round a ring with an arc for every letter pair some word bridges, as wide as the logarithm of its word count. Each letter's slot is split into the half words leave from and the half they arrive at, so an arc reads as directed. Pointing at an arc or a letter lights it and names its words under the disc. Two selects under the disc reach the same by keyboard, and a tap pins an arc on a touch screen.

### `<balance-flow>`

It animates the min-cost *transshipment* inside the longest-chain solve, which finds the fewest words to discard so that every letter has as many words leaving it as arriving. Surplus letters bank down the left column and deficit letters down the right, and each step of the solve is a band between them, as wide as the words it discards. A leg running right to left recovers a word an earlier step discarded, and the slider marks each such step. The transport has first, previous, play, next and last buttons and a slider to scrub; it opens at the balanced end.

### `<hypernym-disc>`

The nested-arc view of all 82,115 noun *synsets*, each drawn inside the synset it is a kind of. Clicking a synset zooms to it, and a search box finds one by name. It reads the three files `make tree` writes.

### Embedding

`embed.html` holds one self-contained section per element, each with its own script, attributes and height, so any one lifts out alone. It asks for its data beside itself, which is the layout `web-dist` produces, and one category control sets `src` on whichever category elements it finds.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, disease, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, mineral, plant, reptile, river, sport, tool, toy, tree, vegetable, vehicle, weapon.

`EXTRA_WORDS` in `src/weft/lexicon.py` tops a category up by hand with words WordNet misses, such as *arabidopsis* in plant.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
