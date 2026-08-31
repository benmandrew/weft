/* The chain <word-disc> builds, with no DOM in it.
 *
 * The rule is the whole game: the next word starts with the letter the last
 * one ended on, and no word is played twice. That makes legality a letter
 * comparison and a count lookup, and the set of legal moves the unused part of
 * one wedge of the disc, so nothing here walks a graph.
 *
 * A word cannot follow itself, and that falls out rather than being written
 * down: the word play is standing on is used, so the test that refuses a
 * repeat refuses it too. render.py makes the same exclusion when it builds the
 * bundle, since a word ending on the letter it starts with is in its own reply
 * group.
 *
 * Refusing a repeat rather than recording one puts the whole of the rule in
 * `legal`, which is what the disc paints, what the readout explains and what
 * the cursor follows — so a word that cannot be played cannot look, read or
 * click as though it can.
 *
 *   const c = new Chain(L.head, L.tail);
 *   c.legal(i) && c.play(i);
 */
export class Chain {
  #head;
  #tail;
  #steps = [];
  // Whether each word has been used, so the paint can ask about all of them in
  // one pass over the disc rather than searching the chain per word. A count
  // rather than a flag, because rewinding has to put it back and a word can
  // sit in the chain only once.
  #count;

  constructor(head, tail) {
    this.#head = head;
    this.#tail = tail;
    this.#count = new Int32Array(head.length);
  }

  get length() {
    return this.#steps.length;
  }
  /* A copy, since the element hands this straight to an event listener. */
  get steps() {
    return this.#steps.slice();
  }
  /* The word play is standing on, and -1 before the first move. */
  get end() {
    return this.#steps.length ? this.#steps[this.#steps.length - 1] : -1;
  }
  /* The letter the next word has to start with, and -1 when anything opens. */
  get letter() {
    return this.#steps.length ? this.#tail[this.end] : -1;
  }

  legal(i) {
    // An index the word list does not have is never a move. The disc can only
    // offer one it has, but `play` is public and a host holding an index from
    // before a `limit` change would otherwise put a word with no letters into
    // the chain and take the paint down with it.
    if (!(i >= 0 && i < this.#head.length)) return false;
    if (this.#count[i] > 0) return false;
    if (!this.#steps.length) return true;
    return this.#head[i] === this.#tail[this.end];
  }
  played(i) {
    return this.#count[i] > 0;
  }

  /* The step it became, or null when the move is not legal. */
  play(i) {
    if (!this.legal(i)) return null;
    this.#count[i]++;
    this.#steps.push(i);
    return { index: i, at: this.#steps.length - 1 };
  }
  undo() {
    return this.rewind(this.#steps.length - 1);
  }
  /* Keeps the first `k` steps and drops the rest. Clicking step k in the line
     under the disc rewinds to just after it, so play carries on from there. */
  rewind(k) {
    const keep = Math.max(0, Math.min(k, this.#steps.length));
    while (this.#steps.length > keep) this.#count[this.#steps.pop()]--;
    return this.end;
  }
  clear() {
    return this.rewind(0);
  }

  /* How many words could follow `i`: the wedge it hands over to, less the word
     itself and everything already used.

     Asked of the word play is standing on, which is itself used, that is the
     move set as it stands — so the count beside the current word and the count
     beside one the pointer is over are the same question put to two words, and
     the second is what the first would become. Zero is the end of the round.  */
  replies(i, byHead) {
    let count = 0;
    for (const j of byHead[this.#tail[i]]) if (j !== i && this.#count[j] === 0) count++;
    return count;
  }
  stuck(byHead) {
    return this.#steps.length > 0 && this.replies(this.end, byHead) === 0;
  }
}
