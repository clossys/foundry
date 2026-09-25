import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { computeBumpLevel, parseSemver } from "./check-release-pr-shape.mjs";

// Hermetic end-to-end coverage, matching check-release-readiness.test.mjs's
// own real-git-repo-under-mkdtemp shape.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-release-pr-shape.mjs");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

function writeManifest(pkgDir, manifest) {
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function readManifest(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
}

function makeFixture(root, { name = "probe", version = "1.0.0" } = {}) {
  const pkgDir = join(root, "packages", name);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeManifest(pkgDir, { name: `@gate-fixture/${name}`, version, private: false, license: "MIT", files: ["src", "README.md", "LICENSE"] });
  writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(pkgDir, "README.md"), `# ${name}\n`);
  writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
  return pkgDir;
}

// The package changelog lives at docs/changelogs/<dir>.md, outside the
// package (scripts/lib/changelog-location.mjs).
function writeChangelog(pkgDir, text) {
  const path = join(pkgDir, "..", "..", "docs", "changelogs", `${basename(pkgDir)}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
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
  const root = mkdtempSync(join(tmpdir(), "release-pr-shape-test-"));
  try {
    git(["init", "-q"], root);
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- unit coverage

test("parseSemver: parses a plain X.Y.Z, rejects anything else", () => {
  assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
  assert.equal(parseSemver("1.2.3-beta.1"), null);
  assert.equal(parseSemver("v1.2.3"), null);
  assert.equal(parseSemver("1.2"), null);
});

test("computeBumpLevel: classifies patch/minor/major and rejects malformed bumps", () => {
  assert.equal(computeBumpLevel("1.0.0", "1.0.1"), "patch");
  assert.equal(computeBumpLevel("1.0.0", "1.1.0"), "minor");
  assert.equal(computeBumpLevel("1.0.0", "2.0.0"), "major");
  assert.equal(computeBumpLevel("1.0.0", "1.2.0"), null); // skipped a minor
  assert.equal(computeBumpLevel("1.0.0", "1.1.1"), null); // minor bump must reset patch
  assert.equal(computeBumpLevel("1.0.5", "1.0.4"), null); // went backwards
  assert.equal(computeBumpLevel("1.0.0", "1.0.0"), null); // no change
});

// ---------------------------------------------------------------- end-to-end coverage

test("no version change: passes with nothing to judge", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");
    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
  });
});

test("version bump justified by a consumed matching-level changeset passes", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
    const base = gitCommit(root, "pending changeset for probe");

    // The release PR: bump the version and delete the changeset it applied.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-fix.md"));

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /release-PR shaped/);
  });
});

test("version bump with a consumed changeset at the WRONG level fails", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
    const base = gitCommit(root, "pending patch changeset for probe");

    // Bumped a MINOR instead of the patch the changeset named.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.1.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-fix.md"));

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /specify patch/);
  });
});

test("a consumed major-level changeset requires a Breaking changes CHANGELOG section", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-break.md"), "---\nprobe: major\n---\n\nRemoved the deprecated foo() export.\n");
    const base = gitCommit(root, "pending major changeset for probe");

    const manifest = readManifest(pkgDir);
    manifest.version = "2.0.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-break.md"));
    // Deliberately NOT writing a Breaking changes section in docs/changelogs/probe.md.

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /Breaking changes/);
  });
});

test("a consumed major-level changeset WITH a Breaking changes CHANGELOG section passes", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-break.md"), "---\nprobe: major\n---\n\nRemoved the deprecated foo() export.\n");
    const base = gitCommit(root, "pending major changeset for probe");

    const manifest = readManifest(pkgDir);
    manifest.version = "2.0.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-break.md"));
    writeChangelog(
      pkgDir,
      "# Changelog\n\n## 2.0.0 - 2026-09-26\n\n### Breaking changes\n\n- Removed the deprecated foo() export.\n\n- Removed the deprecated foo() export.\n",
    );

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
  });
});

test("version bump with a matching docs/changelogs/<dir>.md entry and no changeset passes (direct-bump path)", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.1\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results[0].status, "pass");
    assert.match(report.results[0].detail, /matching docs\/changelogs\/probe\.md entry/);
  });
});

test("version bump with neither a consumed changeset nor a CHANGELOG entry is refused", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /version change outside a release PR is refused/);
  });
});

test("a pending (still-unconsumed) changeset alongside a direct version bump does not by itself justify it", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "unrelated.md"), "---\nprobe: minor\n---\n\nSome other pending change.\n");
    const base = gitCommit(root, "pending changeset for probe, unrelated to this bump");

    // Bumps the version directly WITHOUT consuming (deleting) the pending changeset.
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
  });
});

test("exits 2 on an empty scan rather than a silent clean pass", () => {
  withRepo((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });
    writeFileSync(join(root, "packages", ".gitkeep"), "");
    gitCommit(root, "empty packages dir");
    const r = run(["--json"], root);
    assert.equal(r.code, 2, r.out);
  });
});

test("a matching entry left in packages/<dir>/CHANGELOG.md no longer justifies a direct bump -- the changelog lives in docs/changelogs/", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    // The entry is written at the retired in-package location only.
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "# Changelog\n\n## 1.0.1\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(report.results[0].status, "not-release-shaped");
    assert.match(report.results[0].detail, /docs\/changelogs\/probe\.md has no entry for 1\.0\.1/);
  });
});

test("a consumed major-level changeset's Breaking changes section is read from docs/changelogs/<dir>.md, not the package", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "probe-break.md"), "---\nprobe: major\n---\n\nRemoved the deprecated foo() export.\n");
    const base = gitCommit(root, "pending major changeset for probe");

    const manifest = readManifest(pkgDir);
    manifest.version = "2.0.0";
    writeManifest(pkgDir, manifest);
    rmSync(join(root, ".changesets", "probe-break.md"));
    writeFileSync(
      join(pkgDir, "CHANGELOG.md"),
      "# Changelog\n\n## 2.0.0 - 2026-09-26\n\n### Breaking changes\n\n- Removed the deprecated foo() export.\n\n- Removed the deprecated foo() export.\n",
    );

    const r = run(["--json", "--base", base, pkgDir]);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(report.results[0].detail, /docs\/changelogs\/probe\.md's entry for 2\.0\.0 has no "### Breaking changes" subsection/);
  });
});

// ---------------------------------------------------------------- lockfile shape (issue #1439, defect 3)
//
// These run the real CLI (main()) with NO positional package argument, so
// `targets` comes from discoverPackages() and covers every packages/<dir> --
// the same shape release-pr.yml's own `node scripts/check-release-pr-shape.mjs
// --base origin/<default>` invocation uses. `cwd: root` is required for that
// discovery to find the fixture's own packages/ directory rather than this
// repository's real one.
//
// The lockfile is judged only in the release-PR case -- when a bump consumed
// a changeset. A direct, changelog-justified bump may legitimately change the
// lockfile (for example by adding a dependency), so it gets no lockfile
// verdict at all and is reported exactly as it was before the check existed.

const lock = (probeVersion, extra = {}) =>
  JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture" }, "packages/probe": { name: "@gate-fixture/probe", version: probeVersion }, ...extra } }, null, 2) + "\n";

// The release PR's own shape: a pending changeset at base, applied (deleted)
// at head alongside the bump.
function releaseBumpProbe(root, pkgDir, { lockfile } = {}) {
  const manifest = readManifest(pkgDir);
  manifest.version = "1.0.1";
  writeManifest(pkgDir, manifest);
  rmSync(join(root, ".changesets", "probe-fix.md"));
  writeChangelog(pkgDir, "# Changelog\n\n## 1.0.1\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");
  if (lockfile !== undefined) writeFileSync(join(root, "package-lock.json"), lockfile);
}

function pendingProbeChangeset(root) {
  mkdirSync(join(root, ".changesets"), { recursive: true });
  writeFileSync(join(root, ".changesets", "probe-fix.md"), "---\nprobe: patch\n---\n\nFix a bug.\n");
}

test("a release-PR-shaped package-lock.json change (only the bumped package's version) does not affect the overall verdict", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    pendingProbeChangeset(root);
    writeFileSync(join(root, "package-lock.json"), lock("1.0.0"));
    const base = gitCommit(root, "initial release at 1.0.0, one pending changeset");
    releaseBumpProbe(root, pkgDir, { lockfile: lock("1.0.1") });

    const r = run(["--json", "--base", base], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    const lockResult = report.results.find((x) => x.package === "package-lock.json");
    assert.ok(lockResult, "expected a package-lock.json entry in the report");
    assert.equal(lockResult.status, "pass", lockResult.detail);
    assert.match(lockResult.detail, /release diff's bumped package\(s\) \(probe\)/);
  });
});

test("a release PR's package-lock.json change that rewrites an UNRELATED entry's metadata alongside a legitimate bump fails the overall check", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    pendingProbeChangeset(root);
    writeFileSync(join(root, "package-lock.json"), lock("1.0.0", { "node_modules/left-pad": { version: "1.3.0", resolved: "https://registry.example/left-pad-1.3.0.tgz" } }));
    const base = gitCommit(root, "initial release at 1.0.0, one pending changeset");
    // The bump itself is fine, but a different npm also rewrote an unrelated
    // third-party entry's resolved URL -- exactly the #1439 defect-3 incident
    // shape (26 stray "peer" flags, 14 dropped "libc" fields from a
    // Node-20-bundled npm regenerating the whole file).
    releaseBumpProbe(root, pkgDir, { lockfile: lock("1.0.1", { "node_modules/left-pad": { version: "1.3.0", resolved: "https://evil.example/left-pad-1.3.0.tgz" } }) });

    const r = run(["--json", "--base", base], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 1, r.out);
    const lockResult = report.results.find((x) => x.package === "package-lock.json");
    assert.ok(lockResult, "expected a package-lock.json entry in the report");
    assert.equal(lockResult.status, "not-release-shaped", lockResult.detail);
    assert.match(lockResult.detail, /A release commit's lockfile may change only as scripts\/apply-release-changesets\.mjs/);
  });
});

test("a direct, changelog-justified bump that also adds a dependency gets no lockfile verdict -- judged exactly as before the lockfile check", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    writeFileSync(join(root, "package-lock.json"), lock("1.0.0"));
    const base = gitCommit(root, "initial release at 1.0.0");

    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    manifest.dependencies = { "added-dep": "^1.0.0" };
    writeManifest(pkgDir, manifest);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.1\n\n- Added a dependency.\n\n## 1.0.0\n\n- Initial release.\n");
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture" }, "packages/probe": { name: "@gate-fixture/probe", version: "1.0.1", dependencies: { "added-dep": "^1.0.0" } }, "node_modules/added-dep": { version: "1.0.0", resolved: "https://registry.example/added-dep-1.0.0.tgz" } } }, null, 2) + "\n",
    );

    const r = run(["--json", "--base", base], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results.find((x) => x.package === "package-lock.json"), undefined, "no lockfile verdict for a direct bump");
    assert.deepEqual(report.results, [{ package: "@gate-fixture/probe", status: "pass", detail: report.results[0].detail }], "only the per-package result, with only its public fields");
    assert.match(report.results[0].detail, /accepted under the pre-existing docs\/PUBLISHING\.md convention/);
  });
});

// Round-2 finding R2-1: apply-release-changesets.mjs's sibling-range pass
// gives a dependent whose range the release breaks a patch bump and a
// `^<new>` range rewrite, with no changeset naming it. That dependent-only
// bump belongs to the same release commit and must justify its own lockfile
// edits (reproduced for real from 4aa89cdd with only `controller: minor`
// pending: controller 0.10.0 plus builder/inspector/publisher patch bumps).
test("a release commit's consumed minor bump plus dependent-only patch bumps with ^range rewrites passes the lockfile check", () => {
  withRepo((root) => {
    const coreDir = makeFixture(root, { name: "core", version: "0.9.0" });
    const depDir = makeFixture(root, { name: "dep", version: "1.0.0" });
    const depManifest = readManifest(depDir);
    depManifest.dependencies = { "@gate-fixture/core": "^0.9.0" };
    writeManifest(depDir, depManifest);
    writeChangelog(coreDir, "# Changelog\n\n## 0.9.0\n\n- Initial release.\n");
    writeChangelog(depDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    mkdirSync(join(root, ".changesets"), { recursive: true });
    writeFileSync(join(root, ".changesets", "core-feature.md"), "---\ncore: minor\n---\n\nA feature.\n");
    const lockAt = (coreVersion, depVersion, depRange) =>
      JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture" }, "packages/core": { name: "@gate-fixture/core", version: coreVersion }, "packages/dep": { name: "@gate-fixture/dep", version: depVersion, dependencies: { "@gate-fixture/core": depRange } } } }, null, 2) + "\n";
    writeFileSync(join(root, "package-lock.json"), lockAt("0.9.0", "1.0.0", "^0.9.0"));
    const base = gitCommit(root, "core 0.9.0, dep 1.0.0 on ^0.9.0, one pending minor changeset for core");

    // What apply-release-changesets.mjs writes: core consumes its changeset
    // (0.9.0 -> 0.10.0); dep's ^0.9.0 no longer covers 0.10.0, so dep gets a
    // patch bump and a ^0.10.0 rewrite with a changelog entry but no changeset.
    const coreManifest = readManifest(coreDir);
    coreManifest.version = "0.10.0";
    writeManifest(coreDir, coreManifest);
    rmSync(join(root, ".changesets", "core-feature.md"));
    writeChangelog(coreDir, "# Changelog\n\n## 0.10.0\n\n- A feature.\n\n## 0.9.0\n\n- Initial release.\n");
    const headDep = readManifest(depDir);
    headDep.version = "1.0.1";
    headDep.dependencies = { "@gate-fixture/core": "^0.10.0" };
    writeManifest(depDir, headDep);
    writeChangelog(depDir, "# Changelog\n\n## 1.0.1\n\n- Track @gate-fixture/core ^0.10.0.\n\n## 1.0.0\n\n- Initial release.\n");
    writeFileSync(join(root, "package-lock.json"), lockAt("0.10.0", "1.0.1", "^0.10.0"));

    const r = run(["--json", "--base", base], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    const lockResult = report.results.find((x) => x.package === "package-lock.json");
    assert.equal(lockResult.status, "pass", lockResult.detail);
    assert.match(lockResult.detail, /release diff's bumped package\(s\) \(core, dep\)/);
  });
});

test("a positional package subset with a changeset-consumed bump and a CHANGED lockfile refuses to judge it (exit 2) rather than judge it against a partial bump set", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    pendingProbeChangeset(root);
    writeFileSync(join(root, "package-lock.json"), lock("1.0.0"));
    const base = gitCommit(root, "initial release at 1.0.0, one pending changeset");
    releaseBumpProbe(root, pkgDir, { lockfile: lock("1.0.1") });

    const r = run(["--json", "--base", base, pkgDir], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 2, r.out);
    assert.equal(report.results[0].status, "pass", "the package's own verdict is unchanged");
    const lockResult = report.results.find((x) => x.package === "package-lock.json");
    assert.equal(lockResult.status, "error");
    assert.match(lockResult.detail, /judged only on a full run -- rerun without positional package arguments/);
    assert.equal(run(["--json", "--base", base], root).code, 0, "the same tree passes on a full run");
  });
});

test("a positional package subset with only a direct bump is judged exactly as before (no lockfile verdict)", () => {
  withRepo((root) => {
    const pkgDir = makeFixture(root);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.0\n\n- Initial release.\n");
    writeFileSync(join(root, "package-lock.json"), lock("1.0.0"));
    const base = gitCommit(root, "initial release at 1.0.0");
    const manifest = readManifest(pkgDir);
    manifest.version = "1.0.1";
    writeManifest(pkgDir, manifest);
    writeChangelog(pkgDir, "# Changelog\n\n## 1.0.1\n\n- Fixed a bug.\n\n## 1.0.0\n\n- Initial release.\n");
    writeFileSync(join(root, "package-lock.json"), lock("1.0.1", { "node_modules/anything": { version: "2.0.0" } }));

    const r = run(["--json", "--base", base, pkgDir], root);
    const report = JSON.parse(r.out);
    assert.equal(r.code, 0, r.out);
    assert.equal(report.results.length, 1);
  });
});
