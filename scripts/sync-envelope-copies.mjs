#!/usr/bin/env node
// sync-envelope-copies — the one generator for a zero-dependency package's
// copy of the shared check-output envelope (issue #1384, building on #1174).
//
// THE RULE. packages/controller/src/envelope.ts is the one canonical source
// of the envelope's TypeScript shape and its constructor,
// `buildCheckOutputEnvelope`. A package that already depends on
// `@clossys/controller` imports it from there. A package with no runtime
// dependencies (most role packages; the reason they keep local copies today)
// does not hand-write a second definition: it carries a GENERATED copy at
// the fixed path `src/generated/check-output-envelope.ts`, produced by this
// script, and scripts/check-package-conformance.mjs compares that copy
// byte-for-byte against what this script produces from the canonical source
// right now. A copy that differs by one byte is a finding in report mode and
// --enforce alike, the same "prose and data never diverge" rule a drifted
// generated loop section already follows (docs/contracts/loop-matrix.json).
//
// THE ONE TRANSFORM. The canonical module imports `GateVerdict` from
// ./gates/result.js, which a copy cannot reach. The generator replaces that
// import (and its re-export) with the literal `GateVerdict` declaration read
// from packages/controller/src/gates/result.ts, so the copy stays
// self-contained and both of its inputs remain single-sourced. If either
// input no longer has the shape this transform expects, generation fails
// loudly rather than producing a copy that silently diverges.
//
//   node scripts/sync-envelope-copies.mjs [--write] [--add <package-dir>] [<repoRoot>]
//
// Default (no flag): check every existing copy under packages/*/ and exit 1
// on drift. --write: regenerate every existing copy in place. --add <dir>:
// create the copy for packages/<dir>/ (implies --write for that package).
// Exit 0 = every copy current (or written). Exit 1 = drift found.
// Exit 2 = the canonical source could not be read or transformed.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const CANONICAL_ENVELOPE_PATH = "packages/controller/src/envelope.ts";
export const CANONICAL_VERDICT_PATH = "packages/controller/src/gates/result.ts";
/** Package-relative path every generated copy lives at. Fixed by convention, not declared, so the gate can find it without a manifest field. */
export const ENVELOPE_COPY_PATH = "src/generated/check-output-envelope.ts";

const IMPORT_BLOCK = 'import type { GateVerdict } from "./gates/result.js";\n\nexport type { GateVerdict };\n';
const VERDICT_DECLARATION = /^export type GateVerdict = [^;\n]+;$/m;

const HEADER = [
  "// GENERATED FILE -- do not edit. A byte-for-byte copy of @clossys/controller's",
  `// ${CANONICAL_ENVELOPE_PATH}, with GateVerdict inlined from`,
  `// ${CANONICAL_VERDICT_PATH}, for a package that has no runtime dependency on`,
  "// @clossys/controller (issue #1384). Relative paths in the comments below refer",
  "// to that package, not this one. The repository's conformance gate fails when",
  "// this file differs from what its generator produces now; regenerate with the",
  "// repository script scripts/sync-envelope-copies.mjs --write (not shipped).",
  "",
].join("\n");

/**
 * Pure: the exact bytes a generated copy must contain, from the two canonical
 * source texts. Throws when either input no longer has the shape the one
 * transform expects.
 */
export function renderEnvelopeCopy(envelopeSource, resultSource) {
  if (!envelopeSource.includes(IMPORT_BLOCK)) {
    throw new Error(`${CANONICAL_ENVELOPE_PATH} no longer carries the GateVerdict import block this generator replaces -- update scripts/sync-envelope-copies.mjs in the same change`);
  }
  const declaration = resultSource.match(VERDICT_DECLARATION);
  if (declaration === null) {
    throw new Error(`${CANONICAL_VERDICT_PATH} no longer declares \`export type GateVerdict = ...;\` on one line -- update scripts/sync-envelope-copies.mjs in the same change`);
  }
  return `${HEADER}${envelopeSource.replace(IMPORT_BLOCK, `${declaration[0]}\n`)}`;
}

/** Reads the two canonical inputs under `root` and renders the copy. Throws when either is missing or malformed. */
export function renderEnvelopeCopyFromRoot(root) {
  const envelopePath = join(root, CANONICAL_ENVELOPE_PATH);
  const resultPath = join(root, CANONICAL_VERDICT_PATH);
  if (!existsSync(envelopePath)) throw new Error(`canonical envelope source not found at ${CANONICAL_ENVELOPE_PATH}`);
  if (!existsSync(resultPath)) throw new Error(`canonical verdict source not found at ${CANONICAL_VERDICT_PATH}`);
  return renderEnvelopeCopy(readFileSync(envelopePath, "utf8"), readFileSync(resultPath, "utf8"));
}

/** Every packages/<dir> that carries a copy today (symlinks and plain files skipped). */
export function listEnvelopeCopies(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && existsSync(join(packagesDir, entry.name, ENVELOPE_COPY_PATH)))
    .map((entry) => entry.name)
    .sort();
}

function main(argv) {
  const write = argv.includes("--write");
  const addIndex = argv.indexOf("--add");
  const addDir = addIndex === -1 ? undefined : argv[addIndex + 1];
  const root = argv.find((value, index) => !value.startsWith("--") && argv[index - 1] !== "--add") ?? join(scriptDir, "..");
  let expected;
  try { expected = renderEnvelopeCopyFromRoot(root); }
  catch (error) { console.error(`sync-envelope-copies: ${error instanceof Error ? error.message : String(error)}`); return 2; }

  const targets = new Set(listEnvelopeCopies(root));
  if (addDir !== undefined) {
    if (!existsSync(join(root, "packages", addDir, "package.json"))) { console.error(`sync-envelope-copies: packages/${addDir}/package.json not found`); return 2; }
    targets.add(addDir);
  }
  let drift = 0;
  for (const dir of [...targets].sort()) {
    const path = join(root, "packages", dir, ENVELOPE_COPY_PATH);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === expected) { console.log(`current  packages/${dir}/${ENVELOPE_COPY_PATH}`); continue; }
    if (write || dir === addDir) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, expected);
      console.log(`wrote    packages/${dir}/${ENVELOPE_COPY_PATH}`);
      continue;
    }
    drift += 1;
    console.log(`DRIFTED  packages/${dir}/${ENVELOPE_COPY_PATH} -- regenerate with --write`);
  }
  if (targets.size === 0) console.log("No package carries a generated envelope copy yet.");
  return drift === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.argv.slice(2));
}
