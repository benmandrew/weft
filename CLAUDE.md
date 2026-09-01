# weft

WordNet as circular diagrams: the hypernym taxonomy, the word chain game on a
category, and the 26-letter graph under it. See @README.md for usage.

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

## Setup

`direnv allow`, or `nix develop` by hand. Python comes from nixpkgs — no venv,
no pip, no uv. Add a dependency to the `pythonEnv` list in `flake.nix`. `src/`
is on `PYTHONPATH` via the shellHook, so `python -m weft` runs from the
project root with no install step.

Anything the shell needs at load time goes in `shellHook`, which `.envrc` runs
with `eval "$shellHook"`: nix-direnv caches `nix print-dev-env`, which defines
that variable without executing it, so a hook left to direnv alone never runs.
Keep the hook idempotent, since direnv re-runs it on every load.

## Corpus and cache

- WordNet 3.0 is `pkgs.wordnet`, symlinked into `.nltk_data/corpora/wordnet` by
  the shellHook. Never call `nltk.download()`; nothing may be fetched at
  runtime. Reach the corpus through `NLTK_DATA` and the standard directory
  layout, never a `WordNetCorpusReader` built on the store path: the reader
  falls back to the global lazy corpus for sense keys, ignoring its root.
- Keep `lexicon._wordnet`'s `map_wn` override, which skips nltk's multilingual
  sense-key mapping — two thirds of the corpus load, unused here.
- Import nltk, wordfreq, networkx, matplotlib, tomllib and difflib at the point
  of use, never at module load: a top-of-file import costs 100-300 ms on every
  invocation that does not need it. A cache hit must not import the first three,
  and `stats`, `words` and `categories` must not import matplotlib.
- `.cache/weft` keys resolved word lists on the category, the filter
  arguments and the corpus store path. Bump `lexicon._CACHE_FORMAT` when the
  stored shape changes, so stale files miss rather than mislead.
- `lexicon.EXTRA_WORDS` tops a category up by hand, for the words a lexical
  database misses: "grey" is a lemma of no colour synset. It ships empty. An
  entry bypasses every filter, having been chosen rather than having survived
  them, and joins after the sliding frequency cut in `_resolve`, so it never
  counts towards `--target`. It carries wordfreq's real Zipf, so a rare addition
  sorts last and needs a larger `--limit` to be drawn. A duplicate of a word
  WordNet already yielded is dropped, and `_check_extras` refuses an unknown
  category or an unplayable word at import. `--multiword` still governs it.

## Configuration

- Geometry lives on `config.Geometry`, the word filters on `config.Selection`,
  and the letter colours on a `palette.Wheel` of `Arc`s carried by the `Theme`.
  A figure takes each as an argument, never as a module constant. The file is
  `./weft.toml` or the file `--config` names, which must exist. `theme` is
  a bare key rather than a fourth table, and `--theme` overrides it.
- `[selection]` holds the eight selection settings, and all four commands read
  it, which is why `--config` sits on all four: `categories` prints a count,
  `stats` analyses that list and `build` draws from it, so a table only `build`
  honoured would put the three out of step. The file is read once in `main()`,
  since `categories` loads all 37 word lists.
- `cli._selection_args` builds one flag per `Selection` field, taking its type
  from `config._SELECTION_BOUNDS` and its help from `cli._SELECTION_HELP`;
  `cli._DRAWN` names the one setting only `build` offers. Precedence is the
  flag, then the file, then the default, so every selection flag defaults to
  None and `--multiword` is `BooleanOptionalAction` — `--target 60` typed out
  and no `--target` at all have to reach a file as different things. That rule
  lives in `cli._selection` alone.
- `config.as_members` turns a `Selection` into the keyword arguments
  `lexicon.members` takes, and every caller goes through it. `members` keeps its
  explicit signature, since that is its API.
- Unknown keys and out-of-range values are refused, never ignored, since an
  ignored key redraws the same figure. `hue_start` and `equalise` mean something
  at zero. `[selection]` inverts the rule and lets every numeric setting reach
  its own minimum, since `min_zipf` 0 is the whole vocabulary and `limit` 0 is
  no limit rather than a blank disc; `render.words_disc` spells that out rather
  than slicing. The Zipf ceiling is 8, where the scale runs out. In `[palette]`
  a preset name and an arc's numbers are mutually exclusive, because a preset
  may hold two arcs; `palette.with_wheel` shifts presets to the light ground by
  `LIGHT_SHIFT`, so the built-in wheels come out unchanged.
- `schemas/weft.schema.json` mirrors `config.py` and `palette.py` by hand,
  and `tools/check_schema.py` is what stops the two drifting. The schema owns
  the per-key descriptions, so a new setting is documented there and nowhere
  else. The check has three jobs: holding the schema to `_SELECTION_BOUNDS`,
  holding `lexicon.members`'s keyword defaults to `Selection`'s through
  `config._MEMBERS_RENAME` and `_MEMBERS_SKIP`, and holding `_SELECTION_HELP` to
  `Selection`'s fields, since a setting with no line there gets no flag at all.
  `taplo.toml` and the `#:schema` line in `weft.toml` point editors at it.

## Rendering

- Wedge order is `render._fan_key`, and `web.py` and `word-layout.js` sort the
  same way: the tail letter, rotated to start just before the wedge's own
  letter, running backwards. Plain tail-letter order starts every wedge at A and
  makes the bundle cross itself. A change on one side has to be made on all
  three, and `check_web.mjs` holds the JavaScript to the Python.
- Edges are `Path` cubics, never sampled polylines: SVG draws cubics natively,
  so sampling costs build time, file size and accuracy at once.
- `render._hoist_shared_attributes` moves `style` and `clip-path` off path
  elements onto their group, which is a third of the file. Verify any change to
  it by rasterising before and after and comparing pixels, not by eye.
- `build` renders one file and one view, the word disc, SVG unless `--format
  png`. The other views in `render.py` and the pages in `web.py` are
  library-only; do not wire them back into the command line without asking. Keep
  `svg.fonttype = "path"` in `render._typeface`, since naming the fonts would
  silently substitute a face on any machine without Iowan Old Style, Avenir and
  Menlo.
- The label size is solved, not set: `_wanted_inches` gives the width at which
  adjacent labels exactly clear each other, `_canvas_inches` holds that between
  9.6 and 30 inches, and `_fitted_pt` shrinks `label_pt` by whatever the cap
  denied. Below the cap it returns `label_pt` itself, so a disc that already fits
  cannot move by a rounding error. `_disc_limit` reads the fitted geometry
  through a `dataclasses.replace`, so the axis frames the labels actually drawn.
- Generated pages stay self-contained: no external hosts, no CDN tags.
  `web._CDN_TAG` strips the Bootstrap links pyvis emits regardless of
  `cdn_resources="in_line"`.
- `out/` is generated and gitignored; nothing reads from it.

## The three discs

Shared rules first, then what is particular to each.

- Every module with no DOM in it — `word-layout.js`'s `solve`,
  `word-bundle.js`'s `square` and `thin`, `letter-graph.js`'s `near` and `fade`,
  `disc-lines.js`, `disc-ratio.js`, `disc-index.js` — is separate so
  `check_web.mjs` can assert what nothing downstream can notice: a radius that
  comes back negative, a square that blurs the bundle, an alpha of zero, an
  offset out by one.
- Canvas sizing goes through `disc-ratio.js`'s `ratio`, which bounds the area at
  `MAX_AREA`, 2^23 device pixels, rather than the ratio. Browser zoom multiplies
  devicePixelRatio, so a ratio cap drew the disc at half the resolution the
  screen was showing it at. `#onRatio` re-arms a `(resolution: Xdppx)` query on
  every change, since a zoom moves that ratio and leaves the CSS box alone.
- `disc-idle.js`'s `watch(el, sleep, wake)` is one `IntersectionObserver` at
  `rootMargin: "100% 0px"`. Canvas pixels are 79-87% of what a page carrying
  three discs holds, and `embed.html` runs all three down one column where at
  most one is on screen, so a disc more than a screen away zeroes its canvases
  and sets `#pw` to 0, which every draw path already refuses on; `#asleep` stops
  `#fit` sizing them back. Nothing is dropped before the first fit, and waking
  sets `#resized = 0` so the fit is not held on the drag timer.
- The resize observer watches the frame as well as the stage. Stacked, the
  stage's box does not move when the frame is dragged wider, so watching the
  stage alone left an element stuck in the stacked layout for good.
- Once the frame is 218 px wider than a disc filling its height, the column
  moves beside the disc. Toggled from the resize observer rather than a
  container query, since the test is the frame's own shape. Under `fit` only.
- `fit` makes the element fill the box the host gives it, which means the host
  has to give it one; without it the stage is a square of the element's width.
  Blocks under the disc are held to a fixed height, so a longer definition never
  resizes the disc under the pointer.
- All three refit text when `document.fonts.ready` settles, since canvas text is
  measured rather than laid out and a cached fit would replay in the wrong face.
  `<hypernym-disc>` and `<letter-disc>` call `repaint()`; `<word-disc>` calls
  `#resize`, which also drops `#widest`.
- `disc-label.js` holds the hub's text (`fit`, `band`, `baseline`, `halo`),
  `disc-colour.js` holds `TAU`, `hsv` and the chord cubic `bow`, and
  `disc-index.js` holds the picker's path arithmetic. All three discs read them.
- The halo is `HALO_STEPS` copies of the same `fillText` in `--disc-ground`,
  ringed at `HALO` of the type size; a `strokeText` is positioned by different
  code from a fill and read as a shadow off to one side. `textBaseline` is
  alphabetic and baselines are placed by hand, centred on `HUB_REF` ("Hd")
  rather than on per-word ink metrics, which made the name move as the pointer
  crossed the disc.
- Hit testing is a binary search over angles laid out clockwise from the top.
  There is no spatial index anywhere.

### `<hypernym-disc>`

- It reads a tree as `par`, an array where every parent's index is below all of
  its children's. That ordering is the whole contract: depths, leaf counts and
  angles come out of flat loops rather than a traversal, so 82,115 nodes lay out
  in one frame. `export_tree.py` writes preorder, which satisfies it and puts
  every subtree in a contiguous run. Nesting needs a tree and the hypernyms are
  a DAG, so each synset keeps its first hypernym.
- Children are `#kidOff` and `#kidIdx`, two typed arrays rather than a list per
  node: 657 KB against 4.8 MB, and the build 1.6 ms against 5.3.
- Three exports, generated into `out/` and never committed: `wordnet-tree.json`
  at 42 KB brotli, `wordnet-names.txt` at 311 KB, `wordnet-glosses.txt` at
  1,329 KB, fetched in that order, with first paint waiting on the tree alone.
  Keep them index-aligned: the two text files are positional, with no key to
  catch a mismatch.
- The glosses are `disc-lines.js`'s `Lines`, the text and an `Int32Array` of
  line starts rather than a split, which cost 82,115 string headers and 3.13 MB.
  `at(i)` returns "" past the end, which is what the readout prints while the
  file is on its way.
- `disc-search.js` scores every name in one pass rather than holding an index,
  since the weakest band is a subsequence match and no ordering prunes one.
  Containment does: each name carries a bitmask of the characters it holds, and
  can match only if its mask holds every bit the query's does. Bands sit 1,000
  apart and every penalty is capped below 1,000, so a weaker match can never
  outrank a stronger one.
- The pointer and the search box drive it; the canvas answers no key and takes
  no focus. Enter on a leaf goes to its parent and leaves the cursor on the
  leaf, which clicking cannot do.
- The hub name, the gloss and the crumb tail all come off `#focus`, so the three
  can never be of different nodes. It answers -1 outside the current zoom, so a
  node found elsewhere in the tree is neither highlighted nor added to the path.
- The column lists the ring one out from the root in draw order, which costs no
  sort since a slice of `#kidIdx` is already wedge order. Paged at `KIDS_PAGE`
  200 and `KIDS_NEAR` 240. A branch row prints its share of the ring's leaves,
  which is exactly its wedge's share of the turn; three digits at most, the
  thresholds being the rounding boundaries rather than 10 and 0.1.
- Only `rings` depths below the root are drawn, 14 by default, since WordNet's
  outer rings are nearly empty and dividing the radius by every depth left a
  quarter of the frame blank. The cap is in the prepare key, since it changes
  which runs merge.
- The paint runs on a worker. `disc-paint.js` holds the pipeline with no DOM in
  it and the element calls the same class on the main thread where a worker
  cannot be had, so the fallback cannot drift. The layout stays with the
  element, since hit testing and the hub answer without a round trip. Do not
  terminate the worker on disconnect: it holds the only handle to the base
  canvas, which transfers once and never again, and the element must not size
  that canvas. `WORKER_FLOOR`, 400 ms, is an evaluation budget timed from the
  first paint wanted.
- The draw path is measured and its choices are not obvious. Colours are
  interned per theme and root, which was a fifth of the frame. `merge=density`,
  the default, takes 82,115 arcs to about 8,500. A merged piece takes the
  circular mean of its members' hues, held as a cosine and a sine in `#retint`
  and rounded to a slice one pixel wide so it can be interned; matching on
  colour instead left nothing to merge above `hue-depth` 2. The density ramp
  encodes density, 1 to 64 wedges in a pixel, over a log across `RAMP_STEPS`
  rungs to `RAMP_FLOOR`, quantised to keep the ramped colours interned. Do not
  batch the draw into one path per colour: 145 fills against 82,115 is eight
  times slower, since each colour's path scatters across the whole disc and the
  rasteriser covers its bounding box.

### `<word-disc>`

- `render.words_disc` made interactive. A word's successors are a whole wedge,
  never a list stored per word, which is `graph.py`'s claim applied:
  materialising animal's edges is 96,470 of them against 26 arrays. A word
  cannot follow itself.
- It draws every word the category has unless the host names a `limit`, where
  `build` draws 110: the SVG can grow its canvas and shrink its type, and the
  element has only the frame the page gave it.
- `word-layout.js` is that figure's layout written a second time, so the browser
  and the SVG put the same word at the same angle.
- A word already played is not a move, and `Chain.legal` is the whole of the
  rule — what the disc paints, what the readout explains and what the cursor
  follows. `--disc-warn` is the colour, and `#onMove` writes the cursor only
  when it turns over.
- Labels below 5.5 px are dropped and the hub names what the pointer is on
  instead. `HUB_SIZES` runs 16 down to 8 at weight 700. The hub is one radius
  doing two jobs, what a click undoes and what the name must fit inside, and
  keeping them one number is what stops the outer half of a name sitting where a
  click does nothing.
- The moves column lists `Chain.legal` alphabetically and scrolls, paged at
  `MOVES_PAGE` 200 and `MOVES_NEAR` 240. Rows are inline blocks at
  `width:calc(50% - 1px)`, with `line-height:0` on the list to zero the strut
  whose descent left dead ground between rows. A `pointermove` landing on no row
  holds the hover rather than clearing it, since a pointer is over no row at
  every seam; `pointerleave` is what clears it. Landscape only.
- The resting bundle is every chord the SVG draws, held in a square of its own
  and blitted per frame, dimmed to 0.22 once a chain is being built. It is a
  stroke per chord, since the alpha has to accumulate where curves overlap.
  `word-bundle.js` holds `curve`, `bundle`, `square`, `thin` and `release` with
  no DOM in them. The ring sits at `RING` 0.496 and the element inverts that to
  blit, so a resize is a scaled `drawImage`. The square steps at `STEP` 256
  device pixels and is capped at `MAX_PX`, derived from `MAX_AREA` rather than
  written down, since a cap short of the budget blurs the bundle alone while the
  dots stay sharp.
- The bundle is drawn band by band, `BANDS` 64, each letter's slices sized to
  its share of the chords and the bands alternating direction, so no letter sits
  under its neighbour at every crossing. Nothing is shuffled and no seed is
  drawn, so two builds composite identically and a resize cannot make the
  picture shimmer.
- `thin(alpha, chords)` returns the alpha unchanged at or below `KNEE`, 12,000,
  and `alpha * (KNEE / chords) ** FALL` above it, `FALL` being 0.7. Ink
  accumulates, so a category with eight times the chords floods the middle.
- `MAX_BUNDLE` is 200,000, a guard against a word list nothing here has.
- `word-bundle-worker.js` is its own worker, since `disc-worker.js` holds the
  nested disc's canvas for the life of the page. This one owns nothing between
  messages, so it is terminated on disconnect, and it is opened at connect so
  its module fetch runs alongside the word file's rather than after it. The
  `WORKER_FLOOR` deadline is `#armFloor`'s and starts with the first bundle
  wanted, since timing it from the worker's construction spends it on the
  network and reads a slow link as a device with no worker.
- `release(pic)` closes an `ImageBitmap`, whose pixels sit outside the JS heap
  and read to the collector as a small object under no pressure. A bundle is
  12.3 MB at a typical disc size. `word-disc.js` calls it at three sites: a
  bundle being replaced, one arriving after the disc has moved on, and a
  word-set change. The bundle held over a `disconnectedCallback` is deliberately
  kept, since a reattached element blits it until a replacement lands.
- A held bitmap is blitted stretched until a newer one lands. A word-set change
  drops it; a theme change keeps it. The cache is keyed on a generation counter
  and the size step.
- `index-src` is the whole of the category picker. A category's file is found by
  swapping the last segment of the index's path, since `export_words.py` writes
  them flat and side by side. Choosing a category sets the element's own `src`,
  so a pick goes down the load path a host swapping `src` already had. `#mark`
  is called from the `data` setter too, so the select is right whichever lands
  first. An index named without a `src` opens on the first category.
- The crumb line's root is the category, drawn as a label rather than a step
  since it is where the words came from. Clicking it clears the chain, which is
  the only way to open on a different first word.

### `<letter-disc>`

- The graph `<word-disc>` is the line graph of: 26 nodes, one arc per letter
  pair some word bridges. It reads the same `words-<category>.json` and counts
  the matrix out of it in one pass, so a page carrying both discs fetches one
  file. animal is the worst case at 344 populated pairs.
- Nothing is bundled. At 344 arcs every arc is an individually meaningful
  object, clickable and carrying a count, so merging two destroys what the
  widget exists to show. The log width, the split arcs and the hover are what
  declutter at this scale.
- The width is `log1p` of the word count, which takes the 30:1 ratio between
  animal's trunk and its 103 single-word arcs to about 5:1. `log1p` rather than
  `log` because an arc of no width is an arc that was not drawn.
- A letter's own arc is the sum of the log weights touching it, so one unit of
  weight is the same number of degrees everywhere and a ribbon comes out the
  same width at both ends. No floor under a quiet letter: `check_web.mjs`
  asserts the degrees per unit, and adding one fails it.
- Each letter's arc is split, the leaving half first as the ring is read
  clockwise, each half taking its share of the letter's weight, so direction is
  in the geometry rather than in an arrowhead. The target end tapers to 45% of
  its slot as the second signal.
- The pull runs with the turn, 0.82 at no turn down to 0.14 at half the circle,
  where `<word-disc>` uses a fixed one: 31% of animal's arcs cover less than a
  third of the turn and 12 are loops, and at a long chord's pull every one of
  those is a spike pointing at the middle.
- `fade(alpha, pairs)` is `thin` in the same shape: 0.5 at or below a knee of
  120 pairs, `alpha * (120 / pairs) ** ALPHA_FALL` above it, `ALPHA_FALL` 0.5.
- No worker and no held bitmap; 344 filled ribbons is a frame's work, so a
  resize redraws and its sleep is the two canvases alone. The base canvas is
  its own rather than a worker's, so emptying it needs no message.
- Hit testing is three bands. The ring band answers with an arc by binary search
  over ends that tile it exactly, the band outside answers with a letter, and
  inside the ring the path itself is asked through `isPointInPath`, topmost
  first. `letter-graph.js`'s `near` refuses three quarters of those before a
  path is built, since every point of a ribbon lies in the wedge its four turns
  span; that wedge is the complement of the largest gap between them, which is
  what finds it when an arc wraps through the top. It is a prune, so what it
  owes is never refusing a point that is on the arc.
- The pointer highlights and a click drills, by one scrim fill over the frame
  rather than a second pass over 344 arcs. Clicking an arc drills to the letter
  it leaves; `#preview` never touches `#letter`, so a hover cannot shift what a
  click landed on. Clicking the hub goes back out.
- The readout names the words on an arc rather than counting them, up to 14, and
  is the only place a drilled-into letter is described.
- No search box, no list, no crumb line, and no box around its column. A path
  one letter deep is nothing to draw a crumb line of.

## Build and distribution

- The Makefile's `all` renders one SVG per category and takes its parallelism
  from make's own `-j`, never from a `MAKEFLAGS` line. Its target list comes
  from `weft categories` at parse time, so every invocation pays for that,
  `make clean` included. A config file reaches it through `CONFIG=`, which is
  both the argument and the prerequisite.
- The three tree exports are one grouped target (`&:`) and the 38 word files
  another, so the corpus loads once per group rather than once per file.
- `make web-dist` stages everything a page needs flat in `out/web-dist`, or
  `DIST=`: every `web/*.js` by glob, `web/embed.html`, the three exports and the
  38 word files. The glob is the point — a consuming site copies the directory
  instead of keeping its own list of filenames in step with this one. `web/.` is
  a prerequisite alongside the modules, since a directory's timestamp is the
  only thing that catches a module deleted upstream. Flat works because the
  modules import each other by relative path and the worker resolves through
  `import.meta.url`.
- `embed.html` is the one page it ships: one `<section>` per disc in ordinary
  document flow, each carrying its own script, data attributes, height and
  custom properties, so any one can be lifted out without bringing the others.
  Nothing positions one relative to another. It asks for its data beside itself
  where the three harnesses ask for `/out/…`, which is why `tools/serve.py`'s
  `translate_path` falls back to `out/` for a top-level name not in `web/`.
- `tools/serve.py` gzips the textual types in `GZIP_TYPES` above `GZIP_MIN`,
  holding each body against its mtime, since a deployed copy is served brotli'd
  and a dev server sending 7.1 MB of exports raw is not the thing being
  developed against. It does its own `If-Modified-Since` check, `send_head`
  having no way in to the 304 without the uncompressed body.
- `tools/serve.py`'s `Server` returns from `handle_error` for `BrokenPipeError`
  and `ConnectionResetError`, since a reload abandons open sockets and the reset
  surfaces outside any handler, writing a traceback into the terminal the
  watcher reports into.
- `tools/export_words.py` writes `words-<category>.json` and `words-index.json`
  flat: 37 categories, 13,212 words, 197 KB. Each file holds the whole category
  in `render.py`'s order and reads `[selection]`, so what the element draws is
  what `build` would draw and a host changing `limit` refetches nothing.

## Shape

    src/weft/
      lexicon.py   WordNet closure, the three polysemy filters, the Word type
      graph.py     letter matrix, letter graph, word graph, trap analysis
      render.py    matplotlib figures
      web.py       pyvis pages
      palette.py   Theme tokens, the letter wheel, the font stacks
      config.py    Geometry, the TOML file, its validation
      cli.py       argparse entry point, the text report

    weft.toml                 the live config, at the defaults
    schemas/weft.schema.json  the same settings for an editor
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

## Known limits

A Zipf of exactly zero is dropped unconditionally in `_resolve`, as the line
between WordNet's vocabulary and its taxonomy. That is structural rather than a
tuned threshold — keep it independent of `--min-zipf`.

`--min-zipf` then defaults to 0.0, keeping every word wordfreq knows at all. The
list is already ordered by frequency and `build --limit` draws only the commonest
110, so the order is a better instrument than a cut. The sliding cut survives and
is inert at the defaults: a category yielding fewer than `--target` words relaxes
down its own frequency order to `--zipf-floor`. It is what stops a raised
`--min-zipf` gutting the rare categories.

WordNet is a lexical database, not a game word list, so residue survives the
filters in `lexicon.py` ("entire" and "royal" are genuine WordNet animal terms).
Tighten via `--min-dominance` / `--max-rank`, not by adding a stop-list.

`FALL` in `word-bundle.js` and `ALPHA_FALL` in `letter-graph.js` are both
guesses, since there is no browser here to look in. `make serve` is where to
find out.

## Checks

`make check` must pass before a commit: `ruff check`, `ruff format --check` and
`mypy` over `src/` and `tools/`, then `taplo check`, `tools/check_schema.py`,
`biome lint`, `biome format`, `make web` and `make types`. mypy is strict, with
`mypy_path = src` because `tools/` is not part of the package. nltk, wordfreq,
pyvis and networkx ship no type information, so `mypy.ini` declares them untyped
and the values crossing those boundaries are annotated by hand.

Biome needs no `node_modules`. The recipe names `web/ tools/` rather than `.`,
because config discovery runs before file filtering and Biome walks into any git
worktree under `.claude/worktrees/`, finds the copy of `biome.jsonc` there, and
refuses to run at all. `biome format` reports without writing and exits non-zero
on a diff; `--write` is what writes. The two disabled rules carry their reasons
in `biome.jsonc`, which is `.jsonc` because Biome refuses comments in
`biome.json`.

`make web` is `node tools/check_web.mjs`, a prerequisite of `check` rather than
a line in its recipe, since it and `make types` are the parts that need node.
`node --check` skips the early-error pass that resolves private names, so a
`this.#gone` left by a refactor throws only when the browser evaluates the
class body, leaving the element undefined and the page blank; a field
initialiser naming a moved constant does the same. Both have happened. So the
check imports every module against a stubbed DOM and then drives all three
elements, with clicks computed from `word-layout.js`, hovers fired at rows, and
resizes and scrolls driven through the observers' recorded callbacks.

It asserts properties rather than exact counts, which move whenever the geometry
does, and every assertion was mutation-tested. Its limits are worth knowing: the
stub carries no CSS, so a rule that drew every row as an empty box passes it,
and did; one fragment serves all three templates, so a claim that an element
lacks a search box is read off the module's text rather than the shadow root;
and the main-thread fallback is synchronous, so a stale bundle arrival is not
covered. Anything about layout has to be looked at in a browser, which is what
`make serve` is for.

`make types` is `tsc --noEmit` over the JSDoc annotations in `web/`, a
prerequisite of `check` rather than a line in its recipe for the same reason
`make web` is: tsc is the other part that needs node. Nothing is compiled and no
`.ts` file exists, so the types are comments and the module served is the module
edited. `tsconfig.json` includes `web/*.js` and excludes what is not ready, so a
new module is checked by existing rather than by being added to a list. The
three elements are excluded, `hypernym-disc.js`, `word-disc.js` and
`letter-disc.js`, about 660 errors between them, mostly DOM lookups that come
back nullable. The two workers are excluded as well, since they want
`lib.webworker` where everything else wants `lib.dom`, and one program cannot
hold both. `strictPropertyInitialization` is off, since `Painter`'s typed arrays
are filled by `layout()` rather than by the constructor and every read of one is
guarded by `#n`. It catches what `check_web.mjs` cannot, a renamed field on a
worker message that no test path happens to read, or a wrong argument order in a
call whose arguments are all numbers, which shows up as a subtly wrong picture
rather than an exception.

A last block reads `web/embed.html` and holds it to the directory it ships in,
since `web-dist` finds its modules by glob where that page names them by hand.

Pylance reads `pyrightconfig.json`, which pins standard mode, Python 3.12 and
`src/` on the path, and the tree is clean under it. The pyright CLI is not in
the flake, so that check happens in the editor.

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object. Ruff for Python, Biome
for JavaScript, `nix fmt` for the flake. Comments explain why a choice was
forced, not what a line does — and they are the only home for that reasoning, so
keep them short and keep them at the site.
