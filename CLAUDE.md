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
- The sleep is held for `HOLD`, a second, and a wake cancels it. A fast scroll
  crosses the whole band in one gesture, so a sleep taken the moment a disc left
  it emptied and refilled a disc for a moment nobody spent looking at it, three
  times over on `embed.html`, which is the stutter a fast scroll had in it. The
  hold is only ever memory: nothing draws while it runs, and a disc genuinely
  left behind still gives its pixels back a second later. `watch` returns a
  handle rather than the observer, since a held sleep must not outlive a
  disconnect. `check_web.mjs` drives `watch` on its own for that, the element
  drawing the same either way and the claim being about the sleep that never
  ran; its three element blocks wait the hold out through `away`.
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
- The readout prices perfect play beside the count of replies, since a letter
  with many replies can still be the shorter road: on animal `crab` opens on the
  full 640, where `bear` after it leaves 637 and makes 639. Three states, the
  work being `word-longest.js`'s (`## The longest chain`): at rest the free run
  of the whole word set, for the word play stands on what perfect play still
  reaches, and for a legal move under the pointer what playing it would leave.
- Both figures are held. `#reachOf` maps a word to its figure over the words not
  yet played and is cleared in `#after()`, so every chain change drops it, and
  `#build()` clears it and `#bestRun`, the free run, when the word set moves. A
  pointer crossing the disc asks about the same word over and over and the
  answer moves only when the chain does. `#reach(i)` solves from the letter word
  `i` ends on, which answers for the word play already stands on as well, since
  a played word is out of the reckoning either way and the walk opens on the
  letter it left behind. About 0.9 ms for a word the pointer has not been on and
  nothing for one it has: animal loaded and five figures printed is 24 ms in
  `check_web.mjs`, furniture 2 ms.
- `hint="off"` turns both figures off, read in JavaScript where the work would
  be done rather than in CSS the way `readout="off"` is, since what it saves is
  a solve and not a paint. `embed.html` names no attribute and gets them.
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

## `<word-run>`

Its own section rather than a fourth subsection above: it has no canvas and no
hit testing, so not one of the shared rules under `## The three discs` holds
for it.

- It names the chain the disc could still make, where `<word-disc>`'s readout
  counts it. On animal at rest: `640 words │ crab › boa › anaconda › alpaca ›
  632 more › zebra › avocet › teju › ungulate`. Three moves in: `636 more, 639
  in all │ crab › bear › raven › nutria › 631 more › avocet › teju ›
  utahraptor › racoon`. The played words take the accent colour and the
  projected ones the ink colour, and the separator is the crumb line's own `›`.
- The count sits outside the chain behind a rule, the way the disc's category
  label does, since reading as a step is what it must not do.
- `for` is an id and nothing else, since `<word-disc>`'s events bubble and are
  composed and no host code has to sit between the two. The id resolves through
  `getRootNode()` rather than `document`, so a run inside a shadow tree finds
  its disc. A host that would rather own the answer sets `.source`, the
  element, which beats the attribute, or `.run`, the words themselves.
- It listens for `word-chain` and `word-render`: the first covers play, the
  second the first draw and a change of category. A held key means the pair
  costs one solve between them rather than one each. `disconnectedCallback`
  removes both listeners, so a detached run is not held by the disc.
- The fold is `ENDS`, 4, moved by the `ends` attribute. A run of `2n+1` or
  shorter is shown whole, since hiding one word behind a count reads worse than
  the word.
- `.run` is a flex row in which every word and every chevron is an item in its
  own right, and `justify-content:space-between` splits whatever width the line
  has spare between each pair. Nothing grows. Grouping the ends into two items
  put all the spare width in one place and left the two ends shrinkable: a flex
  item shrinks below its content before its parent scrolls, so at a narrow
  width the words overran the chevrons between them and one end read as a chain
  with no chevrons in it at all. `.run>*{flex:0 0 auto}` is what stops that, and
  what turns the overflow back into a scroll.
- The elision takes a chevron on either side and carries no ellipsis, since the
  words it stands for are steps like any other and the chain has to hand over
  into it and out of it the way it does everywhere else. With the chevrons
  doing that, an ellipsis inside them says the same thing twice.
- The style block is a template literal, so a backtick in a comment inside it
  ends the string and the module stops parsing. That happened, and
  `check_web.mjs` importing every module is what caught it.
- The type is 15px at line-height 1.7. 11px matched `<word-disc>`'s crumb line,
  which is a different job: the crumb is a control strip and this is a line to
  read.
- It fetches nothing. It reads `disc.words` and `disc.chain`, so a page
  carrying the disc, the run and `<letter-disc>` still fetches one word file.
  One solve per chain change, about 0.9 ms on animal, and none on hover.
- `run(words, played)` and `elide(length, ends)` have no DOM in them, and the
  element itself is clean under `tsc`: it is not in `tsconfig.json`'s exclude
  list, unlike the three discs.
- `words.html` carries it under the disc, its `main` a column so the run takes
  its height off the page rather than off the disc. That `main` names no
  `align-items`, so the column's children stretch to its width by default
  rather than each naming `width:100%`. `embed.html`'s
  word-disc section carries two scripts and two elements. Each still carries
  its own tokens, so the pair lifts out together.

## `<balance-flow>`

Its own section rather than a fourth subsection above: it has a canvas and is
not a disc, so some of the shared rules under `## The three discs` hold for it
and the rest do not. `disc-ratio.js`'s `ratio` and its `MAX_AREA` budget,
`disc-idle.js`'s sleep and its `HOLD`, `fit` needing the host to give it a box,
the refit when `document.fonts.ready` settles and `disc-colour.js` all hold.
Hit testing, the hub, the 218 px column rule and the resize observer watching
the frame do not.

- It draws the min-cost transshipment `web/word-longest.js` solves on the way
  to the longest chain. Surplus letters bank down the left column at their
  excess, deficit letters down the right at theirs, and each augmenting path is
  a band between them, as wide as the words it discards. It is the third thing
  reading `words-<category>.json`, after `<word-disc>` and `<letter-disc>`.
- `trace(words)` is the solve `chain` already does with its working shown. It
  reads the augmenting paths off `balanced()` rather than running a second
  solve, so it moves no answer — which is why `graph.py` needs no counterpart
  and `tools/chains.json` holds nothing about it. It returns `{excess, need,
  paid, settled, frames}`, `frames` being one `Augmentation` each: `{push,
  cost, from, to, steps}`.
- `Flow.run` takes an optional `log`, `Flow.label(e, cell)` names the letter
  pair an arc moves, and `Flow.cell` is null until `label` is called, so an
  ordinary solve allocates none of it and the traced one pays 704 ints. A step
  in `steps` is signed: `cell + 1` where the path discards one more word of
  that pair and `-(cell + 1)` where it recovers one, since cell 0 has no sign
  of its own. A reverse step is what lets a later path undo part of an earlier
  one for less than starting again would cost.
- No worker. `trace` is 0.46 ms on animal against `chain`'s own 0.64, and the
  144 augmentations it comes back with are laid out and drawn in one pass, so a
  scrub is a redraw rather than a solve.
- One scale across both columns, so a unit of imbalance is the same height
  wherever it is read and a band comes out the same width at both of its ends.
  The two columns always carry the same units, every word that leaves a letter
  arriving at one, so what differs is how many slots they are cut into, and the
  column with the most of them fills the span exactly.
- The slot gap is `SLOT_GAP` 0.012 of the span capped at `GAP_MAX` 4 px. A
  column can be cut into as many as 26 slots, and at a share alone the 25 gaps
  between animal's take a sixth of the height from the slots themselves.
- Bands tile the slot they touch in the order the solver found them, so the
  last of them ends exactly where the slot does. A band past its slot would be
  a picture saying a letter shipped more than it ever had.
- The deficit column is left uncoloured, drawn in the muted token: a band takes
  the hue of the letter it leaves, so colouring where it lands as well would
  say the two were the same letter's ink. The hue is `palette.py`'s letter
  wheel through `disc-colour.js`'s `hsv`, which both discs colour with too.
- The last band laid is drawn at `LIT` 0.95 and the rest at `thin(ALPHA,
  frames)`, `balance-bank.js`'s version of `letter-graph.js`'s `fade`, over the
  bands rather than the pairs. animal's 144 come out at 0.26, furniture's 36 at
  the full `ALPHA` 0.5. `KNEE` is 40, and `FALL` 0.5 is a guess the way `FALL`
  in `word-bundle.js` and `ALPHA_FALL` in `letter-graph.js` are: there is no
  browser here to look in, and `make serve` is where to find out.
- A band was one sweep from the surplus letter it leaves to the deficit letter
  it reaches, saying nothing about the arcs in between. The band the readout
  names, the lit one, is routed through the letters its path walked:
  `balance-bank.js`'s `route`, one point a letter, placed across the span by
  how many arcs the path has paid for by the time it gets there. A reverse step
  recovers a word an earlier path discarded, so it takes that count back down
  and its leg runs right to left, against every other stroke in the picture.
  Direction is the whole of how a recovery shows, being the one channel that
  costs no ink: the reversing paths are the thin ones, animal's 13 at a median
  push of 2 against 3 across all 144, about 0.96 px on a 426 px span, so
  anything drawn at weight would make 3.3% of the shipping the loudest thing on
  the picture. Only the lit band. 57 of animal's 144 paths take more than one
  arc, and routing all of them would put three crossings in the middle where
  there is one; the readout already speaks for the step it stands at alone.
- Both ends stay on the band's own slice, so the tiling is untouched. An
  interior letter is passed through rather than shipped from, so the line
  crosses the middle of its slot and takes no slice of it, and a letter that
  banks nowhere, being balanced, is dropped rather than given an invented
  height, 4% of food's interior letters and none of animal's. `route` has no
  DOM in it, and `balance-flow.js`'s `ribbon` draws the plain sweep and the
  routed line both, so the two cannot drift; `route` costs 0.3 µs, once a draw.
  The census is worth recording: 204 of the 2,645 augmentations over the 37
  categories carry a reverse step, 7.7%, and almost every one carries exactly
  one, 208 reverse steps against 4,149 in all. insect, reptile and toy have
  none, and the dominant shape is surplus → deficit ⇠ surplus → deficit, 148 of
  the 204. No path takes the running arc count outside [0, cost], all 2,645 of
  them, so the clamp in `route` is a guard rather than something the corpus
  needs. The readout's path line is unchanged, having already printed `→` in
  the accent colour and `⇠` muted.
- `LIT` 0.95 was never the problem. The ink under the lit band comes to 0.26 on
  animal and 0.38 on furniture, so the fill is already three times its own
  ground. What the fill has nothing to work on is the band itself: the element
  opens at the balanced step, and successive shortest paths leave the smallest
  pushes for last, so the band lit on arrival is the thinnest one there is, 0.96
  px on animal and 0.56 px on food against a 426 px span. An alpha has nothing
  to raise on half a pixel. So `LIT_EDGE`, 1.5 px, strokes the lit band's
  outline once the fill is down, in the band's own ink at the alpha it was
  filled at. It is in pixels rather than in units of imbalance, since what it
  carries is which band the readout means and not how much that band shipped;
  the fill keeps every bit of that and the stroke rides its outline. The join is
  round, since the reverse leg turns back on itself and a mitre there is a spike
  pointing out of the picture.
- No hit testing, no hover, no search box, no crumb line and no column beside
  the picture at any width: the rail and the readout under it are the whole of
  what would go there, and the figure is already wide rather than square. So
  the `ResizeObserver` watches the stage alone, where the three discs watch the
  frame as well.
- Its own transport, since what it has to show is a sequence: first, prev,
  play, next, last and a scrub. The run is given a budget rather than the step a
  fixed rate, `RUN_MS` 9,000 held between `STEP_MIN` 60 and `STEP_MAX` 160 ms,
  so animal's 144 augmentations come out at 62 ms each and furniture's 36 at
  the 160 ms ceiling.
- It opens at the balanced state rather than at nothing run, so a page nobody
  touches still shows the whole transport rather than an empty pair of columns.
  Play rewinds first where it stands at that end.
- `seek(k)` is the public way in, clamping to `[0, frames]`, and it emits
  `balance-step` only where the step turns over. The bands drawn are the ones
  below `#step` and the readout names the last of them, so the line and the
  marked band can never be of different steps.
- `disc-idle.js`'s `watch` gives the canvas back a screen away, and playing
  stops with it, since a run nobody can see is a timer spending frames on
  nothing. There is one canvas and nothing held beside it, the bands being
  drawn straight onto it. Waking does not resume: what was playing was left
  behind, and a picture that starts moving as it comes into view is not what
  the reader asked for.
- `src` and `index-src` are `<letter-disc>`'s, reading the same category file
  through `disc-index.js`, so `embed.html`'s one control reaches it unchanged
  and a page carrying all three still fetches one word file.
- It is clean under `tsc`, so it stays out of `tsconfig.json`'s exclude list,
  unlike `hypernym-disc.js`, `word-disc.js` and `letter-disc.js`.
- The readout is three states off `#step`: at nothing run, "26 letters open 778
  words out of balance, cleared in 144 augmentations"; in between, "step k of
  n · A → B · X of Y shipped"; at the end, "balanced after 144 augmentations ·
  945 words discarded to close the circuit". Under it sits the path the step
  walked, `push P · cost C · A → B ⇠ C`, with forward arrows in the accent
  colour and reverse ones muted.
- A reverse step showed in the readout's path line as a muted `⇠` and in the
  lit band's leg running right to left, and neither of those finds one:
  scrubbing for them means reading the path line 144 times. So
  `balance-bank.js`'s `reverses(frames)` returns the steps to mark on the
  scrub. A step is the count of augmentations run, so frame `i` is the band lit
  at step `i + 1` and the mark belongs there rather than on the step before it.
  204 of the 2,645 augmentations carry a reverse step, 7.7%; animal has 13 of
  its 144, food 18 and plant 20. animal's 13 are not spread out, being steps
  88-98 and 143-144, and the closest pair sit 3.38 px apart on a 500 px track,
  so a run of them reads as a band rather than as separate ticks.
- The element draws the scrub's thumb rather than leaving it to
  `accent-color`, since a mark has to line up with the thumb's travel and that
  travel is the thumb's own width, which is the user agent's to pick otherwise.
  The width is `--_thumb`, 13 px, and one number places both. A mark sits at
  `calc(var(--_thumb) / 2 + (100% - var(--_thumb)) * k/n)`, the thumb
  travelling from half a thumb in to half a thumb short of the far end. The
  track is the wrapper's `::before` rather than the input's own, since the
  input paints over the marks and an opaque track would bury them. The marks
  are `aria-hidden`, take no pointer events, and are 2 px by 10 px in the ink
  token. `#ticks()` rebuilds them from `#build()` with `replaceChildren`, so a
  change of category replaces rather than appends; it is `#ticks` and not
  `#mark` because `#mark` is already the category picker's.
- The events are `balance-step {step, frames, push, cost, from, to, shipped,
  need}` and `balance-render {category, words, frames, need, paid, settled,
  solveMs, drawMs}`.
- animal is 1,582 words, 26 letters open, 778 words out of balance, 144
  augmentations and 945 discarded; its biggest single push is 32 words and its
  longest path 5 arcs. furniture is 79 words, 16 letters open, 47 out of
  balance, 36 augmentations and 75 discarded. food has the most augmentations
  at 156, and all 37 categories settle.

## The longest chain

- `graph.longest_chain(words)` and `web/word-longest.js`'s `chain(words)` are
  one algorithm written twice, so a change to either is a change to both.
  `tools/chains.json` is what holds them together: 17 frozen cases, each a word
  list with the chain it must produce word for word, its bound and whether it
  certified. A case may also carry `opening`, the word its chain must open on,
  and `like`, naming the case whose word list it shares rather than carrying a
  second copy of it; both checks resolve those and assert the chain opens on
  the word asked for. `tools/check_chain.py` runs the Python half and
  `check_web.mjs` the JavaScript half. The word lists there are a snapshot and
  do not track the corpus, so a corpus change is not answered by regenerating
  the file.
- The model is `graph.py`'s claim applied again: a word is an arc from its first
  letter to its last, so a chain is a trail on 26 vertices and keeping the most
  words is discarding the fewest. That is a min-cost transshipment on 26 nodes,
  supplies the out-degree minus the in-degree, capacities the word counts, costs
  one per word. Every cost is non-negative and the matrix is totally unimodular,
  so the answer comes back integral with no solver. Words sharing a letter pair
  are interchangeable and aggregate into one arc of capacity n rather than n
  arcs.
- 26 Dijkstras price all 676 start/end pairs off a single balanced solve, since a
  chain from s to t moves supply by one unit at each end and costs the balanced
  answer plus the shortest residual path t to s. The 677th candidate is the
  closed circuit.
- The candidate scan stops early once no remaining candidate can keep more words
  than the best fragment found. That break is load-bearing beyond speed: it also
  decides which component the next round runs on, and a smaller fragment can free
  more words than a larger one — river chains 64 words with the break and 63
  without. Both implementations stop on the same test.
- Candidates sort on the whole tuple, cost then s then t, since neither Python
  nor JavaScript promises anything about ties. No word list here needs it: 37
  categories and 3,000 random ones answer the same either way. It is there so the
  two halves never have to agree by luck.
- The relaxation ignores whether the arcs it keeps form one connected run, so it
  answers with an upper bound. Union-find checks; where the arcs come back
  connected the bound is attained and `certified` is true. Where they do not, the
  largest component is kept and the rest solved again at full capacity, and the
  gap is reported rather than hidden.
- `certified` under-reports on the small categories. 32 of the 37 certify, and
  the five that do not are fabric 61 against a bound of 63, furniture 9/10,
  instrument 10/11, mineral 18/19 and river 64/65; exhaustive search over the
  letter multidigraph proves furniture's 9, instrument's 10 and mineral's 18
  optimal, so the bound is loose by one in those three.
- `graph.longest_chain(words, opening=None)` and `web/word-longest.js`'s
  `chain(words, opening)` take a word the chain must open on, which is the
  question a player standing on a word asks. Under both sits the real
  primitive, a forced opening *letter*, `_solve_matrix(m, start)` in Python and
  `longest(m, start)` in JavaScript. The word-level form spends the word,
  solves from the letter it ends on, and puts it back on the front, so the
  bound it reports covers the whole chain including that word. An opening that
  is not one of the words is refused rather than ignored.
- Every candidate opening on another letter is dropped before the scan. The
  closed circuit survives whatever the letter is, since a closed walk can be
  rotated to open on any letter it touches, and the existing `touched` guard is
  what decides whether this one does. That circuit is the one candidate a
  letter filter cannot simply drop, and `circuit-opened` is the fixture case
  that holds it.
- The bound is computed over the admissible candidates alone, so a chain forced
  through a bad opening still says whether it is the longest chain that opening
  allows.
- 2,189 constrained solves across the 37 categories gave 0 disagreements
  between the two implementations and 0 illegal chains, every one opening on
  the word it was asked for. 2,314 more on random word lists were checked
  against exhaustive brute force, with 0 failures and every one reaching the
  true optimum.
- Certification falls under a constraint. Over those 2,189 solves 75%
  certified, where 32 of the 37 categories certify unconstrained. A forced
  opening can sit in a small component, so the relaxation's bound goes loose
  where the free one did not. furniture chains 9 words whole; opening on `crib`
  still reaches 9, `bookcase` reaches 2 against a bound of 5, and `bunk`
  reaches 1 and is certified, since nothing starts with K.
- A missing certificate is a loose bound far more often than a short chain.
  Over every word of every category under 300 words 69% certify, and mineral is
  the worst at 1% of its openings, against tree 3%, river 3% and fabric 8%.
  Exhaustive search over the letter multidigraph settled all 60 sampled mineral
  openings and the solver had 59 of them exactly right, the exception being
  `sienna`, which chains 13 against a true optimum of 14 and a bound of 15. A
  readout that shows the bound will therefore read as much less certain than
  the solver is, which is why the disc prints the count without its
  certificate.
- A letter no word leaves is short cut rather than solved. The general path
  answers the same, so this is speed and not correctness. It runs in 0.05 ms
  against 0.56 on animal, over the 11 of its 1,582 words that end on a letter
  nothing starts with.
- The five constrained cases each hold something the free ones cannot:
  `circuit-opened` the rotation, `furniture-opened` an opening that costs
  nothing, `furniture-stranded` a dead end certified at one word,
  `furniture-boxed` the constrained bound going loose where the free one did
  not, and `bird-opened` an opening at scale, 116 words certified.
- `web/word-longest.js` has no DOM in it, exporting `chain`, `longest`,
  `buckets`, `components`, `hierholzer` and `trace`. `trace(words)` is the same
  solve with its augmenting paths recorded, read off `balanced()` rather than
  solved a second time, so it moves no answer and `graph.py` has no counterpart
  to it; `<balance-flow>` is what draws them. It imports `matrix` and `LETTERS`
  from `letter-graph.js` rather than counting the matrix a third time, so
  `<word-disc>` pulls `letter-graph.js` transitively and a page carrying that
  element alone fetches one module more than it used to; `embed.html` already
  loads it for `<letter-disc>`. What the element prints off it is in
  `### <word-disc>`.
- `buckets` stores word text exactly as it came in and never rewrites it, so a
  multiword entry like "polar bear" comes back out of a chain spelled the way the
  category spells it.
- `--opening WORD` sits on `stats` alone, since the other three commands print
  no chain and the word it names belongs to one category's list. It is
  lowercased and stripped before matching, and a word the category does not
  yield is refused the way an unknown config key is, naming the nearest word
  `difflib` finds, or the category's count and `weft words <category>` where
  nothing is near. Reporting the unpinned chain under a pinned heading would be
  a wrong answer printed confidently. `graph.summary(words, opening=None)`
  carries the argument through, so `render.py`'s caller is unchanged, and the
  opening goes into the report's heading: `longest chain from crib: 9 words,
  …`.
- `summary()` carries `longest_chain`, `chain_bound` and `chain_certified`, and
  `stats` prints the line. Python is 8 ms on the largest category and JavaScript
  0.8 ms, and the two produce byte-identical chains on all 37.

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
  `import.meta.url`. `balance-flow.js` and `balance-bank.js` are staged by that
  glob with nothing to add by hand, and `balance.html` is a harness served at
  `/balance.html` rather than a page that ships.
- `embed.html` is the one page it ships: one `<section>` per element, the three
  discs and a fourth for `<balance-flow>`, in ordinary document flow, each
  carrying its own script, data attributes, height and custom
  properties, so any one can be lifted out without bringing the others.
  Nothing positions one relative to another. It asks for its data beside itself
  where the three harnesses ask for `/out/…`, which is why `tools/serve.py`'s
  `translate_path` falls back to `out/` for a top-level name not in `web/`.
- One `<select>` above the word disc sets the category for `<word-disc>`,
  `<letter-disc>` and `<balance-flow>`, where the picker each grows from an
  `index-src` of its own would give the page three: three pickers for one
  choice is the page saying the three are unrelated when they are reading the
  same file. `<word-run>` follows the word disc, so it changes with them and
  the control writes nothing to it. It is a `<section>` with its own script
  like the rest, and it writes to whatever
  `document.querySelectorAll("word-disc, letter-disc, balance-flow")` finds
  rather than to anything it requires, so lifting it out leaves the three on the
  category they name themselves and lifting one out leaves it driving
  whichever are left. It waits on `DOMContentLoaded` where the document is
  still loading, since the script sits above all three and none can be found or
  read before the page has finished parsing. It writes `src`, which all three
  already observe, so the page needs no other way in to them; `disc-index.js`'s
  `href` does the path arithmetic and its `label` writes the option text with
  the word count. The index is `words-index.json`, which `web-dist` already
  stages among the 38 word files, and a failed fetch shows in the select itself
  rather than leaving it stuck on "loading".
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
    web/word-longest.js            the longest chain solver, no DOM
    web/word-run.js                the chain the disc could still make
    web/words.html                 the word disc's harness, with a picker
    web/letter-disc.js             the letter graph as a chord diagram
    web/letter-graph.js            its matrix, ring, ribbons and hits, no DOM
    web/letters.html               its harness, with the same picker
    web/balance-flow.js            the transshipment as it runs
    web/balance-bank.js            its two columns and their bands, no DOM
    web/balance.html               its harness
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
    tools/check_chain.py           the Python half of the chain cross-check
    tools/chains.json              the 12 frozen cases both halves answer

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
`tools/check_chain.py`, `biome lint`, `biome format`, `make web` and
`make types`. mypy is strict, with `mypy_path = src` because `tools/` is not
part of the package. nltk, wordfreq, pyvis and networkx ship no type
information, so `mypy.ini` declares them untyped and the values crossing those
boundaries are annotated by hand.

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
initialiser naming a moved constant does the same, and so does a backtick in a
comment inside a template literal, which ends the string. All three have
happened, the last of them in `word-run.js`'s style block. So the
check imports every module against a stubbed DOM and then drives all three
elements, with clicks computed from `word-layout.js`, hovers fired at rows, and
resizes and scrolls driven through the observers' recorded callbacks.

It asserts properties rather than exact counts, which move whenever the geometry
does, and every assertion was mutation-tested. Its limits are worth knowing: the
stub carries no CSS, so a rule that drew every row as an empty box passes it,
and did, and `<word-run>`'s items being let shrink again is the same blind spot
in the same place; one fragment serves all three templates, so a claim that an element
lacks a search box is read off the module's text rather than the shadow root;
and the main-thread fallback is synchronous, so a stale bundle arrival is not
covered. The chain solver's dead-end short cut is the same kind of blind spot,
a speed path answering exactly what the general path would, so neither check
can tell which of the two ran. Anything about layout has to be looked at in a
browser, which is what `make serve` is for.

`tools/check_chain.py` runs the 17 cases in `tools/chains.json` through
`graph.longest_chain`, and `check_web.mjs` runs the same 17 through
`word-longest.js`, so the two solvers meet at one file rather than at each
other. The JavaScript half plays every chain out independently of the fixture
and adds 200 random word lists, asserting the two properties that hold whatever
the words are: the chain is playable, and it never beats its own bound. Each
list is then solved a second time with a forced opening, which must be
playable, must open on the word it was given, and must not be longer than the
free chain.

Six assertions hold `<word-disc>`'s figures, every one of them mutation-tested.
The at-rest line names the free run; a perfect prefix holds words played plus
words still to come equal to that free run the whole way down it; a move off
that chain makes the figure fall; the element's figure for a word under the
pointer equals what `word-longest.js` answers over the words not yet played,
which is what catches a figure worked out before a move and held past it;
`hint="off"` does no work; and a move under the pointer is worded differently
from the word play stands on.

`dispatchEvent` in the stub was a no-op returning true. It now delivers to the
listeners registered on the element and bubbles to the parent, since an element
that binds by listening cannot be driven at all without real delivery.
`getRootNode` and `document.getElementById` were added alongside it, the latter
backed by a map filled when an id is set, and the shared markup fragment gained
a `.run` div.

Nine assertions hold `<word-run>`, every one mutation-tested: the fold leaves
a `2n+1` run whole and loses no word; nothing runs two words together, the row
opening with its count, then a word, no word ever standing next to another and
the chain ending on a word, and a run folded to two words at each end carrying
four chevrons, one inside each end and one on either side of the elision, and
one elision, counted alongside the neighbour rule since the fault reported was
chevrons missing from one end while the other kept them, which a rule about
neighbours cannot see;
the run with nothing played is the free chain; opening on a word that is on a
longest chain costs nothing and a word off one costs; the run never repeats a
word nor comes out longer than the free chain, which is what catches a
continuation solved over the category rather than over what is left; the
element hears play and undo with nothing touching it; a change of the disc's
word set resolves the run over the new words with nothing played, which is what
`embed.html`'s control rests on; a run set by hand shows; and a disconnected
run stops following and lets go of its listeners. `embed.html` is read for the
tenth, that its `for` names an id that page carries.

`check_web.mjs`'s shared `fragment()` gained a rail, a `.keys` div of five
buttons and a `.scrub` input, since `<balance-flow>` is the one element there
whose state a click moves rather than the pointer.

`unbalanced(words, tr)` is the whole of what holds `trace`: it replays every
frame and returns the first thing wrong. Every path must run from a surplus
letter to a deficit one, its walk's two ends must be the letters its frame
names, its cost must be the forward steps less the reverse ones, no cell may
come out discarding more words than it holds, the pushes must clear exactly
what was owed, and the costs must sum to what the trace says. None of that
shows in a chain, which is why it is asserted directly. It runs on the harness
word list, on `["ab", "axb", "ac", "ad", "ef", "gf", "hf"]` and on 60 random
lists. The hand-cut list is there because the harness list balances in three
paths of one unit each, one path a letter, which cannot tell a slot that fills
up from one that never advances, or a push from the count of pushes; on the
built list A ships three times, F receives three times, and A to B carries two
words. Tracing must also move no answer, so the free chain's length is taken
before any of it runs and asserted unchanged, and the circuit's kept words must
not pass the chain's own bound.

Five assertions hold the geometry on its own: a unit of imbalance is worth the
same pixels on both sides, the taller column ends exactly at the span and the
shorter does not overrun it, the bands tile their slots with no gap and no
overlap, a forward step reads head to tail and a reverse one tail to head, and
`thin` is flat at the knee and below `ALPHA` above it. Nine more hold the
element: it opens at the balanced step, draws two cubics a band and one
rectangle a slot, the readout names the augmentation just laid rather than the
one about to run, each of the five keys and the scrub moves the step,
`balance-step` names letters rather than indices, play rewinds from the
balanced end and the same key stops it, a sleep gives the canvas back and stops
the run while a wake does not start it again, a change of words is a fresh
solve and a fresh transport, and a disconnected element stops its run. The
sleep claim is driven on a twenty-path word list, so the run cannot reach its
end inside the hold and finish of its own accord, which is what the claim would
otherwise be resting on. Every one of these was mutation-tested, and three
survived the first pass: a vacuous tiling assertion on a list where every slot
held one band, `shipped` reading as a count of frames where every push was one,
and the sleep claim resting on a run that finished on its own inside the hold.
The changes above are what answered them.

Six more hold `route`: a one-arc path routes to two points, so the plain sweep
is left alone; a reversing path routes to a point a letter; both ends stay on
the band's own slice; every leg runs the way its arc is signed and at least one
runs right to left; every interior letter is crossed at the middle of its slot,
with both columns walked so a lookup built over one of them alone would show;
and a balanced letter is dropped. At the element, the lit band draws two cubics
a leg where every band below it draws two. The fixture is `RWORDS`, 14 words
balancing in 5 paths, cut so the path below the last one is multi-arc and banks
every letter it walks, without which the count reads the same whether the lit
band alone is routed or all of them are. `check_web.mjs`'s canvas stub records
the points given to `moveTo`, `lineTo` and `bezierCurveTo`, where it counted the
cubics and dropped the rest. That is what holds every band to opening and
closing on its own slice, the openings running down the surplus column in letter
order and the closings down the deficit column, and holds the ribbon's two edges
to being the band's own height apart. A ribbon written by shared code fails
identically on every band, which a count cannot see. Every one was
mutation-tested. The one mutation that survives is a cubic's control points
moved off the leg's midline, which changes the bow alone and is what `make
serve` is for.

Four more hold the lit band's edge: one stroke a draw, on the band the readout
names, in that band's own ink, and at a width above zero with a round join. A
stroke on every band would light none of them, and a stroke in another colour
would stop saying which letter the words left. The stub records the nib, the
`lineWidth` and `lineJoin` a stroke went down at, beside the ink it went down
in, since a stroke at no width counts the same as one that shows. All four were
mutation-tested.

Four more hold `reverses`: the routed fixture's marks are exactly its reversing
steps, which marking a step early, marking every step and marking the forward
arcs instead all fail; the fixture marks at least one step, so the element
claim below is not vacuous; an empty trace marks nothing; and a path of forward
arcs alone is not marked. Four more hold the marks at the element: the count of
them equals the count of reversing steps, each sits at its step's fraction of
the travel, the placement names both halves of that travel, half a thumb in and
the span less a whole thumb, which is what catches a mark placed along the
whole track and one not offset by half a thumb, and a change of word set to a
list whose paths recover nothing leaves no marks behind. `check_web.mjs`'s
shared `fragment()` gained the `.slide` wrapper and the `.marks` div. All eight
were mutation-tested.

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
The category control is no element, and names its id, its index and its module
in script text rather than in a `src` attribute, where that loop does not look,
so five assertions of its own cover it, every one mutation-tested: the
selector's id is on the page; the page names `words-index.json`; its inline
script imports at least one module, and every `from "./…js"` in it resolves to
a module `web/` has; and `word-disc.js` and `letter-disc.js` both declare `src`
in `observedAttributes`, since the control reaches them through that attribute
and nothing else. That block's two loops gained `balance-flow` and
`balance-flow.js`.

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
