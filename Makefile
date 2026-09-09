# Renders every category. Parallelism is make's own: `make -j all`, or
# `make -j8` to cap it. Bare `make` runs the 37 builds one at a time.
#
# One file per category means make can tell which are stale, so editing one
# module and running `make -j` again redraws all 37 while editing nothing
# redraws none. `make -B` forces the lot.

OUT ?= out

# The config file build reads; CONFIG= names another. It is both the --config
# argument and a prerequisite, so editing the file redraws.
CONFIG ?= $(wildcard weft.toml)
BUILD ?= python -m weft build $(if $(CONFIG),--config $(CONFIG))

# `categories` resolves every word list to count them, and runs on every make
# invocation, `make clean` included, because the target list comes from it.
CATEGORIES := $(shell python -m weft categories | awk '{print $$1}')
SVGS := $(patsubst %,$(OUT)/%.svg,$(CATEGORIES))

# Anything that changes what a disc looks like. With no config in play CONFIG
# is empty and the dependency simply is not there.
SOURCES := $(wildcard src/weft/*.py) $(CONFIG)

# The three files <hypernym-disc> reads. Nothing in `all` depends on any of it.
DATA := $(addprefix $(OUT)/,wordnet-tree.json wordnet-names.txt wordnet-glosses.txt)

# One file per category for <word-disc>, plus the index a page picks from. Flat
# names rather than a directory, since web-dist stages everything side by side.
WORDS := $(patsubst %,$(OUT)/words-%.json,$(CATEGORIES)) $(OUT)/words-index.json

# Every module in web/, found by glob rather than named one by one, so a new
# module reaches a consuming site by existing.
MODULES := $(wildcard web/*.js)

# The one page web-dist ships: the harnesses ask for their data at /out/, where
# embed.html asks for it beside itself, which is the layout the dist has.
EMBED := web/embed.html

# The directory web-dist stages the modules and the data into. DIST= moves it.
DIST ?= $(OUT)/web-dist

.PHONY: all check clean list tree types words serve web web-dist

all: $(SVGS)

# build creates the directory itself, so there is no order-only rule for it.
$(OUT)/%.svg: $(SOURCES)
	$(BUILD) $* --out $(OUT)

# Everything that has to pass before a commit. taplo validates weft.toml
# against the schema as an editor would, check_schema.py reads that schema back
# against config.py, and check_chain.py holds graph.py's longest_chain to the
# answers in tools/chains.json, which check_web.mjs holds word-longest.js to.
#
# Biome is named web/ tools/ rather than `.`: config discovery runs before
# `files.includes` filters, so from the root Biome finds the biome.jsonc inside
# any git worktree under .claude/worktrees/ and refuses to run at all.
check: web types
	@ruff check src/ tools/
	@ruff format --check src/ tools/
	@mypy
	@RUST_LOG=warn taplo check
	@python tools/check_schema.py
	@python tools/check_chain.py
	@biome lint web/ tools/
	@biome format web/ tools/

# A prerequisite of check rather than a line in it, since it and types below
# are the parts that need node. It loads every module in web/ the way a browser
# does, which `node --check` does not: that parses without resolving private
# names.
web:
	@node tools/check_web.mjs

# The JSDoc types in web/, checked without emitting anything. A prerequisite
# rather than a recipe line for the reason web is: tsc is the other part that
# needs node. tsconfig.json names what is checked and what is not yet.
types:
	@tsc --noEmit

# A prerequisite rather than a recipe line, so the corpus walk reruns when
# lexicon.py or the exporter moves and not on every serve. Grouped, because one
# run writes all three files where three rules would walk the corpus thrice.
$(DATA) &: tools/export_tree.py src/weft/lexicon.py
	@python tools/export_tree.py --out $(OUT)

tree: $(DATA)

# Grouped for the tree's reason: one run resolves every category, where an
# ordinary rule each would load WordNet once per category. The selection
# settings decide the lists, so the config file is a prerequisite via SOURCES.
$(WORDS) &: tools/export_words.py $(SOURCES)
	@python tools/export_words.py --out $(OUT) $(if $(CONFIG),--config $(CONFIG))

words: $(WORDS)

# Serves web/ with a watcher that reloads the browser on save. ARGS= passes
# flags through, as in `make serve ARGS='--port 9000 --open'`.
serve: $(DATA) $(WORDS)
	@python tools/serve.py $(ARGS)

# Everything a page needs to run any of the elements, flat in one directory, so
# a site copies the directory rather than keeping its own list of filenames in
# step with this one by hand.
web-dist: $(DIST)

# Emptied and refilled rather than copied into, so a module deleted upstream
# does not sit in there for good. web/. is a prerequisite because a directory's
# timestamp moves when a file enters or leaves it, which is the only thing that
# catches a deletion; the dot is what stops make reading the phony web above.
$(DIST): $(MODULES) $(EMBED) $(DATA) $(WORDS) web/.
	@rm -rf $@
	@mkdir -p $@
	@cp $(MODULES) $(EMBED) $(DATA) $(WORDS) $@

list:
	@printf '%s\n' $(CATEGORIES)

clean:
	@rm -rf $(OUT)
