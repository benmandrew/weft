/* Holds the word table to the 37 category files, word for word and in order.
 *
 * export_table.py and export_words.py reach the same lists by two routes: the
 * second resolves each category in Python, the first ships the pairs and
 * leaves web/word-source.js to do the sums. So each category's roots go
 * through word-source.js here, and the answer must be its file exactly, less
 * the words lexicon.EXTRA_WORDS added by hand, which belong to a category's
 * name rather than to any node.
 *
 * It reads the exports rather than fixtures, so it runs after them:
 *
 *     node tools/check_words.mjs            # reads out/
 *     node tools/check_words.mjs DIR
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WordTable } from "../web/word-source.js";

const dir = process.argv[2] ?? "out";
const read = (/** @type {string} */ name) => readFileSync(join(dir, name), "utf8");
const { par } = JSON.parse(read("wordnet-tree.json"));
const names = read("wordnet-names.txt").split("\n");
const t = JSON.parse(read("wordnet-words.json"));

const started = performance.now();
const table = new WordTable(t, par, names);
const built = performance.now() - started;

const problems = [];
let slowest = 0;
for (const [name, where] of Object.entries(t.categories)) {
  const file = JSON.parse(read(`words-${name}.json`));
  const added = new Set(where.extra ?? []);
  const want = file.words.filter((/** @type {string} */ w) => !added.has(w));
  const wantZipf = file.zipf.filter(
    (/** @type {number} */ _, /** @type {number} */ i) => !added.has(file.words[i]),
  );
  const t0 = performance.now();
  const got = table.words(where.at);
  slowest = Math.max(slowest, performance.now() - t0);
  if (got.words.join("|") !== want.join("|")) {
    const has = new Set(got.words);
    const wanted = new Set(want);
    const missing = want.filter((/** @type {string} */ w) => !has.has(w));
    const extra = got.words.filter(w => !wanted.has(w));
    problems.push(
      `${name}: ${got.words.length} words where the file holds ${want.length}` +
        (missing.length ? `; missing ${missing.slice(0, 6).join(", ")}` : "") +
        (extra.length ? `; extra ${extra.slice(0, 6).join(", ")}` : "") +
        (!missing.length && !extra.length ? "; the same words in another order" : ""),
    );
  } else if (got.zipf.join("|") !== wantZipf.join("|")) {
    problems.push(`${name}: the words agree and their Zipf values do not`);
  }
}

const count = Object.keys(t.categories).length;
if (problems.length) {
  console.error(`the word table disagrees with ${problems.length} of ${count} category files:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `${join(dir, "wordnet-words.json")}: all ${count} categories agree ` +
    `(decoded in ${built.toFixed(0)} ms, slowest category ${slowest.toFixed(1)} ms)`,
);
