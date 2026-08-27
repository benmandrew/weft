"""Category membership, taken from WordNet's hyponym closure."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeAlias

# Each category names the WordNet synsets whose hyponym closure defines it.
# Several need more than one root because WordNet splits the sense along a line
# players do not: fruit.n.01 is the botanical sense and misses most of what
# somebody would actually say, so the edible sense joins it.
CATEGORIES: dict[str, tuple[str, ...]] = {
    "animal": ("animal.n.01",),
    "bird": ("bird.n.01",),
    "fish": ("fish.n.01",),
    "insect": ("insect.n.01",),
    "mammal": ("mammal.n.01",),
    "dog": ("dog.n.01",),
    "fruit": ("edible_fruit.n.01", "fruit.n.01"),
    "vegetable": ("vegetable.n.01",),
    "food": ("food.n.01", "food.n.02"),
    "drink": ("beverage.n.01",),
    "tree": ("tree.n.01",),
    "flower": ("flower.n.01",),
    "plant": ("plant.n.02",),
    "colour": ("color.n.01",),
    "body-part": ("body_part.n.01",),
    "clothing": ("clothing.n.01",),
    "fabric": ("fabric.n.01",),
    "tool": ("tool.n.01",),
    "instrument": ("musical_instrument.n.01",),
    "vehicle": ("vehicle.n.01",),
    "furniture": ("furniture.n.01",),
    "toy": ("toy.n.01",),
    "sport": ("sport.n.01",),
    "game": ("game.n.01",),
    "metal": ("metal.n.01",),
    "element": ("chemical_element.n.01",),
    "drug": ("drug.n.01",),
    "weapon": ("weapon.n.01",),
    "building": ("building.n.01",),
    "language": ("natural_language.n.01",),
    "job": ("worker.n.01", "occupation.n.01"),
    "country": ("country.n.02",),
    "city": ("city.n.01",),
}

# Lemma names arrive with underscores for spaces. Anything left holding a digit,
# a hyphen or an apostrophe is a taxonomic label rather than a word anyone would
# play, so the pattern drops it.
_PLAYABLE = re.compile(r"[a-z]+(?: [a-z]+)*")


# nltk ships no type information, so a WordNet synset is opaque here. The alias
# says which Any is meant rather than leaving a bare one at every boundary.
Synset: TypeAlias = Any

# Bump when the cached shape changes; old files then miss rather than mislead.
_CACHE_FORMAT = 1


_READER: Any = None


def _wordnet() -> Any:
    """A WordNet reader, built at the point of use and kept for the process.

    Parsing the database costs over a second, and a cache hit needs none of it,
    so nothing here runs until something actually asks WordNet a question.

    Two thirds of that cost is avoidable. `WordNetCorpusReader.__init__` ends by
    calling `map_wn()`, which guards its work with `get_version() == version`
    against a default of the string "wordnet" — a corpus name, not a version, so
    the comparison never holds and the mapping always runs. It parses the 7 MB
    index.sense twice to build a sense-key table for the multilingual API, which
    nothing here calls. Declining to build it takes the load from 1280 ms to
    512 ms and leaves every word list identical.
    """
    global _READER
    if _READER is None:
        import warnings

        import nltk.data
        from nltk.corpus.reader.wordnet import WordNetCorpusReader

        class _Reader(WordNetCorpusReader):  # type: ignore[misc]
            def map_wn(self, version: str = "wordnet") -> None:
                return None

        with warnings.catch_warnings():
            # Passing no omw_reader is the point; the warning about it is not.
            warnings.simplefilter("ignore")
            _READER = _Reader(nltk.data.find("corpora/wordnet"), None)
    return _READER


class UnknownCategory(KeyError):
    """Raised for a category name that has no synset roots."""


@dataclass(frozen=True)
class Word:
    """One playable word, with the Zipf frequency that decided it was playable."""

    text: str
    zipf: float

    @property
    def head(self) -> str:
        return self.text[0]

    @property
    def tail(self) -> str:
        return self.text[-1]


def catalogue() -> list[str]:
    """Every category name, sorted."""
    return sorted(CATEGORIES)


def _descend(synset: Synset) -> list[Synset]:
    # instance_hyponyms carries the proper nouns: without it `country` returns
    # nothing, because France is an instance of a country rather than a kind.
    children: list[Synset] = [*synset.hyponyms(), *synset.instance_hyponyms()]
    return children


def _closure(roots: tuple[str, ...], min_depth: int) -> set[Synset]:
    """Every synset below the category roots, by breadth-first hop count.

    min_depth drops the shallow layers. At depth zero sit the roots themselves,
    whose lemmas are the category name: "animal" is not a playable answer in a
    game of animals, and neither is "vehicle" in a game of vehicles.
    """
    wordnet = _wordnet()
    depth: dict[Synset, int] = {}
    frontier: list[Synset] = []
    for root in roots:
        synset = wordnet.synset(root)
        if synset not in depth:
            depth[synset] = 0
            frontier.append(synset)

    while frontier:
        nxt: list[Synset] = []
        for synset in frontier:
            for child in _descend(synset):
                if child not in depth:
                    depth[child] = depth[synset] + 1
                    nxt.append(child)
        frontier = nxt

    return {synset for synset, d in depth.items() if d >= min_depth}


def _lemma_names(synsets: Iterable[Synset]) -> set[str]:
    return {
        lemma.name().replace("_", " ").lower() for synset in synsets for lemma in synset.lemmas()
    }


def _in_category(
    text: str, category_senses: set[Synset], min_dominance: float, max_rank: int
) -> bool:
    """Whether the category is what somebody hearing the bare word would think of.

    The closure is generous: `animal.n.01` contains a sense of "world" and a
    sense of "blue", and taking every lemma at face value fills the graph with
    words that are animals only under a reading nobody would offer in a game.

    Two signals separate them. WordNet ships sense-tagged counts from a hand
    annotated corpus, so where a word has been tagged at all, the share of its
    noun occurrences falling inside the category is the direct measure. Where it
    has no counts, sense order stands in: WordNet lists senses commonest first,
    so a category sense buried at position seven is not the everyday meaning.
    """
    wordnet = _wordnet()
    senses = wordnet.synsets(text.replace(" ", "_"), pos=wordnet.NOUN)

    tagged = matched = 0
    for rank, sense in enumerate(senses):
        for lemma in sense.lemmas():
            if lemma.name().replace("_", " ").lower() != text:
                continue
            tagged += lemma.count()
            if sense in category_senses:
                matched += lemma.count()

    if tagged:
        return matched / tagged >= min_dominance

    first = next((i for i, s in enumerate(senses) if s in category_senses), None)
    return first is not None and first <= max_rank


def _fingerprint() -> str:
    """Something that changes when the WordNet database does, without loading it.

    The dev shell symlinks the corpus at a nix store path, and that path carries
    the version, so resolving the link is a stat. Asking nltk for its version
    would parse the database instead — the exact cost the cache exists to avoid.
    """
    root = os.environ.get("NLTK_DATA")
    if not root:
        return "unpinned"
    return os.path.realpath(Path(root) / "corpora" / "wordnet")


def _cache_file(category: str, params: dict[str, Any]) -> Path:
    key = json.dumps([_CACHE_FORMAT, category, params, _fingerprint()], sort_keys=True)
    digest = hashlib.sha256(key.encode()).hexdigest()[:16]
    root = Path(os.environ.get("WORDCHAIN_CACHE", ".cache/wordchain"))
    return root / f"{category}-{digest}.json"


def _read_cache(path: Path) -> list[Word] | None:
    try:
        rows = json.loads(path.read_text())
    except (OSError, ValueError):
        # A missing file and a half-written one both mean the same thing: work
        # the cache cannot save. Recomputing rewrites it.
        return None
    return [Word(row["t"], row["z"]) for row in rows]


def _write_cache(path: Path, words: list[Word]) -> None:
    payload = json.dumps([{"t": w.text, "z": w.zipf} for w in words])
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write and rename, so a reader never sees a partial file and two
        # processes racing on the same category leave one intact result.
        scratch = path.with_suffix(f".{os.getpid()}.tmp")
        scratch.write_text(payload)
        scratch.replace(path)
    except OSError:
        pass  # a read-only checkout is a reason to be slow, not to fail


def _resolve(
    category: str,
    min_zipf: float,
    min_dominance: float,
    max_rank: int,
    min_depth: int,
    allow_multiword: bool,
) -> list[Word]:
    """The uncached path: WordNet closure, then the three filters."""
    from wordfreq import zipf_frequency

    senses = _closure(CATEGORIES[category], min_depth)
    words = []
    for text in _lemma_names(senses):
        if len(text) < 2 or not _PLAYABLE.fullmatch(text):
            continue
        if " " in text and not allow_multiword:
            continue
        zipf = zipf_frequency(text, "en")
        if zipf < min_zipf:
            continue
        if not _in_category(text, senses, min_dominance, max_rank):
            continue
        words.append(Word(text, zipf))

    return sorted(words, key=lambda w: (-w.zipf, w.text))


def members(
    category: str,
    *,
    min_zipf: float = 3.0,
    min_dominance: float = 0.2,
    max_rank: int = 2,
    min_depth: int = 1,
    allow_multiword: bool = False,
    cache: bool = True,
) -> list[Word]:
    """The words of a category, commonest first.

    min_zipf is on wordfreq's Zipf scale, where 3.0 is about one occurrence per
    million words. WordNet's tail holds several thousand animals nobody has
    heard of, and they would swamp the graph, so the frequency cut stands in for
    "a word a player might actually produce". min_dominance and max_rank control
    the polysemy filter described on _in_category, and min_depth the
    shallow-layer cut described on _closure.

    The result is cached on disk against the category, every argument above, and
    the WordNet build it came from. A hit skips the 1.3 s the database takes to
    parse, which is the single largest cost in the whole tool.
    """
    if category not in CATEGORIES:
        raise UnknownCategory(category)

    params = {
        "min_zipf": min_zipf,
        "min_dominance": min_dominance,
        "max_rank": max_rank,
        "min_depth": min_depth,
        "allow_multiword": allow_multiword,
    }
    path = _cache_file(category, params)
    if cache:
        hit = _read_cache(path)
        if hit is not None:
            return hit

    words = _resolve(category, min_zipf, min_dominance, max_rank, min_depth, allow_multiword)
    if cache:
        _write_cache(path, words)
    return words
