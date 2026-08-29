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
  times. Precedence is the flag, then the file, then the built-in default, so
  every selection flag defaults to None rather than to its value: a `--target
  60` typed out and no `--target` at all have to reach a file that sets it
  differently as different things. `--multiword` is
  `argparse.BooleanOptionalAction` for the same reason, so `--no-multiword`
  exists and turns off a file that switched it on. `limit` sits here rather
  than in `[geometry]` because it counts words rather than measuring a
  distance; `geometry.disc_limit` is the axis limit in data units and is
  unrelated.
- Unknown keys and values that are not positive numbers are refused, never
  ignored, since an ignored key redraws the same figure; `hue_start` and
  `equalise` are the two settings that mean something at zero. `[selection]`
  inverts that rule: every numeric setting there allows its own minimum, since
  a `min_zipf` of 0 is the whole vocabulary, a `min_dominance` of 0 asks
  nothing of a word's senses and a `target` of 0 relaxes nothing. `limit` is
  the exception at 1, since a disc of no words is a blank page, and the Zipf
  ceiling is 8, because the
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
  `Selection`'s, since those are two copies of the same numbers; `multiword`
  answers to `allow_multiword` there, and `limit` has no counterpart because
  only `build` draws. It caught a real drift on its first run: `members` still
  had `min_zipf=2.0` after the command line's default moved to 0.0.
  `render.words_disc` takes `limit: int = DEFAULT_SELECTION.limit` and so
  copies nothing.
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
  Children are held the same way, as one offsets array rather than a list per
  node: the child count and the leaf test are both `#kidOff[i + 1] -
  #kidOff[i]`, and the flat list of child indices stays local to `#build`,
  since nothing outside it walks children. As 82,115 plain arrays, two thirds
  of them the empty one a leaf never reads, they held 4.8 MB of retained heap
  against 657 KB, and the build's median went 5.3 ms to 1.6 ms.
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
  rather than the stage is what stops the toggle changing its own answer. The
  stage spans both rows of the column, the search box's and the gloss's, so a
  longer definition costs the suggestion list its room rather than the disc its
  height; that is why the gloss runs to five lines there, where two would clip
  most definitions at 200 to 280 px wide. In the column a suggestion puts its
  parent on a second line, since 200 px has no room for both on one.
- The `fit` attribute makes the element fill the box it is given, with the
  stage taking whatever height the search box and the crumbs leave and staying
  square against whichever dimension binds first. Without it the stage is a
  square of the element's width, which is the only thing that works when the
  host gives the element no height of its own; with it the host has to, so it
  is opt-in rather than the default. The harness sets it and never names a
  pixel count, since a page that guesses at its own chrome guesses wrong.
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
  module, five today, and the three exported data files. The module list is a
  glob rather than names written out, which is the whole point of the target:
  a consuming site copies the directory instead of keeping its own list of
  filenames in step with this one, where a sixth module added here leaves that
  site running five of six and nothing says so. `index.html` is left out,
  since it is the local harness and a host page carries its own markup. The
  directory is emptied and refilled rather than copied into, and `web/.` is a
  prerequisite alongside the modules, because a directory's timestamp moves
  when a file enters or leaves it and that is the only thing that catches a
  module deleted upstream. Flat works because the modules import each other by
  relative path and the worker resolves through `import.meta.url`, so the
  directory runs wherever it is served from. The three data files are one
  grouped target (`&:`) rather than three rules, so the exporter walks the
  corpus once rather than three times.

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
    web/disc-label.js              the hub's text fitting, no DOM
    web/disc-worker.js             hosts it on its own thread
    web/index.html                 its harness, the disc and nothing else
    tools/export_tree.py           writes the tree, its names and its glosses
    tools/serve.py                 serves web/ and reloads it on save
    tools/check_web.mjs            loads web/ the way a browser does

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
carries no inline script. `biome format` reports without writing and exits
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
It needs no data files, so it does not depend on the exported tree.

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
