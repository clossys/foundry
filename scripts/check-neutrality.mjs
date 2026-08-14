#!/usr/bin/env node
// check-neutrality — the extraction gate for shared agent conventions.
//
//   node scripts/check-neutrality.mjs [<package-dir>] [--json]
//
// Exit 0 = clean. Exit 1 = findings. Exit 2 = cannot run.
//
// Material that two parties who do not govern each other both depend on is the
// only thing either can safely share, which is why it ends up published here —
// and a private name pushed to a public remote is cached and indexed whether or
// not it is later deleted.
//
// This gate covers the half of that problem a denylist cannot: STRUCTURE. An
// absolute path or a named directory in someone's home discloses one operator's
// machine layout without containing a single denylisted string, so
// check-public-safety.mjs will never see it. Identity — a person, an account, a
// client — stays that gate's job, and this one deliberately does not duplicate
// the denylist. The two together are the coverage; neither alone is.
//
// The scan itself is not reimplemented here. It is @vespeneventures/conventions'
// own exported `scanNeutrality`, run against the files that package ships. A
// second copy of those regexes in this repository is a second thing to keep in
// agreement with the first, and the failure mode of a drifted copy is a gate
// that passes for the wrong reason.
//
// WHAT THIS ADDS OVER THE PACKAGE'S OWN TESTS
//
// The package's self-hosting test scans every document it DECLARES. This walks
// the shipped directories instead, so a file added to documents/ or adapters/
// but never declared — which still ships, because `files` includes the whole
// directory — is caught rather than silently skipped. Undeclared-but-shipped is
// exactly the shape of thing that reaches a registry unreviewed.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const packageDir = resolve(repoRoot, positional[0] ?? "packages/conventions");

function fail(message) {
  console.error(`check-neutrality: ${message}`);
  process.exit(2);
}

if (!existsSync(packageDir)) fail(`no such directory: ${packageDir}`);

// The built package, not the source. Running the same artifact consumers get is
// the point; a gate that passed against TypeScript a consumer never receives
// would be checking something nobody installs.
const distEntry = join(packageDir, "dist/neutrality.js");
if (!existsSync(distEntry)) {
  fail(
    `${relative(repoRoot, distEntry)} is missing — build the package first (npm run build). ` +
      "This gate deliberately runs the built artifact rather than the source.",
  );
}

const { scanNeutrality } = await import(pathToFileURL(distEntry).href);

// Directories whose entire contents ship as shared material. Everything here is
// read by an outside consumer, so everything here is scanned.
const SHIPPED_DIRECTORIES = ["documents", "adapters"];

function walk(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const candidate = stack.pop();
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      for (const child of readdirSync(candidate)) stack.push(join(candidate, child));
    } else if (stat.isFile()) {
      out.push(candidate);
    }
  }
  return out.sort();
}

const findings = [];

let declared = new Set();
const manifestEntry = join(packageDir, "dist/documents.js");
if (existsSync(manifestEntry)) {
  const module = await import(pathToFileURL(manifestEntry).href);
  declared = new Set([
    ...(module.CONVENTION_DOCUMENTS ?? []).map((d) => d.filename),
    ...(module.CONVENTION_ADAPTERS ?? []).map((a) => a.filename),
  ]);
}

for (const directory of SHIPPED_DIRECTORIES) {
  for (const file of walk(join(packageDir, directory))) {
    const rel = relative(packageDir, file);
    const contents = readFileSync(file, "utf8");

    for (const finding of scanNeutrality(contents)) {
      findings.push({ file: rel, rule: finding.rule, severity: finding.severity, detail: finding.message });
    }

    // A shipped file nothing declares is a file no consumer can discover by
    // API and no test scans by name — but it is in the tarball all the same.
    const basename = rel.split("/").pop();
    if (declared.size > 0 && !declared.has(basename)) {
      findings.push({
        file: rel,
        rule: "neutrality/undeclared-shipped-file",
        severity: "medium",
        detail:
          "ships in a shared directory but is not declared in CONVENTION_DOCUMENTS or CONVENTION_ADAPTERS, so nothing resolves or scans it by name",
      });
    }
  }
}

if (flags.has("--json")) {
  console.log(JSON.stringify({ packageDir: relative(repoRoot, packageDir), findings }, null, 2));
} else {
  const scanned = SHIPPED_DIRECTORIES.map((d) => walk(join(packageDir, d)).length).reduce((a, b) => a + b, 0);
  console.log(
    `check-neutrality: scanned ${scanned} shipped file(s) under ${relative(repoRoot, packageDir)}`,
  );
  for (const finding of findings) {
    console.error(`  [${finding.severity}] ${finding.file} — ${finding.rule}: ${finding.detail}`);
  }
}

if (findings.length > 0) {
  console.error(
    `\nFAIL — ${findings.length} finding(s). Shared material must name no absolute path, ` +
      "no operator-specific home directory, and nothing a single plane owns.",
  );
  process.exit(1);
}

console.log("PASS — shared material names no operator path or home directory.");
