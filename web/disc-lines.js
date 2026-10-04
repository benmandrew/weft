/* A text file's lines, kept as the text and where each line starts. Splitting
 * on the newline costs a string header per line and frees nothing, since every
 * substring keeps the whole text alive. The names are not held this way, since
 * the search reads every one of them on every query.
 *
 * Its own module so tools/check_web.mjs can test it: an offset out by one
 * returns the tail of the line above, which reads as a plausible gloss.
 */
export class Lines {
  /** @type {string} */
  #t = "";
  /** @type {Int32Array} */
  #off = new Int32Array(1);

  /** From the text, or from lines a host hands the element, joined back up so
     there is one shape downstream.
     @param {string | Iterable<string>} v */
  constructor(v = "") {
    this.#t = typeof v === "string" ? v : Array.from(v).join("\n");
    // One pass, and one entry past the end, so a line is off[i] to off[i + 1]
    // with no test for the last.
    let n = 1;
    for (let i = this.#t.indexOf("\n"); i >= 0; i = this.#t.indexOf("\n", i + 1)) n++;
    const off = new Int32Array(n + 1);
    let k = 1;
    for (let i = this.#t.indexOf("\n"); i >= 0; i = this.#t.indexOf("\n", i + 1)) off[k++] = i + 1;
    off[n] = this.#t.length + 1;
    this.#off = off;
    this.length = this.#t ? n : 0;
  }

  /** The line, or "" for an index the file does not reach, which is what the
     readout prints while the glosses are still on their way.
     @param {number} i
     @returns {string} */
  at(i) {
    if (!(i >= 0) || i >= this.length) return "";
    return this.#t.slice(this.#off[i], this.#off[i + 1] - 1);
  }
}
