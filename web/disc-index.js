/* Where a category's words are, given the index that named it. No DOM here.
 *
 * tools/export_words.py writes the 37 files and their index flat and side by
 * side, and `make web-dist` stages them that way, so the path to one is the
 * index's own with the last segment swapped. No base URL to resolve against,
 * nothing for a host to name twice, and the one thing it cannot survive is a
 * query string on the index, which a directory of exported files does not
 * have.
 *
 * It is a module rather than a method because both elements that carry a
 * picker derive the same path, and because getting it wrong asks for a
 * directory nobody has — which a browser reports as a disc that never changes,
 * and which nothing downstream can tell. tools/check_web.mjs can.
 */
export function href(indexSrc, name) {
  const src = indexSrc ?? "";
  return `${src.slice(0, src.lastIndexOf("/") + 1)}words-${name}.json`;
}

/* What a row of the index reads as in the picker. The count is what tells
   drug's 750 words from colour's 97 before the choice is made. */
export function label(row) {
  return row.words ? `${row.name} (${row.words})` : row.name;
}
