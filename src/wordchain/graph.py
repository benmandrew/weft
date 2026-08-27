"""The letter graph, the word graph, and the trap analysis over them.

A word runs from its first letter to its last, and the next word must start
where the previous one ended. Every word is therefore an edge between two of 26
letters, and the whole game lives on a 26-node graph no matter how large the
vocabulary is. The word-level graph is the line graph of that one.
"""

from __future__ import annotations

import math
import string
from collections import defaultdict
from dataclasses import dataclass

import networkx as nx
import numpy as np

from .lexicon import Word

LETTERS = string.ascii_lowercase
_INDEX = {letter: i for i, letter in enumerate(LETTERS)}


def letter_matrix(words: list[Word]) -> np.ndarray:
    """A 26x26 count indexed [first letter][last letter]."""
    counts = np.zeros((26, 26), dtype=int)
    for word in words:
        counts[_INDEX[word.head], _INDEX[word.tail]] += 1
    return counts


def letter_graph(words: list[Word]) -> nx.DiGraph:
    """26 nodes, one weighted edge per letter pair some word bridges."""
    graph = nx.DiGraph()
    graph.add_nodes_from(LETTERS)
    counts = letter_matrix(words)
    for i, head in enumerate(LETTERS):
        for j, tail in enumerate(LETTERS):
            if counts[i, j]:
                graph.add_edge(head, tail, weight=int(counts[i, j]))
    return graph


def word_graph(words: list[Word]) -> nx.DiGraph:
    """One node per word, an edge wherever one word can follow another."""
    graph = nx.DiGraph()
    for word in words:
        graph.add_node(word.text, zipf=word.zipf)

    by_head: dict[str, list[Word]] = defaultdict(list)
    for word in words:
        by_head[word.head].append(word)

    for word in words:
        for successor in by_head[word.tail]:
            if successor.text != word.text:
                graph.add_edge(word.text, successor.text)
    return graph


@dataclass(frozen=True)
class LetterStat:
    """What one letter is worth to a player who has just been handed it."""

    letter: str
    supply: int  # words starting here: the replies available
    demand: int  # words ending here: how often play lands on it

    @property
    def pressure(self) -> float:
        """Demand per available reply. Above 1 the letter drains faster than it refills."""
        return self.demand / self.supply if self.supply else math.inf

    @property
    def is_dead_end(self) -> bool:
        return self.supply == 0 and self.demand > 0


def letter_stats(words: list[Word]) -> list[LetterStat]:
    """One entry per letter, in alphabetical order."""
    supply: dict[str, int] = defaultdict(int)
    demand: dict[str, int] = defaultdict(int)
    for word in words:
        supply[word.head] += 1
        demand[word.tail] += 1
    return [LetterStat(letter, supply[letter], demand[letter]) for letter in LETTERS]


def live_letters(words: list[Word]) -> set[str]:
    """Letters any word touches at either end."""
    return {word.head for word in words} | {word.tail for word in words}


def core(graph: nx.DiGraph) -> set[str]:
    """The largest strongly connected set of letters.

    Play inside it can continue indefinitely. A letter outside it is somewhere
    the game can arrive and never leave, which is what ends a round.
    """
    components = list(nx.strongly_connected_components(graph))
    return max(components, key=len) if components else set()


def traps(words: list[Word], limit: int = 6) -> list[LetterStat]:
    """Letters ranked by how badly they strand a player, worst first."""
    reachable = [s for s in letter_stats(words) if s.demand > 0]
    return sorted(reachable, key=lambda s: (-s.pressure, -s.demand))[:limit]


def summary(words: list[Word]) -> dict:
    """Every scalar the report and the web page need."""
    graph = letter_graph(words)
    stats = letter_stats(words)
    live = live_letters(words)
    inside = core(graph) & live
    return {
        "words": len(words),
        "edges": word_graph(words).number_of_edges(),
        "letter_pairs": graph.number_of_edges(),
        "live_letters": sorted(live),
        "core": sorted(inside),
        "outside_core": sorted(live - inside),
        # A letter can fall outside the core for opposite reasons. Nothing ends
        # in C, so play never arrives there and "cat" is only ever an opening
        # move. Nothing starts with X, so arriving there ends the round.
        "openers_only": [s.letter for s in stats if s.supply > 0 and s.demand == 0],
        "dead_ends": [s.letter for s in stats if s.is_dead_end],
        "traps": [(s.letter, s.demand, s.supply, s.pressure) for s in traps(words)],
    }
