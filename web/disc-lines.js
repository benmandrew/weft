/* A text file's lines, kept as the text and where each line starts. Splitting
 * on the newline buys 82,115 string headers and frees nothing, since every
 * substring holds the whole text alive anyway. Names are deliberately not held
 * this way — the search reads every one of them on every query.
 *
 * A module rather than a method because an offset table out by one returns the
 * tail of the line above, which reads as a definition and is nobody's, and
 * tools/check_web.mjs can say so where a browser cannot.
 */
export class Lines {
  #t = "";
  #off = new Int32Array(1);

  /* From the text, or from anything else a host hands the element, which is
     joined back up rather than kept as an array, so there is one shape
     downstream. */
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

  /* The line, or "" for an index the file does not reach, which is what the
     readout prints while the glosses are still on their way. */
  at(i) {
    if (!(i >= 0) || i >= this.length) return "";
    return this.#t.slice(this.#off[i], this.#off[i + 1] - 1);
  }
}
