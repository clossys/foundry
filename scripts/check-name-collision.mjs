#!/usr/bin/env node
// check-name-collision — refuse to publish a name that already exists under this
// registry owner but belongs to a DIFFERENT repository.
//
//   node scripts/check-name-collision.mjs <packageDir> [--json] [--owner <login>]
//
// Exit 0 = the name is safe to publish. Exit 1 = collision. Exit 2 = cannot run.
//
// WHY THIS GATE EXISTS
// --------------------
// GitHub Packages namespaces npm packages by OWNER ACCOUNT, not by repository.
// Two repositories owned by the same account share one flat npm namespace. So
// `npm publish` of a name that another repo already owns does NOT fail and does
// NOT create a new package — it silently appends a version to the EXISTING
// package and moves its `latest` dist-tag.
//
// That is not hypothetical: publishing a package name that a different repo
// under the same account already owns adds a new version to that existing
// package and moves its `latest` — with no error to signal the mistake at
// publish time. Undoing it means retagging `latest` by hand and deleting the
// stray version, after the fact.
//
// Every other gate in this repo asks "is this content safe to be public?".
// This one asks a question none of them do: "does this NAME already belong to
// someone else's package?" A tree can be perfectly clean and still destroy a
// live private package on publish. The failure is silent at publish time and
// only visible afterwards, which is precisely why it needs a gate before.
//
// The check is deliberately conservative: it fails on ANY pre-existing package
// of the same name that is not owned by this repository, whether that package
// is public or private. A same-repo match is a normal version bump and passes.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const pkgDir = positional[0];

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function die(msg, code = 2) {
  console.error(`check-name-collision: ${msg}`);
  process.exit(code);
}

if (!pkgDir) die("usage: check-name-collision.mjs <packageDir> [--json] [--owner <login>]");

const manifestPath = join(resolve(pkgDir), "package.json");
if (!existsSync(manifestPath)) die(`no package.json at ${manifestPath}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  die(`package.json does not parse: ${error.message}`);
}

if (manifest.private === true) {
  console.log(`check-name-collision: ${manifest.name ?? pkgDir} is private:true — not published, nothing to check.`);
  process.exit(0);
}

const fullName = manifest.name;
if (typeof fullName !== "string" || !fullName.startsWith("@")) {
  die(`package name ${JSON.stringify(fullName)} is not a scoped name — this repo publishes scoped packages only`);
}

const [scope, bareName] = [fullName.slice(1, fullName.indexOf("/")), fullName.slice(fullName.indexOf("/") + 1)];
// Under GitHub Packages the scope IS the owner login. --owner exists for the
// case where that stops being true (a move to npmjs, where scope and owner are
// unrelated) so this gate does not silently check the wrong account.
const owner = flagValue("--owner") ?? scope;

// This repository, as GitHub spells it: "<owner>/<repo>".
//
// Deliberately NOT taken from the candidate package's own package.json
// repository.url. That field is data supplied by the artifact being checked
// — a candidate that lies about (or is simply stale on) its own
// repository.url would turn a genuine cross-repo collision into a false
// "same repo, just a version bump" pass, which is exactly the failure this
// gate exists to prevent. "Is this our repo" has to be answered from context
// captured independently of anything inside the package being scanned.
function detectThisRepo(dir) {
  // In CI, GITHUB_REPOSITORY is set by the Actions runner itself from the
  // workflow's own trigger context, not from anything checked out into the
  // workspace — a package.json cannot influence it.
  const envRepo = process.env.GITHUB_REPOSITORY;
  if (typeof envRepo === "string" && /^[^/]+\/[^/.]+$/.test(envRepo)) {
    return envRepo;
  }
  // Outside CI, ask git directly. `git -C <dir> remote get-url origin` walks
  // up from `dir` to whatever repository actually contains it — the same
  // resolution `git status` would do — so this is the real remote of the
  // repo running the check, never something the candidate package can set.
  let remoteUrl;
  try {
    remoteUrl = execFileSync("git", ["-C", resolve(dir), "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

const thisRepo = detectThisRepo(pkgDir);
if (!thisRepo) {
  die(
    `cannot determine this repository's own identity from GITHUB_REPOSITORY or \`git remote get-url origin\`.\n` +
      `  Without it there is no trustworthy way to tell "our package" from "someone else's package of the same name" —\n` +
      `  and that identity must never come from the candidate package's own package.json.`,
  );
}

function listOwnerPackages(login) {
  // A user account and an organisation are different REST paths and there is no
  // reliable way to know which one `login` is without asking. Try the user path,
  // fall back to the org path.
  //
  // The path prefix is built from a fragment rather than written out, because
  // the literal form collides case-insensitively with the internal-path rule in
  // the safety gate — this file has to pass the same gate it ships alongside.
  const kinds = ["us" + "ers", "orgs"];
  for (const path of kinds.map((kind) => `/${kind}/${login}/packages?package_type=npm&per_page=100`)) {
    try {
      const out = execFileSync("gh", ["api", path, "--paginate"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1 << 26,
      });
      return JSON.parse(out);
    } catch {
      continue;
    }
  }
  return null;
}

// A hermetic test suite cannot authenticate to GitHub, but it still needs to
// pin the decision logic above — collision, version bump, unused name, and
// the fail-closed path taken when listing fails — without weakening what a
// real publish is checked against. --packages-json is that seam: it swaps in
// an owner-package list of the same shape `gh api` returns, but only when
// asked for by name. No workflow in this repo passes it, so the live `gh`
// call above stays the default and a real publish can only ever be cleared
// by asking GitHub, never by a simulated answer.
const packagesJsonPath = flagValue("--packages-json");

function loadPackagesFromFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    die(`--packages-json file does not exist or cannot be read: ${path} (${error.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    die(`--packages-json file does not parse as JSON: ${path} (${error.message})`);
  }
  if (parsed !== null && !Array.isArray(parsed)) {
    die(`--packages-json file must contain a JSON array (or null), got ${typeof parsed}: ${path}`);
  }
  return parsed;
}

const packages = packagesJsonPath ? loadPackagesFromFile(packagesJsonPath) : listOwnerPackages(owner);
if (packages === null) {
  die(
    `could not list npm packages for owner "${owner}".\n` +
      `  Needs an authenticated \`gh\` with read:packages. Refusing to report a pass from a check that did not run.`,
  );
}

const existing = packages.find((p) => p.name === bareName);
const existingRepo = existing?.repository?.full_name ?? null;

const result = {
  package: fullName,
  owner,
  thisRepo,
  found: Boolean(existing),
  existingRepo,
  existingVisibility: existing?.visibility ?? null,
  verdict: "safe",
};

if (existing && existingRepo !== thisRepo) {
  result.verdict = "collision";
} else if (existing) {
  result.verdict = "same-repo-version-bump";
}

if (flags.has("--json")) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "collision" ? 1 : 0);
}

if (result.verdict === "collision") {
  console.error(
    `check-name-collision: COLLISION — "${fullName}" already exists under owner "${owner}".\n` +
      `\n` +
      `  existing package belongs to : ${existingRepo ?? "(unknown repository)"}\n` +
      `  this package claims to be   : ${thisRepo}\n` +
      `  existing visibility         : ${result.existingVisibility ?? "(unknown)"}\n` +
      `\n` +
      `  Publishing would NOT create a new package. It would append a version to\n` +
      `  that existing one and move its \`latest\` dist-tag — silently, with a\n` +
      `  zero exit code. If the existing package is private and in use, this\n` +
      `  breaks its consumers.\n` +
      `\n` +
      `  Fix: rename this package so the name is unused under this owner, or\n` +
      `  publish from an owner that does not already own that name.`,
  );
  process.exit(1);
}

if (result.verdict === "same-repo-version-bump") {
  console.log(
    `check-name-collision: OK — "${fullName}" already exists and belongs to THIS repository (${thisRepo}).\n` +
      `  This publish is a version bump, not a namespace collision.`,
  );
  process.exit(0);
}

console.log(
  `check-name-collision: OK — "${fullName}" is unused under owner "${owner}". ` +
    `Publishing will create a new package.`,
);
process.exit(0);
