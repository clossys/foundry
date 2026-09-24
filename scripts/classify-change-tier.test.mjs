import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";
import { classifyChangeTier, classifyPath } from "./classify-change-tier.mjs";

// Two layers, the same split scripts/check-touches-packages.test.mjs uses:
// a pure-function table (fast, no subprocess, exhaustive over the boundary
// and the odd paths) and a small set of hermetic real-git-repo CLI runs
// (proves the environment plumbing -- GITHUB_EVENT_NAME, BASE_SHA,
// $GITHUB_OUTPUT, the fail-closed branches -- actually works end to end).

// ---------------------------------------------------------------------
// Pure classifier: the tier boundary table.
// ---------------------------------------------------------------------

test("classifyPath: every tier boundary", () => {
  const table = [
    // .changesets/*.md -- one level only.
    [".changesets/foo-bar.md", "prose"],
    [".changesets/README.md", "prose"],
    // A TOP-LEVEL docs/*.md file -- prose.
    ["docs/RELEASING.md", "prose"],
    ["docs/PUBLISHING.md", "prose"],
    // docs/changelogs/** -- any depth -- prose.
    ["docs/changelogs/advisor.md", "prose"],
    ["docs/changelogs/nested/advisor.md", "prose"],
    // docs/contracts/** is EXCLUDED from prose (review round 1, #1420):
    // machine-read contracts, not human-only prose. Every example a
    // reviewer cited by name, each forcing 'full'.
    ["docs/contracts/kit-presets.json", "full"], // packages/advisor/scripts/pack-capability-catalogue.mjs reads it and packs it into advisor's tarball
    ["docs/contracts/package-evidence.json", "full"], // graded by scripts/check-package-evidence.mjs, the required `package state` gate
    ["docs/contracts/conversation-contract.md", "full"], // packed into launcher's own tarball by packages/launcher/scripts/pack-skills.mjs
    ["docs/contracts/role-loop-archetypes.json", "full"], // read by scripts/check-role-loop-archetypes.mjs, the required `role-loop archetypes` gate
    ["docs/contracts/trust-statement.md", "full"], // scanned by scripts/check-permission-defaults.mjs inside `role-loop archetypes`
    // docs/LIFECYCLE.md is excluded too: scripts/check-package-evidence.mjs
    // reads and diffs it against docs/contracts/package-evidence.json (the
    // `lifecycle-position-table-drift` finding) -- same required gate as
    // package-evidence.json above, so it cannot be prose either.
    ["docs/LIFECYCLE.md", "full"],
    // A near-miss of the docs/LIFECYCLE.md exclusion: only the exact
    // top-level file is excluded, not a file merely containing that name.
    ["docs/LIFECYCLE-DRAFT.md", "prose"],
    // A nested path can never match the top-level docs/*.md pattern at all
    // (by construction, independent of the docs/contracts/LIFECYCLE.md
    // exclusions above) -- any unrecognised docs/ subdirectory defaults to
    // 'full', never a guessed 'prose'.
    ["docs/a/b/c/deep.md", "full"],
    ["docs/architecture/deep.md", "full"],
    // A root-level *.md file only -- no subdirectory.
    ["AGENTS.md", "prose"],
    ["CONTRIBUTING.md", "prose"],
    ["README.md", "prose"],
    // A package's own README or packed skill.
    ["packages/advisor/README.md", "packed-prose"],
    ["packages/strategist/skill/SKILL.md", "packed-prose"],
    // Everything else, including near-misses of the patterns above.
    ["packages/advisor/src/index.ts", "full"],
    ["packages/advisor/package.json", "full"],
    // A CHANGELOG nested one level deeper than .changesets/*.md's own
    // single-level glob does not match it.
    [".changesets/nested/deep.md", "full"],
    // A root file that is not Markdown.
    ["package.json", "full"],
    ["package-lock.json", "full"],
    // A README that is not directly under packages/<pkg>/ (one level
    // deeper) does not match the packed-prose pattern.
    ["packages/advisor/docs/README.md", "full"],
    // A skill file that is not the package's own top-level skill/SKILL.md.
    ["packages/advisor/skill/other.md", "full"],
    // A file merely named similarly to docs/ but not inside it.
    ["docsish/README.md", "full"],
    // .github/workflows/ci.yml itself must never read as prose -- it is
    // the file defining this very skip.
    [".github/workflows/ci.yml", "full"],
  ];
  for (const [path, expected] of table) {
    assert.equal(classifyPath(path), expected, `classifyPath(${JSON.stringify(path)})`);
  }
});

test("classifyChangeTier: table over combinations, renames, deletions, and moves", () => {
  const table = [
    // All-prose diffs stay 'prose'.
    [["docs/RELEASING.md", ".changesets/foo.md", "AGENTS.md"], "prose"],
    // A single packed-prose path alongside otherwise-prose paths widens to
    // 'packed-prose', never narrows back to 'prose'.
    [["docs/RELEASING.md", "packages/advisor/README.md"], "packed-prose"],
    [["packages/advisor/README.md", "packages/strategist/skill/SKILL.md"], "packed-prose"],
    // One non-prose path anywhere forces 'full', even alongside many prose
    // paths.
    [["docs/RELEASING.md", "packages/advisor/src/index.ts"], "full"],
    [["packages/advisor/README.md", "packages/advisor/src/index.ts"], "full"],
    // A rename/move, modelled the way `git diff --no-renames` reports it:
    // BOTH the deleted old path and the added new path appear as their own
    // entries in the same diff. A file moved from packages/ to docs/ must
    // not read as prose merely because its new location does -- the
    // deleted old path (real source) forces 'full'.
    [["packages/advisor/src/legacy.ts", "docs/legacy.md"], "full"],
    // A deletion of a prose file, with nothing else changed, stays 'prose'
    // -- classifyChangeTier only sees paths, never statuses, so a deleted
    // docs file classifies identically to an added or modified one.
    [["docs/RETIRED.md"], "prose"],
    // A deletion of a non-prose file still forces 'full'.
    [["packages/advisor/src/legacy.ts"], "full"],
    // An empty list and a non-array input are both detection failures, not
    // "nothing changed" -- fail closed to 'full'.
    [[], "full"],
  ];
  for (const [paths, expected] of table) {
    assert.equal(classifyChangeTier(paths), expected, `classifyChangeTier(${JSON.stringify(paths)})`);
  }
  assert.equal(classifyChangeTier(undefined), "full");
  assert.equal(classifyChangeTier(null), "full");
});

// ---------------------------------------------------------------------
// CLI: hermetic real-git-repo fixtures, modelled on
// scripts/check-touches-packages.test.mjs's own fixture shape.
// ---------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptDir, "classify-change-tier.mjs");
const workflowPath = resolve(scriptDir, "..", ".github", "workflows", "ci.yml");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function makeRepo(t) {
  const dir = makeTmpDirSync(t, "classify-change-tier-");
  git(["init", "-q", "-b", "main"], dir);
  mkdirSync(join(dir, "packages", "probe", "src"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "packages", "probe", "package.json"), '{"name":"probe","version":"1.0.0"}\n');
  writeFileSync(join(dir, "packages", "probe", "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "packages", "probe", "README.md"), "# probe\n");
  writeFileSync(join(dir, "package.json"), '{"name":"root","private":true}\n');
  writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n");
  writeFileSync(join(dir, "AGENTS.md"), "# agents\n");
  const baseSha = gitCommit(dir, "base");
  return { dir, baseSha };
}

function runClassifier(dir, { baseSha, eventName = "pull_request" } = {}) {
  const outputFile = join(dir, ".github-output");
  writeFileSync(outputFile, "");
  let stdout;
  let exitStatus = 0;
  try {
    stdout = execFileSync("node", [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        BASE_SHA: baseSha ?? "",
        GITHUB_OUTPUT: outputFile,
      },
    });
  } catch (error) {
    exitStatus = typeof error.status === "number" ? error.status : 1;
    stdout = error.stdout ?? "";
  }
  const outputText = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
  const matches = [...outputText.matchAll(/^tier=(.+)$/gm)];
  const tier = matches.length > 0 ? matches[matches.length - 1][1] : undefined;
  return { exitStatus, stdout, tier };
}

test("CLI: the script itself always exits 0 -- it is a router, never a gate", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n\nUpdated.\n");
  gitCommit(dir, "docs only");
  const { exitStatus } = runClassifier(dir, { baseSha });
  assert.equal(exitStatus, 0);
});

test("CLI: a docs-only change reports tier=prose", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n\nUpdated wording.\n");
  writeFileSync(join(dir, "AGENTS.md"), "# agents\n\nUpdated.\n");
  gitCommit(dir, "docs and root markdown only");
  const { tier } = runClassifier(dir, { baseSha });
  assert.equal(tier, "prose");
});

test("CLI: a package README-only change reports tier=packed-prose", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "packages", "probe", "README.md"), "# probe\n\nUpdated.\n");
  gitCommit(dir, "package readme only");
  const { tier } = runClassifier(dir, { baseSha });
  assert.equal(tier, "packed-prose");
});

test("CLI: a source change alongside docs reports tier=full", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "packages", "probe", "src", "index.ts"), "export const x = 2;\n");
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n\nUpdated.\n");
  gitCommit(dir, "source and docs");
  const { tier } = runClassifier(dir, { baseSha });
  assert.equal(tier, "full");
});

// A file genuinely MOVED from packages/ to docs/ -- git's own rename
// heuristic would collapse this into one line ("packages/probe/src/
// index.ts => docs/index.md") without --no-renames. The classifier must
// still see the deleted source half and report 'full'.
test("CLI: a file moved from packages/ to docs/ reports tier=full, not prose", (t) => {
  const { dir, baseSha } = makeRepo(t);
  const from = join(dir, "packages", "probe", "src", "index.ts");
  const to = join(dir, "docs", "index.md");
  const content = readFileSync(from, "utf8");
  rmSync(from);
  writeFileSync(to, content);
  gitCommit(dir, "move source into docs");
  const { tier } = runClassifier(dir, { baseSha });
  assert.equal(tier, "full");
});

// A deletion of a prose-only file, with nothing else touched, must still
// report 'prose' -- classification is path-based, not status-based.
test("CLI: deleting a docs file only reports tier=prose", (t) => {
  const { dir, baseSha } = makeRepo(t);
  rmSync(join(dir, "docs", "GUIDE.md"));
  gitCommit(dir, "remove a doc");
  const { tier } = runClassifier(dir, { baseSha });
  assert.equal(tier, "prose");
});

test("CLI control (a): an unresolvable BASE_SHA is a detection failure -- reports tier=full, still exits 0", (t) => {
  const { dir } = makeRepo(t);
  const { exitStatus, tier, stdout } = runClassifier(dir, { baseSha: "0000000000000000000000000000000000dead" });
  assert.equal(exitStatus, 0, "must never fail the job");
  assert.equal(tier, "full", "an unresolvable base must fail SAFE (run everything), never a narrower tier");
  assert.match(stdout, /did not resolve/);
});

test("CLI control (b): an empty diff against the merge base (HEAD == base) is treated as a detection failure -- reports tier=full", (t) => {
  const { dir, baseSha } = makeRepo(t);
  const { exitStatus, tier, stdout } = runClassifier(dir, { baseSha });
  assert.equal(exitStatus, 0);
  assert.equal(tier, "full");
  assert.match(stdout, /zero changed paths/);
});

test("CLI control (c): a non-pull_request/merge_group event (push to main) always reports tier=full", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n\nUpdated.\n");
  gitCommit(dir, "docs only, but on push");
  const { tier } = runClassifier(dir, { baseSha, eventName: "push" });
  assert.equal(tier, "full");
});

test("CLI control (d): a merge_group event is classified the same as pull_request", (t) => {
  const { dir, baseSha } = makeRepo(t);
  writeFileSync(join(dir, "docs", "GUIDE.md"), "# guide\n\nUpdated.\n");
  gitCommit(dir, "docs only, merge_group");
  const { tier } = runClassifier(dir, { baseSha, eventName: "merge_group" });
  assert.equal(tier, "prose");
});

test("CLI control (e): a missing BASE_SHA (empty string) reports tier=full", (t) => {
  const { dir } = makeRepo(t);
  const { tier } = runClassifier(dir, { baseSha: "" });
  assert.equal(tier, "full");
});

// ---------------------------------------------------------------------
// Workflow wiring: this job must actually feed ci.yml, or none of the
// above proves anything about what CI does.
// ---------------------------------------------------------------------

test("the classify job exists, is fail-closed by default, and outputs tier", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /^  classify:\n    name: classify change tier$/m);
  assert.match(workflow, /outputs:\n\s+tier: \$\{\{ steps\.classify\.outputs\.tier \}\}/);
  assert.match(workflow, /run: node scripts\/classify-change-tier\.mjs/);
});
