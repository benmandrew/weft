/* The chain <word-disc> builds, with no DOM in it.
 *
 * The rule is the whole game: the next word starts with the letter the last
 * one ended on. That makes legality a comparison of two letters, and the set
 * of legal moves a whole wedge of the disc, so nothing here walks a graph.
 *
 * A word cannot follow itself, which is the one exception and the same one
 * render.py makes when it builds the bundle: a word ending on the letter it
 * starts with is in its own reply group and has to come out of it.
 *
 * A word already played stays legal. The game says otherwise, but a widget
 * that silently refuses a click teaches nothing, so a repeat goes into the
 * chain and is marked as one — on the disc and in the line under it — which is
 * what makes the rule visible at the moment it is broken.
 *
 *   const c = new Chain(L.head, L.tail);
 *   c.legal(i) && c.play(i);
 */
export class Chain {
  #head;
  #tail;
  #steps = [];
  // Whether step k had been played before, held rather than searched: the
  // chain line asks for every step on every repaint.
  #again = [];
  // Times each word appears, so the paint can ask about all of them in one
  // pass over the disc rather than searching the chain per word.
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
    if (!this.#steps.length) return true;
    return i !== this.end && this.#head[i] === this.#tail[this.end];
  }
  played(i) {
    return this.#count[i] > 0;
  }
  /* Whether the word at step k had already been played when it was played. */
  again(k) {
    return this.#again[k] === true;
  }

  /* The step it became, or null when the move is not legal. */
  play(i) {
    if (!this.legal(i)) return null;
    const repeat = this.#count[i] > 0;
    this.#count[i]++;
    this.#again.push(repeat);
    this.#steps.push(i);
    return { index: i, at: this.#steps.length - 1, repeat };
  }
  undo() {
    return this.rewind(this.#steps.length - 1);
  }
  /* Keeps the first `k` steps and drops the rest. Clicking step k in the line
     under the disc rewinds to just after it, so play carries on from there. */
  rewind(k) {
    const keep = Math.max(0, Math.min(k, this.#steps.length));
    while (this.#steps.length > keep) {
      this.#count[this.#steps.pop()]--;
      this.#again.pop();
    }
    return this.end;
  }
  clear() {
    return this.rewind(0);
  }

  /* How many words could be played next. Every word opens an empty chain, and
     zero here is the end of the round: play has arrived on a letter no word in
     the category starts with. */
  replies(byHead) {
    if (!this.#steps.length) return this.#count.length;
    const group = byHead[this.letter];
    return group.length - (this.#head[this.end] === this.letter ? 1 : 0);
  }
  stuck(byHead) {
    return this.#steps.length > 0 && this.replies(byHead) === 0;
  }
}
