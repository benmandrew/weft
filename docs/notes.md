# Notes

The figures in this file are measurements taken at the time of writing, and nothing checks them.

These notes hold the reasoning and the measurements behind weft's design. `CLAUDE.md` holds the rules they produced, and `README.md` holds usage.

## Why letters

A word runs from its first letter to its last, so every word is an edge between two of 26 letters and the whole game lives on a 26-node graph however large the vocabulary grows. The word-level graph is the *line graph* of that small one: its nodes are the letter graph's edges, joined wherever one word's last letter is another's first.

A *spring layout* cannot draw the word graph. Every word ending in A links to every word starting with A, and that edge density defeats any force model, so the word view uses fixed positions and groups words into wedges by first letter. On animal the word graph has 1,582 nodes and 96,470 edges. `<word-disc>` stores a word's successors as its wedge for the same reason, 26 arrays standing in for 96,470 edges.

## The longest chain

A round ends when the current word's last letter starts nothing still unplayed, so the question a category invites is how far perfect play runs with no word repeated. With words as vertices that is the longest path through a graph of 1,582 nodes and 96,470 edges, for which no efficient exact algorithm is known. With letters as vertices it turns small. A chain is a *trail*, an arc-disjoint walk on 26 vertices, and keeping as many words as possible is discarding as few as possible.

Discarding as few as possible is a *min-cost transshipment* on those 26 nodes. The supply at each letter is its outgoing words minus its incoming ones, the capacities are the word counts, and each dropped word costs one. Every cost is non-negative and the constraint matrix is *totally unimodular*, so the answer comes back whole-numbered with no integer solver anywhere. Words sharing a letter pair are interchangeable and aggregate into one arc of capacity n rather than n arcs of capacity one.

A chain has an opening and an ending, and moving one unit of supply at each end is all that separates it from a closed circuit. Its cost is therefore the balanced answer plus the shortest residual path from the ending letter back to the opening one. 26 runs of Dijkstra's algorithm price all 676 opening and ending pairs off a single balanced solve, and a 677th candidate stands for the circuit that opens and ends on one letter.

The relaxation ignores whether the arcs it keeps form one connected run, so it returns an upper bound. A *union-find* pass settles that. Where the kept arcs are connected the bound is attained and the chain is provably the longest. Where they are not, the solver first tries to *join* the stranded letters back on, then keeps the largest component, solves the rest again at full capacity, and reports the gap. The circuit, which can open anywhere, opens on its largest component; it once opened on the lowest letter, which kept a lone loop on *a* over a circuit through *b* and *c*.

The join exists because a *loop*, a word that opens and ends on one letter, never enters the flow. It cannot unbalance a letter, so the flow keeps every loop whatever else it discards, and it can strand one on a letter it has cut off at no cost to itself. fabric showed it. The flow kept *aba* and *alpaca* on an *a* that no other kept word reached, and the retry ran on the letters reached, so *a* was gone for good and the answer was 61. Forcing *organza* back into *a* makes *acetate* the way out, which costs one more discard and joins both loops, for 62.

The join forces discarded words that cross between the kept component and a stranded letter, one at a time, keeping whichever grows the component most. Each candidate's flow is optimal, so holding one more word of a pair costs exactly the cheapest residual cycle through that word's recovery, and one Dijkstra run per opening letter prices every such word. A cycle that costs as many words as the stranded letters hold cannot help and is never walked. A fresh flow solve per word tried was the first version, and took a constrained solve on language from 0.5 ms to 18 ms in the browser, for a loop on *m* it could never afford to join. Joins run only after the scan has found no candidate whole, so a candidate whole as it stands ends the scan before any join is spent.

animal chains 640 of its 1,582 words, and 32 of the 37 categories certify. The five that do not are fabric at 62 against a bound of 63, furniture 9 against 10, instrument 10 against 11, mineral 18 against 19 and river 64 against 65. Exhaustive search over the letter multidigraph proves furniture's 9, instrument's 10 and mineral's 18 optimal. fabric's 62 is optimal by a split on *a*, the only letter its first round strands: chains never touching *a* reach 61, opening on it 59, ending on it 61, and passing through it 62, since *acetate* is its one way out. In those four the bound is loose by one and the chain is not short. river's 64 is unsettled.

Before the join, the solver stopped short on 237 openings across the 37 categories and on fabric unconstrained, and no frozen case could tell: each held what the solver answered when it was frozen. `tools/chains.json` now carries an `oracle` that both halves run under `make check`. It draws 2,000 lists of up to nine words from one seed, one word in four a loop, and holds each chain, free and under an opening word, to the longest an exhaustive search finds. Before the fixes it failed on 280 of those 4,000 chains.

The candidate scan stops once no remaining candidate can keep more words than the best fragment found. That break also decides which component the next round runs on, and a smaller fragment can free more words than a larger one: river chains 64 words with the break and 63 without. Candidates sort on the whole tuple of cost, opening letter and ending letter, since neither Python nor JavaScript promises an order for ties. No word list here depends on it, 37 categories and 3,000 random lists answering the same either way. It is there so the two halves never agree by luck.

### Constrained openings

A player stands on a word, with a letter already fixed, and wants to know how far play still runs. That is the whole-category question with one letter pinned. The solver spends the opening word, solves from the letter it ends on, and puts the word back on the front, so the count and the bound both cover the chain including that word.

Every candidate opening on another letter is dropped before the scan. The closed circuit is the one candidate a fixed letter cannot rule out, since a closed walk rotates to begin on any letter it touches. The bound is computed over the surviving candidates, so a chain forced through a poor opening still reports whether it is the longest that opening allows.

Certification is rarer under a constraint. Across 2,189 constrained solves over the 37 categories, 75% came back certified. A forced opening can strand play in a small component, where the relaxation's bound goes loose. furniture, whose best is 9 words, shows all three outcomes: *crib* still reaches 9, *bookcase* reaches 2 against a bound of 5 that nothing attains, and *bunk* reaches 1 and is certified, since no word in the category starts with K.

A missing certificate is a loose bound far more often than a short chain. Over every word of every category under 300 words, 69% certify. mineral is the worst, certifying on 1% of its openings, against tree and river at 3% and fabric at 8%. Exhaustive search settled all 60 sampled mineral openings, and the solver now has all 60 exactly right. The one it missed before the join, *sienna*, chained 13 against a true optimum of 14 and a bound of 15, its first round stranding loops on *h* and *r*. A readout showing the bound would read as far less certain than the solver is, which is why `<word-disc>` prints the count alone.

The five constrained fixture cases each hold something the free ones cannot. `circuit-opened` holds the rotation, `furniture-opened` an opening that costs nothing, `furniture-stranded` a dead end certified at one word, `furniture-boxed` the constrained bound going loose where the free one did not, and `bird-opened` an opening at scale, 116 words certified.

### Agreement and speed

The Python and JavaScript halves produce byte-identical chains on all 37 categories, Python in 8 ms on the largest and JavaScript in 0.8 ms. Constrained, they disagreed on none of the 2,189 solves and produced no illegal chain. The `oracle` in `tools/chains.json` holds both halves to exhaustive search on 4,000 drawn chains on every `make check`; an earlier one-off check of 2,314 constrained solves on random lists had found no miss. The short cut for an opening letter no word leaves runs in 0.05 ms against 0.56 ms on animal, where 11 of the 1,582 words end on a letter nothing starts with.

## The word disc

The readout prices perfect play beside the count of replies, since a letter with many replies can still be the shorter road. At rest it names the category's free run. On the word play stands on it names what perfect play still reaches, and on a legal move under the pointer what playing that move would leave. On animal, *crab* opens on the full 640-word chain, where *bear* after it leaves 637 and makes 639. A word the pointer has not visited costs about 0.9 ms to price and a repeat costs nothing: loading animal and printing five figures takes 24 ms in `check_web.mjs`, and furniture 2 ms. The figure for a word under the pointer is solved from the letter the word ends on, which answers for the word play stands on as well, since a played word is out of the reckoning either way.

The *fan*, the chords from one word to every word that may follow it, runs from one word to one wedge, so its chords bow to about the same depth and sweep a lens rather than the whole interior. On animal at a 300-pixel ring, *crab*'s 139 chords cross the 135-pixel middle in a band 26 degrees wide and come no nearer the centre than 116 pixels. The dead centre therefore holds no move and stays free for the step back.

Labels below 5.5 px are dropped and the hub names what the pointer is on instead. The element draws every word a category has unless the host sets `limit`, where `build` draws 110, because the SVG (Scalable Vector Graphics) figure can grow its canvas and shrink its type while the element has only the frame the page gives it.

The resting bundle is every chord the printed figure draws, dimmed to 0.22 once a chain is being played. At a typical disc size it is a 12.3 MB `ImageBitmap`, held outside the JavaScript heap where the collector sees a small object under no pressure, which is why it is closed by hand. `thin` exists because ink accumulates: at a fixed alpha, a category with eight times the chords floods the middle. The bundle's worker opens when the element connects, so its module fetch runs alongside the word file's rather than after it.

In the moves column, a pointer is over no row at every seam between rows, so a `pointermove` that lands on no row holds the hover rather than clearing it. The crumb line's root is the category, drawn as a label rather than a step since it is where the words came from.

## `<word-run>`

`<word-run>` names the chain the readout counts. On animal at rest it reads `640 words │ crab › boa › anaconda › alpaca › 632 more › zebra › avocet › teju › ungulate`, and three moves in, `636 more, 639 in all │ crab › bear › raven › nutria › 631 more › avocet › teju › utahraptor › racoon`. Played words take the accent colour and projected ones the ink colour, so the join between what happened and what could sits in the colour rather than in a label.

The count sits outside the chain behind a rule, since it must not read as a step. The elision takes a chevron on each side and no ellipsis, because the words it stands for are steps like any other and the chevrons already say so. Each word and chevron is its own flex item with the spare width shared between every pair; grouping the two ends into two items put all the spare width in one place and left both ends free to shrink. The type is 15 px at a line height of 1.7, larger than the crumb line's 11 px, since the crumb is a control strip and this is a line to read. It costs one solve per change of chain, about 0.9 ms on animal, and none on hover.

## The letter disc

animal is the worst case at 344 populated letter pairs, few enough that every arc stays an individual, clickable object. Its trunk carries 30 times the words of its 103 single-word arcs, and a `log1p` width takes that ratio to about 5:1. A letter's share of the ring is the sum of the log weights touching it, so an arc's width means the same number of words wherever it is read.

Each letter's arc is split into the half words leave from and the half they arrive at, leaving half first clockwise, so direction lives in the geometry rather than in an arrowhead; the target end tapers to 45% of its slot as a second signal. 31% of animal's arcs cover less than a third of the turn and 12 are loops, which is why the pull on a chord varies with its turn, from 0.82 at none to 0.14 at half the circle: at a long chord's pull every one of those short arcs is a spike pointing at the middle.

The canvas has nothing a keyboard can reach, so two selects under it do the pointer's work: a letter, then any arc touching it, each option naming the far letter, the direction and the count. A pick drills in, lights what it chose and is announced; a touch tap pins the same way, since on a phone the readout used to clear as the finger lifted. The old edge, muted at 38%, came to 2.0:1 on the dark ground and 1.7:1 on the light panel; at 85% it is 5.4 and 5.0 on the dark ground and panel, 3.6 and 3.9 on the light ones, and 4.8 and 4.6 on the site's `#141414` and `#191918`.

Hit testing runs in three bands. The ring answers with an arc by binary search over ends that tile it exactly, the band outside answers with a letter, and inside the ring each path is asked through `isPointInPath`, topmost first. `near` refuses three quarters of those before a path is built, since every point of a ribbon lies in the wedge its four turns span, found as the complement of the largest gap between them so an arc wrapping through the top still works.

## The hypernym disc

The tree holds 82,115 synsets and lays out in one frame, because the parent-before-child ordering turns depths, leaf counts and angles into flat loops. WordNet's hypernyms form a *directed acyclic graph* (DAG), so each synset keeps its first hypernym to make a tree. The three exports are `wordnet-tree.json` at 42 KB compressed with brotli, `wordnet-names.txt` at 311 KB and `wordnet-glosses.txt` at 1,329 KB, fetched in that order with first paint waiting on the tree alone.

Holding children as two typed arrays takes 657 KB against 4.8 MB for a list per node, and builds in 1.6 ms against 5.3 ms. Splitting the glosses into strings would cost 82,115 string headers and 3.13 MB, so they are held as the text and an `Int32Array` of line starts. Search scores every name in one pass rather than holding an index, since the weakest band is a subsequence match and no ordering prunes one; a bitmask of the characters each name holds prunes containment instead.

The draw path is measured. Interning colours per theme and root removed a fifth of the frame. The default density merge takes 82,115 arcs to about 8,500, and the density ramp encodes 1 to 64 wedges a pixel. Only 14 rings are drawn by default, since WordNet's outer rings are nearly empty and dividing the radius among every depth left a quarter of the frame blank. Batching the draw into one path per colour, 145 fills against 82,115, is eight times slower, because each colour's path scatters across the whole disc and the rasteriser covers its bounding box.

## Canvas memory

On a page carrying three discs, canvas pixels are 79–87% of what the page holds. `embed.html` stacks all three down one column where at most one is on screen, so a disc more than a screen away gives its pixels back. A sleep taken the moment a disc left that band emptied and refilled discs a fast scroll only passed through, three times over on `embed.html`, and showed as a stutter; holding the sleep for a second removed it. The hold costs only memory, since nothing draws while it runs. `<word-disc>` keeps its resting bundle through a sleep and gives back only its two canvases. The canvases redraw in 5 ms, but entity's bundle takes the worker 255 ms to rebuild, and a scroll at 8,000 px/s reaches the disc 116 ms after it wakes, so a dropped bundle showed the disc without its edges for 150 ms. Kept, the bundle is 9 MB on a 1440 by 900 screen at a ratio of 2, and 38 MB at most.

The canvas budget bounds area rather than the device pixel ratio because browser zoom multiplies that ratio, and a ratio cap drew the disc at half the resolution the screen was showing. The bundle's square is capped from the same area budget, since a lower cap blurs the bundle while the dots over it stay sharp.

## Watching it balance

`<balance-flow>` draws the transshipment above as it runs. Surplus letters bank down the left column at their excess and deficit letters down the right at theirs, and each *augmenting path* the solver walks becomes one band across the middle, as wide as the words that path discards. A forward arc discards one more word of its pair, and a reverse arc recovers a word an earlier path discarded, which lets a later path undo part of an earlier one for less than starting again.

The trace takes 0.46 ms on animal, against the plain chain solve's 0.64 ms. animal's 1,582 words leave 26 letters open and 778 words out of balance, cleared in 144 augmentations for 945 discarded; its largest single push is 32 words and its longest path 5 arcs. furniture's 79 words leave 16 letters open and 47 out of balance, cleared in 36 augmentations for 75 discarded. food takes the most augmentations, 156, and all 37 categories settle.

The run has a nine-second budget, so animal's steps run at 62 ms each and furniture's at the 160 ms ceiling. It opens at the balanced state, so a page nobody touches still shows the whole transport. A column can be cut into up to 26 slots, and with the gap set as a share of the span alone, the 25 gaps in animal's column took a sixth of its height. The thinning leaves animal's 144 bands at an alpha of 0.26 and furniture's 36 at the full 0.5.

A screen reader gets the picture as text: the stage names the run's figures, and a visually hidden list says what each letter still owes at the step shown, against what it opened with, and the path that step pushed, a forward arc discarding a word and a reverse one recovering it. The scrub's value reads as `step 37 of 144, A → E, cost 1`. The keys and the end of a run are announced, and nothing is while it plays, which at 62 ms a step would be sixteen announcements a second. Under reduced motion the run steps every 500 ms, so animal takes 72 seconds where it takes nine.

### Reverse arcs

204 of the 2,645 augmentations across the 37 categories carry a reverse step, 7.7%, and almost all carry exactly one: 208 reverse steps against 4,149 in all. insect, reptile and toy have none. The dominant shape is surplus → deficit ⇠ surplus → deficit, 148 of the 204. No path takes the running arc count outside the range from zero to its cost, so the clamp in `route` never fires on the corpus.

Only the lit band is routed through the letters its path walked, one point a letter, placed across the span by how many arcs the path has paid for by the time it gets there. A reverse step takes that count back down, so its leg runs right to left, against every other stroke in the picture. Direction is the only mark, because the reversing paths are the thin ones. animal's 13 reversing paths have a median push of 2 against 3 across all 144, about 0.96 px on a 426 px span, and anything drawn at weight would make 3.3% of the shipping the loudest thing in the picture. 57 of animal's 144 paths take more than one arc, and routing all of them would put three crossings in the middle where there is one. `route` costs 0.3 µs a draw. A letter the path passes through while owing nothing has no slot, and is dropped from the line rather than given an invented height: 4% of food's interior letters and none of animal's.

### Turn glyphs

A bend in the routed line says the path turned but not which letter it turned on, so each interior turn carries its letter as a glyph. It sits above the band's top edge at the turn's own x, always above, so the rule is read once rather than worked out at every bend. It is drawn in the band's own hue where the columns and headings are muted, so colour says which marks belong to the step the readout names, and over a halo in the ground colour, since the line crosses the bands already drawn. The type is 0.8 of the column labels' size, since a turn annotates one step where a column label names a bank for the whole run, and at one size the two read as a third column.

914 of the 2,645 augmentations walk at least one interior letter, 1,504 interior letters in all and at most 6 on one path: animal 81 over its 144, food 94 over 156, furniture 20 over 36. 87 of those 1,504 bank nowhere, none of them animal's, so on those paths the picture names one letter fewer than the readout's path line. Adjacent turns stand at least 59 px apart on the 355 px between the columns at a 682 px width, and 118 px on animal and food, so a single glyph never meets its neighbour. At the 15 px type a 682 by 520 box gives the column labels, only 15 of animal's 26 letters are named in the columns.

### The lit edge

The ink under the lit band comes to 0.26 on animal and 0.38 on furniture, so the fill at 0.95 is already three times its ground. The band's size is the difficulty. The element opens at the balanced step, and successive shortest paths leave the smallest pushes for last, so the band lit on arrival is the thinnest there is: 0.96 px on animal and 0.56 px on food against a 426 px span. An alpha has nothing to raise on half a pixel, so a 1.5 px stroke rides the lit band's outline in its own ink.

### Scrub marks

Finding a reversing step by stepping through means reading the path line 144 times on animal, so the scrub carries a mark at every step whose path recovers a word. animal has 13 of its 144, food 18 and plant 20. animal's 13 are steps 88 to 98 and 143 to 144, and the closest pair stand 3.38 px apart on a 500 px track, so a run of them reads as one band along the slider rather than separate ticks. The element draws the thumb itself, because a mark has to line up with the thumb's travel, which is the track less the thumb's own width, and the browser would otherwise choose that width.

## Derived categories

The category picker can follow `<hypernym-disc>`, handing `<word-disc>`, `<letter-disc>` and `<balance-flow>` the words below whatever node the disc is on. A file per node was ruled out: 12,224 nodes have a playable word below them, and their lists would come to about 4.9 MB of JSON. So `tools/export_table.py` ships the facts every one of those lists is computed from, once, and `web/word-source.js` does the sums in the page.

The *word table* holds 40,118 words, 65,938 (word, synset) pairs and 2,313 `extra` edges for the hypernyms the tree dropped. It is 987 KB raw, 279 KiB with gzip and 246 KiB with brotli. It is JSON because the live site serves JSON gzipped. A `LABEL` flag spells 30,508 of the 40,118 words from the synset labels in `wordnet-names.txt`, which a page holding the disc has already fetched, so only the other 9,610 travel as text.

Pairs are pruned to those that can change an answer. A pair is kept if it is a member, if its word has sense-tagged counts and the pair carries one, or if its word has none and the pair is among its early senses. Pairs are grouped by synset in the tree's *preorder*, so a subtree's pairs are one contiguous run and taking a subtree in is a loop.

Two choices went against a smaller file. Word ids run in rank order rather than in order of first appearance, which would save 27 KiB gzipped but cost the page a sort on every selection. The count array holds an entry for every pair, 16.5 KiB gzipped against 11.8 KiB for a sparse one, for the simpler decode.

In Node the table decodes in 6–15 ms and the slowest of the 37 categories answers in 2.2–2.9 ms, both as `node tools/check_words.mjs` prints them. The root, entity, answers in 9.1 ms. The page keeps the last 12 answers, since a reader zooming in and back out asks for the same few nodes.

Following entity in headless Chrome on an Apple silicon Mac, with all three elements on the page, the switch took 181 ms at full speed and 763 ms under a 4× central processing unit (CPU) throttle. Of that, 74 ms and 297 ms went on `<word-disc>` calling `measureText` on each of the 40,117 words to find the widest, which sizes its label ring. The switch ran inside the handler that fired `disc-zoom`, so the disc's own redraw waited behind it, 172 ms to the next frame at 1× and 552 ms at 4×. `<letter-disc>` applies the same list in 25 ms and `<balance-flow>` in 22 ms, 11.5 ms of it the solve, and neither raises a *long task*.

The measuring also cost memory. Blink caches the shaped text of every `measureText` call, and the 40,117 calls left 28.5 MiB of `blink::PlainTextNode` objects on the Oilpan heap. Blink's embedder heap went from 5.5 to 41 MiB and stayed there until `<word-disc>` next drew a smaller set, including while the disc was scrolled out of view.

So `#measure()` now estimates each word as the sum of its characters' advances, measuring each character once, and calls `measureText` only on the words whose estimate is within `SLACK` of the widest. Kerning and ligatures move a word only a little. Over entity's words in Libertinus Serif a word runs from 6.3% narrower than its characters' sum (the fl ligature) to 1.7% wider (rv), so the widest word is certain to be measured once `SLACK` exceeds 1 − 0.983/1.063, about 7.5%. At the 10% it is set to, entity measures one word whole. Across the 37 categories and every 25th tree node, 352 word sets, none measured more than 11, and every result matched measuring every word. The embedder heap at entity is now 4.0 MiB, the same as plant.

The picker also stopped handing words over inside the handler that fired the move. `#soon()` waits for the next frame and then a task, so the disc paints first, and moves made while it waits coalesce into one follow of wherever the disc ended. The disc now paints 1–3 ms after a zoom at 1× and at 4×. The elements finish following entity 94 ms after the zoom at 1× and 244 ms at 4×, where the work falls after the paint as two long tasks of 212 ms and 66 ms. organism finishes in 56 ms and 104 ms, physical entity in 66 ms and 163 ms.

### Merging the bundle

Entity holds 74,068,990 chords, and until the merge `<word-disc>` refused any bundle over 200,000. More time would not have helped: `thin` gives each of entity's chords an alpha of 0.00044, which is 0.11 of one 8-bit level, so a canvas rounds every stroke to nothing. So `word-bundle.js` merges words into 2,400 angle bins and draws one stroke per pair of bins a wedge reaches, at the alpha its chords would stack to. A letter's words ending in one letter are a contiguous run of its wedge, which is what keeps the merge exact to a bin.

The stroke count then follows the bins rather than the words. On a 1,536 px square, 2,400 bins are about two device pixels of rim, and the four largest nodes draw as 196,313 strokes at most (entity 192,843, abstraction 196,313, physical entity 179,580, object 173,951), against 15 to 74 million chords. In the same browser, entity's bundle lands 261 ms after the option is chosen, at a 1,280 px square, and hovering across it keeps to the frame rate with no long task. None of the 37 categories merges a single pair: animal's 1,582 words are the densest, and each still has a bin of its own, so every shipped category draws stroke for stroke as it did before.

## Corpus and data

The 37 categories hold 13,212 words, 197 KB of JSON (JavaScript Object Notation) across the per-category files. A top-of-file import of nltk, wordfreq, networkx or matplotlib costs 100–300 ms on every invocation that does not use it, and nltk's multilingual sense-key mapping is two thirds of the corpus load. The exports come to 7.1 MB uncompressed, which is why the development server compresses them to match a deployed copy.

Every number above describes WordNet 3.0 as filtered on one day. The rules in `CLAUDE.md` are the part meant to survive a change to the corpus, and these figures are the evidence for why each rule was written.
