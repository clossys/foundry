#!/usr/bin/env node
// set-registry — propagate the publishing registry from package-scope.json.
//
//   node scripts/set-registry.mjs [--registry <url>] [--check]
//
// package-scope.json's `registry` field is the single declared source for
// which registry every published package's `publishConfig.registry` must
// point at — the same single-source-of-truth pattern AGENTS.md already
// states for `scope` ("The publishing scope lives in exactly one file"),
// extended to cover the registry too. Nothing else in this repository
// should hardcode a registry URL inside a package manifest.
//
// --check verifies, for every non-private packages/*/package.json:
//   - publishConfig.registry is present, and
//   - it is exactly equal to package-scope.json's declared `registry`
//     (or the `--registry` override, if one is given).
// A missing or mismatched publishConfig.registry is a finding (exit 1).
// Anything that prevents checking at all — package-scope.json missing or
// unparseable, no usable registry to check against, packages/ missing or
// empty, a package.json that will not read or parse — exits 2, distinct
// from both a clean pass (0) and a real finding (1). Same three-state
// contract every gate in this repo uses (see CONTRIBUTING.md's "Gate CLIs
// exit 0/1/2" entry): a check that cannot run must fail, never silently
// pass. `scripts/set-scope.mjs --check`'s own structural verification is
// the direct model for this.
//
// Without --check, this REWRITES every non-private packages/*/package.json
// in place so publishConfig.registry matches the declared registry (or the
// `--registry` override, which also rewrites package-scope.json.registry
// itself — the same shape as set-scope.mjs's `--scope` override updating
// package-scope.json.scope). Each rewrite is a literal string replace of
// the OLD declared registry URL inside that file's own text — never a
// JSON.parse/JSON.stringify round trip — so a package.json's existing
// formatting (a compact single-line publishConfig in some packages,
// multi-line in others) survives exactly as written. A package whose
// publishConfig.registry does not match either the old or the new declared
// value is left untouched and reported as a finding instead of guessed at:
// silently overwriting an already-out-of-sync value would hide the fact
// that it was already wrong.
//
// This script only ever edits text inside this repository. It never talks
// to npm, GitHub Packages, or any other registry, and it never registers a
// scope, an organization, or a trusted publisher — see
// docs/PUBLISHING.md's "Migrating to the public npm registry" runbook for
// the real, owner-only steps that happen outside this repository before
// `registry` here is ever changed to point anywhere else.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repoRoot, "package-scope.json");

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(`set-registry: could not read/parse ${configPath}: ${error.message}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const registryArgIndex = argv.indexOf("--registry");
const nextRegistry = registryArgIndex >= 0 ? argv[registryArgIndex + 1] : config.registry;

if (typeof nextRegistry !== "string" || nextRegistry.length === 0) {
  console.error("set-registry: no registry declared in package-scope.json, and none given via --registry");
  process.exit(2);
}
try {
  const parsed = new URL(nextRegistry);
  if (parsed.protocol !== "https:") throw new Error("not https");
} catch {
  console.error(`set-registry: "${nextRegistry}" is not a valid https:// URL`);
  process.exit(2);
}

// oldRegistry is what package-scope.json declared BEFORE this invocation's
// --registry (if any) changes it — the propagation path needs this to know
// what string it is replacing; --check needs only nextRegistry.
const oldRegistry = config.registry;
if (!check && (typeof oldRegistry !== "string" || oldRegistry.length === 0)) {
  console.error("set-registry: package-scope.json has no existing \"registry\" to propagate from");
  process.exit(2);
}

const packagesDir = join(repoRoot, "packages");
let packageDirs;
try {
  packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(packagesDir, name, "package.json")));
} catch (err) {
  console.error(`set-registry: could not read packages/ (${err.code ?? err.message}) — cannot verify anything is correctly pinned.`);
  process.exit(2);
}
if (packageDirs.length === 0) {
  console.error("set-registry: packages/ contains zero packages — nothing to verify. Refusing to report a pass that checked nothing.");
  process.exit(2);
}

const changed = [];
const findings = [];

for (const name of packageDirs) {
  const pkgJsonPath = join(packagesDir, name, "package.json");
  const pkgJsonRel = relative(repoRoot, pkgJsonPath);
  let raw;
  try {
    raw = readFileSync(pkgJsonPath, "utf8");
  } catch (err) {
    console.error(`set-registry: could not read ${pkgJsonRel}: ${err.code ?? err.message}`);
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`set-registry: could not parse ${pkgJsonRel}: ${err.message}`);
    process.exit(2);
  }

  if (manifest.private === true) continue; // not published — nothing to pin

  const declaredRegistry = manifest.publishConfig?.registry;

  if (check) {
    if (typeof declaredRegistry !== "string" || declaredRegistry.length === 0) {
      findings.push(`  ${pkgJsonRel}: has no publishConfig.registry (expected "${nextRegistry}")`);
    } else if (declaredRegistry !== nextRegistry) {
      findings.push(`  ${pkgJsonRel}: publishConfig.registry is "${declaredRegistry}", expected "${nextRegistry}"`);
    }
    continue;
  }

  if (typeof declaredRegistry !== "string" || declaredRegistry.length === 0) {
    findings.push(`  ${pkgJsonRel}: has no publishConfig.registry to propagate into — add one by hand first`);
    continue;
  }
  if (declaredRegistry === nextRegistry) continue; // already correct

  if (declaredRegistry !== oldRegistry) {
    // Doesn't match what package-scope.json says it used to declare either —
    // already hand-edited out of sync. Report it rather than guess: blindly
    // overwriting would hide that it was already wrong before this ran.
    findings.push(
      `  ${pkgJsonRel}: publishConfig.registry is "${declaredRegistry}", which is neither the old ` +
        `("${oldRegistry}") nor the new ("${nextRegistry}") declared registry — not rewritten, fix by hand`,
    );
    continue;
  }

  const after = raw.split(oldRegistry).join(nextRegistry);
  if (after !== raw) {
    writeFileSync(pkgJsonPath, after);
    changed.push(pkgJsonRel);
  }
}

if (check) {
  if (findings.length) {
    console.error(`set-registry --check: ${findings.length} registry-drift finding(s):`);
    for (const f of findings) console.error(f);
    console.error(`\nrun: node scripts/set-registry.mjs`);
    process.exit(1);
  }
  console.log(`set-registry --check: every published package's publishConfig.registry matches the declared registry (${nextRegistry}).`);
  process.exit(0);
}

if (findings.length) {
  console.error(`set-registry: ${findings.length} finding(s) require a manual fix before this can rewrite cleanly:`);
  for (const f of findings) console.error(f);
  process.exit(1);
}

if (registryArgIndex >= 0 && nextRegistry !== config.registry) {
  writeFileSync(configPath, JSON.stringify({ ...config, registry: nextRegistry }, null, 2) + "\n");
  changed.push("package-scope.json");
}

console.log(
  changed.length
    ? `set-registry: rewrote ${changed.length} file(s) to ${nextRegistry}\n  ${changed.join("\n  ")}`
    : `set-registry: already at ${nextRegistry}; nothing to do.`,
);
