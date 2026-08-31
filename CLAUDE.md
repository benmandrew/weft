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
- `lexicon.EXTRA_WORDS` tops a category up by hand, on top of what the closure
  yields, since WordNet is a lexical database rather than a game word list and
  can miss a word every player would offer: "grey" is a lemma of no colour
  synset, so the colour category returns "gray" alone. It ships empty, with one
  commented line for the shape. An entry bypasses every filter — the Zipf cut,
  the polysemy dominance and rank filter, the depth cut — because a word
  written down by hand was chosen rather than survived, and it joins after the
  sliding frequency cut in `_resolve`, so it never counts towards `--target`
  and never displaces a word the closure earned. `--multiword` still governs
  it, since that flag decides whether the whole graph chains on outer letters.
  It carries wordfreq's real Zipf rather than a stand-in, so `words` prints the
  truth about it, and a word wordfreq has never seen scores zero, sorts last,
  and needs a larger `--limit` to be drawn. A duplicate of a word WordNet
  already yielded is dropped; the cache is keyed on the category's entry, so
  editing the table misses rather than serving a list resolved before the edit;
  and `_check_extras` refuses an unknown category name or an unplayable word at
  import, rather than letting a typo silently add nothing.
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
- The label size is solved, not set: `_wanted_inches` gives the width at which
  adjacent labels exactly clear each other, `_canvas_inches` holds that between
  9.6 and 30 inches, and `_fitted_pt` shrinks `label_pt` by whatever the cap
  denied. Below the cap it returns `label_pt` itself — the cap is tested rather
  than the two sizes compared, so a disc that already fits cannot move by a
  rounding error, and every category at the default limit renders byte for byte
  as it did before the fitting existed. Above it the type takes the shortfall
  rather than the labels overlapping: `--limit 0` on animal wants 101 inches,
  gets 30, and sets 2.0 pt against 6.8. Small on a screen and exact under a
  zoom, which is the trade `--format svg` already makes. `_disc_limit` reads
  the fitted geometry too, through a `dataclasses.replace` of the one passed
  in, so the axis frames the labels actually drawn rather than the ones asked
  for.
- Geometry lives on `config.Geometry`, the word filters on `config.Selection`
  beside it, and the letter colours on a `palette.Wheel` of one or more `Arc`s
  carried by the `Theme`; a figure takes each as an argument, never as a module
  constant. The config file is `./wordchain.toml` or the file `--config` names,
  which must exist. `theme` is a bare key at the top rather than a fourth table
  beside `[geometry]`, `[palette]` and `[selection]`, because it names a ground
  rather than a group of distances, and `--theme` overrides it.
- `[selection]` holds the command line's own selection arguments — `min_zipf`,
  `min_dominance`, `max_rank`, `min_depth`, `target`, `zipf_floor`, `multiword`
  and `limit` — so a file can move them. Every command reads the table, not just
  `build`, which is why `--config` sits on all four rather than on `build`
  alone: `categories` prints a count, `stats` analyses that list and `build`
  draws from it, and a table only `build` honoured would put the three out of
  step. The file is read once in `main()` rather than per command, because
  `categories` loads all 37 word lists and would otherwise parse the file 37
  times. The flags are not written out one argparse block each:
  `cli._selection_args` builds one flag per `Selection` field, taking the
  flag's name off the field name and its type off `config._SELECTION_BOUNDS`,
  and reading its metavar and help out of `cli._SELECTION_HELP`. `cli._DRAWN`
  names the one setting only `build` offers. Precedence is the flag, then the
  file, then the built-in default, so every selection flag defaults to None
  rather than to its value: a `--target 60` typed out and no `--target` at all
  have to reach a file that sets it differently as different things.
  `--multiword` is `argparse.BooleanOptionalAction` for the same reason, so
  `--no-multiword` exists and turns off a file that switched it on. That rule
  lives in `cli._selection` alone, where it used to be eight `_chosen` calls,
  one per setting, each restating the same sentence. `limit` sits here rather
  than in `[geometry]` because it counts words rather than measuring a
  distance; `geometry.disc_limit` is the axis limit in data units and is
  unrelated.
- `config.as_members` turns a `Selection` into the keyword arguments
  `lexicon.members` takes, and every caller goes through it — `cli._load`, which
  all four commands share, and `tools/export_words.py`. Spelling the eight out
  at a call site is what had put four copies of them in the tree, one of which
  had already drifted. `members` keeps its explicit signature, since that is
  its API, and a caller wanting different settings builds a different
  `Selection`. Every command prints the same text after the change and every
  SVG matches byte for byte once matplotlib's per-run generated element ids are
  normalised, which two runs of unchanged code differ by too.
- Unknown keys and values that are not positive numbers are refused, never
  ignored, since an ignored key redraws the same figure; `hue_start` and
  `equalise` are the two settings that mean something at zero. `[selection]`
  inverts that rule: every numeric setting there allows its own minimum, since
  a `min_zipf` of 0 is the whole vocabulary, a `min_dominance` of 0 asks
  nothing of a word's senses, a `target` of 0 relaxes nothing, and a `limit` of
  0 is no limit rather than a blank disc, since a count being lifted reads as
  all of them the way it does in a head or a tail. `render.words_disc` spells
  that out rather than slicing, because the slice returns nothing. The Zipf ceiling is 8, because the
  scale runs out there ("the" scores 7.7) and anything above it empties every
  category. `config._SELECTION_BOUNDS` declares
  each numeric setting's JSON type, minimum and maximum once, and both the
  validator and `tools/check_schema.py` read it, so the schema is held to the
  rule actually enforced rather than to a second copy of it. In `[palette]` a
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
  carries none, so a new setting is documented there and nowhere else. The
  check has a second job, holding `lexicon.members`'s keyword defaults to
  `Selection`'s, since those are two copies of the same numbers. That
  `multiword` answers to `allow_multiword` there, and that `limit` has no
  counterpart because only `build` draws, are facts `config._MEMBERS_RENAME`
  and `config._MEMBERS_SKIP` own, and the check reads the two rather than
  keeping a second copy of them. It caught a real drift on its first run:
  `members` still had `min_zipf=2.0` after the command line's default moved to
  0.0. The third job is holding `cli._SELECTION_HELP` to `Selection`'s fields,
  since a setting with no line there gets no flag at all and nothing else would
  say so. `render.words_disc` takes `limit: int = DEFAULT_SELECTION.limit` and
  so copies nothing.
- `<hypernym-disc>` reads a tree as `par`, an array where every parent's index
  is below all of its children's. That ordering is the whole contract: it lets
  the element find depths, leaf counts and angles in flat loops instead of a
  traversal, so 82,115 nodes lay out in one frame. `export_tree.py` writes the
  nodes in preorder over that tree, which satisfies the contract on its own by
  emitting a node ahead of its whole subtree, and visits siblings by rank then
  by descending subtree size, since sibling order is wedge order and the layout
  has to come out unchanged. Preorder also puts every subtree in a contiguous
  run of indices, worth 181 KB brotli across the three files and a prerequisite
  for serving one wedge's glosses as a byte range, which nothing does yet. Rank
  no longer holds the contract up but is still what finds a cycle in the DAG,
  orders the pass that totals subtree sizes, and leads the sibling key, where
  379 of the 16,933 sibling groups hold nodes of differing rank. Nesting needs a
  tree and the hypernyms are a DAG, so each synset keeps its first hypernym and
  drops the other 2,313 edges; every node survives, only cross-links go.
  Children are held the same way, as one offsets array and one flat array of
  child indices rather than a list per node: the child count and the leaf test
  are both `#kidOff[i + 1] - #kidOff[i]`, and `#kidIdx` is what answers which
  children, retained rather than left local to `#build` now that the column
  lists the ring below the root. As 82,115 plain arrays, two thirds of them the
  empty one a leaf never reads, they held 4.8 MB of retained heap against
  657 KB, and the build's median went 5.3 ms to 1.6 ms. Retaining `#kidIdx`
  moves neither figure: that 657 KB is exactly the two arrays, `#kidOff` an
  `Int32Array(N + 1)` at 328,464 bytes and `#kidIdx` an `Int32Array(N - 1)` at
  328,456.
- The layout never reads a name, so the export is two files and the element
  fetches them in that order: `wordnet-tree.json` is the structure at 42 KB
  brotli, `wordnet-names.txt` the names for the same indices at 311 KB. First
  paint waits on the smaller one and a node answers to `#index` until the
  larger arrives, which is why `start` is re-resolved when it does. Both are
  generated into `out/` and never committed. Keep them index-aligned: the names
  file is positional, with no key to catch a mismatch.
- The search box reaches a node by name, and it does exactly what the pointer
  does: picking a suggestion calls the same `#preview` the pointer calls, so the
  highlighted path cannot drift from the hover, and Enter is the click. A leaf
  is the exception, because zooming into one shows an empty disc: Enter on a
  leaf goes to its parent and leaves the cursor on the leaf, which is the one
  thing clicking cannot do and the reason to search for a word at all. A picked
  node outside the current zoom is not highlighted, since there is nowhere on
  the disc to draw it; Enter brings it into view.
- `disc-search.js` scores every name in one pass rather than holding an index.
  A sorted index would answer a prefix in log time for a 23 ms sort, but the
  weakest band is a subsequence match, which no ordering of the names prunes.
  Containment does: every name carries a bitmask of the characters it holds, a
  bit each for a to z, one of its own for a space, since a multiword query is
  common and most names have no space, and a last bit shared by everything
  else. A name can match only if its mask holds every bit the query's mask
  does, which is as true of the subsequence band as of the rest. The masks
  cost nothing measurable to build: they go in a second pass over strings the
  first has just left in cache, taking the first query's setup over 82,115
  names to 5.1 ms against 5.3 ms for the lowercased copy alone. The scan then
  falls from 4.30 ms to 0.41 on "dog", 2.29 to 0.19 on "domestic dog" and 3.74
  to 0.18 on "xyzq", warm medians of 15 runs; a one-character query gains
  least, 2.27 ms to 1.15 on "a", since almost every name holds the letter. The
  prune is inert, and that was checked rather than argued: the scorer with and
  without it returns identical hits, indices and scores over the real corpus
  for 26 written queries and 400 generated ones. Bands sit 1,000 apart and
  every penalty is capped below 1,000, so a weaker kind of match can never
  outrank a stronger one however long the name it sits in; that ordering is
  what `check_web.mjs` asserts, not the scores.
- The disc is driven by the pointer alone. The arrow keys, Enter and Escape
  that used to move a cursor over the canvas are gone, and with them the
  canvas's tabindex and its `application` role, since a canvas that answers no
  key should not take focus. The search box is the keyboard's way to any node
  and keeps its own arrows and Enter. `#cursor` stays: it is what holds the
  highlight on a leaf that Enter landed beside.
- The hub names the node under the pointer and otherwise the current root, at
  every level rather than only at the top, muted so the name of the view never
  reads as a selection. Under that name sits the way out, in the crumb
  buttons' accent, and only where clicking does something: never at the root,
  where a click on the hub is a no-op, and never with the pointer on a wedge,
  where the room is wanted for that wedge's name. The name is fitted to a
  radius short of the hint, so the two cannot collide however long it runs. A
  pointer move used to force a layout per event, reading
  `getBoundingClientRect` and three custom properties through
  `getComputedStyle` and writing the crumb's `innerHTML` on a line the write
  before had just dirtied. The rect is now `offsetX`/`offsetY`, exact because
  the canvas carries no border or padding; the custom properties are read once
  and held until a resize, the colour-scheme query, or the `repaint()` a host
  calls after restyling; and the hub's fit is held on radius and name, since
  fitting costs 9.5 `measureText` calls at the median and 539 for the longest
  name in WordNet, and a pointer crossing wedges asks for the same few names
  over and over.
- `disc-label.js` fits that name: it steps down five sizes and up to three
  lines, and breaks a word only when nothing else fits. A forced break carries
  a trailing hyphen and the word carries on below, including on the last line,
  where an ellipsis used to sit. A hyphen says the word goes on; the ellipsis
  said the rest was gone. A break landing on a space takes no hyphen, since
  that would invent one inside the name. It is its own module because it is
  the part of the hub with edge cases, and only a context's `font` and
  `measureText` are touched, so `check_web.mjs` measures it with a monospace
  stub where a width is a character count. `fit` returns the face it set as
  well as setting it, so a held fit puts the font back without measuring
  again.
- Above the crumb path sits the definition of whatever the hub names: the node
  under the pointer, and the current root when the pointer is off the disc. One
  method answers for both, so the name in the middle and the definition below
  it can never be of different nodes. It is a third export,
  `wordnet-glosses.txt`, index-aligned with the names and fetched after them,
  since it is much the largest of the three and read by one line of text. It
  carries every synset rather than only the 16,922 that can be a root, because
  the definition follows the pointer and two thirds of what the pointer lands
  on are leaves, at 1,329 KB over the wire. Nothing on the disc waits for it. Stacked under the disc the block is a fixed
  two lines, so moving to a longer definition never resizes the disc, and it
  reserves nothing until the file lands. It reads in the ink colour a step
  above the crumb below it, and its first letter is raised on 75,110 of the
  82,115 — never where the gloss opens on a parenthetical label such as
  `(mathematics)`, which 2,959 do and which is conventionally lowercase, and
  never where the second letter is a capital, which is what stops the 4 like
  "cDNA copy of the RNA genome" from becoming "CDNA".
- That file is 5.5 MB and the disc shows one definition at a time, so it is held
  as the text and an `Int32Array` of line starts rather than split on the
  newline. A substring keeps the whole text alive whatever shape it is in, so
  the split bought only 82,115 string headers, 3.13 MB on top of the file, where
  the offsets cost 328,464 bytes and a slice is cut when the pointer asks for
  one. That is 2.8 MB back. `disc-lines.js` holds it as `Lines`, with `length`
  and `at(i)`, where `at` returns "" for an index the file does not reach, which
  is what the readout prints while the glosses are still on their way, and the
  constructor takes the text or anything else a host hands the element, joined
  back up so there is one shape downstream; the element's public `glosses`
  property is that object rather than an array. It is a module rather than a
  method because an offset table out by one returns the tail of the line above,
  which reads as a definition and is nobody's, and `check_web.mjs` can say so
  where a browser cannot — the argument `solve`, `square` and `thin` are already
  there for. Names are deliberately not held this way: the search reads every
  one of them on every query and would cut 82,115 slices to do it.
- Below that the element prints the crumb path and nothing else. The path
  carries on past the current root with the chain of whatever the hub is
  naming, the node under the pointer or the one the search left the cursor on,
  so the path a click would land on is legible before the click. That tail is
  muted, where the way out down to the root keeps its accent buttons and its
  ink-coloured root, so the view's own path still reads as where the disc is
  and the tail as a pointer passing over. The tail comes off `#focus`, the same
  method the hub's name and the gloss come off, so the three can never be of
  different nodes, and `#focus` answers -1 for a node outside the current zoom,
  so a searched node elsewhere in the tree adds no tail — the same rule that
  leaves it unhighlighted on the disc. The line is rendered in two elements,
  the head rebuilt only on a zoom and the tail only when the focus moves, so a
  pointer crossing a wedge writes to the DOM once rather than once per pixel.
  Written into one element the split bought nothing, since every tail rewrite
  re-parsed the head.
  The line of counts that sat under it is gone: the hub already names whatever
  the pointer or the search is on, and `disc-hover` still carries the depth and
  the leaf count, so a host that wants them can print its own. A failed fetch
  still reports there, and a `#failed` flag holds that message until a zoom,
  which is how long it survived when the line was written whole.
- Where the frame is wide enough for a column, the element lists every node one
  ring out from the current root under the search box: what a click on the disc
  would open, read as a list rather than picked out of a fringe of wedges. It is
  the same column, the same landscape threshold and the same paging
  `<word-disc>` lists its moves in, `KIDS_PAGE` at 200 and `KIDS_NEAR` at 240,
  and WordNet's widest node holds 661 children with 16 nodes over a page, so
  paging is a path that runs here rather than one that never does. The order is
  the order the disc draws them, and it costs no sort: `#build` lays a parent's
  angles out in one pass over its children as they sit in the flat child array,
  so a slice of that array is already wedge order. Sorting alphabetically, as
  `<word-disc>` sorts its moves, would put the list and the disc in different
  orders and there is no reading one against the other after that. A node with
  children of its own reads apart from a leaf — `.kids li.leaf` is muted with
  the cursor left an arrow, where a branch takes the ink colour and a pointer —
  because only the branch is a way further in, and the header line above the
  list reads `3 below · 1 opens further`, the branch count in the accent.
  A branch row also prints, right-aligned against the column's edge, what that
  branch weighs: the leaves under it against every leaf in the ring, muted and
  monospaced as every other number the element prints. The row is a flex of a
  name span and a weight span, where it was one line of text, and the name
  still ellipsises. It is one division rather than a sum over the row's
  siblings, because a node's leaf count is its children's added up, so the
  ring's own total is `#leaves` at the root. It is also exactly the share of
  the turn the wedge takes — `#build` divides a parent's span by its leaf count
  and gives each child its own count of them — so the figure printed is the
  width of the arc it names and can be read against the disc rather than only
  against the other rows. Three digits at most, since a ring of 661 nodes has
  shares in the hundredths and a column has no room to say so: rounded whole
  above 9.95%, one decimal down to 0.095%, and everything below that reads
  `<0.1%`. The two thresholds are the rounding boundaries rather than 10 and
  0.1, so 9.96% prints as `10%` rather than `10.0%`. A leaf prints nothing. It
  weighs one leaf, which is the ring's floor rather than anything about the
  node, and it is the row with nothing below it, so the figure is a branch's
  alone and its absence is a third thing saying which rows are a way further
  in, beside the muted colour and the arrow cursor.
  Hovering a row is hovering its wedge and clicking one is clicking it, both
  through the same `#preview` and `#go` the pointer and the search box use, so
  the column and the disc cannot describe different things. `#go` gained a
  guard for it: a leaf whose parent is already the root is pinned rather than
  zoomed to, since clicking a leaf row would otherwise zoom to where the disc
  already is, rebuild the list under the click that came out of it and throw
  its scroll back to the top. That fixes the same needless redraw for a leaf
  reached by search that was already in view. The suggestions and this list
  share the room on the rule `<word-disc>` already sets, suggestions while the
  search box has something in it and the ring below otherwise. One per line,
  where `<word-disc>` lists its moves two up: a 240 px column has no room for
  two of "domestic dog", which is the same measurement that already drops a
  suggestion's parent onto a second line here. The list carries the box that
  one does, a 1 px `--_edge` border on the `--_panel` ground with 3 px of
  padding, drawn like the suggestions it shares the room with, and it is
  `flex:1 1 auto` inside a stretching row, so the border runs down to the
  definition at the foot of the column however few nodes the ring holds.
  `.kids li` is `display:flex` and so block-level, and the rows abut on that
  alone: the `line-height:0` that stops `<word-disc>`'s inline-block rows
  leaving a strut's descent between every pair has nothing to fix here. The
  `pointermove` handler is the other element's word for word, down to holding
  the hover where a move lands on no row rather than clearing it. This disc
  never showed the blink, its rows abutting, but the list's own padding is a
  seam like any other and it would have blinked there.
- `hue-depth` defaults to 8 and `merge` to density, and the harness sets
  neither: it is one disc with a search box, no controls and no timings. Both
  attributes still work, so a comparison is one attribute away in the
  inspector, and `check_web.mjs` is what holds the other merge modes honest.
- Once the frame is 218 px wider than a disc filling its height, the search box
  and its suggestions move into a column beside the disc rather than a strip
  above it, and the definition goes with them, to the foot of that column,
  level with the bottom of the disc. That stops the suggestions covering the
  disc, and hands the disc back the height the search box was taking and the
  44 px the two gloss lines and their gaps were taking below it. The crumb line
  alone then spans the width under the disc. The gloss and the crumb are two
  children of the frame rather than one block of their own, because grid
  placement is the only way to move the gloss into the column and grid places
  only its own children. It is under `fit` only, since without a definite
  height there is no landscape to find, and no portrait phone reaches the
  threshold, so a narrow screen keeps the stacked layout and the suggestions
  overlay the disc there as any combobox does. The class is toggled from the
  resize observer rather than a container query, because the test is the
  frame's own shape and a container cannot query itself; measuring the frame
  rather than the stage is what stops the toggle changing its own answer. That
  observer watches both boxes, and all three elements had the same fault when
  it watched only the stage. The stage's box is what the canvases are sized
  from and the frame's shape is what decides the layout, and the two do not
  move together: stacked, the stage is a square of whatever height the flex
  column leaves it, so its size comes off the frame's height and a frame
  dragged wider leaves the stage's box exactly where it was. No callback was
  raised, so an element dropped to the stacked layout when the page narrowed
  and then stayed there however wide the page was dragged afterwards — the way
  in worked because grid to flex does move the stage, and only the way out was
  silent. The
  stage spans both rows of the column, the search box's and the gloss's, so a
  longer definition costs the suggestion list its room rather than the disc its
  height; that is why the gloss runs to five lines there, where two would clip
  most definitions at 200 to 280 px wide. In the column a suggestion puts its
  parent on a second line, since 200 px has no room for both on one.
  The column has a box around it, which is what separates it from the disc. It
  is the frame's own `::before`, placed as an explicit grid item spanning
  column 1 from the first row to the definition's, rather than an element
  wrapping the column: the picker, the search box and the definition are
  separate grid items, and the stacked layout puts the definition under the
  disc rather than in a column, so nothing wraps them and CSS cannot move the
  DOM. A pseudo-element is generated first, so it paints behind the items
  sitting in it, and it carries `pointer-events:none`. It exists in wide mode
  alone, since `content` is set only there. The items carry the inset that
  keeps their text off the border, 10 px on the picker's top, on the search
  box's sides and bottom and on the definition's sides and bottom, and the
  definition's `margin-top:12px` went with it, the search box's 10 px of bottom
  padding standing in for the gap. Both elements draw it. `<hypernym-disc>` has
  no picker, so its box spans two rows rather than three and its search box
  takes padding on all four sides.
- The `fit` attribute makes the element fill the box it is given, with the
  stage taking whatever height the search box and the crumbs leave and staying
  square against whichever dimension binds first. Without it the stage is a
  square of the element's width, which is the only thing that works when the
  host gives the element no height of its own; with it the host has to, so it
  is opt-in rather than the default. The harness sets it and never names a
  pixel count, since a page that guesses at its own chrome guesses wrong.
- Both elements size their canvases through `disc-ratio.js`'s `ratio`, which
  bounds the area rather than the ratio. They used to take
  `Math.min(devicePixelRatio, 2)`, and browser zoom multiplies
  devicePixelRatio, so cmd+ on a Retina screen asked for 2.2, 3 or 4 and the
  cap drew the disc at up to half the resolution the screen was showing it at:
  sharp at 100%, blurred at 200%, on both discs. What the cap was guarding is
  the backing store, and a backing store is an area, so `MAX_AREA` is 2^23
  device pixels a canvas — 33.6 MB at four bytes each, half the 16,777,216
  Safari has held a canvas to, so an element's base and its overlay together
  sit inside what one canvas is allowed, and above anything the old cap could
  reach. Zoom costs the budget almost nothing, since a page laid out in CSS
  pixels gets proportionally fewer of them as the ratio rises and the two
  changes nearly cancel; it binds on a genuinely large element on a 3x screen,
  which is where a canvas is actually expensive. The ratio is passed in rather
  than read, so `check_web.mjs` holds it to the rule rather than to whatever
  screen it runs on, the split `solve` and `square` already make.
- A zoom is watched for as well as budgeted, because it moves devicePixelRatio
  and leaves the CSS box alone: an element a host sized in pixels — which is
  what `fit` asks a host to do — sees no observation and would go on painting
  at the resolution before the zoom, blurring on cmd+ and never recovering.
  `#onRatio` holds a `(resolution: Xdppx)` query naming the current ratio and
  re-arms it on every change, since a query can only report leaving the one
  value it names. `device-pixel-content-box` on the resize observer would say
  the same thing in one place, and is not portable. `check_web.mjs`'s
  `matchMedia` stub keeps its listeners for this, the way the `ResizeObserver`
  one does, so a zoom is driven as a browser drives it; dropping the refit from
  `#onRatio` fails it.
- A disc's canvases are much the largest thing a page carrying one holds. On the
  article the two elements are embedded in, which gives each
  `max(26rem, 100vh - 4rem)`, their four canvases come to 63.6 MB on a 16 inch
  laptop, a stage of 1,021 CSS px, and 115.6 MB on a 5K display at 1,376,
  against 21 MB for every name, gloss and typed array on the page put together:
  canvas pixels are 79% to 87% of what the page holds. A page stacking two discs
  down a column can only show one of them at a time, so the other was holding
  31.8 MB or 57.8 MB of pixels nobody could see, and the word disc's resting
  bundle another 16.0 MB or 30.3 MB on top. So a disc more than a screen from
  the viewport gives its pixels back and takes them again on the way in, which
  takes that article's steady state from 79.6 MB to 47.8 MB and from 145.8 MB to
  88.0 MB. `disc-idle.js` exports `watch(el, sleep, wake)`, one
  `IntersectionObserver` at `rootMargin: "100% 0px"`: a whole viewport above and
  below, so the pixels are there before the disc is, where an element that woke
  as its top edge crossed the fold would be repainting while it was already
  being read, and nothing either side, since the discs sit in a column and a
  page scrolls down. It says when and never what — what a disc drops is the
  element's own. Both sleep by zeroing their canvases and setting `#pw` to 0,
  which is what every draw path already refuses on, and `#asleep` is what stops
  `#fit` sizing them straight back under the resize observer, which goes on
  firing at an element nobody can see. `<word-disc>` releases its bundle as
  well. `<hypernym-disc>`'s base canvas may belong to the worker by then, where
  setting a dimension throws, so the worker is sent `{sleep: true}` and the
  painter sizes it again from the next view it is handed. Nothing is dropped
  before the first fit, so a disc that starts below the fold never allocates
  rather than allocating and giving back. Waking sets `#resized = 0` so the fit
  goes through outright rather than on the trailing timer that coalesces a drag:
  coming back into view is not a drag, and the disc is about to be read. Where a
  browser has no `IntersectionObserver`, `watch` returns null and the disc keeps
  its pixels, which is the behaviour before this existed.
- Only `rings` depths below the root are drawn, 14 by default. WordNet is 20
  deep and its outer rings are nearly empty — depth 13 spans 4.5% of the turn,
  depth 19 is one node — so dividing the radius by every depth put the visible
  mass at 75% of it and left a quarter of the frame blank. Capping fills the
  frame, taking the disc at 1280x900 from about 520 px across to 725. Nothing
  is lost: what falls off the edge is one zoom away, since zooming makes the
  node the new root and the count starts again from it. The cap is in the view
  the painter is sent and in its prepare key, because it changes which runs
  merge and which colours are interned. The hub asks `#under`, which is
  containment in the root's cone alone, so a node the search reached below the
  last ring is still named; the highlight climbs to its deepest drawn ancestor
  rather than showing nothing.
- Hit testing binary-searches the nodes at one depth by start angle, and zooming
  rescales angles rather than laying out again, so neither needs a spatial
  index. `make serve` watches `web/` and reloads the browser on save. Nothing in
  `all` depends on any of it.
- The paint runs on a worker. `disc-paint.js` holds the whole pipeline with no
  DOM in it: the tint, the palette, the merged runs and the draw.
  `disc-worker.js` hosts that class against an OffscreenCanvas, and the element
  calls the same class on the main thread where a worker cannot be had, so the
  fallback cannot drift from the fast path. The layout stays with the element
  rather than moving to the worker, because hit testing, the crumbs, the
  crumbs and the hub all have to answer without a round trip. The layout
  crosses once per tree and the hue depth only when it changes, so a repaint is
  a small message however large the tree, and `byDepth` crosses as typed arrays,
  since a nested plain array of 82,115 numbers is the slowest thing structured
  clone can be handed. A canvas can be handed to a worker only once, and only
  before anything has taken a context on it, so the element cannot paint first
  and hand over afterwards; it waits for the worker to say it is ready. The
  worker is opened when the element connects rather than when the first draw
  asks for a painter, so its module fetch runs alongside the tree's, and the
  400 ms it is given starts at the first paint the element wants rather than
  at `new Worker()`. Timed from the constructor that budget covered fetching
  and evaluating two modules, so a slow link spent it all on the network and
  the device most in need of the worker was the one most likely to lose it,
  permanently. It is an evaluation budget now. What it still guards is a
  worker that loads and never answers, which leaves the draw on the main
  thread for good, and what it still costs is a blank disc for that long. Do
  not terminate the worker when the element
  disconnects: it holds the only handle to the base canvas, and that canvas
  cannot be handed over twice. The element no longer sizes that canvas either,
  since setting a dimension on a transferred canvas throws — the painter does
  it, and the element still sizes the overlay.
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
  Radius is in that key because the merge is measured in pixels, which makes a
  resize a whole remerge, 15.6 ms over 82,115 nodes, once per frame of a drag.
  The first change is applied outright, so a load or a rotation is not held
  up, and the rest are coalesced on a 60 ms trailing timer; the canvases
  stretch to the new box until the drag stops.
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
- `make web-dist` stages everything a page needs to run `<hypernym-disc>` flat
  in one directory, `out/web-dist` unless `DIST=` names another, which `make
  clean` removes with the rest of `out/`. Its contents are every `web/*.js`
  module, seventeen today, `web/embed.html`, the three exported data files and the
  38 word files, 59 in all. The
  module list is a glob rather than names written out, which is the whole point
  of the target: a consuming site copies the directory instead of keeping its
  own list of filenames in step with this one, where an eighteenth module added here
  leaves that site running seventeen of eighteen and nothing says so. `index.html`,
  `words.html` and `letters.html` are left out, since they are the local
  harnesses and a host
  page carries its own markup, and `embed.html` is the exception because it is
  written for this directory: it asks for `wordnet-tree.json` and
  `words-animal.json` beside itself rather than at `/out/…` the way the two
  harnesses do, because the directory is flat and a host copies it whole and
  serves it from wherever it likes. So it is both a page a host can serve as it
  stands and the markup a host reads to write its own. It is not a layout. The
  three elements sit in ordinary document flow, one `<section>` after another
  down a single column, and each section carries its own
  `<script type="module">`, its own data attributes, its own height and its own
  custom properties, so any one can be lifted out and dropped anywhere on a host
  page without bringing the others, and no element needs another to exist.
  Nothing there positions one relative to another, since a page that did would
  be the one thing a host embedding a single disc cannot use. The height is
  given on the element, because `fit` makes an element fill the box it is handed
  and a page that guesses at its own chrome guesses wrong, so that number is the
  host's; the page says in a line that dropping `fit` instead makes the element
  a square of its own width, which is what to do where the height cannot be
  named. Its word disc is animal at no limit, all 1,582 words and 96,470 chords,
  which is the case the bundle work was for, and its letter disc is animal too,
  off the same file, so the page fetches one word file for the two of them. A
  page carrying the word disc and the nested one is where two threads with a
  worker apiece are exercised — which is also why embedding one section does not
  depend on embedding another. `tools/serve.py`'s
  `translate_path` looks a top-level name that is not in `web/` up in `out/`
  before giving up, which is what lets that one page run unchanged under `make
  serve` as well as out of the dist directory rather than carrying two sets of
  paths. Its `Server`, a subclass of `ThreadingHTTPServer`, returns from
  `handle_error` for `BrokenPipeError` and `ConnectionResetError` and defers to
  the base class for everything else: a reload makes the browser abandon the
  sockets it has open, and the reset surfaces in `handle_one_request` reading the
  request line, outside any handler code the file owns, so socketserver printed a
  full traceback for the normal end of a connection and saving a file wrote a
  stack trace into the terminal the watcher reports into, which is the one place
  a real error has to be legible. `_stream` already swallowed the same two for
  the reload channel; this is that rule applied where the read happens between
  requests rather than inside one. A socket opened and abandoned with
  `SO_LINGER 0` writes the traceback on the unpatched server and nothing on the
  patched one, which goes on serving. The Makefile names the page in `EMBED`
  beside `MODULES`, so `$(DIST)` takes it as a prerequisite and copies it. The
  directory is emptied and refilled rather than copied into, and `web/.` is a
  prerequisite alongside the modules, because a directory's timestamp moves
  when a file enters or leaves it and that is the only thing that catches a
  module deleted upstream. Flat works because the modules import each other by
  relative path and the worker resolves through `import.meta.url`, so the
  directory runs wherever it is served from. The three data files are one
  grouped target (`&:`) rather than three rules, so the exporter walks the
  corpus once rather than three times.
- `<word-disc>` is `render.words_disc` made interactive: pick a word, every word
  that can follow it lights up, pick again, and the chain reads out under the
  disc. The successors of a word are a whole wedge — every word starting with
  the letter it ends on — and never a list stored per word, which is `graph.py`'s
  claim that the game lives on 26 nodes and the word graph is the line graph of
  that one. Materialising the edges is 96,470 of them for animal at `limit 0`,
  against 26 arrays. A word cannot follow itself, the same exclusion `render.py`
  makes when it builds the bundle.
- The element draws every word the category has unless the host names a `limit`,
  where `build` draws 110. Zero is no limit rather than a blank disc, the way a
  lifted count reads in a head or a tail. The two differ for a reason rather
  than by drift: the SVG grows its canvas until adjacent labels clear each other
  and shrinks the type once it runs out at 30 inches, where the element has
  whatever frame the host gave it and drops the labels instead. A count is a
  thing to ask for on a disc that cannot grow. Measured uncapped in a 720 px
  frame, 19 of the 37 categories keep their labels, down to building at 207
  words and 5.6 px, and all 37 keep the resting bundle, animal's 96,470 chords
  included. The 7 that drop their labels are drug, body-part, city, plant, job,
  food and animal, from 750 words and 24,898 chords up to 1,582 and 96,470,
  which used to be past `MAX_BUNDLE` too. Where the labels go, the hub names
  what the pointer is on and the search box reaches a word by name, so the disc
  is still played the same way.
- Every word that could be played next is listed in the column beside the disc,
  under the search box, where nothing was drawn before. The suggestions only
  take that room while the box has something in it, and that is the rule between
  the two: suggestions while you are typing, moves otherwise. The list is the
  whole set sorted alphabetically, which is how a word is found by eye in a list
  that runs past the column, and nothing is capped: scrolling reaches the end of
  any list. A word already played leaves the list and comes back when play is
  wound off it, since `Chain.legal` is what fills it, the same method the disc
  paints from. Hovering an entry is hovering its dot and clicking one is
  clicking it, both through `#preview` and `play`, so the column and the disc
  cannot describe different things. It earns its room where the disc cannot
  label itself: uncapped, the 7 largest categories drop their labels, and the
  column is then the only place the moves can be read rather than found among the
  dots. It is also where it overflows. Animal's median word offers 60 replies
  and its worst 187, against the 15 to 31 rows a column holds one up, so the
  list runs two up and scrolls. Rows go into the DOM a page at a time,
  `MOVES_PAGE` being 200, and the next page follows when a scroll comes within
  `MOVES_NEAR` of the foot, 240 px, so the work per move is a page rather than a
  category. A page overfills the column at any size the column can be, 100 lines
  two up against those 15 to 31, so the scrollbar says at once that there is
  more, and a page that somehow did not fill the column asks for the next one
  itself rather than waiting for a scroll that will never come. Rows already
  placed stay placed. Nothing is thrown away as it goes out of view, so
  scrolling back up is free and the scroll position never has to be guessed at,
  which is what makes this an append rather than a windowing scheme. 200 is
  where no move set is ever paged, the largest over the 37 categories being
  animal's 187, after "mollusc", so a move set arrives whole and paging only
  ever concerns the list before the first move, which is the whole category
  rather than a set of replies to anything, 1,582 words for animal.
  Landscape only, like the readout's placement: the stacked layout has no
  column, and there the suggestions are a dropdown over the disc. Nothing is
  built in that shape, since it would be several hundred elements behind
  `display:none`. The rows are inline blocks of half the width rather
  than a two-column grid. A grid drew every box with nothing written in it once
  the rows overflowed the column, so the fix is the construct that cannot fail
  that way rather than a patch to the one that did: a scrolling block of inline
  blocks is the oldest layout there is, and the reading order came free with it,
  left to right and then down, which is what inline blocks do. The row sets its
  own colour and leading rather than inheriting them, on the principle that a
  list which drew no text should depend on as little from outside as it can, and
  `box-sizing: border-box`, because the page's own box-sizing rule does not
  cross into a shadow root and content-box put two halves and their padding past
  the width and wrapped every second word onto a line of its own. The list
  carries a box of its own as well, a 1 px `--_edge` border on the `--_panel`
  ground with 3 px of padding, which is the box the suggestions already draw in
  that room. It was `flex:1 1 auto` inside a stretching row already, so the
  border runs down to the definition at the foot of the column however few words
  are in it.
  An inline block sits in a line box that holds the inherited strut too, and the
  strut's descent hangs below a row aligned to the top of that box. That left a
  few pixels of list between every pair of rows that belonged to no row, which a
  pointer travelling down the column crossed between each pair.
  `line-height:0` on the list zeroes the strut, the line box comes out the
  height of the row itself and the rows abut, and every row sets its own
  `line-height:1.5`, so nothing else moves. It is deliberately not
  `font-size:0`, the careless version of the same fix: a row that drew no text
  would still be a visible box under that, which is the fault the grid this list
  replaced was thrown out for. The 8 px `margin-right` that used to sit between
  the two rows of a line went for the same reason, dead ground between two hover
  targets. The rows are `width:calc(50% - 1px)` with no margin, so the pair
  still comes to 2 px short of the width and no rounding can wrap them, and the
  words are held apart by their own 5 px side padding.
  Closing those gaps left the hover highlight still blinking off and on as the
  pointer went down the column, and the geometry was only a contributing cause.
  The actual one was the list's own `pointermove` handler, which read
  `e.target.closest("li[data-i]")` and, finding no row, called `#preview(-1)`
  and cleared the hover. A pointer is over the list and over no row at every
  seam that is left: the list's 3 px of padding, the 2 px of slack at the end of
  a line, a hairline between two rows abutting at a fractional width. So every
  crossing cleared the preview and the next row set it again, however narrow the
  seams were made. A move landing on no row now returns and holds whatever the
  last one set, and leaving the list is the only thing that clears the hover,
  which is what the `pointerleave` listener beside it has always been for.
- `word-layout.js` is that figure's layout written a second time, so the browser
  and the SVG put the same word at the same angle: the same 3.5 degree gap, the
  same wedge order, the same `_fan_key`. `check_web.mjs` holds it to the Python's
  ordering, and a change on either side has to be made on both. `solve`, `turns`
  and `at` sit there rather than in the element, because a sizing that comes back
  with a negative radius is exactly what nothing downstream tests for and `make
  check` can; the hub is held to 0.55 of the ring so a frame too small for the
  label floor cannot leave it swallowing the dots.
- A word already played is not a move. Refusing it rather than recording it puts
  the whole of the rule in `Chain.legal`, which is what the disc paints, what the
  readout explains and what the cursor follows, so a word that cannot be played
  cannot look, read or click as though it can. The refusal is legible three ways
  before the click: the word keeps the warning colour wherever it appears, the
  readout under the pointer says it is already played, and the cursor drops back
  to an arrow over it. That last one is why `canvas.over` is `cursor:default`
  and `#onMove` lifts it to a pointer over a legal word or over the hub with a
  chain to wind back; the inline style is written only when it turns over, since
  a pointer move fires several times per wedge. `--disc-warn` is still the
  custom property, standing at the theme's `dead`. "A word cannot follow itself"
  now falls out of the same test rather than being written down, since the word
  play is standing on is used.
- The readout names the word and counts what can follow it, `fetus · 171
  possible next words`, and marks the word's own last letter in place rather
  than naming it again after the word, where it used to read `fetus hands over
  on S · 171 words can follow it`. That letter is the whole of what decides the
  next move, so it belongs where it sits; naming it separately said the same
  thing twice and put the count a clause further away than it needed to be. The
  mark is a colour and a rule, the accent and an underline, never the colour
  alone, since colour by itself says nothing to a reader who cannot see it. The
  end of the round has two shapes the readout tells apart, one clause each: `no
  possible next words: nothing starts with U`, a letter the category never had a
  word starting with, against `no possible next words: every A word is used`,
  one whose words the chain has spent. Only the first is a fact about the
  category. `Chain.replies(i, byHead)` is asked of the word the pointer is on
  and of the word play is standing on, and because the latter is itself used,
  the same method answers "what could follow this" and "what can be played
  now".
- The crumb line's root is the category, and winding back to it clears the
  chain, which is the only way to open on a different first word. Without it
  the first word was a dead end, since the one step of a one-step chain renders
  as the name you are at rather than as a button and there was nothing before it
  to click. It does `<hypernym-disc>`'s job and deliberately not its shape:
  there the root is a node on the path and looks like the rest of it, where here
  the category is where the words came from rather than one of them, and drawing
  the two alike had it reading as the first word played. So it is a label rather
  than a step — the body face against the steps' monospace, italic and muted,
  with a rule beside it rather than a chevron. The chevrons then separate one
  word from the next and never the label from the first word, which is why
  `#showTail` adds one only where a word precedes its preview. It is muted until
  pointed at, taking the accent and an underline on hover, so it offers a way
  back without competing with the steps, which are the path. It is held at the
  crumb line's own font size, so its line box cannot be the taller one and give
  the line a height that depends on what it holds.
- `disc-colour.js` holds `TAU` and `hsv`, moved out of `disc-paint.js`: all
  three discs read the same letter wheel and `<word-disc>` needs none of the
  rest of that 405-line Painter. `disc-paint.js` re-exports `TAU`, so its import sites
  and `hypernym-disc.js`'s are unchanged.
- Both elements redo their text measuring when `document.fonts.ready` settles.
  Canvas text is measured rather than laid out: the DOM reflows when a face
  swaps in, a drawn pixel cannot, and `disc-label.js`'s `fit` is cached on
  `radius|text` carrying the font string it settled on, so nothing re-runs by
  itself. A host serving its monospace unpreloaded under `font-display: swap`,
  which is IBM Plex Mono on the site this is embedded in, paints the first
  frame against the fallback and then replays that cached fit in the real face,
  at a size and a line break solved for the fallback; where the fallback is the
  narrower of the two the fitted line runs past the hub radius.
  `<hypernym-disc>` calls `repaint()`, which drops `#fits` and `#toks` and draws
  again, and that is the whole of it there. `<word-disc>` calls `#resize`
  instead, because it also solves its label size from `#widest`, one
  `measureText` per drawn word and 1,582 of them for animal uncapped, which
  `repaint()` leaves alone along with the geometry solved off it. `#resize`
  drops `#widest`, `#fits`, `#toks` and `#bands`, measures and solves again,
  and is idempotent against a box that has not moved; it is guarded on `#box`,
  null until the first fit, since a face landing before that is the face the
  first fit measures with. It leaves the bundle alone, and rightly: that is
  chords rather than text, so no face it is drawn beside can change it. `tools/check_web.mjs`'s stub resolves
  `document.fonts.ready`, so the callback is run rather than only parsed, which
  is the fault that check exists for. The limit is that `document.fonts.ready`
  settles once: a face that only starts loading afterwards never fires it
  again.
- The resting bundle is every chord the SVG draws, held in a square of its own
  rather than in the frame's canvas and blitted per frame, dimmed to 0.22 once a
  chain is being built. It is a stroke per chord rather than one path per
  letter, because the alpha has to accumulate where curves overlap the way it
  does in the figure; batched into one path a bundle composites once and reads
  flat. `web/word-bundle.js` holds the three parts with no DOM in them: `curve`,
  the chord cubic, `bundle`, the picture stroke by stroke, and `square`, the
  sizing. The ring sits at `RING` of that square, 0.496, and the element inverts
  that to blit — `side = r / RING`, centred on the disc — so a resize is a
  scaled `drawImage` rather than a rebuild. The square is `(r * dpr) / RING`
  rounded up to `STEP`, 256 device pixels, and capped at `MAX_PX`, which is
  derived from `disc-ratio.js`'s `MAX_AREA` rather than written down: the ring
  fills the frame, so a square stage of side s at ratio d wants about s × d,
  and the budget holds s × d to the root of `MAX_AREA`. That is 3,072 today, a
  37.7 MB bitmap at the one disc size that reaches it, and a disc larger than
  that is blitted up. Derived because a cap short of the budget blurs the
  bundle alone while the dots and the labels drawn over it stay sharp, which is
  the fault a number written down here would come back as the next time the
  budget moved. The step is what
  makes a drag cross a size boundary a few times rather than rebuild on every
  frame. `curve` is shared: the element draws its fan and its chain through the
  same function the bundle strokes with, so the resting picture and the live one
  cannot be drawn to different shapes.
- The bundle is drawn band by band rather than letter by letter. Alphabetically,
  every chord leaving Z composited over every chord leaving A and the fringe
  read as the back of the alphabet. `bundle` cuts each letter into `BANDS`
  slices, 64, each sized to that letter's own share of its chords, so a wedge of
  12 chords is spread through the stack as widely as one of 10,000 and every
  letter reaches both ends of it. Spreading alone was not enough: drawn in the
  same order within every band, a letter still sits under its neighbour at every
  crossing, and rotating the order per band keeps that cycle and only moves
  where it starts, so A still went down before B in 25 bands of 26. The bands
  run alternately forwards and backwards, which puts every pair one way in the
  even bands and the other way in the odd ones, and joins each band to the next
  on the same letter, 1,600 colour changes rather than 1,663 over a
  10,400-chord test set. Nothing is shuffled and no seed is drawn: the order is
  fixed by the word set alone, so two builds of the same disc composite
  identically and neither a resize nor a theme change can make the picture
  shimmer, which a random permutation would, since the bundle is rebuilt
  whenever the square or the colours move. 64 is where the two costs meet. The
  colour is what canvas has to parse, and a letter drawn in one run sets it 26
  times where a per-chord shuffle would set it once per stroke, 96,470 times on
  animal; band by band the ceiling is 26 × 64 = 1,664 whatever the category, a
  rounding error against animal's strokes, and a category small enough for that
  ceiling to be a large share of its own strokes has nothing expensive to share.
  It is fine enough to matter as well, cutting animal's busiest wedge into
  slices 8 chords deep. The chords are still never listed out. A cursor per
  letter carries `at` and `to` across the bands so each one resumes where the
  last stopped, since materialising animal's 96,470 edges is what `graph.py`
  exists to avoid.
- The alpha is thinned by the chord count. It accumulates where curves overlap,
  which is what gives the bundle its shape, so a category with eight times the
  chords lays eight times the ink into the same disc and the middle, where every
  long chord is bowed through, floods: at the 0.11 the dense categories are drawn
  in, a pixel crossed by 26 chords is 95% opaque. That 0.11 was tuned against
  bundles that were never dense, since the old ceiling stopped anything past
  24,000 chords being drawn at all and the densest ever actually drawn was
  language's 11,249. So `thin(alpha, chords)` returns the alpha unchanged at or
  below `KNEE`, 12,000 and just above that figure, and `alpha * (KNEE / chords)
  ** FALL` above it, with `FALL` at 0.7; `word-disc.js` calls it on the tuned
  value it already computed. Over the 37 categories 30 come out exactly
  unchanged, the knee not having moved, and the seven the ceiling used to refuse
  are thinned, animal 0.110 to 0.026, food to 0.037, job to 0.040, plant to
  0.042, city to 0.050, body-part to 0.051 and drug to 0.066. 0.7 is the
  compromise between two wrong answers, the square root having been the first
  guess and still reading thick at the top of the range. Holding the ink per
  pixel level wants the alpha to fall as 1/chords,
  which takes animal to 0.013 and rubs the picture out, and leaving it flat is
  what floods. `FALL` is the knob if the fringe still reads thick, and it is an
  exponent rather than a second constant because the knee is where the falloff
  has to start whatever its steepness. It lives in `word-bundle.js` rather than
  in the element for the reason `solve` and `square` do: an alpha that comes back
  at zero draws nothing and one above the tuned value draws more ink than that
  value was tuned at, and the element could notice neither. `check_web.mjs`
  asserts the shape rather than the numbers — unchanged at the knee, unchanged
  for a sparse category, animal thinner than drug, and animal still above a
  hundredth, since a half-pixel stroke is already partially covered and an alpha
  below that is a bundle that is drawn and cannot be seen.
- The build being once per word set rather than once per size, and off the main
  thread, is why `MAX_BUNDLE` stands at 200,000 rather than 24,000. The old
  ceiling cost the seven largest categories their picture at `limit 0`: animal
  holds 96,470 chords, food 57,320, job 50,275, plant 48,033, city 36,693,
  body-part 35,732 and drug 24,898. Chords go as the square of the words, so
  200,000 draws every category the tool ships at no limit and refuses a list
  half again as large. It is a guard against a word list nothing here has rather
  than a judgement about when a bundle stops reading as a picture.
- `word-bundle-worker.js` is its own worker rather than `disc-worker.js`, for
  two reasons. That one is handed the nested disc's canvas through
  `transferControlToOffscreen` and holds it for the life of the page, so it can
  serve one element and no other; and the two jobs are the wrong pair to queue
  behind each other, since the nested disc paints per frame where a bundle is up
  to 96,470 strokes in one go. A page carrying both elements gets two threads,
  which is the count it wants. This one owns nothing between messages — it makes
  its own `OffscreenCanvas` and transfers an `ImageBitmap` back rather than being
  handed a canvas — so it is terminated when the element disconnects, where
  `disc-worker.js` must not be, and there is nothing that can only be given away
  once. A page holding several word discs could share one instance; they get one
  apiece instead, so two discs build in parallel rather than in turn. It is
  opened when a bundle is first wanted rather than when the element connects,
  since its module fetch would otherwise race the word file's for a picture that
  cannot be drawn until that file lands. The `ready` handshake and the 400 ms
  `WORKER_FLOOR`, timed from the first bundle actually wanted rather than from
  the worker's construction, are the nested disc's and are kept for the same
  reasons.
- `word-bundle.js` exports `release(pic)`, which closes an `ImageBitmap` and,
  where there is none, empties a canvas by setting its dimensions to 0. A
  bitmap's pixels sit outside the JS heap, so a bundle that has been replaced
  reads to the collector as a small object under no pressure and the tab holds
  its 12.3 MB for as long as it likes: at the disc height the embedding article
  uses, `max(26rem, 100vh - 4rem)` and so about 836 CSS px on a 900 px window,
  the square rounds to 1,792 device pixels, which is 12.3 MB a bundle. A
  category pick and a theme change each replace one, being the two things that
  bump `#gen`, and so does every crossed 256-pixel size step. A pick used to
  orphan 12.3 MB on the main thread and about 25 MB in the worker, so going
  through the 37-category picker was roughly 1.4 GB of pixels nothing was
  drawing. Safari
  reloaded the page carrying both elements "because it was using significant
  memory", and this was the cause. It sits in that module rather than in either
  caller because both drop the same picture and neither can tell whether it
  went, which is the argument `solve`, `square` and `thin` are already there
  for. `word-disc.js` calls it at three sites: the bundle being replaced in
  `#gotBundle`, one that arrives after the disc has moved on and is dropped by
  key, and the word-set change in `#build`. The worker keeps one
  `OffscreenCanvas`, sizes it per message and empties it to 0 by 0 as soon as
  `transferToImageBitmap` has taken its pixels; made afresh per message it cost
  two buffers a build, the one drawn on and the blank one
  `transferToImageBitmap` leaves behind, in a thread whose JS heap is a few
  kilobytes and whose collector therefore has no reason to run. What is
  deliberately not released is the bundle held over a `disconnectedCallback`,
  since a reattached element blits it until a replacement lands, and
  `disc-worker.js`, which is still left running for the reason above.
- The held bitmap goes on being blitted, stretched to the new radius, until a
  newer one lands, so a rebuild has no blank in it. A word-set change is the
  exception and drops it, since those words are no longer on the disc. A theme
  change keeps it: the letter wheel comes off two custom properties, and a
  moment of the old colours reads better than the picture going out and coming
  back. The cache is keyed on a generation counter, bumped by a word set or a
  theme, and on the size step. `stats`, and so the `word-render` event, carries
  `bundlePx`, the square the bundle is held at, and `thread`, "worker" or
  "main".
- `check_web.mjs` covers all of it. `square` is asserted directly, because a
  square short of the ring it holds draws a blurred bundle and nothing
  downstream can tell — the same argument `solve` is held to in
  `word-layout.js`. The blit's inversion of `RING` is asserted against the
  geometry the click test already computes, since a factor wrong in either draws
  the whole picture at the wrong scale and no count of strokes or blits would
  notice; reversing it fails the check. A four-pixel resize restrokes nothing
  where a two-hundred-pixel one restrokes 31,084, which is what says a resize is
  a blit. The 900-word crowd keeps the bundle it used to lose. The
  `ResizeObserver` stub keeps its callbacks and what each one was given to
  watch, so a resize is driven the way a browser drives it rather than through
  a private method: `resize()` runs an observer only where one of its own boxes
  has moved. Modelling the targets is the point rather than the fidelity. An
  element can measure one box and observe another, and then a change to the box
  it measures raises no callback and the element never learns of it; firing
  every callback on every resize hides exactly that, and hid it here until the
  stub was made to model it. All three elements are put through the round trip
  for it — stacked and then dragged wide again with the stage left where it
  was — and dropping the frame from any one of them fails the way back and not
  the way in.
- The label size is solved rather than set, the same equation as `_wanted_inches`
  and `_disc_limit` turned round: there the canvas grows until adjacent labels
  clear each other, here the canvas is whatever the host gave, so the type takes
  the shortfall from the start. Below 5.5 px the labels are dropped rather than
  smeared and the hub names what the pointer is on instead, which is the whole of
  what a label was for. In a 720 px square: 110 words solve to 12.3 px, 200 words
  to 7.4, and at 400 the labels go and the ring takes their room, 260 px to 325.
- Hit testing is one binary search over the placement order: turns clockwise from
  the top are strictly increasing by construction, so there is no spatial index,
  the same argument the nested disc makes. Both neighbours are tested, since the
  search lands below the query and the slice above it may be the nearer one, and
  the gaps between wedges belong to nobody.
- Two canvases and no worker. The base moves on a move — bundle, fan, chain,
  dots, labels, wedge letters — and the overlay on a pointer: the hub, a ring on
  whatever it is over, and a preview of the fan that word would open. The bundle
  being cached is what makes a click a blit and a fan. Clicking the hub is the
  way back, one step, which is the one thing clicking a word cannot do. Nothing
  is drawn behind it now: a panel disc wide enough to hold the name covered the
  middle of the figure, and the middle is where the long chords cross, so it is
  the part worth seeing rather than the part to cover. The name cannot simply sit
  on the bundle unaided, and that was measured rather than assumed: 100 to 280 of
  a category's drawn chords pass inside the hub's radius, 279 of 658 in element
  at the worst and 183 of 449 in animal, and 100 to 156 of them come within 0.15
  of the ring's radius of dead centre. So the text carries its own ground
  instead. It is laid under the fill in `--disc-ground` as `HALO_STEPS` copies
  of the same `fillText` the ink uses, 8 of them ringed at `HALO` of the type
  size and never under 1 px around each baseline, so the union reaches that far
  past every letter. The only thing it hides is the shape of its own letters.
  It was a `strokeText` under the fill, at twice that as a line width with a
  round join, and the argument for it was that a stroke is centred on the glyph
  outline and so cannot sit off to one side of the letter it belongs to. That
  is true of the geometry and not of what is drawn: a stroke is taken off the
  outline where a fill is a rasterised glyph, the two are positioned by
  different code, and the halo read as a shadow lying down and right of the
  word. It survived the fix below, and it went when the discs got sharp enough
  under zoom to see it plainly. Copies cannot drift that way, since every one
  is the call that draws the letters and the offsets sum to nothing, and
  `check_web.mjs` asserts exactly that: one text, one radius, and a ring whose
  centre is the point the ink goes down at. Eight directions leave a scallop
  0.076 of the reach deep, a tenth of a pixel at the top of the ladder. `HALO`
  is 0.08 rather than 0.16 because it is now the reach rather than a width, so
  the picture is unchanged: 1.3 px clear of a glyph at 16 px type, against
  chords half a pixel wide. At 0.3 of a 33 px name, the size the ladder used to
  top out at, the ground merged the letters into one slab and read as a shape
  behind the word rather than as ground around it.
  The other half of the same complaint was the block being centred on
  the em square: `textBaseline: "middle"` centres a box whose descender space is
  empty for most words, so the type sat a pixel or two low — invisible at 12 px
  on a panel, and a halo hanging off the bottom of the name at 33 px over the
  bundle. `textBaseline` is alphabetic and the hub places its baselines by hand
  for that reason. What they are centred on is a band measured off the face
  rather than off the word: centring each line on its own
  `actualBoundingBoxAscent` and `actualBoundingBoxDescent` gave every word its
  own baseline, so "iris" stopped at the dot and sat lower where "guppy" ran
  below the baseline and sat higher, and the name moved up and down as the
  pointer crossed the disc. The band is `HUB_REF`, the string "Hd", a capital and
  an ascender, which between them reach the top of anything a name can hold, and
  no descender, since what sits below the baseline should hang below the centre
  rather than move it. It is measured once per font and cached in `#bands` beside
  `#fits`, cleared with it on a resize or a restyle, either of which can change
  the face. `HUB_RISE` and `HUB_DROP`, 0.72 and 0.2, are the proportions of a
  Latin line, used where a context reports no ink metrics and to leave the "↑
  back" hint its room under a name that may or may not end in a descender, which
  is what used to put the hint lower under those. With no outline drawn, that
  hint and the pointer cursor are what mark the hub as clickable; its radius is
  unchanged.
- `disc-label.js`'s `fit` takes an optional size ladder and weight and defaults
  to what it had, so `<hypernym-disc>` is untouched at 12 down to 8 px and weight
  500, and `<word-disc>` asks for 16 down to 8 at 700. Its hub is the larger of
  the two and the name is the only thing in it, where the nested disc's hub
  shares the middle with a ring of its own children. A larger ladder on its own
  made the long-word categories *worse*: with the back hint showing, disease
  dropped 33 of its 110 words to the bottom of the ladder, below the size they
  already had, since the ladder ran out of room sooner and stepped further down
  it. So the name got more room as well as more type. The hub is one radius
  doing both jobs, what a click in the middle undoes and what the name has to
  fit inside, and keeping them as one number is what stops the outer half of a
  name sitting somewhere a click does nothing. It grew by half — `HUB_SHARE`
  from 0.3 to 0.45 and `HUB_MIN` from 44 to 66 — when the panel disc behind the
  name went, which was free, since the space is empty now and the name carries
  its own ground. `HUB_MAX` still caps it, and the dots are hit-tested from 0.62
  of the ring outwards, so there is a band between the hub and the innermost
  word where a click means neither. `HUB_SIZES` topped out at 33 when the panel
  went and the room it had been taking came free, and taking that room was the
  mistake: set that large the name is the figure rather than a label on it, and
  the figure is the disc, whose long chords cross in the middle the name sits
  over. It runs 16 down to 8 now, and it is the weight rather than the size that
  sets the name apart, since `disc-label.js`'s own ladder tops out at 12 and this
  one at 16. Legibility over the bundle is the halo's work rather than the size's.
  `HALO_MIN` went from 3 px to 2 as a consequence, and to 1 with the halving
  that made `HALO` a reach: against a ladder topping out at
  16 a 3 px floor would bind at every rung and `HALO` would never be read, where
  at half that the fraction rules the three rungs a real disc uses and the floor
  rules the two degraded ones. The "↑ back"
  hint stays at 11 px, so the hierarchy under the name is unchanged, and the
  ladder keeps the two low rungs the shorter one ended on, which no disc of a
  usable size reaches: they are there so a frame too small for the hub to mean
  anything degrades as it did rather than worse. `fit`
  returns the size it settled on as well as the leading and the face, since the
  halo is scaled to the type.
- The gloss and the crumb below the disc are held to a height whatever they
  hold, and that is what stops the disc moving under the pointer. Under `fit`
  the frame is a flex column and the stage takes what those two leave, so a
  block that grows by a line takes a line off the disc's height and, the stage
  being square, as much off its width. The crumb was the one that bit: it is
  empty until the pointer names a word, so crossing onto the disc shrank it,
  moved the words out from under the pointer, and fired the resize observer,
  which rebuilt the bundle a stroke at a time. `<hypernym-disc>` never showed
  it because its crumb carries the root's name from the first zoom.
- `index-src` names a `words-index.json` and is the whole of the category
  picker: given one, the element fetches the index and puts a `<select>` of the
  categories at the head of the column, above the search box. Named without it
  nothing is built, since a page embedding a single disc is one category and one
  file, and the picker is hidden as well where the index holds fewer than two
  categories. Where a category's words are is its one piece of arithmetic:
  `export_words.py` writes the 37 files and their index flat and side by side
  and `web-dist` stages them that way, so the element takes the index's own path
  and swaps the last segment, `/out/words-index.json` to `/out/words-bird.json`.
  No base URL to resolve against and nothing for a host to name twice, and the
  one thing it cannot survive is a query string on the index, which a directory
  of exported files does not have. Choosing a category sets the element's own
  `src`, so a pick goes down the load path a host swapping `src` already had and
  the chain, the layout and the held bundle all go with it, a chain over words no
  longer drawn having nothing to stand on. An index named without a `src` opens
  on the first category in it rather than on a blank disc: `#load` has already
  run and found nothing by the time the index resolves, so a `src` written by
  hand still wins. The picker follows the words rather than leading them —
  `#mark` is called from the `data` setter as well as after the options are
  built — which is what makes the select right whichever of the index and the
  word file lands first, and what moves it when a host sets `src` by hand.
  `search="off"` is about finding a word, so it still hides the search box and
  the moves list and it leaves the picker: the picker is the search box one
  scale out, that one reaching a word inside a category and this one reaching
  the category, so it sits at the head of the same column without being part of
  that box. The select keeps its native appearance, since stripping it takes the
  arrow with it and the arrow is what says the control opens a list. The
  landscape grid gained a row for it, `grid-template-rows` running `auto
  minmax(0,1fr) auto auto`, and there is no row-gap, so with no index named that
  row measures nothing and every distance below it is what it was before the
  picker existed. A row measuring nothing puts the top edge of the column's box
  at the search box's own top, where the picker's 10 px of top padding was the
  inset, so `:host([fit]) .frame.wide .pick[hidden] + .find{padding-top:10px}`
  puts it back there.
- `tools/export_words.py` writes `words-<category>.json`, one per category, plus
  `words-index.json`: 37 categories, 13,212 words, 197 KB. Flat names rather than
  a directory, since `web-dist` stages everything side by side and the modules
  find each other by relative path there. Each file holds the whole category in
  `render.py`'s own order and the element cuts it at its own `limit`, so a host
  changing that attribute refetches nothing. It reads `[selection]` the way every
  command does, so what the element draws is what `build` would draw. The
  Makefile's `WORDS` is one grouped target (`&:`) for the same reason the tree
  is: one run resolves every category, where 38 ordinary rules would load WordNet
  38 times. `serve` and `web-dist` both depend on it. `web/index.html` stays the
  nested-arc harness and `web/words.html` is the word chain one, whose category
  picker is the element's now: it names `src` and `index-src` and nothing else,
  its own header `<select>` and the script that filled it from the index having
  gone. `web/embed.html` names one category per section and no picker.
- `<letter-disc>` draws the graph `<word-disc>` is the line graph of: 26 nodes,
  one arc per letter pair some word bridges, the arc's width the log of the
  words on it. It is `graph.py`'s claim drawn rather than printed. animal is the
  worst case at 344 populated pairs of the 676 possible, from 1,582 words,
  against food's 321, plant's 297, city's 286, element's 141, colour's 67 and
  dog's 63. Weights run 1 to 32 on animal and to 45 on food, 103 of animal's 344
  arcs carry one word, and 12 of them run a letter back to itself, holding 52
  words between them. It reads the same `words-<category>.json` `<word-disc>`
  reads and counts the 26x26 matrix out of it in one pass, so there is nothing
  new to export, no new Makefile target, and a page carrying both discs fetches
  one file for the pair. `index-src` gives it the same category picker, and
  `web/letters.html` is its harness, naming `src` and `index-src` and nothing
  else the way `words.html` does.
- Nothing on it is bundled. Edge bundling buys clutter reduction and pays
  traceability for it, and at 344 arcs every arc is an individually meaningful
  object, clickable and carrying a count, so merging two destroys the thing the
  widget exists to show. It is the right tool at `<word-disc>`'s 96,470 equal
  chords, where no individual chord matters and where `PULL` already does the
  degenerate case of it, and the wrong one here. What declutters at this scale
  is the log width, the split arcs and the hover.
- The width is `log1p` of the word count rather than the count. Drawn linearly
  the 103 weight-1 arcs are a thirtieth of animal's 32-word trunk and disappear;
  the log takes that ratio to about 5 to 1. `log1p` rather than `log` because
  `log(1)` is 0 and an arc of no width is an arc that was not drawn.
- A letter's own arc is the sum of the log weights of every arc touching it, so
  one unit of weight is the same number of degrees everywhere on the ring, a
  ribbon comes out the same width at both its ends, and that width means one
  thing wherever it is read. Equal arcs per letter would make a quiet letter's
  ends fat and a busy letter's thin, so every ribbon between the two would be a
  trapezoid claiming two different counts, which nothing downstream could tell.
  `check_web.mjs` asserts the degrees per unit directly, and adding a floor back
  under a letter fails it. One was tried and removed for exactly that reason,
  and it buys little: over the 37 categories the quietest letter is plant's at
  0.61° of the ring, 3 px at a 300 px radius, and animal's is 1.14°.
- Each letter's arc is split, the leaving half first as the ring is read
  clockwise and the arriving half after it, each taking its own share of that
  letter's weight. So direction is in the geometry rather than in an arrowhead:
  an arc leaves the bright half of one letter and lands in the dim half of
  another, the ring band being drawn at the letter's own colour on the leaving
  half and dimmed on the arriving one. A ribbon's target end is tapered to 45%
  of its slot as well, which is the second thing saying which way it runs. The
  split point says at a glance whether a letter is somewhere play sets out from
  or somewhere it arrives.
- The pull runs with the turn, 0.82 at no turn at all down to 0.14 at half the
  circle, where `<word-disc>` uses a fixed one. Fixed is right there, since a
  chord joins two of 1,582 dots and the ones worth seeing are long. Here 31% of
  animal's 344 arcs cover less than a third of the turn and 12 run a letter back
  to itself, and at a long chord's pull every one of those is a spike pointing
  at the middle. So a long arc dives nearly to the centre and a loop hugs the
  ring it leaves.
- A ribbon is filled rather than stroked, so the alpha accumulates wherever two
  overlap, and the middle, where every long arc is bowed through, is where they
  all do. animal draws 344 arcs into the ring colour draws 67 into, so
  `fade(alpha, pairs)` returns the tuned 0.5 at or below a knee of 120 pairs and
  `alpha * (120 / pairs) ** ALPHA_FALL` above it, `ALPHA_FALL` standing at 0.5:
  animal comes out at 0.295 and food at 0.306, where colour, element and dog are
  untouched. It is `word-bundle.js`'s `thin` in the same shape and it lives in
  `letter-graph.js` for the same reason — an alpha that comes back at zero draws
  nothing and the element could not tell.
- No worker and no held bitmap. 344 filled ribbons is a frame's work where
  `<word-disc>`'s 96,470 strokes is a thread's, so a resize redraws rather than
  blitting a picture already built.
- The pointer highlights and a click drills, the split all three discs make.
  Pointing at an arc or a letter lights it and dims the rest, by one scrim fill
  over the frame rather than a second pass over 344 arcs, which takes the ring
  bands and the letters down with it so the highlight reads against the whole
  figure. A letter lights everything touching it in either direction. The column
  beside the disc lists whatever letter was last clicked into and never what is
  hovered, which is what stops a list rebuilding under a pointer on its way to a
  row. At rest it is every arc the category has, heaviest first; drilled into a
  letter it is that letter's arcs, the leaving ones and then the arriving ones,
  the arriving rows dimmed as the ring band has them. Clicking the hub puts it
  back to every arc.
- The readout under the disc names the words on the arc the pointer is on rather
  than counting them: an arc is 32 words and the readout is which 32, up to 14
  of them, which is what ties this disc to `<word-disc>`. The search box reaches
  a word and highlights the arc it sits on, since a word is not drawn here and
  its letter pair is. The labels are 26 single letters outside the ring, dropped
  where the arc is narrower than the glyph, with the hub naming what the pointer
  is on instead, which is `<word-disc>`'s answer at its own label floor.
- Hit testing is three tests over three bands. The ring band answers with an arc
  by binary search over ends laid out clockwise from the top, the same absence
  of a spatial index both other discs have, and the ends tile each half of each
  letter exactly, so there is no dead ground in it. The band outside the ring
  answers with a letter. Inside the ring the path itself is asked, through
  `isPointInPath` with the transform dropped and topmost first, since a ribbon
  there is a curved shape no arithmetic short of the path describes.
  `letter-graph.js`'s `near` refuses three quarters of them before a path is
  built at all, for the price of two comparisons: every point of a ribbon lies
  in the convex hull of its four ring points and their control points, and the
  control points sit on the rays to the ring points, so the hull is inside the
  wedge those four turns span — as long as that wedge is under half a turn,
  past which the hull reaches the centre and the wedge stops saying anything.
  That wedge is the complement of the largest gap between the four rather than
  the span from the lowest to the highest, which is what finds it when an arc
  runs from the first letter to the last and its own wedge wraps through the
  top of the ring. Over 720 turns of animal's ring 85 of its 344 arcs survive,
  79 of 321 on food and 15 of 67 on colour, and every arc those three draw is
  narrow enough to be pruned at all, food's widest excepted. It is a prune
  rather than an answer, so what it owes is never refusing a point that is on
  the arc — the claim `disc-search.js`'s character mask is held to, and checked
  the same way, by walking the thing itself.
- The chord cubic lives in `disc-colour.js` as `bow`, the bezier alone with no
  `moveTo`, and all three discs draw it. `<letter-disc>`'s `ribbon` walks a
  closed boundary, so it cannot afford a `moveTo` at every crossing.
  `word-bundle.js`'s `curve` is that plus the `moveTo` and is otherwise
  unchanged, so the worker, the element and the check are untouched.
- The hub's halo, its reference band and its baseline arithmetic live in
  `disc-label.js` as `halo`, `band` and `baseline`, with `HALO`, `HALO_MIN`,
  `HALO_STEPS`, `HUB_REF`, `HUB_RISE` and `HUB_DROP`. All three discs name
  something in the middle, and both of those have gone wrong in this tree
  before — a halo that read as a shadow lying off to one side of the word, and a
  name that moved up and down as the pointer crossed the disc — so a second copy
  could drift back to either. `<word-disc>` was rewired onto them and its
  existing hub assertions still pass, which is what says the move preserved its
  behaviour. Each element keeps its own per-font cache, since `g.font` is the one
  thing that changes the answer.
- `disc-index.js` holds `href(indexSrc, name)` and `label(row)`, the picker's
  path arithmetic, which both elements with a picker derive. Getting it wrong
  asks for a directory nobody has, which a browser reports as a disc that never
  changes.

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
    biome.jsonc                    lints and formats the JavaScript

    web/hypernym-disc.js           the nested-arc element
    web/disc-paint.js              the draw pipeline, no DOM
    web/disc-search.js             ranked name lookup, no DOM
    web/disc-worker.js             hosts it on its own thread
    web/index.html                 its harness, the disc and nothing else
    web/word-disc.js               the word chain element
    web/word-layout.js             its wedge placement and sizing, no DOM
    web/word-chain.js              the chain and the repeat rule, no DOM
    web/word-bundle.js             the resting bundle and its square, no DOM
    web/word-bundle-worker.js      builds it off the main thread
    web/words.html                 the word disc's harness, with a picker
    web/letter-disc.js             the letter graph as a chord diagram
    web/letter-graph.js            its matrix, ring, ribbons and hits, no DOM
    web/letters.html               its harness, with the same picker
    web/disc-colour.js             TAU, hsv and the chord cubic, all three discs
    web/disc-label.js              the hub's text: fit, band, baseline, halo
    web/disc-index.js              where a category's words sit beside the index
    web/disc-ratio.js              the backing-store ratio and its budget, no DOM
    web/disc-idle.js               whether a disc is near enough to be worth pixels
    web/disc-lines.js              a text file's lines, kept as text and offsets
    web/embed.html                 a section per disc, the one page web-dist ships
    tools/export_tree.py           writes the tree, its names and its glosses
    tools/export_words.py          writes a file per category and the index
    tools/serve.py                 serves web/ and reloads it on save
    tools/check_web.mjs            loads and drives web/ as a browser does

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

## Known limits

A Zipf of exactly zero is dropped unconditionally in `_resolve`, as the line
between WordNet's vocabulary and its taxonomy. That is structural rather than a
tuned threshold — keep it independent of `--min-zipf`.

`--min-zipf` then defaults to 0.0, keeping every word wordfreq knows at all. The
list is already ordered by frequency and `build --limit` draws only the commonest
110, so the order is a better instrument than a cut: it costs the disc nothing
and gives `words` and `stats` the whole vocabulary. That took plant from 539
words to 1020, animal 895 to 1582, food 860 to 1255, job 751 to 1073, colour 80
to 97 and flower 60 to 83. The drawn 110 are unchanged for the first four, and
only colour and flower, which used to stop short at 80 and 60, draw more than
before.

The sliding cut survives and is inert at the defaults: a category yielding fewer
than `--target` words relaxes from `--min-zipf` down its own frequency order to
`--zipf-floor`, and there is nothing below 0.0. It is what stops a raised
`--min-zipf` gutting the rare categories, which is the reason to keep it.

WordNet is a lexical database, not a game word list, so residue survives the
filters in `lexicon.py` ("entire" and "royal" are genuine WordNet animal terms).
Tighten via `--min-dominance` / `--max-rank`, not by adding a stop-list.

The resting bundle's alpha is thinned above 12,000 chords by the count raised to
0.7, which takes animal from 0.110 to 0.026. Whether that exponent is the right
one has not been looked at, since there is no browser here to look in; `make
serve` is where to find out, and `FALL` in `word-bundle.js` is the knob.

`<letter-disc>`'s fill alpha is faded above 120 populated letter pairs by the
count raised to 0.5, which takes animal from 0.5 to 0.295 and food to 0.306.
That exponent has not been looked at either, for the same reason; `make serve`
is where to find out, and `ALPHA_FALL` in `letter-graph.js` is the knob.

## Checks

`make check` must pass before a commit: `ruff check`, `ruff format --check` and
`mypy` over `src/` and `tools/`, then `taplo check`, which validates
`wordchain.toml` against the schema as an editor would, `tools/check_schema.py`,
which reads the schema back against `config.py` and `palette.py`, `biome lint`
and `biome format` over the JavaScript, and `make web`, which loads `web/` the
way a browser does. mypy is strict over
`src/wordchain` and `tools`, with `mypy_path = src` because `tools/` is not part
of the package. nltk, wordfreq, pyvis and networkx ship no type information and
have no stubs in nixpkgs, so `mypy.ini` declares them untyped and the values
crossing those boundaries are annotated by hand — `lexicon.Synset` names the
opaque WordNet type rather than leaving a bare `Any` at each call site.

Biome is one Rust binary with its rules built in, like `ruff` and `taplo`, so
the JavaScript checks need no `node_modules` and no lockfile. It covers
`web/**/*.js` and `tools/**/*.mjs`, which is everything: `web/index.html`
carries no inline script. The recipe names `web/ tools/` on the command line
rather than `.`, which it used to, though `files.includes` narrows either
invocation to the same 13 files, because config discovery runs before that
filtering: from the
repository root Biome walks into any git worktree under `.claude/worktrees/`,
finds the copy of `biome.jsonc` living there, and refuses to run at all with
"found a nested root configuration". Naming the two directories is what makes
`make check` pass whether or not a worktree is open, which is the point of
working in one. `biome format` reports without writing and exits
non-zero on a diff, so there is no `--check` flag to pass and `--write` is what
writes. `lineWidth` is 100 to match ruff's `line-length`, and the style settings
name what the code already did. Two things are off, with their reasons in
`biome.jsonc`: the `assist` group, whose one action would sort
`hypernym-disc.js`'s imports alphabetically where they sit in the order the
module builds on them, and `style/useTemplate`, which fired on five sites that
all append a literal to an expression. The config is `.jsonc` because Biome
refuses comments in `biome.json`, and those two decisions need their reasons
beside them. Formatting took the five `web/*.js` files and `check_web.mjs` from
1,494 lines to 1,908, mostly by splitting lines that held several statements;
that churn was paid once and deliberately. Biome never runs the modules, so
`make web` still has to.

`make web` is `node tools/check_web.mjs`. It is a prerequisite of `check` rather
than a line in its recipe, since it is the one part that needs node, and
`nodejs` is in the flake for it. `node --check` parses a file but does not run
the early-error pass that resolves private names, so a `this.#gone` left behind
by a refactor passes it and then throws SyntaxError in the browser when the
class body is evaluated, leaving the custom element undefined and the page
blank. That has happened. So the check imports every module in `web/` against a
stubbed DOM, which fails exactly where the browser fails. It then runs the draw
pipeline over a synthetic tree of 8,005 nodes, four subtrees of 2,000 leaves,
which puts the fringe wedges at about a quarter of a pixel, and asserts the
properties the pipeline rests on rather than exact counts, which move whenever
the geometry does: that `merge=off` draws every node, that `density` and
`merge=on` both merge, that a repeat draws the same, that a zoom draws less, and
that hue-depth 19 still merges, which is what guards the hue blend. Last it
queries the search over eight names written down in the file, asserting the
order of the bands rather than the scores, which move whenever a penalty is
retuned, that a multiword subsequence query still reaches a multiword name
through the character-mask prune, that holding every character of a query is
not the same as holding them in order, and that `fit` returns the face it set.
It needs no data files, so it does not depend on the exported tree. The stub
carries no CSS, so the check covers the JavaScript and nothing about layout: a
rule that drew every row of a list as an empty box passes it, and did, since the
words were in the DOM and the rows took a hover, which left the fault entirely
in the stylesheet and entirely invisible here. What it can still say about the
markup is what it asserts, that the elements are built and hold what they
should; anything about how they are laid out has to be looked at in a browser,
which is what `make serve` is for.

It also drives `<word-disc>` rather than only importing it. A field initialiser
naming a constant a refactor had moved parses, imports, and throws only when a
page first constructs the element; that happened, to this element, and nothing
short of building one caught it. The stub records what the canvas was asked to
draw and measures text off the font size it was set, both templates clone the
same markup so one fragment serves either element, and the points a click is
fired at are computed from `word-layout.js`, which makes a hit a statement about
the element agreeing with the layout. The stub's `measureText` reports ink
metrics as well as a width, and reports them off the letters — a taller ascent
for a capital, an ascender or a dotted i, a descent only for a descender —
because reported flat it could not tell the fix from the bug. So the check
asserts that nothing in the hub is stroked at all and that the halo under a
name is copies of it — one text, one radius, and a ring whose centre is the
point the ink goes down at, which is what says the halo sits on its own letters
— that the ink goes down last, that the reference band is centred on the
hub, and that "iris", "guppy", "cow" and "test" all come back on one baseline.
The stub records the colour of every `fillText` for this, since the halo is now
made of fills like the letters over it and the ground is what tells the two
apart.
The assertions were mutation-tested: shifting the whole ring down and right by
its own radius, which is the artefact this replaced, fails the radius and the
centre assertions; drawing the ink before the ground fails the order one; and
reversing the fan sort, dropping the hit
test's upper neighbour, and removing the label floor each fail it, and restoring
the per-word measurement fails the baseline one with iris and test 1.6 px below
guppy and cow, the reported symptom exactly.
The stub records the source of each `drawImage` beside the box it went in, which
is what lets the check assert that a word-set change and a theme change each
leave the bundle that was being blitted emptied — a claim nothing downstream can
make, since the disc draws the same either way. Dropping either `release` call
fails it. The stale arrival is not covered, since the main-thread fallback the
check drives is synchronous and never produces one.

The hover on the moves column is asserted there as well, which the stub's
carrying no CSS is no bar to. A seam reaches the element as a `pointermove`
whose target is the list rather than a row, which is exactly what a browser
sends, so the stub can drive one. The check hovers a row and asserts the readout
names that word, fires a move targeting the list itself and asserts the readout
has not moved, then fires `pointerleave` and asserts it has. It matches the
marked-up shape `<b>toa<span class="last">d</span></b>` rather than the bare
word, since the readout marks a word's last letter in place and splits it with a
span. It was mutation-tested too: restoring the `-1` branch fails the seam
assertion, with the readout dropping back to the chain word.

The stub's `setAttribute` calls `attributeChangedCallback` for an observed
attribute the way a browser does, which is what the element counts on when it
sets its own `src` from the picker, and the two hand-written
`attributeChangedCallback("limit", …)` calls went with it, for the reason the
resize observer keeps its callbacks. A `fetch` stub serving an index and two
word files is what then drives the picker: an index alone opens the first
category, the options carry the word counts, choosing bird asks for the file
beside the index, the words come back as bird's, the chain clears, and a `src`
set by hand moves the select back. All of it was mutation-tested — dropping the
directory from the derived path, dropping the `#mark` call in the `data` setter,
refusing the auto-open, and hiding the picker unconditionally each fail it.

The bundle's z-order is asserted over a synthetic set of 520 words and 10,400
chords, read off a stub that records the colour each stroke went down in, which
is the only way to make a claim about z-order without rasterising. Every letter
holding at least `BANDS` chords starts in the first tenth of the stack and ends
in the last tenth, which is what says its chords are not a contiguous run; some
pair of letters is drawn in both orders, which is what the alternation buys and
what rotating the order per band would not give; and the colour changes stay
under 26 × `BANDS` and under a quarter of the strokes, so the batching survived
the interleave. All three were mutation-tested too: collapsing `BANDS` to 1
reproduces the original bug exactly, running letter A from stroke 0 to stroke
399 of 10,400, and turning the alternation off fails the second.

`<hypernym-disc>` is constructed there too, for the first time: until the column
gained its list the check drove `<word-disc>` alone and ran the nested disc's
modules without ever putting the tag on screen. It is driven over a six-node
tree named so that draw order and alphabetical order differ, the root's children
being zebra, moss and apple, so a list that came back sorted fails. What is
asserted is the row order, the leaf marking, the header line, that clicking a
branch row zooms and the list becomes that node's ring, and that clicking a leaf
row leaves the root where it is and leaves the very same row objects in place,
which is the only way from here to say nothing was rebuilt rather than rebuilt
to the same names. The weights are asserted there too, moss holding two of the
root's four leaves and so reading 50%, and the ring of leaves it opens onto
printing nothing. A second tree is then fed to the same element to pin the
formatting, six nodes reaching none of the rounding boundaries: a root of 10,000
leaves under four branches holding 996, 990, 9 and 8,005 of them, which reads
`10%`, `9.9%`, `<0.1%` and `80%`. Then that a query hides the list and closing
the search brings it back, and that stacking drops the rows rather than leaving
them behind `display:none`. All of it was mutation-tested: sorting the list
alphabetically, dropping the leaf class, dropping the `#showKids` call in
`zoomTo`, dropping the `#go` guard, and leaving the list drawn under the
suggestions each fail it, as do inverting the ratio, dividing by the row count
rather than the leaf count, dropping the rounded-whole rung, dropping the
`<0.1%` floor, and printing a weight on leaves too. The
stub grew a `closest` for it, a tag name optionally qualified by one class or
one data attribute, since both discs delegate their list handlers off
`e.target.closest("li[data-i]")` and without it a row could be built and counted
here but never clicked.

`letter-graph.js` and `<letter-disc>` are covered the same way. The canvas stub
gained a `fill` tally recording each fill's colour, the way it already records
strokes, a `fillRect`, an `isPointInPath` that answers false throughout — so
what is driven is the ring band and the letter band, and the interior hit is
what that costs — and a `textContent` that walks its children the way a
browser's does, since a list row is built out of spans and strings and a getter
answering only its own string reported every row as empty.

The element is driven over nine words on six letters, `cat cot tan tin toad dog
area aorta nan`, chosen so that weight order and alphabetical order differ and
two of the arcs are loops. The geometry is held to the matrix's counts and to a
word outside a to z being no edge; to one unit of weight being the same number
of degrees everywhere, which is the proportional-arc invariant; to the width
being the log; to every letter's ends tiling its two halves exactly, with the
arcs and the gaps coming to a turn; to those ends being strictly increasing, so
the binary search is sound, with every slot answered at both its edges and the
gaps between letters answering nobody; to the pull running with the turn; to the
fade's shape; and to the sizing staying inside its own square at every size and
coming back positive, the disc that drops its letters having the bigger ring
either side of the label floor. On the element it asserts one fill per arc in
more than one colour and light before heavy, the resting list heaviest first, a
pointer on a computed ring point naming the right arc with the readout naming
its words, a pointer outside the ring naming the letter, a hover leaving the
very same row objects in place, a click drilling to the letter an arc leaves, an
arriving row being marked, the seam that `<word-disc>`'s column already asserts,
where a move landing on no row holds the highlight and only `pointerleave`
clears it, the hub's halo being copies of the ink ringed at one radius with the
ink last, the search reaching a word's arc, and stacking dropping the rows. Six shapes a real
category can put through the geometry are run past it as well — nothing at all,
one word, one loop, a letter nothing starts with, a letter nothing ends with,
and one letter throughout — since each lands the split at an end of its arc or
leaves the ring with almost nothing on it, and what is owed in every case is
ends of some width, finite angles, a split inside its own arc and a hit test
that still round-trips.
The prune in front of the interior hit test is held to being inert rather than
argued about: each ribbon's own boundary is walked, its two runs along the ring
and its two cubics rebuilt from `letter-graph.js`'s own control points, and
`near` has to accept every point of it.
That walk covers a second word set whose arcs straddle the top of the ring,
which is not decoration — a wedge found as the span from the lowest turn to the
highest is the same answer wherever nothing wraps, so a broken search for the
largest gap is inert on any set that has no such arc, and two of those eight do.
All eighteen mutations tried were caught: equal node arcs, linear weight, a
heavy-first draw order, a fixed pull, a split fixed at half rather than by
weight, a split nudged outside its arc, a narrowed wedge, a weakened prune, an
unsound prune, the largest gap not actually found, clearing the highlight on a
seam, rebuilding the column on a hover, the resting list in layout order, a hub
with no ground, the ring band not answering, the band outside it not answering,
an arc drilling to its target, and a column listing arriving before leaving.

The stub keeps its `IntersectionObserver` callbacks the way it keeps the resize
observer's, so a disc is scrolled off the screen the way a browser does it. Both
elements are asserted to drop both canvases, and `<word-disc>` its bundle with
them; that a resize while a disc is a screen away does not take the pixels back,
which moves a box to say it, since the stub calls back only where one has;
and that coming back restores the canvas to the size it had. `Lines` is asserted
on its lines rather than on its shape, and the readout is driven through the
element. All of it was mutation-tested: dropping the `#asleep` guard in either
`#fit`, dropping the canvas zeroing, dropping the bundle release from sleep,
dropping the fit from wake, an offset out by one, and a slice that keeps its
newline each fail it.

A last block reads `web/embed.html` and holds it to the directory it ships in,
since `web-dist` finds its modules by glob where that page names its modules,
its three elements and its data files by hand, so the glob's guarantee stops at
the directory's edge: a module renamed here would be copied under its new name
and left unreferenced by the page, with nothing to say so. It asserts that every
`.js` the page names exists in `web/`, that every data file it asks for is one
`web-dist` actually stages flat beside it — `wordnet-tree.json`,
`wordnet-names.txt`, `wordnet-glosses.txt` and `words-<category>.json` — that
`<hypernym-disc>`, `<word-disc>` and `<letter-disc>` are all on the page, and
that each one's own script is named there, since a section whose module is
loaded elsewhere could not be lifted out on its own and that is the one way the
three could quietly become one block again. Only the names are checked, since
nothing renders the
markup, which is the limit this section already states about the CSS; renaming
`word-disc.js` in the page fails it.

Pylance reads `pyrightconfig.json`, which pins standard mode, Python 3.12 and
`src/` on the path, and the tree is clean under it; the pyright CLI is not in
the flake, so that check happens in the editor. Strict mode leaves 65 findings,
every one a `reportUnknown*` or a missing stub for those four libraries, and
clearing them means writing stubs rather than annotating this code.

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object. Ruff for Python, Biome for
JavaScript, `nix fmt` for the flake. Comments explain why a choice was forced, not what a line
does.
