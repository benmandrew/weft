"""Category membership, taken from WordNet's hyponym closure."""

from __future__ import annotations

import re
from dataclasses import dataclass

from nltk.corpus import wordnet
from wordfreq import zipf_frequency

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


def _descend(synset):
    # instance_hyponyms carries the proper nouns: without it `country` returns
    # nothing, because France is an instance of a country rather than a kind.
    return synset.hyponyms() + synset.instance_hyponyms()


def _closure(roots: tuple[str, ...], min_depth: int) -> set:
    """Every synset below the category roots, by breadth-first hop count.

    min_depth drops the shallow layers. At depth zero sit the roots themselves,
    whose lemmas are the category name: "animal" is not a playable answer in a
    game of animals, and neither is "vehicle" in a game of vehicles.
    """
    depth = {}
    frontier = []
    for root in roots:
        synset = wordnet.synset(root)
        if synset not in depth:
            depth[synset] = 0
            frontier.append(synset)

    while frontier:
        nxt = []
        for synset in frontier:
            for child in _descend(synset):
                if child not in depth:
                    depth[child] = depth[synset] + 1
                    nxt.append(child)
        frontier = nxt

    return {synset for synset, d in depth.items() if d >= min_depth}


def _lemma_names(synsets) -> set[str]:
    return {
        lemma.name().replace("_", " ").lower() for synset in synsets for lemma in synset.lemmas()
    }


def _in_category(text: str, category_senses: set, min_dominance: float, max_rank: int) -> bool:
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


def members(
    category: str,
    *,
    min_zipf: float = 3.0,
    min_dominance: float = 0.2,
    max_rank: int = 2,
    min_depth: int = 1,
    allow_multiword: bool = False,
) -> list[Word]:
    """The words of a category, commonest first.

    min_zipf is on wordfreq's Zipf scale, where 3.0 is about one occurrence per
    million words. WordNet's tail holds several thousand animals nobody has
    heard of, and they would swamp the graph, so the frequency cut stands in for
    "a word a player might actually produce". min_dominance and max_rank control
    the polysemy filter described on _in_category, and min_depth the
    shallow-layer cut described on _closure.
    """
    try:
        roots = CATEGORIES[category]
    except KeyError:
        raise UnknownCategory(category) from None

    senses = _closure(roots, min_depth)
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
