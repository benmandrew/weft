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
python -m wordchain categories       # the 33 categories and their WordNet roots
python -m wordchain stats animal     # the letter analysis
python -m wordchain words animal     # the word list with Zipf frequencies
python -m wordchain build animal     # every figure, page and table
```

`build` writes to `out/<category>/` and takes `--out DIR` (default `out`), `--theme light|dark` (default `dark`), `--limit N` (words in the static disc, default 110) and `--web-limit N` (words in the interactive page, default 260). All three selection commands take `--multiword`, which keeps entries like *polar bear* and chains them on their outer letters.

## Outputs

`build` writes seven files into `out/<category>/`:

- `letters.png` — chord diagram, 26 letters round a circle, ribbon width by word count, dead ends in red
- `matrix.png` — the 26×26 first/last counts as a grid
- `pressure.png` — words starting with each letter against words ending with it
- `words.png` — the word graph in wedges by first letter, 110 commonest words by default
- `letters.html`, `words.html` — interactive pyvis pages; hover a node to light its edges
- `report.txt`, `words.csv` — the analysis as text and the word list as comma-separated values

The pyvis pages are self-contained. vis-network is inlined, and the tool strips the Bootstrap content delivery network (CDN) tags that pyvis emits regardless of `cdn_resources="in_line"`.

## Reading the disc

Wedges run alphabetically round the ring, and within a wedge the words are sorted on their *last* letter rather than the second onwards. Every word in a wedge already shares a first letter, so ordinary alphabetical order sorts them on something the game does not care about. Sorting on the letter each word hands over puts all the words leading to T side by side, and their curves leave the wedge as a single bundle instead of crossing each other on the way out.

Above about 150 words the labels alternate between two radii, with a leader line tying the outer tier back to its dot. Adjacent labels collide at their inner ends, where the circumference is smallest, and staggering doubles the room each one has against its same-tier neighbour.

Figures come from three families: Iowan Old Style for titles, Avenir for labels, Menlo for letters and counts, each with a fallback ending in a face matplotlib bundles itself. Images carry the graph and nothing else — no title, caption, legend or summary block. `build --chrome` adds all four back for a figure that has to stand on its own. Figures render dark by default, because 4,856 faint curves read as light against a dark ground and as smudge against a pale one. Both themes are complete palettes rather than an inversion of each other: the dark one lifts the letter wheel's value from 0.60 to 0.88 and drops its saturation, so all 26 hues stay separable either way.

## Choosing the words

Word lists come from the hyponym closure of one or more WordNet synset roots. `animal` is `animal.n.01`; `fruit` needs both `edible_fruit.n.01` and `fruit.n.01`, because WordNet splits the botanical and the edible senses.

The closure is generous. `animal.n.01` contains a sense of *world* and a sense of *blue*. Four filters cut it down to something playable:

- `--min-zipf` (default 3.0) drops rare words on wordfreq's Zipf scale, where 3.0 is about one occurrence per million words. WordNet's tail holds thousands of animals nobody has heard of.
- `--min-dominance` (default 0.2) uses WordNet's sense-tagged counts: for a word tagged in the annotated corpus, the share of its noun uses that falls inside the category. This is what removes *date* and *key* from fruit.
- `--max-rank` (default 2) is the fallback for untagged words. WordNet lists senses commonest first, so a category sense buried at position seven is not the everyday meaning.
- `--min-depth` (default 1) drops the category's own name, since *animal* is not a playable answer in a game of animals.

WordNet is a lexical database, not a game word list, and some residue always survives: *entire* and *royal* are genuine WordNet animal terms nobody would play. The flags exist to be tuned per category. Thin categories want looser settings — `python -m wordchain words flower --min-zipf 2.5 --max-rank 5 --min-dominance 0.05` takes flowers from 9 words to 24.

## Categories

animal, bird, body-part, building, city, clothing, colour, country, dog, drink, drug, element, fabric, fish, flower, food, fruit, furniture, game, insect, instrument, job, language, mammal, metal, plant, sport, tool, toy, tree, vegetable, vehicle, weapon.

## Layout

`src/wordchain/` holds `lexicon.py` (WordNet extraction and filtering), `graph.py` (letter matrix, word graph, trap analysis), `render.py` (matplotlib figures), `web.py` (pyvis pages), `palette.py` (per-letter colours) and `cli.py`.

The 26-node graph was fixed before any word list existed, and a category only decides which of its edges are populated and how heavily. Everything the tool draws is a way of asking which letters are worth steering an opponent towards.
