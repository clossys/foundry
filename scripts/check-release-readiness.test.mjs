import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lineDigest } from "./lib/package-identity-transition.mjs";
import { currentQualificationJoins } from "./lib/candidate-qualification.mjs";

// Hermetic end-to-end coverage: every fixture is a real, throwaway git repo
// under mkdtemp, and the real script is spawned exactly the way CI spawns
// it. Nothing here reads this repository's own git history, its own
// packages/, or the network — `npm pack --dry-run` never touches the
// registry, and every `--base` used below is an explicit local sha (or, in
// the one test that exercises the fallback, a local `main` branch this
// fixture creates itself) so nothing depends on an `origin` remote either.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-release-readiness.mjs");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function readManifest(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
}

function writeManifest(pkgDir, manifest) {
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// Builds a single-package fixture repo: package.json (version, files field
// shipping src/ minus test files, README, LICENSE) plus one src file. Does
// NOT commit — the caller decides the commit shape it needs.
function makeFixture(root, { name = "probe", version = "1.0.0", files } = {}) {
  const pkgDir = join(root, name);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeManifest(pkgDir, {
    name: `@gate-fixture/${name}`,
    version,
    private: false,
    license: "MIT",
    files: files ?? ["src", "!src/**/*.test.ts", "README.md", "LICENSE"],
  });
  writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(pkgDir, "src", "index.test.ts"), "test('x', () => {});\n");
  writeFileSync(join(pkgDir, "README.md"), `# ${name}\n`);
  writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
  return pkgDir;
}

function makeIdentityTransitionFixture(root) {
  const pkgDir = join(root, "packages", "probe");
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  mkdirSync(join(root, "governance"), { recursive: true });
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  const current = {
    scope: "@oldscope",
    registry: "https://old-registry.example.invalid",
    access: null,
    repository: "old-owner/source",
    releaseTarget: "old-registry",
  };
  const candidate = {
    scope: "@newscope",
    registry: "https://registry.npmjs.org",
    access: "public",
    repository: "new-owner/platform",
    releaseTarget: "public-npm",
  };
  const policy = {
    $comment: "fixture closed identity transition",
    schemaVersion: 1,
    current,
    candidate,
    historyInventory: "governance/package-identity-history.json",
    historicalPathRules: ["docs/contracts/"],
  };
  const manifest = (identity) => ({
    name: `${identity.scope}/probe`,
    version: "1.0.0",
    private: false,
    license: "MIT",
    files: ["src", "README.md", "LICENSE"],
    repository: { type: "git", url: `git+https://github.com/${identity.repository}.git` },
    bugs: { url: `https://github.com/${identity.repository}/issues` },
    homepage: `https://github.com/${identity.repository}/tree/main/packages/probe#readme`,
    publishConfig: identity.access === null ? { registry: identity.registry } : { registry: identity.registry, access: identity.access },
  });
  const lock = (identity) => ({
    name: "fixture-root",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "fixture-root", version: "1.0.0" },
      [`node_modules/${identity.scope}/probe`]: { resolved: "packages/probe", link: true },
      "packages/probe": { name: `${identity.scope}/probe`, version: "1.0.0" },
    },
  });
  const scopeDocument = (identity) => ({
    $comment: "fixture identity declaration",
    scope: identity.scope,
    registry: identity.registry,
    status: identity === candidate ? "W1D source recut prepared for public npm; publication and provider trust remain inactive until W1E." : "current fixture state",
    ...(identity.access === null ? {} : { access: identity.access }),
  });
  const catalog = {
    schemaVersion: 2,
    defaultTarget: candidate.releaseTarget,
    targets: [
      { id: current.releaseTarget, status: "historical", scope: current.scope, registry: current.registry, packages: "all" },
      { id: candidate.releaseTarget, status: "active", scope: candidate.scope, registry: candidate.registry, access: candidate.access, packages: ["advisor", "starter", "controller"] },
    ],
  };
  const lifecycle = {
    schemaVersion: 1,
    packages: [
      { name: `${candidate.scope}/probe`, status: "active" },
      { name: `${current.scope}/probe`, status: "published" },
    ],
  };
  const lifecycleBytes = `${JSON.stringify(lifecycle, null, 2)}\n`;
  const oldNameLine = lifecycleBytes.split("\n").find((line) => line.includes(`${current.scope}/probe`));
  const history = {
    $comment: "fixture exact historical line",
    schemaVersion: 1,
    references: [{ path: "docs/contracts/package-lifecycle.json", lineSha256: lineDigest(oldNameLine) }],
  };
  writeFileSync(join(root, "governance", "package-identity-transition.json"), `${JSON.stringify(policy, null, 2)}\n`);
  writeFileSync(join(root, "package-scope.json"), `${JSON.stringify(scopeDocument(current), null, 2)}\n`);
  writeManifest(pkgDir, manifest(current));
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(lock(current), null, 2)}\n`);
  writeFileSync(join(root, "governance", "release-catalog.json"), `${JSON.stringify({ schemaVersion: 1, defaultTarget: current.releaseTarget, targets: [] }, null, 2)}\n`);
  writeFileSync(join(root, "governance", "package-identity-history.json"), `${JSON.stringify({ $comment: "fixture", schemaVersion: 1, references: [] }, null, 2)}\n`);
  writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), `${JSON.stringify({ schemaVersion: 1, packages: [{ name: `${current.scope}/probe`, status: "published" }] }, null, 2)}\n`);
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: CI\non: workflow_dispatch\n");
  writeFileSync(join(pkgDir, "src", "index.ts"), `export const packageName = "${current.scope}/probe";\n`);
  writeFileSync(join(pkgDir, "README.md"), `# ${current.scope}/probe\n`);
  writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
  const base = gitCommit(root, "complete current identity");
  const resetCandidate = () => {
    writeFileSync(join(root, "package-scope.json"), `${JSON.stringify(scopeDocument(candidate), null, 2)}\n`);
    writeManifest(pkgDir, manifest(candidate));
    writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(lock(candidate), null, 2)}\n`);
    writeFileSync(join(root, "governance", "release-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
    writeFileSync(join(root, "governance", "package-identity-history.json"), `${JSON.stringify(history, null, 2)}\n`);
    writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), lifecycleBytes);
    writeFileSync(join(pkgDir, "src", "index.ts"), `export const packageName = "${candidate.scope}/probe";\n`);
    writeFileSync(join(pkgDir, "README.md"), `# ${candidate.scope}/probe\n`);
  };
  resetCandidate();
  return { pkgDir, base, current, candidate, manifest, lock, scopeDocument, lifecycle, history, resetCandidate };
}

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withRepo(build) {
  const root = mkdtempSync(join(tmpdir(), "release-readiness-test-"));
  try {
    git(["init", "-q"], root);
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- default (diff) mode

test("default mode: flags content changed since --base with no version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.mode, "diff");
    assert.equal(report.results[0].status, "needs-bump");
    assert.ok(
      report.results[0].changed.includes("modified: src/index.ts"),
      `expected src/index.ts to be reported changed, got ${JSON.stringify(report.results[0].changed)}`,
    );
  });
});

// collect-changesets.mjs validates a changeset's frontmatter package name
// against real packages/<dir> directories on disk (see its own
// discoverPackageDirs()). makeFixture() puts the fixture package directly at
// the repo root (root/probe), not under root/packages/probe, so these two
// tests plant a minimal packages/<name>/package.json stub purely so the
// changeset naming it is recognised as well-formed -- the stub is never
// otherwise read by check-release-readiness.mjs itself.
function stubPackagesDir(root, name) {
  mkdirSync(join(root, "packages", name), { recursive: true });
  writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
}

test("default mode (issue #1255): a pending changeset naming the package is an alternative to a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    stubPackagesDir(root, "probe");
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /pending changeset covers it/);
    assert.match(report.results[0].detail, /probe-fix\.md/);
  });
});

test("default mode (issue #1255): a changeset naming a DIFFERENT package does not rescue the bump requirement", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    stubPackagesDir(root, "probe");
    stubPackagesDir(root, "some-other-package");
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "other-fix.md"), "---\nsome-other-package: patch\n---\n\nUnrelated.\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
  });
});

// issue #1322 item 2: pendingChangesetDetail() used to read the whole
// working tree's .changesets/ with no merge-base filtering, contradicting
// its own header's stated rule ("a changeset added ... in this pull
// request's history"). A changeset already pending on `main` BEFORE this
// PR's merge base -- left over from some unrelated, unmerged PR, or (as
// here) never applied yet from an earlier release -- must not let a packed
// -content change THIS pull request makes ride on someone else's pending
// changeset.
test("default mode (issue #1322 item 2): a changeset that already existed AT the merge base does not satisfy this PR's own packed change", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    stubPackagesDir(root, "probe");
    // The changeset for "probe" is committed as part of the SAME commit
    // this run's --base points at -- it existed at the merge base, not
    // added by the PR under test.
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-preexisting.md"), "---\nprobe: patch\n---\n\nAn earlier, unrelated pending changeset.\n");
    const base = gitCommit(root, "initial release at 1.0.0, with a pre-existing pending changeset");

    // This PR's own change: packed content moves, but it adds no changeset
    // of its own and bumps no version.
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1 -- the pre-existing changeset must not satisfy this PR's own packed change; got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
    assert.doesNotMatch(report.results[0].detail, /pending changeset covers it/);
  });
});

test("default mode (issue #1322 item 2): a changeset added by this PR itself (not present at the merge base) still satisfies the same package's packed change", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    stubPackagesDir(root, "probe");
    const base = gitCommit(root, "initial release at 1.0.0");

    // This PR's own change: packed content moves, AND it adds its own new
    // changeset, committed after the merge base (so it is genuinely part of
    // this PR's own history, not just an uncommitted working-tree file).
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
    gitCommit(root, "fix a bug, deferred to the next release PR");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /pending changeset covers it/);
    assert.match(report.results[0].detail, /probe-fix\.md/);
  });
});

test("default mode: passes content changed since --base alongside a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

test("default mode: passes when only a test file changed since --base (not part of the tarball)", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.test.ts"), "test('x', () => { throw new Error(); });\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

test("default mode: passes when nothing changed since --base", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /no packed-file changes/);
  });
});

test("default mode: passes a package that did not exist yet at --base (newly added package directory)", () => {
  withRepo((root) => {
    // The base commit has some other, unrelated repo content — deliberately
    // no packages/probe at all — so the fixture package is genuinely new
    // relative to `base`, not merely unchanged.
    writeFileSync(join(root, "README.md"), "# repo\n");
    const base = gitCommit(root, "repo scaffold, no packages yet");

    const pkgDir = makeFixture(root);
    gitCommit(root, "add probe package at 1.0.0");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /did not exist at merge-base/);
  });
});

test("default mode: admits only the complete history-aware public identity transition without a version bump", () => {
  withRepo((root) => {
    const fixture = makeIdentityTransitionFixture(root);
    const r = run(["--json", "--base", fixture.base, fixture.pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /exact history-aware W1D identity transition/);
  });
});

test("default mode: arbitrary, partial, unbound, and dependency-drifted renames cannot evade the bump gate", () => {
  const scenarios = [
    ["arbitrary package rename", (root, f) => { const value = readManifest(f.pkgDir); value.name = `${f.candidate.scope}/other`; writeManifest(f.pkgDir, value); }],
    ["partial declaration", (root, f) => writeFileSync(join(root, "package-scope.json"), `${JSON.stringify(f.scopeDocument(f.current), null, 2)}\n`)],
    ["missing history", (root) => writeFileSync(join(root, "governance", "package-identity-history.json"), `${JSON.stringify({ $comment: "fixture", schemaVersion: 1, references: [] }, null, 2)}\n`)],
    ["invalid lifecycle", (root, f) => writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), `${JSON.stringify({ ...f.lifecycle, packages: f.lifecycle.packages.map((entry) => entry.name.startsWith(f.current.scope) ? { ...entry, status: "retired" } : entry) }, null, 2)}\n`)],
    ["manifest-lock dependency mismatch", (_root, f) => { const value = readManifest(f.pkgDir); value.dependencies = { "left-pad": "1.0.0" }; writeManifest(f.pkgDir, value); }],
  ];
  for (const [name, mutate] of scenarios) {
    withRepo((root) => {
      const fixture = makeIdentityTransitionFixture(root);
      mutate(root, fixture);
      const r = run(["--json", "--base", fixture.base, fixture.pkgDir]);
      const report = JSON.parse(r.out);
      assert.equal(r.code, 1, `${name}: expected exit 1, got ${r.code}: ${r.out}`);
      assert.equal(report.results[0].status, "needs-bump", name);
      assert.match(report.results[0].detail, /identity-transition exemption rejected/, name);
    });
  }
});

// This is the regression test for the exact false positive found in review:
// @example/comms was bumped, then edited twice more at the same
// version, then PUBLISHED after those edits. From git history alone that
// looks identical to PR #155's real failure (bump, edit, edit, never
// publish) -- audit mode cannot tell them apart (see next test) and is
// documented as a heuristic for exactly this reason. Default mode does not
// have this problem: a pull request whose merge base is at or after the
// point everything was already assembled sees no diff at all.
test("default mode: the bump-then-edit-then-publish shape (comms) is NOT flagged when the merge base is after the edits", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    gitCommit(root, "bump to 0.1.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    gitCommit(root, "fix 1, forgot to bump (later published anyway)");

    writeFileSync(join(pkgDir, "README.md"), "# probe\n\nnow with more detail\n");
    const publishedTip = gitCommit(root, "fix 2, forgot to bump (this is what 0.1.0 actually shipped)");

    // A later, unrelated pull request branches off AFTER everything above
    // was already assembled (and, in the real story, already published) --
    // its own merge base is `publishedTip`, and it touches nothing here.
    const r = run(["--json", "--base", publishedTip, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

test("default mode: falls back to a local main branch when no --base is given and origin/main does not exist", () => {
  withRepo((root) => {
    // Guarantee a real branch literally named "main" regardless of this
    // host's git init.defaultBranch setting.
    git(["branch", "-M", "main"], root);

    const pkgDir = makeFixture(root);
    gitCommit(root, "initial release at 1.0.0"); // this becomes the tip of main

    git(["checkout", "-q", "-b", "feature"], root);
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    gitCommit(root, "edit on feature, still 1.0.0"); // main does not move

    const r = run(["--json", pkgDir]); // no --base, no origin -- must fall back to local main
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
  });
});

test("default mode: human-readable output names the changed files and prints a clear verdict banner", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--base", base, pkgDir]);
    assert.equal(r.code, 1);
    assert.match(r.out, /BUMP.*@gate-fixture\/probe/);
    assert.match(r.out, /modified: src\/index\.ts/);
    assert.match(r.out, /RELEASE-READINESS FAIL/);
  });
});

test("default mode: dist/ is excluded from the comparison on both sides", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root, { files: ["dist", "src", "!src/**/*.test.ts", "README.md", "LICENSE"] });
    const base = gitCommit(root, "initial release at 1.0.0");

    // dist/ exists only in the working tree (gitignored in the real repo,
    // simply never committed here) — it must never be treated as an "added"
    // file just because history never had it.
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(join(pkgDir, "dist", "index.js"), "export const x = 1;\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

test("default mode: skips a private:true package", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const manifest = readManifest(pkgDir);
    manifest.private = true;
    writeManifest(pkgDir, manifest);
    const base = gitCommit(root, "private package, never published");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "skip");
  });
});

test("default mode: passes gracefully when the repository has no commits at all yet", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root); // deliberately never committed

    const r = run(["--json", pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

// ------------------------------------------------------- devDependencies exemption (issue #269)
//
// Operator decision: a change confined to `devDependencies` does not ship,
// so it is exempt from the version-bump requirement — but ONLY when that is
// the entire change. Every shape here that touches a runtime-relevant field,
// or any file besides package.json, must still require a bump; an exemption
// that accidentally widens past devDependencies-only is worse than the
// Dependabot wedge it exists to fix.

test("default mode: a devDependencies-only package.json change is exempt from the version-bump requirement", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const manifest = readManifest(pkgDir);
    manifest.devDependencies = { typescript: "5.4.0" };
    writeManifest(pkgDir, manifest);
    const base = gitCommit(root, "initial release at 1.0.0, with devDependencies");

    const bumped = readManifest(pkgDir);
    bumped.devDependencies = { typescript: "5.5.0" };
    writeManifest(pkgDir, bumped);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /devDependencies/);
  });
});

test("default mode: a runtime `dependencies` change still requires a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const manifest = readManifest(pkgDir);
    manifest.dependencies = { "left-pad": "1.0.0" };
    writeManifest(pkgDir, manifest);
    const base = gitCommit(root, "initial release at 1.0.0, with a runtime dependency");

    const bumped = readManifest(pkgDir);
    bumped.dependencies = { "left-pad": "1.1.0" };
    writeManifest(pkgDir, bumped);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
    assert.ok(
      report.results[0].changed.includes("modified: package.json"),
      `expected package.json to be reported changed, got ${JSON.stringify(report.results[0].changed)}`,
    );
  });
});

test("default mode: a mixed devDependencies + dependencies change still requires a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const manifest = readManifest(pkgDir);
    manifest.dependencies = { "left-pad": "1.0.0" };
    manifest.devDependencies = { typescript: "5.4.0" };
    writeManifest(pkgDir, manifest);
    const base = gitCommit(root, "initial release at 1.0.0, with runtime and dev dependencies");

    const bumped = readManifest(pkgDir);
    bumped.dependencies = { "left-pad": "1.1.0" };
    bumped.devDependencies = { typescript: "5.5.0" };
    writeManifest(pkgDir, bumped);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
  });
});

test("default mode: a devDependencies bump alongside a source change still requires a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const manifest = readManifest(pkgDir);
    manifest.devDependencies = { typescript: "5.4.0" };
    writeManifest(pkgDir, manifest);
    const base = gitCommit(root, "initial release at 1.0.0, with a devDependency");

    const bumped = readManifest(pkgDir);
    bumped.devDependencies = { typescript: "5.5.0" };
    writeManifest(pkgDir, bumped);
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "needs-bump");
    assert.ok(
      report.results[0].changed.includes("modified: package.json") &&
        report.results[0].changed.includes("modified: src/index.ts"),
      `expected both package.json and src/index.ts reported changed, got ${JSON.stringify(report.results[0].changed)}`,
    );
  });
});

test("default mode: --base pointing at an unresolvable ref is a hard error, not a silent pass", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    gitCommit(root, "initial release at 1.0.0");

    const r = run(["--json", "--base", "not-a-real-ref", pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "error");
    assert.match(report.results[0].detail, /does not resolve/);
  });
});

// ---------------------------------------------------------------------- audit mode

test("--audit: still flags the bump-commit-anchored case (comms shape) that default mode now correctly passes", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    gitCommit(root, "bump to 0.1.0");
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    gitCommit(root, "fix 1, forgot to bump");
    writeFileSync(join(pkgDir, "README.md"), "# probe\n\nnow with more detail\n");
    gitCommit(root, "fix 2, forgot to bump");

    const r = run(["--json", "--audit", pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.equal(report.mode, "audit");
    assert.equal(report.results[0].status, "needs-bump");
    assert.deepEqual(report.results[0].changed, ["modified: README.md", "modified: src/index.ts"]);
    assert.match(report.results[0].detail, /HEURISTIC/);
  });
});

test("--audit: passes a package whose source changed alongside a version bump", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--audit", pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
  });
});

test("--audit: passes a brand-new package with no history yet", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root); // deliberately not committed

    const r = run(["--json", "--audit", pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /no commits yet/);
  });
});

test("--audit and --base together is a usage error (audit ignores merge base entirely)", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    const r = run(["--audit", "--base", base, pkgDir]);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
  });
});

// ------------------------------------------------------------- empty scan (the third state)
//
// Regression coverage for the defect: an empty scan used to print "no
// packages to check." and exit 0 — reporting every package release-ready on
// the strength of having examined none. `packages/` renamed, a glob broken
// in a refactor, or a shallow checkout hiding the directory would all have
// gone green. These tests pin the fix (exit 2, "could not run" — same
// three-state contract `ui-token-check`'s cli.test.ts uses, see its own
// "the third state: could not run" describe block) and then prove the fix
// did not also break the two states that must still work: a real clean pass
// (0) and a real finding (1).

test("default mode: an empty scan (packages/ exists but has no packages inside it) exits 2, never a clean pass", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });

    const r = run([], root); // no positional targets -> falls through to discoverPackages()
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /refusing to report a clean pass on an empty scan/);
  });
});

test("default mode: an empty scan exits 2 in --json mode too, with an error key (not a bare {results: []})", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.ok(
      report.error,
      `a JSON consumer must not be able to read this as success — expected an "error" key, got ${r.out}`,
    );
    assert.match(report.error, /refusing to report a clean pass on an empty scan/);
    assert.deepEqual(report.results, []);
  });
});

test("--audit: an empty scan also exits 2, not 0 — the guard applies in audit mode too", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });

    const r = run(["--json", "--audit"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.ok(report.error, `expected an "error" key in --audit mode too, got ${r.out}`);
    assert.match(report.error, /refusing to report a clean pass on an empty scan/);
  });
});

test("default mode: a genuinely clean run (one real, unchanged package discovered under packages/) still exits 0", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });
    makeFixture(join(root, "packages"));
    const base = gitCommit(root, "initial release at 1.0.0");

    const r = run(["--json", "--base", base], root); // no positional target -> discoverPackages() must find it
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].status, "pass");
  });
});

test("default mode: a real finding (content changed, no version bump) still exits 1 — the fix did not make the gate unable to fail", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });
    const pkgDir = makeFixture(join(root, "packages"));
    const base = gitCommit(root, "initial release at 1.0.0");

    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 2;\n");

    const r = run(["--json", "--base", base], root); // no positional target -> discoverPackages()
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results[0].status, "needs-bump");
  });
});

// -------------------------------------------------------------------- general

test("exits 2 (not 0) with nothing to check when no packages/ directory exists at all and no targets are given", () => {
  withRepo((root) => {
    const r = run([], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /refusing to report a clean pass on an empty scan/);
  });
});

// --------------------------------------- issue #920: the retained-record join
//
// A fixture repo built the same way check-qualification-record-required.test.mjs
// builds one: this repository's OWN governance/release-qualification-policy.json
// is copied in (never re-invented, so the fixture can never drift from what
// the real policy actually declares) and the fixture package is always named
// "writer" against the real "@clossys/writer" policy entry. Unlike that
// script's tests, these never bump the version relative to `--base` — the
// whole point of issue #920 is that this gate must catch a stale record even
// when NOTHING about the diff looks like it needs a bump.

function qualificationFixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "release-readiness-qualification-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(["init", "-q"], root);
  mkdirSync(join(root, "governance"), { recursive: true });
  cpSync("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  mkdirSync(join(root, "governance/release-qualification-adapters", "writer"), { recursive: true });
  writeFileSync(join(root, "governance/release-qualification-adapters/writer/current-direct.json"), JSON.stringify({ fixtures: [] }));
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  const pkgDir = join(root, "packages", "writer");
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeManifest(pkgDir, {
    name: "@clossys/writer",
    version: "0.3.3",
    private: false,
    license: "MIT",
    files: ["src", "!src/**/*.test.ts", "README.md", "LICENSE"],
  });
  writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(pkgDir, "src", "index.test.ts"), "test('x', () => {});\n");
  writeFileSync(join(pkgDir, "README.md"), "# writer\n");
  writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
  return { root, pkgDir };
}

function retainQualificationRecord(root) {
  const joins = currentQualificationJoins(root, { name: "@clossys/writer", version: "0.3.3" });
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  writeFileSync(
    join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"),
    JSON.stringify({ candidate: { packageManifestSha256: joins.packageManifestSha256, packageTreeSha1: joins.packageTreeSha1 } }),
  );
}

test("MUTATION (issue #920): a retained record that has gone stale forces needs-bump even though packed content is unchanged", (t) => {
  const { root, pkgDir } = qualificationFixtureRoot(t);
  gitCommit(root, "initial 0.3.3, not yet qualified");
  // currentQualificationJoins()'s packageTreeSha1 is read from the COMMITTED
  // tree at HEAD (`git rev-parse HEAD:<packageDir>`), even in its default
  // "WORKTREE" mode — so the record must be retained, and every mutation
  // measured against it, with a real commit in between; an uncommitted
  // working-tree edit alone is invisible to it.
  retainQualificationRecord(root); // computed from HEAD as it stands right now
  const base = gitCommit(root, "retain qualification record for 0.3.3");

  // The exact architect-0.1.7 shape: a test-only edit, excluded from packed
  // content by `!src/**/*.test.ts`, with the version left untouched. This
  // gate's own packed-content diff reports nothing changed — but the tree
  // the record was qualified against has now moved.
  writeFileSync(join(pkgDir, "src", "index.test.ts"), "test('x', () => { expect(x).toBe(1); });\n");
  gitCommit(root, "test-only edit (packed content unaffected, but the tree moved)");

  const r = run(["packages/writer", "--json", "--base", base], root);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
  const report = JSON.parse(r.out);
  assert.equal(report.results[0].status, "needs-bump");
  assert.equal(report.results[0].staleRetainedRecord, true);
  assert.match(report.results[0].detail, /no bump required for packed content, but the retained record for 0\.3\.3.*is now stale/);
  assert.match(report.results[0].detail, /packageTreeSha1/);
});

test("(issue #920, other direction) a retained record that still matches the tree leaves an unchanged package clean", (t) => {
  const { root } = qualificationFixtureRoot(t);
  gitCommit(root, "initial 0.3.3, not yet qualified");
  retainQualificationRecord(root); // computed from HEAD as it stands right now
  const base = gitCommit(root, "retain qualification record for 0.3.3");
  // Nothing moves the tree after the record was retained.

  const r = run(["packages/writer", "--json", "--base", base], root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  const report = JSON.parse(r.out);
  assert.equal(report.results[0].status, "pass");
  assert.equal(report.results[0].staleRetainedRecord, undefined);
});

test("(issue #920) a package with no retained record at all is not flagged — an ordinary in-progress package, not a finding", (t) => {
  const { root } = qualificationFixtureRoot(t);
  // No retainQualificationRecord() call at all: this version was simply
  // never qualified yet, which is the ordinary pre-release state, not a
  // stale-record finding.
  const base = gitCommit(root, "0.3.3, never qualified");

  const r = run(["packages/writer", "--json", "--base", base], root);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  const report = JSON.parse(r.out);
  assert.equal(report.results[0].status, "pass");
});
