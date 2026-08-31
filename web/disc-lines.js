/* A text file's lines, kept as the text and where each line starts.
 *
 * `wordnet-glosses.txt` is 5.5 MB of definitions, one per synset, and the disc
 * shows one of them at a time. Split on the newline it is 82,115 strings, and
 * every one of them holds the whole text alive anyway, since that is what a
 * substring is: 3.1 MB of headers on top of the 5.5 MB, for a readout two
 * lines deep. Held this way the same file costs the text and one Int32Array,
 * 0.3 MB, and a slice is cut when the pointer asks for it.
 *
 * The offsets are the whole of it, so this is a module rather than a method:
 * an index table that is out by one returns the tail of the line above, which
 * reads as a definition and is nobody's, and tools/check_web.mjs can say so
 * where a browser cannot.
 *
 * Names are not held this way. The search reads every one of them on every
 * query and would cut 82,115 slices to do it.
 */
export class Lines {
  #t = "";
  #off = new Int32Array(1);

  /* From the text, or from anything else a host hands the element, which is
     joined back up rather than kept as an array: one shape downstream, and the
     property is documented as a file's lines. */
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
