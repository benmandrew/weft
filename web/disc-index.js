/* Where a category's words are, given the index that named it. No DOM here.
 *
 * The exported files and their index sit flat and side by side, so the path to
 * one is the index's own with the last segment swapped. Nothing for a host to
 * name twice, and the one thing it cannot survive is a query string on the
 * index.
 */
export function href(indexSrc, name) {
  const src = indexSrc ?? "";
  return `${src.slice(0, src.lastIndexOf("/") + 1)}words-${name}.json`;
}

/* What a row of the index reads as in the picker. The count is what tells a
   large category from a small one before the choice is made. */
export function label(row) {
  return row.words ? `${row.name} (${row.words})` : row.name;
}
