/**
 * Write (or --check) src/catalog-core/component-source-proofs.json: the real
 * TypeScript AST reading of every stock component source in the offline source
 * bundles, keyed by script kind and the sha256 of the exact bytes. Build Designer
 * first (for the catalog bundles); the reader is scripts/lib/component-source-ast.mjs. A stock source the AST refuses fails this generator; it is never skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { loadCatalogBundles } = await import("../dist/catalog-bundles.js");
const { componentSourceProofs } = await import("./lib/component-source-ast.mjs");

const files = loadCatalogBundles().sourceBundles.flatMap(bundle => bundle.files);
const table = componentSourceProofs(files);
const content = JSON.stringify(table, null, 2) + "\n";
const target = resolve(root, "src/catalog-core/component-source-proofs.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content) throw new Error("Component source proofs are stale: run node scripts/generate-component-source-proofs.mjs");
  console.log(`Component source proofs: ${Object.keys(table.proofs).length} current`);
} else {
  writeFileSync(target, content);
  console.log(`Component source proofs: ${Object.keys(table.proofs).length} written`);
}
