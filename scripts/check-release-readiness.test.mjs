import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lineDigest } from "./lib/package-identity-transition.mjs";

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
      { id: candidate.releaseTarget, status: "active", scope: candidate.scope, registry: candidate.registry, access: candidate.access, packages: "all" },
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
