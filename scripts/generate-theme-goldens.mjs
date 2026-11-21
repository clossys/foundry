#!/usr/bin/env node
/**
 * Write (or --check) the theme goldens that only tests read, from the real generators in the
 * built Designer package (build it first: `npm run build -w @clossys/designer`). These bytes are
 * re-captured only through this script, with the reason in the commit; never by hand and never
 * with `vitest -u`.
 *
 * Targets, each with the generator its test compares against:
 *   - designer src/builder/theme/__fixtures__/int2-default.css and
 *     producer src/read/__fixtures__/theme-pins/int2-default.css: `defaultThemeCss()`
 *     (project.test.ts, theme-pins.test.ts);
 *   - designer src/catalog-core/__golden__/foundry-{brand,scales,fonts,theme}.css,
 *     foundry-notices.json and resolved.foundry.json: the shipped-theme profile and
 *     `emit(...)` exactly as emit.golden.test.ts builds them;
 *   - designer src/library-cli/__fixtures__/agent-receipted/: `seedLibrary()` from
 *     src/library-cli/__fixtures__/agent-library.ts (see agent-receipted.md);
 *   - designer src/catalog-bundles.data.json `valueFiles` (theme and asset fills,
 *     catalog/fills/<source>/*.json): sha256 and document re-read from the source file each
 *     entry binds (catalog-bundles.test.ts); every other field is carried through as is.
 *
 *   node scripts/generate-theme-goldens.mjs [--check]
 *
 * --check writes nothing and exits 1 naming every stale target.
 */
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const designer = join(repo, "packages", "designer");
const producer = join(repo, "packages", "producer");
const dist = join(designer, "dist");
const check = process.argv.includes("--check");

const { defaultThemeCss } = await import(join(dist, "builder", "theme", "index.js"));
const { applyLibraryChange, libraryHash, emit, loadCatalog, resolve: resolveProfile, stableStringify } = await import(join(dist, "catalog-core", "index.js"));
const { seedLibrary } = await import(join(dist, "library-cli", "__fixtures__", "agent-library.js"));

/** path -> expected bytes, for every single-file target. */
const expected = new Map();

// 1. The package default theme (both int2-default.css goldens).
const theme = defaultThemeCss();
expected.set(join(designer, "src", "builder", "theme", "__fixtures__", "int2-default.css"), theme);
expected.set(join(producer, "src", "read", "__fixtures__", "theme-pins", "int2-default.css"), theme);

// 2. The catalog emit goldens: the same shipped profile emit.golden.test.ts builds.
{
  const catalog = loadCatalog();
  let library = { source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED", extends: "foundry" }, fills: [], adoptedAt: "2026-10-23" };
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: catalog.fills.map(fill => fill.$extensions["com.clossys.fill"]).filter(meta => meta.slot.startsWith("themes.")).map(meta => ({ op: "adopt", slot: meta.slot, source: meta.source })) });
  const resolved = resolveProfile({ catalog, library });
  const profile = { ...resolved, baseline: Object.fromEntries(Object.values(resolved.members).filter(m => m.emit).map(m => [m.emit, { ...m.css }])) };
  const golden = join(designer, "src", "catalog-core", "__golden__");
  for (const file of emit(profile, ["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"])) expected.set(join(golden, `foundry-${file.path}`), file.contents);
  expected.set(join(golden, "resolved.foundry.json"), stableStringify(profile));
}

// 3. catalog-bundles.data.json valueFiles: every entry bound to its source bytes.
{
  const path = join(designer, "src", "catalog-bundles.data.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const file of data.valueFiles) {
    const bytes = readFileSync(join(designer, "src", file.path), "utf8");
    file.sha256 = createHash("sha256").update(bytes, "utf8").digest("hex");
    file.document = JSON.parse(bytes);
  }
  expected.set(path, `${JSON.stringify(data, null, 2)}\n`);
}

// 4. The agent-receipted fixture directory: seeded into a scratch root, compared file by file.
const receipted = join(designer, "src", "library-cli", "__fixtures__", "agent-receipted");
const walk = (root, dir = root, out = new Map()) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(root, path, out);
    else out.set(relative(root, path), readFileSync(path, "utf8"));
  }
  return out;
};
{
  const scratch = join(mkdtempSync(join(tmpdir(), "theme-goldens-")), "library");
  await seedLibrary(scratch);
  const seeded = walk(scratch);
  const current = walk(receipted);
  for (const [name, bytes] of seeded) expected.set(join(receipted, name), bytes);
  for (const name of current.keys()) if (!seeded.has(name)) expected.set(join(receipted, name), null);
}

const stale = [];
for (const [path, bytes] of expected) {
  let current = null;
  try { current = readFileSync(path, "utf8"); } catch { current = null; }
  if (current === bytes) continue;
  stale.push(relative(repo, path));
  if (check) continue;
  if (bytes === null) unlinkSync(path);
  else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, "utf8"); }
}
if (check && stale.length) {
  console.error(`Theme goldens are stale; run node scripts/generate-theme-goldens.mjs:\n${stale.map(path => `  ${path}`).join("\n")}`);
  process.exit(1);
}
console.log(`Theme goldens: ${expected.size} files ${check ? "current" : stale.length ? `written (${stale.length} changed)` : "already current"}`);
