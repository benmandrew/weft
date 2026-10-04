# weft

WordNet as circular diagrams: the hypernym taxonomy, the word chain game on a
category, and the 26-letter graph under it. See @README.md for usage.

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

This file holds rules and the reasons that forced them. The algorithms, the
longer reasoning and the measured figures are in docs/notes.md, which does not
load each session; read it before changing the chain solver or
`<balance-flow>`, or when a figure is wanted.

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
- `lexicon.EXTRA_WORDS` tops a category up by hand, for words a lexical database
  misses, and ships empty. An entry bypasses every filter and joins after the
  sliding frequency cut in `_resolve`, so it never counts towards `--target`.
  It carries wordfreq's real Zipf, so a rare addition sorts last and needs a
  larger `--limit` to be drawn. A duplicate of a word WordNet already yielded is
  dropped, `_check_extras` refuses an unknown category or an unplayable word at
  import, and `--multiword` still governs it.

## Configuration

- Geometry lives on `config.Geometry`, the word filters on `config.Selection`,
  and the letter colours on a `palette.Wheel` of `Arc`s carried by the `Theme`.
  A figure takes each as an argument, never as a module constant. The file is
  `./weft.toml` or the file `--config` names, which must exist. `theme` is a
  bare key rather than a fourth table, and `--theme` overrides it.
- All four commands read `[selection]`, so `--config` sits on all four: a table
  only `build` honoured would put `categories`, `stats` and `build` out of step.
  The file is read once in `main()`, since `categories` loads all 37 word lists.
- `cli._selection_args` builds one flag per `Selection` field, its type from
  `config._SELECTION_BOUNDS` and its help from `cli._SELECTION_HELP`;
  `cli._DRAWN` names the one setting only `build` offers. Precedence is the
  flag, then the file, then the default, so every selection flag defaults to
  None and `--multiword` is `BooleanOptionalAction`: `--target 60` typed out and
  no `--target` at all must reach a file as different things. That rule lives in
  `cli._selection` alone.
- `config.as_members` turns a `Selection` into `lexicon.members`'s keyword
  arguments, and every caller goes through it. `members` keeps its explicit
  signature, since that is its API.
- Unknown keys and out-of-range values are refused, never ignored, since an
  ignored key silently redraws the same figure. `hue_start` and `equalise` mean
  something at zero. `[selection]` lets every numeric setting reach its own
  minimum: `min_zipf` 0 is the whole vocabulary and `limit` 0 is no limit rather
  than a blank disc, which `render.words_disc` spells out rather than slicing.
  The Zipf ceiling is 8, where the scale runs out. In `[palette]` a preset name
  and an arc's numbers are mutually exclusive, since a preset may hold two arcs;
  `palette.with_wheel` shifts presets to the light ground by `LIGHT_SHIFT`.
- `schemas/weft.schema.json` mirrors `config.py` and `palette.py` by hand and
  owns the per-key descriptions, so a new setting is documented there and
  nowhere else. `tools/check_schema.py` holds the schema to
  `_SELECTION_BOUNDS`, `lexicon.members`'s keyword defaults to `Selection`'s
  through `config._MEMBERS_RENAME` and `_MEMBERS_SKIP`, and `_SELECTION_HELP` to
  `Selection`'s fields, since a setting with no help line gets no flag.
  `taplo.toml` and the `#:schema` line in `weft.toml` point editors at it.

## Rendering

- Wedge order is `render._fan_key`, and `web.py` and `word-layout.js` sort the
  same way: the tail letter, rotated to start just before the wedge's own
  letter, running backwards. Plain tail-letter order makes the bundle cross
  itself. A change on one side is a change on all three, and `check_web.mjs`
  holds the JavaScript to the Python.
- Edges are `Path` cubics, never sampled polylines: SVG draws cubics natively,
  so sampling costs build time, file size and accuracy at once.
- `render._hoist_shared_attributes` moves `style` and `clip-path` off path
  elements onto their group, a third of the file. Verify any change to it by
  rasterising before and after and comparing pixels, not by eye.
- `build` renders one file and one view, the word disc, SVG unless `--format
  png`. The other views in `render.py` and the pages in `web.py` are
  library-only; do not wire them back into the command line without asking.
  Keep `svg.fonttype = "path"` in `render._typeface`, since naming the fonts
  would silently substitute a face on any machine without Iowan Old Style,
  Avenir and Menlo.
- The label size is solved, not set: `_wanted_inches` gives the width at which
  adjacent labels clear each other, `_canvas_inches` holds it between 9.6 and 30
  inches, and `_fitted_pt` shrinks `label_pt` by whatever the cap denied. Below
  the cap it returns `label_pt` itself, so a disc that already fits cannot move
  by a rounding error. `_disc_limit` reads the fitted geometry through
  `dataclasses.replace`, so the axis frames the labels actually drawn.
- Generated pages stay self-contained: no external hosts, no CDN tags.
  `web._CDN_TAG` strips the Bootstrap links pyvis emits regardless of
  `cdn_resources="in_line"`.
- `out/` is generated and gitignored; nothing reads from it.

## The three discs

- The DOM-free modules (`word-layout.js`, `word-bundle.js`, `letter-graph.js`,
  `balance-bank.js`, the `disc-*.js` helpers) are split out so `check_web.mjs`
  can assert on them. Put new logic there rather than in an element.
- Canvas size goes through `disc-ratio.js`'s `ratio`, which caps the area at
  `MAX_AREA`, never the ratio, since browser zoom multiplies devicePixelRatio.
- `disc-idle.js`'s `watch` empties the canvases of a disc more than a screen
  away after `HOLD`, and a wake cancels the hold, so a fast scroll does not
  empty and refill every disc it crosses. It returns a handle rather than the
  observer, since a held sleep must not outlive a disconnect.
- `<word-disc>`'s sleep keeps the resting bundle and frees only the canvases.
  The canvases redraw in 5 ms; entity's bundle takes the worker 255 ms, and a
  fast scroll reaches the disc 116 ms after it wakes, so a dropped bundle left
  it without edges on screen. A change of words while asleep still releases it.
- The resize observer watches the frame as well as the stage, since a stacked
  stage's box does not move when the frame widens.
- `fit` fills the box the host gives, so the host must give one. Blocks under a
  disc are fixed height, so longer text never resizes the disc under the
  pointer. Text past the box scrolls inside it rather than being clamped, and
  `scrollable` gives an overflowing box a tab stop, `role=region` and a name so
  the keyboard can scroll it. That reads layout, so it runs once, a frame after
  a committed action, a key or a resize, and never on a pointer move.
- Refit text when `document.fonts.ready` settles, since canvas text is measured
  and a cached fit replays in the wrong face.
- The halo is copies of one `fillText`, never a `strokeText`, which is
  positioned by different code and reads as a shadow. Hub baselines centre on
  `HUB_REF` ("Hd"), since per-word ink metrics make the name jump.
- Hit testing is a binary search over angles; there is no spatial index.
- Accessibility (WCAG 2.2 AA) in `<hypernym-disc>` and `<word-disc>`:
  - The host is `role=group` with an `aria-label` unless the page set one, and
    `.stage` is `role=img` with a short text alternative updated on a zoom or a
    build.
  - One visually hidden `.announce` live region per element (`role=status`,
    polite, atomic). Only a committed action writes to it (a zoom, a play, a
    refusal), never a hover. `#tell` clears it and puts identical text back a
    frame later, since a region is read only when its text changes.
  - The column (`.kids` / `.moves`) is a `role=listbox` with one tab stop and
    `aria-activedescendant`. `disc-search.js`'s `step` moves the row without
    wrapping; Enter or Space acts as a click. A keyed row past the paged rows
    pages the column on to it.
  - A hover readout ends on the host's `pointerleave`, not the canvas's, and
    holds over empty canvas, so the pointer can cross to the readout (1.4.13).
    Escape anywhere reverts it.
  - `--_edge` is 85% muted in all four elements (80% is the floor), at least
    3:1 on ground and panel in both palettes, and `--disc-edge` overrides it.
    The selected-row tint is 10% accent, so every text colour on it keeps
    4.5:1; a 2px inset accent bar marks the row without relying on the tint.
  - Rows are at least 24px tall. The crumb's buttons are shorter, and rely on
    the spacing exception of 2.5.8, since a taller line would take height off
    the disc. The crumb scrolls to its end on a move rather than wrapping.
  - The canvas is `touch-action: pan-y`, so a page still scrolls across it.

### `<hypernym-disc>`

- It reads the tree as `par`, an array where every parent's index is below all
  of its children's. That ordering is the whole contract: depths, leaf counts
  and angles come out of flat loops rather than a traversal. `export_tree.py`
  writes preorder, which satisfies it and keeps every subtree contiguous.
- The three exports go to `out/` and are never committed. Keep them
  index-aligned: the names and glosses files are positional, with no key to
  catch a mismatch.
- `disc-search.js` bands sit 1,000 apart and every penalty is capped below
  1,000, so a weaker match never outranks a stronger one.
- The hub name, the gloss and the crumb tail all come off `#focus`, so the three
  are always one node.
- The `rings` cap is in the prepare key, since it changes which runs merge.
- Do not terminate the paint worker on disconnect: it holds the only handle to
  the base canvas, which transfers once, and the element must not size that
  canvas. The main-thread fallback calls the same `disc-paint.js` class, so it
  cannot drift.
- `layoutTree` (`disc-layout.js`) and `tints`, `merge`, `ramp` and `rampStep`
  (`disc-paint.js`) are public: a static SVG banner of the disc, drawn outside
  this repo, imports them from `web-dist` so it cannot drift from the element
  either. Keep their signatures, or change the caller with them. `merge` takes
  the hue step (`hueQ`) and the hairline rule (`hair`) as options, because a
  file sized in pixels wants both set differently from a canvas.
- Never batch the draw into one path per colour: 145 fills against 82,115 is
  eight times slower, since each colour's path scatters across the disc and the
  rasteriser covers its bounding box. A merged piece takes the circular mean of
  its members' hues, rounded to a one-pixel slice so it interns; matching on
  colour leaves nothing to merge above `hue-depth` 2.

### `<word-disc>`

- A word's successors are a whole wedge, never a list stored per word, which is
  `graph.py`'s claim applied. `word-layout.js` is `render.words_disc`'s layout
  written a second time, so both put a word at the same angle.
- `Chain.legal` is the whole of the rule, a played word being no move: the
  disc paints, the readout explains and the cursor follows that one function.
- The readout's figures are cached in `#reachOf`, cleared in `#after()` on every
  chain change and in `#build()` with `#bestRun` when the word set moves.
  `hint="off"` is read in JavaScript, not CSS, since it saves a solve.
- The hub is one radius for what a click undoes and what a name must fit, so no
  part of a name sits where a click does nothing.
- The resting bundle is a stroke per merged chord, since alpha must
  accumulate, held in its own square capped at `MAX_PX`, derived from
  `MAX_AREA`, since a lower cap blurs the bundle alone. It draws in `BANDS` of
  alternating direction with no shuffle and no seed, so builds composite
  identically and a resize cannot shimmer.
- `points` merges words into `BINS` angle bins before drawing: a stroke joins
  two bins and goes down at the alpha its `weight` in chords would stack to.
  A letter's words ending in one letter are one contiguous run, all reaching
  the whole of that letter's wedge, so the merge is exact to a bin. It bounds
  the strokes whatever the word count, which is why there is no chord cap; a
  cap also could not draw a dense set, whose per-chord alpha is under one
  8-bit level. The bins are angular, so the picture does not move with the
  square. `weight` subtracts the self-pairs, a word not following itself.
- `word-bundle-worker.js` owns nothing between messages, so it is terminated on
  disconnect, unlike `disc-worker.js`. `#armFloor` starts the `WORKER_FLOOR`
  deadline at the first bundle wanted, since timing it from construction reads
  a slow link as no worker.
- The worker draws through `bands`, and after each band it snapshots the canvas
  with `createImageBitmap` and waits for a task. That sends each band to the
  GPU process on its own; batched, entity arrived there as three tasks of about
  45 ms on the thread every browser frame is drawn on, and frames ran late for
  a quarter of a second. Keep both halves. Do not swap in `getImageData`, which
  doubles the GPU work, or `willReadFrequently`, whose software canvas took
  1.2 s for plant. A build a newer message overtakes stops and answers nothing.
- The wait is a `MessageChannel` task and then `GAP` (2 ms). Do not go back to
  `setTimeout(0)`: it nests inside the snapshot's task and is clamped to 4 ms,
  which was 290 ms of entity's 390 ms build. Do not drop the timer either: bands
  sent back to back put GPU tasks of up to 48 ms on the browser's frame thread.
- `release(pic)` closes an `ImageBitmap`, whose pixels sit outside the heap and
  look small to the collector: call it when a bundle is replaced, lands after
  the disc moved on, or on a word-set change. The bundle held over
  `disconnectedCallback` is kept on purpose, for reattachment.
- `#measure()` estimates each word as the sum of its characters' advances, each
  character measured once, and calls `measureText` only on the words within
  `SLACK` of the widest estimate. Do not go back to measuring every word: on
  entity that was 74 ms and left 28.5 MiB of Blink's shaped-text cache on the
  heap until the disc next drew a smaller set. `SLACK` must stay above the
  kerning spread, about 7.5% in Libertinus Serif.
- `#draw` puts the opaque dots into one `Path2D` per colour, walked in ring order,
  and skips a dot within a third of a pixel of the last one its path took. A
  fill per dot was 31 ms of each entity draw. The dimmed dots of a game in play
  keep a fill each, because overlapping they must darken each other. A single
  path anti-aliases its edge once, so a packed ring comes out about a device
  pixel thinner than the stacked fills made it.
- Every sort by spelling compares integer places from `spelling()`, never the
  strings: `rankOrder`'s tie-break, `layout`'s within-letter order and the
  column's `#alpha`. The last two are counting sorts through `alphabetical`,
  bucketed by place; on entity `layout` went from 8.4 ms to 1.3 ms with the
  same output. `WordTable` sorts its whole table once and hands each
  derived set its places as `spell`, which the picker passes through to
  `apply`. A place is only used for comparison, so the table's global places
  work for any subset. Do not ship the places in `wordnet-words.json`: words
  are numbered commonest first, so the list does not compress, and it adds
  99 KiB gzipped to a 279 KiB file to save 9 ms once per page.
- `#build` draws the disc and leaves the column of moves and the longest-chain
  sentence to `#later`, which runs after the next frame. On entity they took
  16 ms and 7 ms of the task that drew the disc. `#settled` is clear while that
  work waits: `#showRead` leaves the sentence out and `#shape` leaves the
  column alone until then. The build clears the old column at once, since a
  row clicked before `#later` runs would play whatever word took its index.
  The keyboard's row (`#mark`) is cleared with it, for the same reason.

### `<letter-disc>`

- It counts the letter matrix out of the same `words-<category>.json`, so a
  page with both discs fetches one file.
- Nothing is bundled: every arc is clickable and carries a count, and merging
  two destroys what the element shows.
- The width is `log1p` of the word count, since an arc of no width is not drawn.
  Put no floor under a quiet letter: `check_web.mjs` asserts one unit of weight
  is the same degrees everywhere.
- The pull runs with the turn, since a fixed long-chord pull turns short arcs
  and loops into spikes.
- `letter-graph.js`'s `near` is a prune, so it must never refuse a point that is
  on the arc. `#preview` never touches `#letter`, so a hover cannot move what a
  click landed on.
- The letter and arc selects are the keyboard's way to everything the pointer
  reads, since the canvas has nothing focusable. They and a touch tap go through
  `#pin`, which drills with `show()` and holds the arc in `#held`. The hub, the
  readout and the lit arcs all read `#shown()` (hover, then held arc, then
  letter), so the three cannot differ. A pick is announced; a hover never is.
- The hover clears on the host's `pointerleave`, not the canvas's, so the
  pointer can cross to the readout (WCAG 1.4.13). Escape clears a hover, and
  with focus inside goes back to the category. A tap pins, since a finger has
  no hover and its readout went as it lifted; a mouse click still does nothing.
- The canvas is `touch-action:pan-y pinch-zoom`: `none` stopped a phone
  scrolling past a disc that fills the screen.
- The readout scrolls rather than clipping, and `#scrollable` makes it a
  focusable region while it overflows; a held arc names all its words. `--_edge`
  is muted at 85%, which clears 3:1 on both the ground and the panel in both
  default palettes and the site's, and `--disc-edge` overrides it.

### Derived categories

- `tools/export_table.py` writes `out/wordnet-words.json`, one table from which
  `web/word-source.js` derives the word list below any synset. A file per node
  is ruled out, since 12,224 nodes have a playable word below them.
- It works because every filter in `lexicon._resolve` and `_in_category` is a
  fact about one (word, synset) pair or a sum over the pairs inside a category:
  the member bit, the early bit (sense rank ≤ `max_rank`), the pair's
  sense-tagged count, the word's tagged total and its Zipf. A new or changed
  filter in `lexicon.py` is therefore a change to `export_table.py` and
  `word-source.js` too. `tools/check_words.mjs` holds the derivation to all 37
  `words-<category>.json` files, word for word and Zipf for Zipf, and fails
  otherwise.
- `max_rank` and `multiword` are fixed at export, since they decide which pairs
  ship. The other `[selection]` settings travel in the table's `selection` and
  the page applies them.
- Word ids run in rank order (−Zipf, then spelling), the order the category
  files hold, so a result sorted by id needs no Zipf sort.
- The table is positional against `wordnet-tree.json`, as the names and glosses
  are. It carries a 32-bit Fowler–Noll–Vo (FNV-1a) fingerprint of `par`, and
  `WordTable` refuses a table written against another tree, since a mismatch
  otherwise reads as plausible wrong words. `fingerprint()` in
  `export_table.py` and `word-source.js` must agree.
- The tree keeps only first hypernyms, so the rest ship as `extra` edges and
  `ids()` closes over them to a fixpoint. "First" is by name: nltk 3.10 returns
  them in hash-seed order, so `_parents` sorts, or the two exports disagree.
  `min_depth` counts those edges too, as `lexicon._closure` does.
- `lexicon.EXTRA_WORDS` is not in the table, since a hand-added word belongs to
  a category's name rather than to a node. A derived list omits them, and
  `check_words.mjs` leaves them out of the comparison.
- `web/disc-picker.js`'s `Picker` is the one picker the three word elements
  share, talking to its element through the `PickerHost` callbacks (`open`,
  `apply`, `ready`, `category`, `fail`). `tree` names a `<hypernym-disc>` by id,
  resolved through `getRootNode()` so an element in a shadow tree finds it.
  It puts a visible `.pick-label` ("Category") ahead of the select and drops
  the select's `aria-label`, so no element needs a template change to show it.
  Its default rule is wrapped in `:where`, so an element's own rule wins.
- `table()` in `word-source.js` fetches once per `src` and decodes once per tree
  per page, however many elements follow. A failed fetch is not kept, so the
  next ask retries. The table is fetched at the disc's first move or the
  option's first choice, not on load: the first move is the reader using the
  disc, and the counts are then ready when the picker opens.
- The `#applying` flag is how `mark()` tells the picker's own words from words a
  host handed over, so any `src` or `data` from the host ends following.
- A node with no words below it is disabled in the select, and moving the disc
  onto one while following leaves the element on what it had, since an empty
  list is nothing to play.
- `#soon()` hands a followed node's words over a frame later
  (`requestAnimationFrame`, then `setTimeout(0)`), never inside the `disc-zoom`
  or `change` handler, so the disc paints first. Moves made while it waits
  coalesce into one follow of where the disc ended. A hidden page runs no
  frames, so it waits for a task alone. `check_web.mjs` tests all of this.
- `group` is read when the reader chooses, never observed. `LIVE` holds the
  connected pickers; a choice runs `#choose` here and `#take` in the rest, which
  goes through `#choose` and not `#onCat`, so it crosses once. `#take` skips a
  picker that does not offer the value or is on it already, and a `src` or
  `data` from the host never crosses.
- A host naming `tree` and no `src` opens following the disc. `#follow`
  returns without releasing while the disc's names are missing, and
  `#onNames` calls `#soon` again for a picker that is following and has drawn
  nothing. If the table fails, it opens `#first`, the index's first category.
  Such a page fetches the word table on load, not on the first move.

## `<word-run>`

- `for` resolves through `getRootNode()`, so a run in a shadow tree finds its
  disc. It fetches nothing, reading the disc's words and chain, and
  `disconnectedCallback` removes its listeners.
- Keep `.run>*{flex:0 0 auto}`: a flex item shrinks below its content before
  its parent scrolls, so words overrun the chevrons at narrow widths.
- The style block is a template literal, so a backtick in a comment inside it
  ends the string and the module stops parsing.

## `<balance-flow>`

Of the disc rules, `ratio`, the sleep, `fit`, the fonts refit and
`disc-colour.js` hold; hit testing, the hub and watching the frame do not.

- `trace(words)` reads the augmenting paths off `balanced()` rather than
  solving again, so it moves no answer and `tools/chains.json` needs no
  counterpart. A step is signed `cell + 1` for a discard and
  `-(cell + 1)` for a recovery, since cell 0 has no sign.
- A solve while asleep still fires `balance-render`, with `drawMs` 0, since a
  host's prose quoting the figures can be in view while the element is not.
- One scale across both columns, and bands tile their slot in solver order, so
  a band never overruns what its letter shipped. The deficit column is muted,
  since a band takes the hue of the letter it leaves.
- Only the lit band is routed through the letters it walked, and a reverse leg
  running right to left is the only mark a reversal gets, since reversing paths
  are the thin ones. A letter that banks nowhere is dropped rather than given
  an invented height. `ribbon` draws the sweep and the routed line both.
- Read the turn glyphs' letters off each point's `letter`, which `route` sets;
  never recount along `walk`, since a dropped letter shifts every name after it.
- `LIT_EDGE` is in pixels, since the lit band can be under a pixel tall and it
  marks which band rather than how much. The join is round, since the reverse
  leg doubles back.
- The element draws the scrub's thumb itself, since a mark must sit on the
  thumb's travel: `--_thumb` places both.
- The canvas is a `role="img"` with the run's figures, and `.ledger` is a
  visually hidden list of what each letter still owes (`owing`), written with
  the readout so the two are of one step. The scrub carries `aria-valuetext`.
- The keys and a run's end are announced; the scrub is not, since its value text
  is read and a live region would say each step twice, and nothing is while it
  plays. `#halt(say)` is that rule: a stop on the way to a key's own step, a
  scrub or a sleep says nothing.
- Under `prefers-reduced-motion` a run steps at `STEP_CALM`, 500 ms whatever the
  category. A step is drawn whole with no tween to drop, so the pace is the
  motion. The readout and `--_edge` follow `<letter-disc>`'s rules.

## The longest chain

- `web/word-longest.js` is the one solver. A Python copy fed `weft stats`
  until October 2026 and was removed, since only `web-dist` ships; do not
  bring one back without asking.
- `tools/chains.json` pins it: 25 frozen cases, each with the chain it must
  produce word for word, its bound and whether it certified, plus an optional
  `opening` and `like`. `check_web.mjs` runs them, and a drifted case prints
  the whole chain it now makes, which is also how a new case gets its chain.
  The word lists are a snapshot; do not regenerate them on a corpus change.
- A frozen case records what the solver answered, so it cannot catch a short
  chain. The file's `oracle` can: it draws small lists from one seed and a
  31-bit generator and holds each chain to exhaustive search. It was added
  after the solver had been short on fabric and 237 openings unseen. Keep the
  loop bias, since a loop is what the flow strands. It runs `search` alone as
  well, from a best of zero, and checks its walk plays every word it reports:
  behind the heuristic the search runs too rarely for a missing branch to show.
- The heuristic (the scan, the join, the retry rounds) is not exact, so a chain
  under the bound goes to `search`, a branch and bound over `relax` that is.
  Never return a heuristic chain under the bound unsearched, and do not patch
  the heuristic to stop a miss: it is only the first chain the search must
  beat, and speed is all it buys.
- The model is in docs/notes.md: a min-cost transshipment on 26 letters, one
  arc per letter pair, Dijkstra pricing every opening and ending, union-find
  certifying the answer, and the search proving the rest.
- A loop never enters the flow, so the flow can strand one on a letter it cut
  off for free. `join` forces crossing words back, priced as residual cycles
  off the candidate's own optimal flow. Do not go back to a fresh flow solve
  per word tried: it took language's constrained solve from 0.5 ms to 18 ms.
  Joins run only after the scan found nothing whole, and a join that loses a
  word is a fragment, never a certificate.
- The candidate scan's early break decides which component the next round runs
  on, so removing it changes which chain comes out and how often the search
  runs. Candidates sort on the whole tuple, so their order never rests on the
  order they were priced in.
- A forced opening word is spent, solved from the letter it ends on and put
  back on the front, so the bound covers the whole chain. Candidates opening
  elsewhere are dropped except the closed circuit, which rotates onto any letter
  it touches (the `touched` guard). An opening not in the words is refused.
- `<word-disc>` prints the count without its certificate, since a missing
  certificate is only a loose bound: the search has proved the chain longest.
- `buckets` keeps word text as it came in, so "polar bear" keeps its spelling.

## Build and distribution

- The Makefile's `all` renders one SVG per category and takes its parallelism
  from make's own `-j`, never from a `MAKEFLAGS` line. Its target list comes
  from `weft categories` at parse time, so every invocation pays for that,
  `make clean` included. `CONFIG=` is both the argument and the prerequisite.
- The three tree exports are one grouped target (`&:`) and the 38 word files
  another, so the corpus loads once per group rather than once per file.
- The word table is its own target, `make table`. Its recipe runs
  `check_words.mjs` and deletes the table if the check fails, so the next make
  rewrites it rather than taking it as current. It is a prerequisite of `serve`
  and ships in `web-dist`.
- `make web-dist` stages every `web/*.js` by glob, `web/embed.html`, the three
  exports, the 38 word files and the word table flat, so a consuming site copies
  the directory instead of keeping a filename list in step. `web/.` is a
  prerequisite, since a directory's timestamp is all that catches a deleted
  module. `tools/export_preload.mjs` adds `preload.json`, each element's module
  mapped to every module it reaches, for a host that appends its scripts late
  and so cannot rely on the preload scanner.
- `embed.html` is the one page that ships: a `<section>` per element, each with
  its own script, data attributes, height and custom properties, so any one
  lifts out alone. It asks for data beside itself, which is why
  `tools/serve.py` falls back to `out/` for a top-level name not in `web/`. Its
  one category `<select>` writes `src` to whatever elements it finds, requiring
  none. Each section preloads every module its scripts reach (`modulepreload`),
  in the section so it lifts out with it; `check_web.mjs` holds each list to the
  import graph, workers excluded.
- `tools/serve.py` gzips textual types, since a deployed copy is served
  compressed, and does its own `If-Modified-Since`, `send_head` having no way to
  the 304 without the uncompressed body. It swallows `BrokenPipeError` and
  `ConnectionResetError`, since a reload abandons sockets.
- `tools/export_words.py` writes each category whole, in `render.py`'s order and
  reading `[selection]`, so a host changing `limit` refetches nothing.

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

`FALL` in `word-bundle.js` and `balance-bank.js`, `ALPHA_FALL` in
`letter-graph.js` and `TURN_PT` in `balance-flow.js` are guesses, since there is
no browser here to look in. `make serve` is where to find out.

`<balance-flow>`'s column labels drop any slot shorter than the type, so a
small box names only some letters.

## Checks

`make check` must pass before a commit: `ruff check`, `ruff format --check` and
`mypy` over `src/` and `tools/`, then `taplo check`, `tools/check_schema.py`,
`biome lint`, `biome format`, `make web` and
`make types`. mypy is strict, with `mypy_path = src` because `tools/` is not
part of the package; nltk, wordfreq, pyvis and networkx are declared untyped in
`mypy.ini`, and values crossing them are annotated by hand.

Biome needs no `node_modules`. The recipe names `web/ tools/` rather than `.`,
because config discovery runs before file filtering and Biome walks into any git
worktree under `.claude/worktrees/`, finds the copy of `biome.jsonc` there, and
refuses to run at all. `biome format` reports without writing; `--write`
writes.

`make web` is `node tools/check_web.mjs`. `node --check` skips the early-error
pass, so a `this.#gone` left by a refactor, a field initialiser naming a moved
constant, or a backtick in a comment inside a template literal leaves an
element undefined and the page blank only once a browser evaluates it. So the
check imports every module against a stubbed DOM and drives every element. It
asserts properties rather than exact counts, which move with the geometry, and
every assertion was mutation-tested. `check_web.mjs` itself is the record of
what is asserted. Its blind spots: the stub carries no CSS, one markup fragment
serves every template, the main-thread fallback is synchronous so a stale
bundle arrival is not covered, and a speed path answering what the general path
would, such as the solver's dead-end short cut, cannot be told apart from it.
Layout has to be looked at in a browser, which is what `make serve` is for.

`make types` is `tsc --noEmit` over the JSDoc in `web/`; nothing is compiled.
`tsconfig.json` includes `web/*.js` and excludes what is not ready, so a new
module is checked by existing. Excluded: `hypernym-disc.js`, `word-disc.js` and
`letter-disc.js`, mostly nullable DOM lookups, and the two workers, which want
`lib.webworker` where everything else wants `lib.dom`. `word-run.js` and
`balance-flow.js` are clean and stay in. `strictPropertyInitialization` is off,
since `Painter`'s typed arrays are filled by `layout()` and every read is
guarded by `#n`.

Pylance reads `pyrightconfig.json`, and the tree is clean under it; the pyright
CLI is not in the flake.

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
    docs/notes.md                  the algorithms, the reasoning, the figures

    web/hypernym-disc.js           the nested-arc element
    web/disc-layout.js             its tree's angles and rings, no DOM
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
    web/disc-colour.js             TAU, hsv(Bytes) and the chord cubic, all discs
    web/disc-label.js              the hub's text: fit, band, baseline, halo
    web/disc-index.js              where a category's words sit beside the index
    web/disc-ratio.js              the backing-store ratio and its budget, no DOM
    web/disc-idle.js               whether a disc is near enough to be worth pixels
    web/disc-lines.js              a text file's lines, kept as text and offsets
    web/disc-picker.js             the category picker the word elements share
    web/word-source.js             any synset's words, off the table, no DOM
    web/embed.html                 a section per disc, the one page web-dist ships
    tools/export_tree.py           writes the tree, its names and its glosses
    tools/export_words.py          writes a file per category and the index
    tools/export_table.py          writes the table any synset's words come from
    tools/export_preload.mjs       writes each element's import closure
    tools/serve.py                 serves web/ and reloads it on save
    tools/check_web.mjs            loads and drives web/ as a browser does
    tools/check_words.mjs          holds the table to the 37 category files
    tools/chains.json              the 25 frozen cases and the oracle's draw

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other. A figure takes a `Theme` argument rather than reading a global, and every
colour in `render.py` and `web.py` comes off that object. Ruff for Python, Biome
for JavaScript, `nix fmt` for the flake. Comments explain why a choice was
forced, not what a line does — and they are the only home for that reasoning, so
keep them short and keep them at the site.
