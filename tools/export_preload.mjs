/* Writes, for each element's module, every module it imports directly or not,
 * as JSON on stdout. A host loading an element late, from a script it appends,
 * learns of each module only once its importer has arrived, and word-disc.js
 * is five levels deep. With this list it can name them all as modulepreloads
 * up front. `make web-dist` stages the output as preload.json.
 *
 *     node tools/export_preload.mjs > preload.json
 *
 * An element is a module that defines one, found by reading web/, so a new
 * element is listed by existing. Workers load into a module map of their own,
 * which a document's preload does not fill, so their graphs are left out.
 */
import { readdirSync, readFileSync } from "node:fs";

const web = new URL("../web/", import.meta.url);
const text = name => readFileSync(new URL(name, web), "utf8");

/** The modules `name` imports by a static `import … from`, in source order.
    @param {string} name @returns {string[]} */
const importsOf = name =>
  [...text(name).matchAll(/^\s*import\s[^;]*?\sfrom\s+"\.\/([\w.-]+\.js)"/gm)].map(m => m[1]);

/** Every module the named ones reach, less the named ones themselves, sorted.
    @param {string[]} names @returns {string[]} */
export const reach = names => {
  const seen = new Set();
  const walk = name => {
    for (const dep of importsOf(name))
      if (!seen.has(dep)) {
        seen.add(dep);
        walk(dep);
      }
  };
  for (const name of names) walk(name);
  for (const name of names) seen.delete(name);
  return [...seen].sort();
};

/** Each element's module mapped to what it reaches. @returns {Record<string, string[]>} */
export const preloads = () =>
  Object.fromEntries(
    readdirSync(web)
      .filter(name => name.endsWith(".js") && text(name).includes("customElements.define("))
      .sort()
      .map(name => [name, reach([name])]),
  );

if (import.meta.url === `file://${process.argv[1]}`)
  process.stdout.write(`${JSON.stringify(preloads(), null, 2)}\n`);
