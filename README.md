# weft

`weft` draws WordNet as circular diagrams: the *hypernym* taxonomy as nested arcs, the word chain game on one category's word list, and the 26-letter graph under that category as a chord diagram. In the chain game each word starts with the letter the previous one ended on, as in *cat*, *tiger*, *rat*, *toad*. A word is therefore an edge from its first letter to its last, so the game lives on a 26-node graph whatever the size of the vocabulary.

The command line renders the word chain disc to a file, and the browser draws all three as *custom elements*.

## Setup

The project uses a Nix flake. `direnv allow` activates it on entering the directory, and `nix develop` gives the same shell by hand. Python, its packages and the WordNet corpus all come from nixpkgs, so there is no virtualenv, no pip and no download at runtime, and `python -m weft` runs from the project root.

## Commands

```
python -m weft categories       # the 37 categories, with word counts
python -m weft stats animal     # the letter analysis and the longest chain
python -m weft words animal     # the word list with Zipf frequencies
python -m weft build animal     # render the word disc to out/animal.svg
```

`build` writes `out/<category>.svg`, the words in wedges by first letter. Its flags:

- `--format svg|png`, default `svg`. Scalable Vector Graphics (SVG) zooms, and its glyphs are embedded as outlines, so it renders identically without the fonts installed.
- `--out DIR`, default `out`.
- `--theme light|dark`, overriding the config file's `theme`, and dark when neither sets it.
- `--limit N`, the words drawn: the 110 commonest by default, every word at 0. The canvas grows until adjacent labels clear each other, and past 30 inches the type shrinks instead.

`stats` prints the longest chain the category allows and says whether it is provably the longest. `--opening WORD` pins its first word, matched lowercased. A word the category lacks is refused with the nearest word it has, or with a pointer at `weft words <category>` when nothing is near.

All four commands share the filters that decide which words a category yields, among them `--min-zipf`, `--target`, `--min-dominance` and `--max-rank`. `--multiword` keeps entries such as *polar bear*, chained on their outer letters. Every command takes `--no-cache` and `--config FILE`, and a flag beats the config file for one run, so `--no-multiword` turns off a file that switched it on.

## Configuration

Every command loads `./weft.toml` when it exists, or the file `--config` names, which must exist. The file is Tom's Obvious Minimal Language (TOML), with a bare `theme` key and three tables. `[geometry]` holds the disc's measurements, `[palette]` the letter colours, and `[selection]` the eight settings that decide which words a category yields and how many the disc draws. Every key is optional. `schemas/weft.schema.json` documents each setting, and the file names it on its first line so an editor completes keys as they are typed. An unknown key or an out-of-range value stops the command, which suggests the closest valid name.

## Make targets

- `make check` runs the linters, type checkers and tests for the Python and the browser modules alike, and must pass before a commit.
- `make -j` renders every category, one SVG each. `OUT=` moves the output directory, `CONFIG=` names a config file, and `make clean` removes the output.
- `make words` writes one JavaScript Object Notation (JSON) file per category for the browser elements.
- `make serve` serves the harnesses and reloads on save. `/` is the nested-arc view, `/words.html` the word chain, `/letters.html` the letter graph, `/balance.html` the balancing flow, and `/embed.html` all four.
- `make web-dist` gathers the modules, the exported WordNet tree, the category files and `embed.html` into one flat directory, `out/web-dist` unless `DIST=` names another, which can be copied whole and served from anywhere.

## Browser elements

`<word-disc>`, `<letter-disc>` and `<balance-flow>` each read one `words-<category>.json`, named by `src`, so a page carrying all three fetches one file. An `index-src` naming the category index adds a category picker.

### `<word-disc>`

The playable form of `build`'s disc, drawing every word in the file unless a `limit` attribute caps the count.

Clicking a word lights the words that can follow it, one whole wedge, since the words that follow *cat* are those starting with T. Clicking one of those carries the chain on. Pointing at a word draws its *fan* of chords to those followers, which holds still as the pointer moves inwards, so a chord can be followed and clicked. A search box reaches a word by name, and a wide window adds a column listing every legal move.

The line under the disc is the chain so far, and clicking a step winds play back to it. Clicking the category label clears the chain, which is how to open on a different first word. Clicking the empty centre takes one step back. A word already played is not a move and keeps a warning colour.

The line above the chain names the current word, marks its last letter and counts the replies. It also prices perfect play: the category's longest chain at rest, how far perfect play still runs from the current word, and what a move under the pointer would leave. `hint="off"` turns those figures off, and the solve behind them.

### `<word-run>`

`<word-run for="disc">` follows the `<word-disc>` with that id and prints its chain, the played words in the accent colour and then the longest continuation over the words left. A long run keeps its first four and last four words, with the count of hidden ones between them. It fetches nothing, reading the words off its disc.

### `<letter-disc>`

The letters sit round a ring with an arc for every letter pair some word bridges, each as wide as the logarithm of its word count. Each letter's slot is split into the half words leave from and the half they arrive at, so an arc reads as directed.

Pointing at an arc lights it, pointing at a letter lights every arc touching it, and the line under the disc names the words on the arc. Clicking an arc drills into the letter it leaves; clicking a letter does nothing. Clicking the middle goes back out. It takes `src` and `index-src`.

### `<balance-flow>`

It animates the min-cost *transshipment* inside the longest-chain solve, which finds the fewest words to discard so that every letter has as many words leaving it as arriving. Surplus letters bank down the left column and deficit letters down the right, and each step of the solve is a band between them, as wide as the words it discards.

The transport has first, previous, play, next and last buttons and a slider to scrub. It opens at the balanced end, and play rewinds first from there. The line under the picture names the current step, which is drawn through the letters its path turned on, each labelled. A leg running right to left recovers a word an earlier step discarded, and the slider marks each such step. It takes `src` and `index-src`, and ignores the pointer.

### `<hypernym-disc>`

The nested-arc view at `/`, each *synset* drawn inside the synset it is a kind of. `make web-dist` stages the tree it reads.

### Embedding

`embed.html` holds one self-contained section per element, each with its own script, attributes and height, so one lifts out alone. It asks for its data beside itself, and one category control sets `src` on the three elements that read a category file.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, disease, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, mineral, plant, reptile, river, sport, tool, toy, tree, vegetable, vehicle, weapon.

`EXTRA_WORDS` in `src/weft/lexicon.py` tops a category up by hand with words WordNet misses, such as *grey*, and ships empty.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
