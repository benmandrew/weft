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

# The three files <hypernym-disc> reads, and the dev server that watches them.
# All of it sits outside the SVG pipeline: nothing in `all` depends on any of it.
DATA := $(addprefix $(OUT)/,wordnet-tree.json wordnet-names.txt wordnet-glosses.txt)

# One file per category for <word-disc>, plus the index a page picks from. Flat
# names rather than a directory, since web-dist stages everything side by side.
# Each holds the whole category and the element cuts it at its own limit, so a
# page changing that attribute refetches nothing.
WORDS := $(patsubst %,$(OUT)/words-%.json,$(CATEGORIES)) $(OUT)/words-index.json

# Every module in web/, found by glob rather than named one by one, so a
# twelfth module reaches a consuming site by existing. index.html is the local
# harness and stays out of the glob: a host page carries its own markup.
MODULES := $(wildcard web/*.js)

# The one page web-dist ships. index.html and words.html stay behind as the
# local harnesses, which ask for their data at /out/ and are one element each;
# embed.html carries both elements and asks for its data beside itself, which
# is the layout the dist directory has.
EMBED := web/embed.html

# The directory web-dist stages the modules and the data into. DIST= moves it.
DIST ?= $(OUT)/web-dist

.PHONY: all check clean list tree words serve web web-dist

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
# and not on every serve. It is a grouped target because one run writes all
# three files: as three ordinary rules make would walk the corpus three times
# over.
$(DATA) &: tools/export_tree.py src/wordchain/lexicon.py
	@python tools/export_tree.py --out $(OUT)

tree: $(DATA)

# One grouped target for the same reason as the tree: a single run resolves
# every category, where 38 ordinary rules would load WordNet 38 times. The
# selection settings decide the lists, so the config file is a prerequisite
# through SOURCES.
$(WORDS) &: tools/export_words.py $(SOURCES)
	@python tools/export_words.py --out $(OUT) $(if $(CONFIG),--config $(CONFIG))

words: $(WORDS)

# Serves web/ with a watcher that reloads the browser on save. ARGS= passes
# flags through, as in `make serve ARGS='--port 9000 --open'`.
serve: $(DATA) $(WORDS)
	@python tools/serve.py $(ARGS)

# Everything a page needs to run either element, flat in one directory: the
# modules, the data they fetch, and embed.html, which carries both discs and is
# what a host copies or reads to write its own markup. A site copies the
# directory rather than a list of filenames it keeps in step with this one by
# hand, so adding a module here cannot leave that site running five of six.
web-dist: $(DIST)

# The directory is the target and its timestamp is what make compares, so it is
# emptied and refilled rather than copied into: a module deleted upstream would
# otherwise sit in there for good. web/. is a prerequisite alongside the modules
# themselves because a directory's timestamp moves when a file enters or leaves
# it, which is the only thing that catches a deletion. It is spelt with the dot
# so make reads it as that directory rather than as the phony web above.
$(DIST): $(MODULES) $(EMBED) $(DATA) $(WORDS) web/.
	@rm -rf $@
	@mkdir -p $@
	@cp $(MODULES) $(EMBED) $(DATA) $(WORDS) $@

list:
	@printf '%s\n' $(CATEGORIES)

clean:
	@rm -rf $(OUT)
