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
// --check re-runs the same rewrite without writing anything, and fails if any
// file would still change. Since the rewrite only ever touches references
// that already carry the declared scope (see the scopedRef comment below),
// that in practice means: a --scope rename was applied only partially — some
// references updated, some missed — and committed that way.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The scope already declared in package-scope.json, read before this
// invocation's --scope (if any) changes it. Every first-party reference in
// the tree is expected to already carry exactly this scope.
const oldScope = config.scope;

// This is a scope RENAME (@oldscope/pkg -> @newscope/pkg), not a scope
// CAPTURE (@anything/pkg -> @newscope/pkg). An earlier version of this
// script did the latter: it matched *any* leading @scope in front of a
// package name pulled from the packages/ directory listing, on the theory
// that restricting to our own package names "keeps third-party dependencies
// untouched." That reasoning had it backwards — a package NAME is not ours
// to claim, a SCOPE is. `@vitest/ui` matched that regex, because `ui` also
// happens to be the name of a package we own, and got rewritten to
// `@vespeneventures/ui` inside package-lock.json — inside vitest's own
// peerDependencies, at a version that does not exist under our scope. Worse,
// `--check` then re-read the already-corrupted file, found nothing left that
// disagreed with its own (wrong) rule, and passed: the gate confirmed its
// own damage (issue #9).
//
// Anchoring on the scope we actually publish under, instead of on whatever
// name follows it, is what "keeps third-party dependencies untouched"
// actually requires: nothing outside our own scope can be ours, no matter
// what the trailing name looks like, so this never needs to know the set of
// package names at all.
//
// oldScope is validated non-empty and npm-legal by the check above, so this
// regex can never degrade into "match anything" the way the old
// package-name alternation could when packages/ was empty (that bug, and
// the packages/-may-not-exist bootstrap dance it required, no longer apply:
// this rewrite doesn't enumerate packages/ to build its pattern, so there is
// nothing here for an empty packages/ directory to break).
const scopedRef = new RegExp(`${escapeRegExp(oldScope)}/([a-z0-9][a-z0-9._-]*)`, "g");

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml"]);

// Directories skipped for reasons that have nothing to do with .gitignore:
// .git is VCS-internal (git never lists itself in its own ignore rules), and
// .github holds CI workflow config this script deliberately never rewrites.
// node_modules and dist are kept here too as a git-independent fallback (see
// below), but they are also declared, correctly, in .gitignore.
//
// Everything ELSE that should be skipped — build output, coverage, and
// critically .claude/, which holds OTHER agents' live worktrees checked out
// locally — used to only be reachable by adding yet another literal string
// to this array. That is the same mistake as the name-based regex above: a
// hardcoded list is a proxy for the real question ("is this part of the
// tree we're allowed to touch?"), and a proxy drifts out of sync with the
// thing it stands in for. It already had: CI never has anything under
// .claude/, so `--check` was green there and red on a contributor's machine,
// and the fix it printed would have overwritten files inside another
// session's live, uncommitted worktree (issue #25).
//
// check-public-safety.mjs already solved this the right way — ask git, which
// has the authoritative answer, instead of hand-maintaining a second copy of
// .gitignore here. Doing the same means a future .gitignore entry, or any
// other directory an agent creates that nobody thought to hardcode, is
// covered automatically instead of silently being walked into. If this isn't
// run inside a git work tree at all, git fails and we fall back to an empty
// ignore set — the four hardcoded names above are what still protects a
// non-git invocation.
const ignored = (() => {
  try {
    const out = execFileSync(
      "git",
      ["-C", repoRoot, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split("\n").filter(Boolean).map((p) => p.replace(/\/$/, "")));
  } catch {
    return new Set(); // not a git work tree — nothing to prune by ignore rules
  }
})();

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".github"].includes(entry)) continue;
    const full = join(dir, entry);
    if (ignored.has(relative(repoRoot, full))) continue;
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
