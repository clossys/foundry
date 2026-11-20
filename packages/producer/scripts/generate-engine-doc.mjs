#!/usr/bin/env node
// Write docs/engine.md from the built engine (dist/engine/doc.js); `--check` exits 1 when the file differs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { engineDoc } from "../dist/engine/doc.js";

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "engine.md");
const text = engineDoc();
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* missing */ }
  if (current !== text) { console.error("docs/engine.md differs from the engine; run npm run generate:engine-doc -w @clossys/producer"); process.exit(1); }
  console.log("docs/engine.md: matches the engine");
} else {
  writeFileSync(target, text);
  console.log("wrote docs/engine.md");
}
