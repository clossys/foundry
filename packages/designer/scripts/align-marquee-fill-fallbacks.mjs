/**
 * Rewrites the token reads in the two marquee theme fills (CONTAM-U12, revision animate-marquee-v3)
 * so each `var(--x)` carries its declared value as fallback: `var(--duration)` becomes
 * `var(--duration, <declared>)`. The value is read by the U1 declared-fallback reader
 * (`globalDeclaredFallback` and `alignDeclaredFallbacks` in src/compiled-css/declared-fallbacks.ts)
 * over the same declared sources compiled.css uses; none is typed here. A read with no global
 * declaration refuses (UndeclaredTokenFallbackError) and nothing is written.
 * Build Designer first, then regenerate the theme goldens (node ../../scripts/generate-theme-goldens.mjs).
 *
 *   node scripts/align-marquee-fill-fallbacks.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { compiledCssDeclaredSources } = await import("../dist/compiled-css/generate.js");
const { alignDeclaredFallbacks, globalDeclaredFallback } = await import("../dist/compiled-css/declared-fallbacks.js");

const stylesDir = resolve(root, "styles");
const output = readFileSync(resolve(stylesDir, "compiled.css"), "utf8");
const sources = compiledCssDeclaredSources(stylesDir);
const declared = globalDeclaredFallback(sources, output);
const check = process.argv.includes("--check");

/** Every name read by `var(` in `text`, each required to have a global declared value. */
const align = (text) => {
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) declared(match[1]);
  return alignDeclaredFallbacks(text, sources, output);
};

const stale = [];
for (const slot of ["animate-marquee", "animate-marquee-vertical"]) {
  const path = resolve(root, "src", "catalog", "fills", "foundry", `themes.${slot}.json`);
  const current = readFileSync(path, "utf8");
  const doc = JSON.parse(current);
  const member = doc.themes[slot].default;
  member.$extensions["com.clossys.css"].raw = align(member.$extensions["com.clossys.css"].raw);
  member.$value = align(member.$value);
  const expected = `${JSON.stringify(doc, null, 2)}\n`;
  if (expected === current) continue;
  stale.push(path);
  if (!check) writeFileSync(path, expected, "utf8");
  console.log(`${check ? "Stale" : "Wrote"} ${path}: ${member.$value}`);
}
if (check && stale.length) {
  console.error("A marquee fill read differs from its declared fallback. Run node scripts/align-marquee-fill-fallbacks.mjs.");
  process.exit(1);
}
if (!stale.length) console.log("Marquee fills: every read carries its declared fallback.");
