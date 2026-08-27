# Renders every category. Parallelism is make's own: `make -j all`, or
# `make -j8` to cap it. Bare `make` runs the 37 builds one at a time.
#
# One file per category means make can tell which are stale, so editing one
# module and running `make -j` again redraws all 37 while editing nothing
# redraws none. `make -B` forces the lot.

OUT ?= out
BUILD ?= python -m wordchain build

# `categories` resolves all 37 word lists to count them, which is 0.23 s
# against a warm cache and 3.2 s against a cold one. It runs on every make
# invocation, including `make clean`, because the target list is built from it.
CATEGORIES := $(shell python -m wordchain categories | awk '{print $$1}')
SVGS := $(patsubst %,$(OUT)/%.svg,$(CATEGORIES))

# Anything that changes what a disc looks like. A missing wordchain.toml
# contributes nothing to the wildcard, so the dependency simply is not there.
SOURCES := $(wildcard src/wordchain/*.py) $(wildcard wordchain.toml)

.PHONY: all clean list

all: $(SVGS)

# build creates the directory itself, so there is no order-only rule for it.
$(OUT)/%.svg: $(SOURCES)
	@$(BUILD) $* --out $(OUT)

list:
	@printf '%s\n' $(CATEGORIES)

clean:
	@rm -rf $(OUT)
