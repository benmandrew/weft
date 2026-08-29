# Renders every category. Parallelism is make's own: `make -j all`, or
# `make -j8` to cap it. Bare `make` runs the 37 builds one at a time.
#
# One file per category means make can tell which are stale, so editing one
# module and running `make -j` again redraws all 37 while editing nothing
# redraws none. `make -B` forces the lot.

OUT ?= out

# The config file build actually reads. It defaults to the wordchain.toml in
# this directory, which is the one build would discover on its own, and CONFIG=
# names another. Either way it is both the --config argument and a prerequisite,
# so editing the file redraws.
CONFIG ?= $(wildcard wordchain.toml)
BUILD ?= python -m wordchain build $(if $(CONFIG),--config $(CONFIG))

# `categories` resolves all 37 word lists to count them, which is 0.23 s
# against a warm cache and 3.2 s against a cold one. It runs on every make
# invocation, including `make clean`, because the target list is built from it.
CATEGORIES := $(shell python -m wordchain categories | awk '{print $$1}')
SVGS := $(patsubst %,$(OUT)/%.svg,$(CATEGORIES))

# Anything that changes what a disc looks like. With no config in play CONFIG
# is empty and the dependency simply is not there.
SOURCES := $(wildcard src/wordchain/*.py) $(CONFIG)

# The flat tree <hypernym-disc> reads, and the dev server that watches it.
# Both live outside the SVG pipeline: nothing in `all` depends on them.
TREE := $(OUT)/wordnet-tree.json

.PHONY: all check clean list tree serve web

all: $(SVGS)

# build creates the directory itself, so there is no order-only rule for it.
$(OUT)/%.svg: $(SOURCES)
	$(BUILD) $* --out $(OUT)

# Everything that has to pass before a commit. The last two are about the
# config file: taplo validates wordchain.toml against wordchain.schema.json,
# which is the check an editor runs, and check_schema.py reads that schema back
# against config.py, since the schema repeats every field name, default and
# bound the code already owns.
check: web
	@ruff check src/ tools/
	@ruff format --check src/ tools/
	@mypy
	@RUST_LOG=warn taplo check
	@python tools/check_schema.py
	@biome lint .
	@biome format .

# A prerequisite of check rather than a line in it, since it is the one part
# that needs node. It loads every module in web/ the way a browser does, which
# `node --check` does not: that parses a file without resolving private names,
# so a reference left behind by a refactor passes it and then throws when the
# browser evaluates the class, leaving the page blank.
web:
	@node tools/check_web.mjs

# The exporter walks all 82,115 noun synsets, so it is a prerequisite rather
# than a recipe line: it reruns when lexicon.py or the exporter itself moves,
# and not on every serve.
$(TREE): tools/export_tree.py src/wordchain/lexicon.py
	@python tools/export_tree.py --out $(OUT)

tree: $(TREE)

# Serves web/ with a watcher that reloads the browser on save. ARGS= passes
# flags through, as in `make serve ARGS='--port 9000 --open'`.
serve: $(TREE)
	@python tools/serve.py $(ARGS)

list:
	@printf '%s\n' $(CATEGORIES)

clean:
	@rm -rf $(OUT)
