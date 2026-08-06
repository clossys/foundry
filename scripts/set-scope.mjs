#!/usr/bin/env node
// set-scope — propagate the publishing scope from package-scope.json.
//
//   node scripts/set-scope.mjs [--scope @newscope] [--check]
//
// The scope is a single decision that would otherwise be spelled out in every
// package.json, README, import example and doc comment. Keeping it in one file
// and rewriting mechanically means renaming the scope is a one-line edit plus
// this script, not a 30-file find-and-replace done by hand.
//
// --check verifies the tree already matches package-scope.json and exits
// non-zero otherwise. CI runs that so a hand-edited package name cannot drift
// away from the declared scope.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repoRoot, "package-scope.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const scopeArgIndex = argv.indexOf("--scope");
const nextScope = scopeArgIndex >= 0 ? argv[scopeArgIndex + 1] : config.scope;

if (!/^@[a-z0-9][a-z0-9._-]*$/.test(nextScope)) {
  console.error(`set-scope: invalid npm scope: ${nextScope}`);
  console.error(`  expected a leading @ and npm-legal lowercase characters, e.g. @example`);
  process.exit(2);
}

// Any @scope/ prefix currently present on a first-party package name. Matching
// on the known package directory names (rather than any @foo/bar at all) keeps
// third-party dependencies untouched.
//
// packagesDir may not exist at all: git does not track empty directories, so
// a repository with zero packages published so far has no packages/ entry in
// a fresh checkout even though it exists locally wherever someone `mkdir`'d
// it by hand. Treating "missing" the same as "empty" (both -> no package
// names) is required, not optional — this crashed CI outright on first push.
const packagesDir = join(repoRoot, "packages");
const packageNames = existsSync(packagesDir)
  ? readdirSync(packagesDir).filter((entry) => statSync(join(packagesDir, entry)).isDirectory())
  : [];
// With zero packages, joining an empty array produces an empty alternation —
// `(...)` matching zero characters at every position — which turns this into
// "match literally any @scope/anything", not "match nothing". That is a real
// bug, not a hypothetical: it fired on this repo's own scripts, which mention
// unrelated scoped names (test fixtures, illustrative examples) that have
// nothing to do with this repository's own package scope. A null regex that
// can never match is the correct behavior when there is nothing to rewrite.
const scopedRef =
  packageNames.length > 0
    ? new RegExp(`@[a-z0-9][a-z0-9._-]*/(${packageNames.join("|")})\\b`, "g")
    : /(?!)/g;

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".github"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(full))) out.push(full);
  }
  return out;
}

const changed = [];
for (const file of walk(repoRoot)) {
  if (file === configPath) continue;
  const before = readFileSync(file, "utf8");
  const after = before.replace(scopedRef, (_m, pkg) => `${nextScope}/${pkg}`);
  if (after !== before) {
    changed.push(relative(repoRoot, file));
    if (!check) writeFileSync(file, after);
  }
}

if (check) {
  if (changed.length) {
    console.error(`set-scope --check: ${changed.length} file(s) do not match the declared scope ${nextScope}:`);
    for (const f of changed) console.error(`  ${f}`);
    console.error(`\nrun: node scripts/set-scope.mjs`);
    process.exit(1);
  }
  console.log(`set-scope --check: every first-party reference uses ${nextScope}.`);
  process.exit(0);
}

if (scopeArgIndex >= 0 && nextScope !== config.scope) {
  writeFileSync(configPath, JSON.stringify({ ...config, scope: nextScope }, null, 2) + "\n");
  changed.push("package-scope.json");
}

console.log(
  changed.length
    ? `set-scope: rewrote ${changed.length} file(s) to ${nextScope}\n  ${changed.join("\n  ")}`
    : `set-scope: already at ${nextScope}; nothing to do.`,
);
