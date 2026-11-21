/**
 * Rewrites the hand-authored reads in styles/theme-keys.css so each fallback equals its declared
 * value (CONTAM-U6): a read of a global token takes its expanded declared value, a Tailwind `--tw-*`
 * read its `@property` initial value, and a bare read of a runtime-only token `unset`. Scoped and
 * runtime reads that already carry a fallback are left as written and listed. Values are read by
 * `alignDeclaredFallbacks` (src/compiled-css/declared-fallbacks.ts), the reader the compiled output
 * uses; none is typed here. Build Designer first, then run `npm run generate:compiled-css`.
 *
 *   node scripts/align-theme-keys-fallbacks.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { compiledCssDeclaredSources } = await import("../dist/compiled-css/generate.js");
const { alignDeclaredFallbacks, classifyFallbackReads } = await import("../dist/compiled-css/declared-fallbacks.js");

const stylesDir = resolve(root, "styles");
const path = resolve(stylesDir, "theme-keys.css");
const current = readFileSync(path, "utf8");
const output = readFileSync(resolve(stylesDir, "compiled.css"), "utf8");
const sources = compiledCssDeclaredSources(stylesDir);
const expected = alignDeclaredFallbacks(current, sources, output);
const listed = [...new Set(classifyFallbackReads(expected, sources, output).filter((r) => r.kind !== "global" && r.kind !== "tw-property").map((r) => `${r.name} (${r.kind})`))].sort();

if (process.argv.includes("--check")) {
  if (expected !== current) {
    console.error(`${path}: a fallback differs from its declared value. Run node scripts/align-theme-keys-fallbacks.mjs.`);
    process.exit(1);
  }
  console.log(`${path}: every global fallback equals its declared value.`);
} else if (expected !== current) {
  writeFileSync(path, expected, "utf8");
  console.log(`Wrote ${path}.`);
} else console.log(`${path}: already aligned.`);
console.log(`Left as written (no global declared value): ${listed.join(", ") || "none"}`);
