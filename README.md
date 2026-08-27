# chain

`chain` visualises the connection graph of the word chain game. Players take turns naming words from a category, and each word must start with the letter the previous word ended on: *cat*, *tiger*, *rat*, *toad*. The tool pulls a category word list out of WordNet, builds the graph of legal moves, and renders it.

A word runs from its first letter to its last, and the next word must start where the previous one ended. Every word is therefore an edge between two of 26 letters, and the whole game lives on a 26-node graph no matter how large the vocabulary gets. The word-level graph is the *line graph* of that small one: its nodes are the edges of the letter graph, joined wherever one word's last letter is another's first.

That is why the tool draws both views. A spring layout of the word graph is useless, because every word ending in A links to every word starting with A and the resulting edge density defeats any force model. The word view uses fixed positions instead, grouping words into wedges by first letter.

## A worked example

`python -m wordchain stats animal` at default settings gives 364 words and 4856 playable moves between them, using 198 of the 676 possible first/last letter pairs.

X and U are dead ends. Words end there — *fox*, *ox*, *lynx*, *emu*, *gnu* — and none start there, so landing on either ends the round. C, J, Q, V and Z are the opposite: words start there and none end there, so play never arrives at them and *cat* is only ever an opening move. Neither group is a trap in play.

Y is the worst genuine trap, at 17.0 landings per available reply: 34 animals end in Y and 2 start with it. N follows at 7.0 and E at 6.2.

## Setup

The project uses a Nix flake. `direnv allow` activates it on entering the directory, and `nix develop` gives the same shell by hand. `ruff check src/` and `mypy` both pass, the latter in strict mode. Python and its packages (nltk, networkx, matplotlib, numpy, pyvis, wordfreq) come from nixpkgs. There is no virtualenv, no pip, and no lockfile beyond `flake.lock`.

One direnv wrinkle is worth knowing about. nix-direnv caches the output of `nix print-dev-env`, which defines `shellHook` as a variable without ever running it, so a flake that does real work in its hook silently does none of it under direnv. Both the `PYTHONPATH` entry and the WordNet symlink below live in that hook, so `.envrc` runs it explicitly with `eval "$shellHook"` rather than keeping a second copy that drifts.

nltk normally downloads the WordNet corpus into `~/nltk_data` at runtime. `pkgs.wordnet` is the Princeton 3.0 distribution and its `dict/` directory holds the same WNdb files nltk parses, so the shellHook symlinks the store path into `$PWD/.nltk_data/corpora/wordnet` and exports `NLTK_DATA`. Nothing is fetched over the network and the corpus version is pinned along with everything else. It has to be the directory layout rather than pointing a `WordNetCorpusReader` at the store path directly, because the reader falls back to the global lazy corpus when it resolves sense keys, and that fallback ignores the root it was given.

## Commands

```
python -m wordchain categories       # the 37 categories, with word counts
python -m wordchain stats animal     # the letter analysis
python -m wordchain words animal     # the word list with Zipf frequencies
python -m wordchain build animal     # render the word graph
```

`categories` takes `--headers` for a header row, and the same filter arguments as the other commands, so its counts match what they would build. Counting means resolving all 37, which is 3.2 s against a cold cache and 0.23 s once they are in it.

`build` writes `out/<category>/words.svg` and takes `--format svg|png` (default `svg`), `--out DIR` (default `out`), `--theme light|dark` (default `dark`), `--limit N` (words in the disc, default 110) and `--config FILE`. Every command takes `--no-cache`. All three selection commands take `--multiword`, which keeps entries like *polar bear* and chains them on their outer letters.

## Outputs

`build` writes one file, `out/<category>/words.svg`: the word graph in wedges by first letter, the 110 commonest words by default. The analysis that used to accompany it is still a command away — `stats` prints it and `words` prints the list.

Vector is the default because it wins on every axis that matters here. A 364-word disc takes 0.48 s to write against 1.16 s as a 190 dpi PNG, ships at 1.3 MB gzipped against 4.6 MB, and zooms, so a label too small to read on screen is one gesture away. `--format png` still renders the raster.

The file holds around 5,000 alpha-blended paths and 2,400 glyph references. Browsers draw it without complaint; Preview and Inkscape can be slow with that many. Glyphs are embedded as outlines rather than named, under `svg.fonttype = "path"`, so the figure renders identically on a machine with none of Iowan Old Style, Avenir or Menlo installed.

`render` and `web` carry four more views that the command line no longer reaches: a 26-letter chord diagram, the 26×26 first/last grid, the supply-against-demand bars, and two interactive pyvis pages where hovering a node lights its edges. The pyvis pages are self-contained, with vis-network inlined and the Bootstrap content delivery network (CDN) tags stripped — pyvis emits those regardless of `cdn_resources="in_line"`.

## Speed

`build animal --limit 400` takes 2.0 s the first time and 0.93 s after, against 4.5 s before any of this was measured. `stats` is 0.35 s and `words` 0.22 s.

Resolved word lists are cached under `.cache/wordchain`, keyed on the category, every filter argument, and the nix store path the WordNet corpus resolves to — a path that changes whenever the corpus does, and costs a stat to read where asking nltk for its version would cost a second. There is no command to populate it: whichever command first asks for a category writes the file, and every later run of any command reads it, because the key is the category and the filters rather than the caller.

`WordNetCorpusReader.__init__` ends by calling `map_wn()`, which guards its work with `get_version() == version` against a default of the string `"wordnet"` — a corpus name, not a version, so the comparison never holds and the mapping always runs. It parses the 7 MB `index.sense` twice to build a sense-key table for the multilingual API, which nothing here calls. Declining to build it takes the corpus load from 1280 ms to 512 ms and leaves every word list byte-identical.

Edges are cubic path segments rather than sampled polylines. SVG has cubics natively, so the curve is exact instead of approximated by 24 points, the figure builds in 50 ms instead of 131, and the file holds 1.4 MB instead of 3.8 MB.

The saved file is then rewritten to hoist shared attributes onto their groups. matplotlib stamps `style` and `clip-path` onto every path element even though a collection's paths share them by construction — 49 distinct style strings and one clip across 9,700 elements, or 35% of the file spent on identical bytes. Every property involved is inherited in SVG and clipping a group is the same as clipping each child by the same path, so 1.36 MB becomes 846 kB for a render verified pixel-identical through librsvg. It costs 140 ms.

nltk, wordfreq, networkx and matplotlib are all imported at the point of use rather than at module load. A cache hit never imports the first three at all, and `stats`, `words` and `categories` never import matplotlib, which alone is 290 ms.

The disc's axes fills its figure, so `bbox_inches="tight"` is gone from the default path. Trimming means measuring, and measuring means drawing every curve a second time.

Three things were measured and left alone. Replacing pyplot with the object-oriented API saves 4 ms, because matplotlib's core import is the cost and pyplot is a rounding error on it. `svg.fonttype = "none"` saves nothing at all, so the font-independent `"path"` is free. Restricting the corpus reader to nouns raises `KeyError: 'a'`, because satellite adjectives need the adjective index.

## Reading the disc

Wedges run alphabetically round the ring, and within a wedge the words are sorted on their *last* letter rather than the second onwards. Every word in a wedge already shares a first letter, so ordinary alphabetical order sorts them on something the game does not care about, while the letter each word hands over is the one that decides where its curve goes.

That ordering is rotated per wedge, and it runs against the direction the words are placed. Sorting on the tail letter alone starts every wedge at A, which is arbitrary once the wedges are themselves a ring: for the S wedge it drops the destinations nearest to S into the middle of the block and sends the bundle back across itself. Two chords leaving one wedge avoid crossing when the nearer origin takes the farther destination, so S runs R, Q, P back to A, wraps to Z and finishes on T. The curves then leave in a single sweep.

Every label sits at one radius. Adjacent labels collide at their inner ends, where the circumference is smallest, and the fix is the canvas rather than the layout: `_canvas_inches` solves for the width at which each label gets a full line of leading along the ring, which comes to 23 inches for 364 animals. Sizing up costs nothing in vector output, priced as it is by element count rather than dimensions.

The axis limit is solved too, by `_disc_limit`. A label's length is fixed in inches by the font while the axis limit is what converts inches to data units, so the limit appears on both sides of one equation. Solving it lets the axes fill the figure exactly, and a figure with no margin is one matplotlib never has to draw twice to work out where to crop.

Figures come from three families: Iowan Old Style for titles, Avenir for labels, Menlo for letters and counts, each with a fallback ending in a face matplotlib bundles itself. Images carry the graph and nothing else — no title, caption, legend or summary block. `build --chrome` adds all four back for a figure that has to stand on its own. Figures render dark by default, because 4,856 faint curves read as light against a dark ground and as smudge against a pale one. Both themes are complete palettes rather than an inversion of each other: the dark one lifts the letter wheel's value from 0.60 to 0.88 and drops its saturation, so all 26 hues stay separable either way.

## Configuring the geometry

Eight numbers decide where the disc puts things, and the good value for each depends on the category; 895 animals and 60 flowers do not want the same label size or the same curve pull. They were module constants in `render.py`, so trying a different figure meant editing the source. They are now fields on a frozen *dataclass*, `Geometry` in `config.py`, and `render.chord` and `render.words_disc` take one as an argument the way they already take a `Theme`.

| setting | default | what it sets |
| --- | --- | --- |
| `pull` | 0.32 | how far the chord diagram's curves bow towards the centre |
| `pull_dense` | 0.20 | the same for the word disc, above 150 words |
| `label_radius` | 1.015 | where labels start, as a fraction of the dot ring |
| `label_pt` | 6.8 | label size, which also drives the canvas through `_canvas_inches` |
| `leading` | 1.22 | how much clear space each label demands, to the same effect |
| `wedge_band` | 0.075 | room reserved outside the labels for the wedge letter |
| `glyph_width` | 0.58 | mean glyph width, used to reserve label room |
| `disc_limit` | 1.34 | axis half-width for the chord diagram, and the inches-to-data-units conversion the word disc's canvas is solved in |

The file holds one `[geometry]` table of flat keys, in Tom's Obvious Minimal Language (TOML). Every key is optional, and anything absent keeps its default.

```toml
[geometry]
label_pt = 9.0
pull_dense = 0.1
```

`build` takes `--config FILE`. With no flag it loads `./wordchain.toml` when that file exists, and uses the built-in defaults otherwise. A file named with `--config` has to exist, because a `--config` that silently falls back to the defaults is a typo that costs a render to notice. The discovered one does not have to, since the whole point is that most runs have no file.

Validation refuses rather than ignores. An unknown table, an unknown key, a value that is not a number, a bool, and anything not strictly positive and finite each stop the build. A key the tool ignores is worse than one it refuses: the figure comes back unchanged and the file looks like it should have changed it. An unrecognised key is answered with the closest setting name from `difflib`, or with the full list of eight when nothing is close, and every message carries the file path, since a build otherwise names no file.

`tomllib` and `difflib` are imported at the point of use rather than at module load, for the same reason nltk and matplotlib are. tomllib costs 5 ms to import and only `build` ever reads a config, so `stats` still runs in 0.18 s and imports none of the three. Rendering with no config file present writes bytes identical to the output before any of this existed, once matplotlib's random per-run element ids are normalised.

## Choosing the words

Word lists come from the hyponym closure of one or more WordNet synset roots. `animal` is `animal.n.01`; `fruit` needs both `edible_fruit.n.01` and `fruit.n.01`, because WordNet splits the botanical and the edible senses.

The closure is generous. `animal.n.01` contains a sense of *world* and a sense of *blue*. Four filters cut it down to something playable:

- Words wordfreq scores at exactly zero are dropped whatever the settings. A zero means the word appears in none of its corpora, and that is precisely where WordNet stops listing vocabulary and starts listing taxonomy: 879 of animal's 2,461 candidates score zero, and they read *aegyptopithecus*, *acanthocephalan*, *abrocome*. Excluding them is structural rather than a threshold guess, which is what lets the threshold below sit low.
- `--min-zipf` (default 2.0) drops rare words on wordfreq's Zipf scale, where 2.0 is about one occurrence per ten million words.
- `--target` (default 60) makes that cut adapt. One absolute threshold suits some categories and guts others: at 3.0, animal keeps 364 words and flower keeps 9, not because English has nine flowers but because flower names sit lower in the frequency table than animal names as a class. Everything above `--min-zipf` is kept, and if that leaves fewer than the target the threshold slides down the category's own frequency order until it has enough. `--zipf-floor` (default 0.0) is where it stops regardless, which is to say any word wordfreq knows at all.

  Categories with plenty of common words never notice — animal and food cut at exactly 2.0. Flower relaxes to 60 and instrument stops at 74; toy runs out at 29, which is a fair claim about how many single-word toys English has.
- `--min-dominance` (default 0.2) uses WordNet's sense-tagged counts: for a word tagged in the annotated corpus, the share of its noun uses that falls inside the category. This is what removes *date* and *key* from fruit.
- `--max-rank` (default 2) is the fallback for untagged words. WordNet lists senses commonest first, so a category sense buried at position seven is not the everyday meaning.
- `--min-depth` (default 1) drops the category's own name, since *animal* is not a playable answer in a game of animals.

WordNet is a lexical database, not a game word list, and some residue always survives: *entire* and *royal* are genuine WordNet animal terms nobody would play. The flags exist to be tuned per category.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, disease, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, mineral, plant, reptile, river, sport, tool, toy, tree, vegetable, vehicle, weapon.

## Layout

`src/wordchain/` holds `lexicon.py` (WordNet extraction and filtering), `graph.py` (letter matrix, word graph, trap analysis), `render.py` (matplotlib figures), `web.py` (pyvis pages), `palette.py` (per-letter colours), `config.py` (the geometry and its file) and `cli.py`.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
