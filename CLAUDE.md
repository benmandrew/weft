# weft

WordNet as circular diagrams: the hypernym taxonomy, the word chain game on a
category, and the 26-letter graph under it. See @README.md for usage.

`graph.py` holds the structural claim the whole project rests on: a word is an
edge from its first letter to its last, so the game lives on 26 nodes and the
word graph is the line graph of that one. Keep analysis there rather than in
`render.py` or `cli.py`.

This file holds rules and the reasons that forced them. The algorithms, the
longer reasoning and the measured figures are in docs/notes.md, which does not
load each session; read it before changing the chain solver, `<balance-flow>`
or a `<word-disc>` speed path, or when a figure is wanted.

## Setup

`direnv allow`, or `nix develop` by hand. Python comes from nixpkgs — no venv,
no pip, no uv. Add a dependency to the `pythonEnv` list in `flake.nix`. `src/`
is on `PYTHONPATH` via the shellHook, so `python -m weft` runs from the
project root with no install step.

Anything the shell needs at load time goes in `shellHook`, which `.envrc` runs
with `eval "$shellHook"`: nix-direnv caches `nix print-dev-env`, which defines
that variable without executing it. Keep the hook idempotent, since direnv
re-runs it on every load.

## Corpus and cache

- WordNet 3.0 is `pkgs.wordnet`, symlinked into `.nltk_data/corpora/wordnet` by
  the shellHook. Never call `nltk.download()`; nothing may be fetched at
  runtime. Reach the corpus through `NLTK_DATA`, never a `WordNetCorpusReader`
  built on the store path, which falls back to the global corpus for sense keys.
- Keep `lexicon._wordnet`'s `map_wn` override: nltk's multilingual sense-key
  mapping is two thirds of the corpus load and unused here.
- Import nltk, wordfreq, networkx, matplotlib, tomllib and difflib at the point
  of use, never at module load. A cache hit must not import the first three,
  and `stats`, `words` and `categories` must not import matplotlib.
- `.cache/weft` keys word lists on the category, the filter arguments and the
  corpus store path. Bump `lexicon._CACHE_FORMAT` when the stored shape changes.
- `lexicon.EXTRA_WORDS` tops a category up by hand. An entry
  bypasses every filter, joins after the sliding cut (so never counts towards
  `--target`) and carries its real Zipf. `_check_extras` refuses an unknown
  category or an unplayable word at import; `--multiword` still governs it.

## Configuration

- Geometry lives on `config.Geometry`, the word filters on `config.Selection`,
  and the letter colours on a `palette.Wheel` carried by the `Theme`. A figure
  takes each as an argument, never as a module constant. `theme` is a bare key
  rather than a fourth table, and `--theme` overrides it.
- All four commands read `[selection]`, so `--config` sits on all four. The
  file is read once in `main()`.
- `cli._selection_args` builds one flag per `Selection` field, from
  `config._SELECTION_BOUNDS` and `cli._SELECTION_HELP`; `cli._DRAWN` names the
  one setting only `build` offers. Precedence is flag, then file, then default,
  so every selection flag defaults to None and `--multiword` is
  `BooleanOptionalAction`. That rule lives in `cli._selection` alone.
- Every caller turns a `Selection` into `lexicon.members` arguments through
  `config.as_members`. `members` keeps its explicit signature as its API.
- Unknown keys and out-of-range values are refused, never ignored, since an
  ignored key silently redraws the same figure. Every numeric setting may reach
  its own minimum: `min_zipf` 0 is the whole vocabulary and `limit` 0 is no
  limit, which `render.words_disc` spells out rather than slicing. In
  `[palette]` a preset name and an arc's numbers are mutually exclusive.
- `schemas/weft.schema.json` mirrors `config.py` and `palette.py` by hand and
  owns the per-key descriptions. `tools/check_schema.py` holds it to
  `_SELECTION_BOUNDS`, `members`'s defaults to `Selection`'s (through
  `_MEMBERS_RENAME` and `_MEMBERS_SKIP`), and `_SELECTION_HELP` to `Selection`.

## Rendering

- Wedge order is `render._fan_key`: the tail letter, rotated to start just
  before the wedge's own letter, running backwards. Plain tail-letter order
  makes the bundle cross itself. `web.py` and `word-layout.js` sort the same
  way, so a change is a change on all three; `check_web.mjs` holds the
  JavaScript to the Python.
- Edges are `Path` cubics, never sampled polylines.
- `render._hoist_shared_attributes` moves `style` and `clip-path` off paths
  onto their group, a third of the file. Verify a change to it by rasterising
  before and after and comparing pixels.
- `build` renders one view, the word disc. The other views in `render.py` and
  the pages in `web.py` are library-only; do not wire them into the command
  line without asking. Keep `svg.fonttype = "path"`, since named fonts
  substitute silently on a machine without them.
- The label size is solved: `_wanted_inches` gives the width at which labels
  clear, `_canvas_inches` holds it between 9.6 and 30 inches, and `_fitted_pt`
  shrinks `label_pt` by what the cap denied, returning `label_pt` itself below
  the cap. `_disc_limit` reads the fitted geometry.
- Generated pages stay self-contained: no external hosts. `web._CDN_TAG` strips
  the Bootstrap links pyvis emits regardless of `cdn_resources="in_line"`.
- `out/` is generated and gitignored; nothing reads from it.

## The discs

- Put new logic in the DOM-free modules (`word-layout.js`, `word-bundle.js`,
  `letter-graph.js`, `balance-bank.js`, the `disc-*.js` helpers), where
  `check_web.mjs` can assert on it, rather than in an element.
- Canvas size goes through `disc-ratio.js`'s `ratio`, which caps the area at
  `MAX_AREA`, never the ratio, since browser zoom multiplies devicePixelRatio.
- `disc-idle.js`'s `watch` empties the canvases of a disc more than a screen
  away after `HOLD`, and a wake cancels the hold, so a fast scroll does not
  refill every disc it crosses. It returns a handle rather than the observer,
  so a held sleep cannot outlive a disconnect.
- The resize observer watches the frame as well as the stage, since a stacked
  stage's box does not move when the frame widens.
- `fit` fills the box the host gives. Blocks under a disc are fixed height and
  scroll inside, so text never resizes the disc under the pointer.
  `scrollable` gives an overflowing box a tab stop, `role=region` and a name;
  it reads layout, so it runs a frame after a committed action, a key or a
  resize, never on a pointer move.
- Refit text when `document.fonts.ready` settles, since canvas text is measured.
- The halo is copies of one `fillText`, never a `strokeText`. Hub baselines
  centre on `HUB_REF` ("Hd"), since per-word ink metrics make the name jump.
- Hit testing is a binary search over angles; there is no spatial index.
- Accessibility targets WCAG 2.2 AA in every element:
  - The host is `role=group` with an `aria-label` unless the page set one, and
    the stage is `role=img` with a short text alternative.
  - One visually hidden `.announce` live region per element. Only a committed
    action writes to it, never a hover. `#tell` clears it and writes the text
    a frame later, since a region is read only when its text changes.
  - A column of rows is a `role=listbox` with one tab stop and
    `aria-activedescendant`; `disc-search.js`'s `step` moves without wrapping,
    and Enter or Space acts as a click.
  - A hover readout ends on the host's `pointerleave`, not the canvas's, so the
    pointer can cross to the readout (1.4.13). Escape reverts it.
  - `--_edge` is 85% muted (80% is the floor for 3:1 on ground and panel in
    both palettes); `--disc-edge` overrides it. The selected-row tint is 10%
    accent, so text on it keeps 4.5:1, and a 2px inset bar marks the row.
  - Rows are at least 24px tall. The crumb's shorter buttons rely on the
    spacing exception of 2.5.8, and the crumb scrolls rather than wraps.
  - The canvas is `touch-action: pan-y` (`<letter-disc>` adds `pinch-zoom`),
    so a page scrolls across it.

### `<hypernym-disc>`

- It reads the tree as `par`, where every parent's index is below all of its
  children's. That ordering is the whole contract: layout runs as flat loops.
  `export_tree.py` writes preorder, which also keeps every subtree contiguous.
- The three exports are index-aligned: names and glosses are positional, with
  no key to catch a mismatch.
- `disc-search.js` bands sit 1,000 apart and every penalty is capped below
  1,000, so a weaker match never outranks a stronger one.
- The hub name, the gloss and the crumb tail all come off `#focus`.
- The `rings` cap is in the prepare key, since it changes which runs merge.
- Do not terminate the paint worker on disconnect: it holds the only handle to
  the base canvas, which transfers once. The main-thread fallback calls the
  same `disc-paint.js` class.
- `layoutTree` (`disc-layout.js`) and `tints`, `merge`, `ramp` and `rampStep`
  (`disc-paint.js`) are public: a static SVG banner outside this repo imports
  them from `web-dist`. Keep their signatures, or change the caller with them.
- Never batch the draw into one path per colour, which is eight times slower:
  each colour's path scatters across the disc. A merged piece takes the
  circular mean of its members' hues, rounded to a one-pixel slice.

### `<word-disc>`

- A word's successors are a whole wedge, never a list stored per word.
  `word-layout.js` is `render.words_disc`'s layout written a second time.
- `Chain.legal` is the whole of the rule: the disc, the readout and the cursor
  all follow it.
- The readout's figures are cached in `#reachOf`, cleared in `#after()` on a
  chain change and in `#build()` with `#bestRun` when the word set moves.
  `hint="off"` is read in JavaScript, since it saves a solve.
- The hub is one radius for what a click undoes and what a name must fit.
- Its sleep keeps the resting bundle and frees only the canvases, since the
  bundle takes the worker far longer to rebuild than a fast scroll takes to
  arrive. A change of words while asleep still releases it.
- The resting bundle is a stroke per merged chord, since alpha must
  accumulate, in its own square capped at `MAX_PX` (derived from `MAX_AREA`).
  It draws in `BANDS` of alternating direction with no shuffle and no seed, so
  builds composite identically.
- `points` merges words into `BINS` angle bins: a stroke joins two bins at the
  alpha its `weight` in chords would stack to. A letter's words ending in one
  letter are one contiguous run, so the merge is exact to a bin. It bounds the
  strokes whatever the word count, so there is no chord cap. `weight`
  subtracts the self-pairs.
- `word-bundle-worker.js` owns nothing between messages, so it is terminated
  on disconnect. `#armFloor` starts the `WORKER_FLOOR` deadline at the first
  bundle wanted, since timing it from construction reads a slow link as no
  worker.
- The worker draws through `bands`, snapshotting the canvas with
  `createImageBitmap` after each band and waiting before the next, so each
  band reaches the GPU process on its own. Do not swap in `getImageData` or
  `willReadFrequently`. The wait is a `MessageChannel` task and then `GAP`
  (2 ms): `setTimeout(0)` nests and clamps to 4 ms, and no wait at all floods
  the browser's frame thread. A build a newer message overtakes stops and
  answers nothing.
- `release(pic)` closes an `ImageBitmap`, whose pixels sit outside the heap:
  call it when a bundle is replaced, lands after the disc moved on, or on a
  word-set change. The bundle held over `disconnectedCallback` is kept for
  reattachment.
- `#measure()` sums each word's character advances and calls `measureText`
  only on words within `SLACK` of the widest estimate. Measuring every word
  fills Blink's shaped-text cache. `SLACK` must stay above the kerning spread,
  about 7.5% in Libertinus Serif.
- `#draw` puts the opaque dots into one `Path2D` per colour, walked in ring
  order, skipping a dot within a third of a pixel of the last. The dimmed dots
  of a game in play keep a fill each, since they must darken each other.
- Every sort by spelling compares integer places from `spelling()`, never
  strings: `rankOrder`'s tie-break, and `layout` and `#alpha` through the
  counting sort `alphabetical`. `WordTable` sorts once and hands each derived
  set its places as `spell`. Do not ship the places in `wordnet-words.json`;
  they do not compress.
- `#build` draws the disc and leaves the moves column and the longest-chain
  sentence to `#later`, after the next frame. `#settled` is clear meanwhile:
  `#showRead` leaves the sentence out and `#shape` leaves the column alone.
  The build clears the old column and `#mark` at once, since a row clicked
  before `#later` would play whatever word took its index.

### `<letter-disc>`

- It counts the letter matrix out of `words-<category>.json`, the file
  `<word-disc>` reads.
- Nothing is bundled: every arc is clickable and carries a count.
- The width is `log1p` of the word count, with no floor under a quiet letter:
  `check_web.mjs` asserts one unit of weight is the same degrees everywhere.
- The pull varies with the turn, since a fixed long-chord pull turns short arcs
  and loops into spikes.
- `letter-graph.js`'s `near` is a prune, so it must never refuse a point on the
  arc. `#preview` never touches `#letter`.
- The letter and arc selects are the keyboard's way to everything the pointer
  reads. They and a touch tap go through `#pin`, which holds the arc in
  `#held`. The hub, the readout and the lit arcs all read `#shown()` (hover,
  then held arc, then letter), so the three cannot differ. A pick is
  announced; a hover never is. A mouse click does nothing.

### Derived categories

- `tools/export_table.py` writes `out/wordnet-words.json`, one table from which
  `web/word-source.js` derives the words below any synset, since a file per
  node would be 12,224 files.
- Every filter in `lexicon._resolve` and `_in_category` is a fact about one
  (word, synset) pair or a sum over a category's pairs, which is what makes
  the table possible. A new or changed filter in `lexicon.py` is therefore a
  change to `export_table.py` and `word-source.js` too. `tools/check_words.mjs`
  holds the derivation to all 37 category files, word for word.
- `max_rank` and `multiword` are fixed at export, since they decide which pairs
  ship; the other settings travel in the table's `selection`.
- Word ids run in rank order (−Zipf, then spelling), so a result sorted by id
  needs no Zipf sort.
- The table is positional against `wordnet-tree.json` and carries an FNV-1a
  fingerprint of `par`; `WordTable` refuses a mismatch. `fingerprint()` in
  `export_table.py` and `word-source.js` must agree.
- The tree keeps only first hypernyms, so the rest ship as `extra` edges and
  `ids()` closes over them. "First" is by name, since nltk returns them in
  hash-seed order. `min_depth` counts those edges too, as `lexicon._closure`
  does.
- A hand-added word belongs to a category's name, not to a node, so the table
  carries `EXTRA_WORDS` only on its `categories` entries as `extra`. A derived
  list omits them, and `check_words.mjs` leaves them out of the comparison.
- `web/disc-picker.js`'s `Picker` is the one picker the word elements share,
  talking to its element through the `PickerHost` callbacks. `tree` resolves
  through `getRootNode()`. The picker adds a visible `.pick-label` and its
  default rule is wrapped in `:where`, so an element's own rule wins.
- `table()` fetches once per `src` and decodes once per tree per page; a failed
  fetch is not kept. The table is fetched at the disc's first move or the
  option's first choice, not on load.
- `#applying` is how `mark()` tells the picker's words from a host's, so any
  `src` or `data` from the host ends following.
- A node with no words below it is disabled, and following onto one leaves the
  element on what it had.
- `#soon()` hands a followed node's words over a frame and a task later, never
  inside the `disc-zoom` or `change` handler, so the disc paints first; moves
  made while it waits coalesce. A hidden page waits for a task alone.
- `group` is read when the reader chooses, never observed. `LIVE` holds the
  connected pickers; a choice runs `#choose` here and `#take` in the rest, so
  it crosses once. A `src` or `data` from the host never crosses.
- A host naming `tree` and no `src` opens following the disc. `#follow` waits
  while the disc's names are missing, and `#onNames` retries. If the table
  fails, it opens `#first`, the index's first category.

## `<word-run>`

- `for` resolves through `getRootNode()`. It fetches nothing, and
  `disconnectedCallback` removes its listeners.
- Keep `.run>*{flex:0 0 auto}`: a flex item shrinks below its content before
  its parent scrolls, so words overrun the chevrons at narrow widths.

## `<balance-flow>`

Of the disc rules, `ratio`, the sleep, `fit`, the fonts refit and
`disc-colour.js` hold; hit testing, the hub and watching the frame do not.

- `trace(words)` reads the augmenting paths off `balanced()` rather than
  solving again. A step is signed `cell + 1` for a discard and `-(cell + 1)`
  for a recovery, since cell 0 has no sign.
- A solve while asleep still fires `balance-render`, with `drawMs` 0.
- One scale across both columns, and bands tile their slot in solver order.
  The deficit column is muted, since a band takes the hue of the letter it
  leaves.
- Only the lit band is routed through the letters it walked; a reverse leg
  running right to left is the only mark a reversal gets. A letter that banks
  nowhere is dropped. Read the turn glyphs' letters off each point's `letter`,
  never by recounting along `walk`.
- `LIT_EDGE` is in pixels, since the lit band can be under a pixel tall.
- The element draws the scrub's thumb, since a mark must sit on its travel.
- The canvas is a `role="img"` with the run's figures, and `.ledger` is a
  visually hidden list of what each letter still owes (`owing`), written with
  the readout so the two show one step.
- The keys and a run's end are announced; the scrub is not, since its value
  text is read already. `#halt(say)` is that rule.
- Under `prefers-reduced-motion` a run steps at `STEP_CALM`, 500 ms.

## The longest chain

- `web/word-longest.js` is the one solver. Do not bring back a Python copy
  without asking.
- `tools/chains.json` pins it: 25 frozen cases, each with the chain it must
  produce word for word, its bound and whether it certified. A drifted case
  prints the whole chain it now makes, which is how a new case gets its chain.
  The word lists are a snapshot; do not regenerate them on a corpus change.
- The file's `oracle` holds the solver to exhaustive search on small drawn
  lists, through the heuristic and through `search` alone. Keep the loop bias,
  since a loop is what the flow strands.
- The heuristic (scan, join, retry rounds) is not exact, so a chain under the
  bound goes to `search`, a branch and bound over `relax` that is. Never return
  a heuristic chain under the bound unsearched, and do not patch the heuristic
  to stop a miss.
- `join` prices forced crossing words as residual cycles off the candidate's
  own flow. Do not go back to a fresh flow solve per word. A join that loses a
  word is a fragment, never a certificate.
- The candidate scan's early break decides which component the next round runs
  on; removing it changes the chains. Candidates sort on the whole tuple.
- A forced opening word is spent, solved from the letter it ends on and put
  back on the front. Only the closed circuit survives from candidates opening
  elsewhere (the `touched` guard). An opening not in the words is refused.
- `<word-disc>` prints the count without its certificate, since the search has
  proved the chain longest either way.
- `buckets` keeps word text as it came in, so "polar bear" keeps its spelling.

## Build and distribution

- The Makefile's `all` takes its parallelism from make's own `-j`, never from
  a `MAKEFLAGS` line. Its target list comes from `weft categories` at parse
  time. `CONFIG=` is both the argument and the prerequisite.
- The three tree exports are one grouped target (`&:`) and the 38 word files
  another, so the corpus loads once per group.
- `make table` runs `check_words.mjs` and deletes the table if the check fails,
  so the next make rewrites it.
- `make web-dist` stages every `web/*.js` by glob, `embed.html` and all the data
  flat. `web/.` is a prerequisite, since a directory's timestamp is what
  catches a deleted module. `tools/export_preload.mjs` writes `preload.json`.
- `embed.html` is the one page that ships, a `<section>` per element that lifts
  out alone with its own `modulepreload` list; `check_web.mjs` holds each list
  to the import graph. It asks for data beside itself, which is why
  `tools/serve.py` falls back to `out/` for a top-level name not in `web/`.
- `tools/serve.py` gzips textual types, does its own `If-Modified-Since`, and
  swallows `BrokenPipeError` and `ConnectionResetError`.
- `tools/export_words.py` writes each category whole, so a host changing
  `limit` refetches nothing.

## Known limits

A Zipf of exactly zero is dropped unconditionally in `_resolve`, as the line
between WordNet's vocabulary and its taxonomy. Keep it independent of
`--min-zipf`, which defaults to 0.0: the list is ordered by frequency and
`build` draws the commonest 110, so the order does the work. The sliding cut
is inert at the defaults and stops a raised `--min-zipf` gutting the rare
categories.

WordNet is a lexical database, not a game word list, so residue survives the
filters ("entire" and "royal" are genuine WordNet animal terms). Tighten via
`--min-dominance` / `--max-rank`, not a stop-list.

`FALL` in `word-bundle.js` and `balance-bank.js`, `ALPHA_FALL` in
`letter-graph.js` and `TURN_PT` in `balance-flow.js` are guesses, since there is
no browser here to look in. `make serve` is where to find out.

`<balance-flow>`'s column labels drop any slot shorter than the type, so a
small box names only some letters.

## Checks

`make check` must pass before a commit: `ruff check`, `ruff format --check` and
`mypy` over `src/` and `tools/`, then `taplo check`, `tools/check_schema.py`,
`biome lint`, `biome format`, `make web` and `make types`. mypy is strict, with
`mypy_path = src`; nltk, wordfreq, pyvis and networkx are declared untyped in
`mypy.ini`.

The Biome recipe names `web/ tools/` rather than `.`, because Biome would walk
into a git worktree under `.claude/worktrees/`, find its `biome.jsonc` and
refuse to run. `biome format` reports without writing; `--write` writes.

`make web` is `node tools/check_web.mjs`, which imports every module against a
stubbed DOM and drives every element, since `node --check` misses the early
errors (a stale `this.#field`, a backtick in a template-literal comment) that
blank a page. It asserts properties rather than exact counts, and is the record
of what is asserted. It cannot see CSS, layout, or a stale bundle arrival (the
main-thread fallback is synchronous), and cannot tell a speed path from the
general path when both answer alike. Look at layout with `make serve`.

`make types` is `tsc --noEmit` over the JSDoc in `web/`. `tsconfig.json`
includes `web/*.js` and excludes `hypernym-disc.js`, `word-disc.js`,
`letter-disc.js` (nullable DOM lookups) and the two workers (they want
`lib.webworker`), so a new module is checked by existing.
`strictPropertyInitialization` is off, since `Painter`'s typed arrays are
filled by `layout()` and every read is guarded by `#n`.

Pylance reads `pyrightconfig.json`; the pyright CLI is not in the flake.

## Shape

    src/weft/
      lexicon.py   WordNet closure, the polysemy filters, the Word type
      graph.py     letter matrix, letter graph, word graph, trap analysis
      render.py    matplotlib figures
      web.py       pyvis pages
      palette.py   Theme tokens, the letter wheel, the font stacks
      config.py    Geometry, Selection, the TOML file and its validation
      cli.py       argparse entry point, the text report

    web/                     one element per *-disc.js, word-run.js and
                             balance-flow.js; DOM-free helpers beside them;
                             a harness .html per element and embed.html
    tools/export_*.py        the tree, the category files, the word table
    tools/export_preload.mjs each element's import closure
    tools/serve.py           serves web/ and reloads it on save
    tools/check_*.{mjs,py}   the browser modules, the table, the schema
    tools/chains.json        the solver's frozen cases and oracle
    docs/notes.md            the algorithms, the reasoning, the figures

## Style

Both themes in `palette.py` are complete palettes, never an inversion of each
other, and every colour in `render.py` and `web.py` comes off a `Theme`
argument. Ruff for Python, Biome for JavaScript, `nix fmt` for the flake.
Comments explain why a choice was forced, not what a line does; keep them short
and at the site, and put figures in docs/notes.md.
