"""Connection graphs for the word chain game.

The modules are lexicon, graph, render, web, palette, config and cli. None is
imported here: web pulls in pyvis at module load, and a package that imports it
makes every command pay for the one that draws a page.
"""
