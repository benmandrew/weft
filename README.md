# weft

`weft` draws WordNet as circular diagrams. Three of them sit on the one corpus. The first is the *hypernym* taxonomy, every synset nested inside the synset it is a kind of, 82,115 of them as nested arcs. The second is the word chain game on a category's word list, where each word starts with the letter the previous one ended on: *cat*, *tiger*, *rat*, *toad*. The third is the 26-letter graph under that same category, drawn as a chord diagram.

The word chain disc is the one the command line renders, to `out/<category>.svg`, and all three are drawn in the browser. The name is the *weft*, the thread a weaver crosses through the warp, which is what a disc full of chords looks like.

A word runs from its first letter to its last, so every word is an edge between two of 26 letters and the whole game lives on a 26-node graph however large the vocabulary gets. The word-level graph is the *line graph* of that small one, its nodes the edges of the letter graph, joined wherever one word's last letter is another's first.

A spring layout is useless here. Every word ending in A links to every word starting with A, and the resulting edge density defeats any force model, so the word view uses fixed positions instead and groups words into wedges by first letter.

## Setup

The project uses a Nix flake. `direnv allow` activates it on entering the directory, and `nix develop` gives the same shell by hand. Python and its packages (nltk, networkx, matplotlib, numpy, pyvis, wordfreq) come from nixpkgs, so there is no virtualenv, no pip, and no lockfile beyond `flake.lock`.

The shellHook puts `src/` on `PYTHONPATH` and symlinks the WordNet corpus out of the nix store, so `python -m weft` works from the project root and nothing is fetched over the network at runtime.

`make check` runs everything that has to pass: ruff, mypy in strict mode over `src/weft` and `tools`, the two checks that hold the config file and its schema together, Biome linting and formatting the browser modules and the node tools, a `nodejs` pass that loads the browser modules as a browser would and draws a synthetic tree with them, and TypeScript reading the JSDoc types the browser modules carry, which compiles nothing and emits nothing.

## Commands

```
python -m weft categories       # the 37 categories, with word counts
python -m weft stats animal     # the letter analysis
python -m weft words animal     # the word list with Zipf frequencies
python -m weft build animal     # render the word graph
```

`build` writes `out/<category>.svg` and takes `--format svg|png` (default `svg`), `--out DIR` (default `out`), `--theme light|dark`, which overrides the config file's `theme` and stands at dark with neither, and `--limit N`, the words in the disc, 110 unless the config file moves it, or 0 for every word the category has. The label size is solved rather than set: the canvas grows until adjacent labels clear each other, and past the 30 inches it is capped at the type shrinks instead.

`stats` takes one flag of its own, `--opening WORD`, which pins the chain it reports to a first word. The longest chain section below is what that changes.

All four commands share the filters that decide which words a category yields, among them `--min-zipf`, `--target`, `--min-dominance`, `--max-rank` and `--multiword`, which keeps entries like *polar bear* and chains them on their outer letters. A flag beats the config file for one run, so `--no-multiword` turns off a file that switched it on. Every command takes `--no-cache` and `--config FILE`.

`make -j` renders every category, one file each. `make clean` removes the output directory, `OUT=` moves it, and `CONFIG=` names a config file.

`make web-dist` gathers everything a page needs to run any of the three browser elements into one flat directory, `out/web-dist` unless `DIST=` names another: the modules, the exported WordNet tree, one file per category, and `embed.html`, a page holding one section per disc that asks for its data beside itself. The directory can be copied whole and served from anywhere, and each section carries its own script, settings and height, so one can be lifted out without the others.

## Outputs

`build` writes one file, `out/<category>.svg`: the word graph in wedges by first letter, the 110 commonest words by default. `stats` prints the letter analysis and `words` prints the list.

Scalable Vector Graphics (SVG) is the default because the disc zooms, so a label too small to read on screen is one gesture away, and `--format png` renders a raster instead. Glyphs are embedded as outlines rather than named, so the figure renders identically on a machine with none of Iowan Old Style, Avenir or Menlo installed.

## Playing it in the browser

The rendered disc shows every legal move at once, and `<word-disc>`, a *custom element*, makes those moves playable. Picking a word lights up every word that can follow it, one whole wedge of the disc, since the words that can follow *cat* are exactly the words starting with T. Picking one of those carries the chain on, and the line under the disc is the chain so far, each step clickable to wind play back to it. The category is printed beside the chain as a label, and clicking it winds play all the way back, which is how you open on a different first word.

The centre of the disc names whatever the pointer is on, and clicking it takes one step back. A search box reaches a word by name. The line above the chain names the current word with its last letter marked, since that letter is what the next word must start with, and counts the words that could follow it, or says that none can, which is the end of the round. A word already played is not a move, and keeps a warning colour wherever it appears.

The element takes one category file and draws every word in it, with a `limit` attribute to cap that at a count, where `build` draws 110. Every chord the printed figure draws sits under the playable disc at any word count. A page that also names an index of the categories gets a picker above the search box and changes category itself; `/words.html` under `make serve` is where to try it. A page embedding a single category names one file and gets no picker, which is what `/embed.html` does.

Where the window is wide enough for a column beside the disc, every word that could be played next is listed there in alphabetical order, and clicking one plays it. The search suggestions take that column while you are typing.

`make words` writes the data the element reads, one JavaScript Object Notation (JSON) file per category. `make serve` serves the harnesses with a watcher that reloads on save: `/` is the nested-arc view of WordNet, `/words.html` the word chain, `/letters.html` the letter graph, and `/embed.html` all three.

## The letter graph itself

Every word is an edge between two letters, so under a category's word list sits a graph of 26 nodes and the letter pairs some word bridges. `<letter-disc>` draws that one: the letters around a ring, an arc for every populated pair, and each arc as wide as the logarithm of the words on it, so a pair spanned by a single word is still visible beside the busiest pair in the category.

Each letter's place on the ring is split in two, the half words leave from and the half they arrive at, so an arc runs from the bright side of one letter to the dim side of another and reads as directed without an arrowhead. A letter's share of the ring is its share of the traffic, so an arc's width means the same number of words wherever on the figure it is read, and the split point says whether a letter is somewhere play sets out from or somewhere it arrives.

Pointing at an arc lights it and dims everything else, and pointing at a letter lights every arc touching it. The line under the disc names the words on the arc rather than counting them, which is where this disc and the playable one meet. Clicking a letter drills into it, and clicking an arc drills into the letter it leaves, since that is the letter play sets out from; the middle then names that letter, and clicking the middle goes back out to every arc the category has.

It reads the same category file `<word-disc>` reads, so a page carrying both fetches one file for the pair, and naming an index gives it the same picker. `/letters.html` under `make serve` is where to try it.

## The longest chain

A round ends when the current word's last letter starts nothing that is still unplayed, so the question a category invites is how far play can run when every word is chosen perfectly and none is repeated. `weft` answers that exactly. animal chains 640 of its 1,582 words, and for 32 of the 37 categories the answer arrives with a proof that no longer chain exists.

Nothing here searches for that chain. With words as vertices the question is the longest path through a graph of 1,582 nodes and 96,470 edges, for which no efficient exact algorithm is known. With letters as vertices it turns small: a word is an arc from its first letter to its last, so a chain is a *trail*, an arc-disjoint walk on 26 vertices, and keeping as many words as possible is discarding as few as possible.

Discarding as few as possible is a min-cost *transshipment* on those 26 nodes, the supply at each letter being its outgoing words minus its incoming, the capacities the word counts and the cost one per word dropped. Every cost is non-negative and the constraint matrix is *totally unimodular*, so the answer comes back whole-numbered with no integer solver anywhere. Words sharing a letter pair are interchangeable, so they aggregate into one arc of capacity n rather than n arcs of capacity one.

A chain has an opening and an ending, and moving one unit of supply at each end is the whole of what separates it from a closed circuit, so its cost is the balanced answer plus the shortest residual path from the ending letter back to the opening one. 26 runs of Dijkstra's algorithm price all 676 openings and endings off a single balanced solve, with a 677th candidate for the circuit that opens and ends on the same letter.

What the relaxation ignores is whether the arcs it keeps form one connected run, so what it returns is an upper bound. A *union-find* pass settles that. Where the kept arcs are connected the bound is attained and the chain is provably the longest there is; where they are not, the largest component is kept and the rest is solved again at full capacity, and the gap is reported rather than hidden.

Five categories finish with a gap: fabric chains 61 words against a bound of 63, furniture 9 against 10, instrument 10 against 11, mineral 18 against 19, and river 64 against 65. Exhaustive search over the letter multidigraph proves furniture's 9, instrument's 10 and mineral's 18 are the true maxima, so in those three the bound is loose by one rather than the chain being short.

`python -m weft stats <category>` prints the chain with its verdict: `longest chain: 640 words, crab … ungulate — provably the longest there is` for animal, and `longest chain: 9 words, crib … rolodex — against an upper bound of 10 nothing reached` for furniture.

The same machinery answers a narrower question, and it is the one a player actually has. Nobody stands at the start of a category; they stand on a word, with a letter already fixed, wanting to know how far play can still run from there. That is the whole-category question with one letter pinned. Spend the opening word, solve from the letter it ends on, and put the word back on the front of whatever comes back, so the count and the bound both cover the chain including that word.

`python -m weft stats <category> --opening WORD` asks it, and the flag sits on that command alone, the other three printing no chain. The word is matched lowercased, so `--opening CRIB` works, and the report takes it into the heading: furniture's line above becomes `longest chain from crib: 9 words, crib … rolodex — against an upper bound of 10 nothing reached`, where `--opening desk` reads `longest chain from desk: 1 word, desk — provably the longest there is`. A word the category does not yield is refused, answered with the nearest word `difflib` finds, or with the category's word count and a pointer at `weft words <category>` when nothing is near. Reporting the unpinned chain under a pinned heading would be a wrong answer printed confidently.

Every candidate opening on another letter is dropped before the scan. The closed circuit is the one candidate a fixed letter cannot rule out, since a closed walk can be rotated to begin on any letter it touches, so it stands or falls on whether it touches this one. The bound is then computed over the candidates that survive, which is what lets a chain forced through a poor opening still report whether it is the longest that opening allows.

Certification is harder to come by under a constraint. Across 2,189 constrained solves over the 37 categories, 75% came back certified, where 32 of the 37 categories certify when the opening is free. A forced opening can strand play in a small component, and the relaxation's bound goes loose there where the free one did not. furniture shows all three outcomes on a category whose overall best is 9 words: opening on *crib* still reaches 9, opening on *bookcase* reaches 2 against a bound of 5 that nothing attains, and opening on *bunk* reaches 1 and is certified, since no word in the category starts with K. A missing certificate says less than it sounds like it does: mineral certifies on 1% of its openings, and exhaustive search over 60 of them found the solver's chain optimal in 59.

The solver is written twice, in `src/weft/graph.py` and in `web/word-longest.js`, held to one another by seventeen frozen cases in `tools/chains.json`. The two produce byte-identical chains on all 37 categories, Python taking 8 ms on the largest category and JavaScript 0.8 ms. Constrained, they disagreed on none of those 2,189 solves and produced no illegal chain, and a further 2,314 solves on random word lists were checked against exhaustive search, all of them reaching the true optimum. The browser module draws nothing yet, since no element on any page reads it.

## Configuration

Every command loads `./weft.toml` when that file exists and uses the built-in defaults otherwise, and `--config FILE` names another, which has to exist. The file is Tom's Obvious Minimal Language (TOML), with a bare `theme` key and three tables: `[geometry]` for the disc's measurements, `[palette]` for the letter colours and `[selection]` for the eight settings that decide which words a category yields and how many of them the disc draws. Every key is optional, anything absent keeps its default, and a flag beats the file for one run. Each setting is documented in `schemas/weft.schema.json`, which the file names on its first line, so an editor explains and completes the settings as they are typed. Validation refuses rather than ignores: an unknown key or an out-of-range value stops the build, answered with the closest name from `difflib`.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, disease, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, mineral, plant, reptile, river, sport, tool, toy, tree, vegetable, vehicle, weapon.

A category can be topped up by hand. `EXTRA_WORDS` in `src/weft/lexicon.py` maps a category to words added on top of the WordNet closure, for the ones a lexical database misses: *grey* is a lemma of no colour synset, so the colour category offers *gray* alone until somebody writes the other spelling down. The table ships empty. Such a word bypasses the filters, having been chosen rather than survived them, and it carries its real wordfreq frequency, so a rare addition sorts to the tail of the list and needs a larger `--limit` to be drawn.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
