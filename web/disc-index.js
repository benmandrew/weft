/* Where a category's words are, given the index that named it. No DOM here.
 *
 * The exported files and their index sit flat and side by side, so the path to
 * one is the index's own with the last segment swapped. Nothing for a host to
 * name twice, and the one thing it cannot survive is a query string on the
 * index.
 */
/** One category in the index: its name and, where the exporter wrote one, how
   many words it holds.
   @typedef {{name: string, words?: number}} IndexRow */

/** @param {string | null | undefined} indexSrc @param {string} name
   @returns {string} */
export function href(indexSrc, name) {
  return beside(indexSrc, `words-${name}.json`);
}

/* Any other export by the same rule, which is how a picker finds the word
   table without a second attribute naming it. */
/** @param {string | null | undefined} indexSrc @param {string} file
   @returns {string} */
export function beside(indexSrc, file) {
  const src = indexSrc ?? "";
  return `${src.slice(0, src.lastIndexOf("/") + 1)}${file}`;
}

/* What a row of the index reads as in the picker. The count is what tells a
   large category from a small one before the choice is made. */
/** @param {IndexRow} row @returns {string} */
export function label(row) {
  return row.words ? `${row.name} (${row.words})` : row.name;
}
