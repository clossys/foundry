#!/usr/bin/env node
// preflight-package — the single command that must pass before a publish is
// even proposed.
//
//   node scripts/preflight-package.mjs <packageDir> [--require-denylist] [--denylist <file>]
//
// Exit 0 = every gate passed. Exit 1 = at least one gate failed. Exit 2 = a gate
// could not run (which is a failure, not a skip).
//
// The gates are deliberately ordered cheapest-and-most-catastrophic first:
//
//   1. name collision   — the only failure that damages something OTHER than
//                         this package. Under GitHub Packages the npm namespace
//                         is per-OWNER, so publishing a name another repo owns
//                         appends a version to THAT package and moves its
//                         `latest`, silently and with a zero exit code. This
//                         runs first because it is the one mistake that cannot
//                         be undone by fixing this repo.
//   2. denylist quality — grades the rules themselves. Every later gate is only
//                         as good as this data; a denylist that matches nothing
//                         makes the whole run a green no-op.
//   3. gate regression  — proves the gates still catch planted contamination.
//   4. tree safety      — the repository as committed.
//   5. artifact safety  — the packed tarball, which is the thing that actually
//                         ships and is NOT the same set of files as the tree.
//   6. README parity    — the README's promises about the public surface
//                         (documented exports, working import examples)
//                         checked against reality.
//   7. contamination classes — the structural, non-denylist-able tells (CI's
//                         "prose" job order: README parity, then this).
//
// Nothing here publishes, pushes, or mutates registry state. An explicit
// --denylist is forwarded to every gate that reads policy, so quality,
// tree-safety and artifact-safety cannot silently grade different files.

import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const pkgDir = argv.filter((a) => !a.startsWith("--"))[0];
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (!pkgDir) {
  console.error("usage: preflight-package.mjs <packageDir> [--require-denylist] [--denylist <file>]");
  process.exit(2);
}
const absPkgDir = resolve(pkgDir);
if (!existsSync(join(absPkgDir, "package.json"))) {
  console.error(`preflight: no package.json at ${absPkgDir}`);
  process.exit(2);
}

const strict = flags.has("--require-denylist") ? ["--require-denylist"] : [];
const denylistPath = flagValue("--denylist");
if (argv.includes("--denylist") && (!denylistPath || denylistPath.startsWith("--"))) {
  console.error("usage: preflight-package.mjs <packageDir> [--require-denylist] [--denylist <file>]");
  process.exit(2);
}
const denylist = denylistPath ? ["--denylist", denylistPath] : [];

const gates = [
  { name: "name collision", argv: [join(scriptDir, "check-name-collision.mjs"), absPkgDir] },
  { name: "denylist quality", argv: [join(scriptDir, "check-denylist-quality.mjs"), ...denylist] },
  { name: "gate regression tests", argv: [join(scriptDir, "test-gates.mjs")] },
  { name: "tree safety", argv: [join(scriptDir, "check-public-safety.mjs"), repoRoot, "--allow-changelogs", ...strict, ...denylist] },
  { name: "artifact safety", argv: [join(scriptDir, "check-artifact-safety.mjs"), absPkgDir, ...strict, ...denylist] },
  { name: "README parity", argv: [join(scriptDir, "check-readme-parity.mjs"), absPkgDir] },
  { name: "contamination classes", argv: [join(scriptDir, "check-contamination-classes.mjs"), absPkgDir] },
];

const results = [];
for (const gate of gates) {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", gate.argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    code = error.status ?? 1;
    out = (error.stdout ?? "") + (error.stderr ?? "");
  }
  results.push({ ...gate, code, out });
  const status = code === 0 ? "PASS" : code === 2 ? "ERROR" : "FAIL";
  console.log(`\n${"=".repeat(72)}\n== ${status}  ${gate.name}\n${"=".repeat(72)}`);
  console.log(out.trim());
}

console.log(`\n${"=".repeat(72)}\n== preflight summary\n${"=".repeat(72)}`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? "PASS " : r.code === 2 ? "ERROR" : "FAIL "}  ${r.name}`);
}

const worst = results.reduce((a, r) => (r.code === 2 ? 2 : r.code !== 0 && a !== 2 ? 1 : a), 0);
console.log(
  worst === 0
    ? "\npreflight PASSED — this package may be proposed for publish.\n" +
        "A merged version change is released by the repository's automated workflow; a green preflight is a required local precondition, not publication evidence."
    : "\npreflight FAILED — do not publish.",
);
process.exit(worst);
