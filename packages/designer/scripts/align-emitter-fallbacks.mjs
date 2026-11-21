#!/usr/bin/env node
/**
 * Writes the fallback of every `var(--x)` that Designer's block, specimen and token-preview
 * emitters write (CONTAM-U9), through `src/compiled-css/emitter-fallbacks.ts`. No value is typed
 * here; each comes from the declared-fallback reader the generated stylesheet uses.
 *
 * Build Designer first. After writing, regenerate `styles/compiled.css` and `styles/utilities.css`
 * (`npm run generate:compiled-css`): changed class strings change the candidates.
 *
 *   node scripts/align-emitter-fallbacks.mjs [--check]
 * Exit codes: 0 = aligned or written, 1 = a fallback differs (--check), 2 = could not run.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function importDist(file) {
  const path = join(root, "dist", "compiled-css", file);
  if (!existsSync(path)) throw new Error(`Designer is not built: ${path} is missing (run npm run build in packages/designer).`);
  return import(pathToFileURL(path).href);
}

try {
  const { compiledCssDeclaredSources } = await importDist("generate.js");
  const { classifyFallbackReads } = await importDist("declared-fallbacks.js");
  const { alignEmitters, emitterComputedFallbacks } = await importDist("emitter-fallbacks.js");
  const stylesDir = join(root, "styles");
  const sources = compiledCssDeclaredSources(stylesDir);
  const outputCss = readFileSync(join(stylesDir, "compiled.css"), "utf8");
  const results = alignEmitters(root, sources, outputCss);
  const stale = results.filter((r) => r.expected !== r.current);
  if (process.argv.includes("--check")) {
    for (const r of stale) console.error(`${r.file}: a fallback differs from its declared value. Run node scripts/align-emitter-fallbacks.mjs.`);
    if (stale.length > 0) process.exit(1);
    console.log(`${results.length} emitters: every fallback equals its declared value.`);
  } else {
    for (const r of stale) writeFileSync(join(root, r.file), r.expected, "utf8");
    console.log(stale.length > 0 ? `Wrote ${stale.map((r) => r.file).join(", ")}.` : "Already aligned.");
  }
  const listed = new Set();
  const computed = new Set();
  for (const r of results) {
    const own = `${outputCss}\n${r.expected}`;
    for (const read of classifyFallbackReads(r.expected, sources, own)) {
      if (read.kind !== "global" && read.kind !== "tw-property") listed.add(`${read.name} (${read.kind})`);
    }
    for (const c of emitterComputedFallbacks(r.expected, sources, own)) computed.add(`${c.read.name} (${c.registryKey === null ? "computed" : `TOKENS ${c.registryKey}`})`);
  }
  console.log(`Left as written (no global declared value): ${[...listed].sort().join(", ") || "none"}`);
  console.log(`Left as written (fallback computed by code): ${[...computed].sort().join(", ") || "none"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
