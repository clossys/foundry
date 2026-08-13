import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
  return JSON.parse(execFileSync("cat", [join(pkgDir, "package.json")], { encoding: "utf8" }));
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

// This is the regression test for the exact false positive found in review:
// @vespeneventures/comms was bumped, then edited twice more at the same
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

// -------------------------------------------------------------------- general

test("exits 0 with nothing to check when no packages/ directory exists and no targets are given", () => {
  withRepo((root) => {
    const r = run([], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });
});
