import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "agent-cloud.mjs");

const withFixture = (packageJson, lockfile, run) => {
  const root = mkdtempSync(`${tmpdir()}/foundry-cloud-check-`);
  try {
    writeFileSync(`${root}/AGENTS.md`, "# fixture\n");
    writeFileSync(`${root}/package.json`, JSON.stringify(packageJson));
    if (lockfile) writeFileSync(`${root}/package-lock.json`, JSON.stringify(lockfile));
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const check = (root) => execFileSync(process.execPath, [scriptPath, "check"], { cwd: root, encoding: "utf8", stdio: "pipe" });

// issue #823: a shallow clone (the default right after `git clone` in a
// cloud/agent sandbox) truncates git history that check:package-evidence
// depends on. `withFixture` above never initializes a git repo at all, so it
// cannot exercise this — `git rev-parse --is-shallow-repository` fails
// outright there (no `.git`), which this module treats as "not shallow" and
// steps aside, exactly as it should for an unrelated condition. These fixtures
// build a real, tiny two-commit origin repo and shallow-clone it, the same
// way `git clone` (without `--depth`) never would, so the shallow flag is
// genuinely `true` — a real reproduction, not a mock.
const withShallowGitFixture = (packageJson, lockfile, run) => {
  const origin = mkdtempSync(`${tmpdir()}/foundry-cloud-origin-`);
  const clonePath = `${tmpdir()}/foundry-cloud-shallow-${process.pid}-${Date.now()}`;
  try {
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: origin });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: origin });
    execFileSync("git", ["config", "user.name", "fixture"], { cwd: origin });
    writeFileSync(`${origin}/first.txt`, "first\n");
    execFileSync("git", ["add", "."], { cwd: origin });
    execFileSync("git", ["commit", "--quiet", "-m", "first"], { cwd: origin });
    writeFileSync(`${origin}/second.txt`, "second\n");
    execFileSync("git", ["add", "."], { cwd: origin });
    execFileSync("git", ["commit", "--quiet", "-m", "second"], { cwd: origin });

    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${origin}`, clonePath]);
    assert.equal(
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: clonePath, encoding: "utf8" }).trim(),
      "true",
      "fixture setup bug: the clone this test built is not actually shallow",
    );

    writeFileSync(`${clonePath}/AGENTS.md`, "# fixture\n");
    writeFileSync(`${clonePath}/package.json`, JSON.stringify(packageJson));
    if (lockfile) writeFileSync(`${clonePath}/package-lock.json`, JSON.stringify(lockfile));
    mkdirSync(`${clonePath}/node_modules`);
    run(clonePath);
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(clonePath, { recursive: true, force: true });
  }
};

const isShallow = (root) => execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() === "true";

test("cloud check requires the tracked lockfile", () => {
  withFixture({ name: "fixture", version: "1.0.0" }, null, (root) => {
    assert.throws(() => check(root), /package-lock\.json is required/);
  });
});

test("cloud check rejects a missing declared dependency", () => {
  const packageJson = { name: "fixture", version: "1.0.0", dependencies: { fixtureDependency: "1.0.0" } };
  const lockfile = {
    name: "fixture",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": packageJson,
      "node_modules/fixtureDependency": { version: "1.0.0" },
    },
  };
  withFixture(packageJson, lockfile, (root) => {
    assert.throws(() => check(root), /Cloud dependencies are not ready/);
  });
});

test("cloud check reports ready after npm-compatible dependency verification", () => {
  const packageJson = { name: "fixture", version: "1.0.0" };
  const lockfile = { name: "fixture", lockfileVersion: 3, requires: true, packages: { "": packageJson } };
  withFixture(packageJson, lockfile, (root) => {
    mkdirSync(`${root}/node_modules`);
    assert.match(check(root), /dependencies verified/);
  });
});

test("cloud check fails clearly on a shallow git clone, naming the cause instead of letting a downstream check fail confusingly", () => {
  const packageJson = { name: "fixture", version: "1.0.0" };
  const lockfile = { name: "fixture", lockfileVersion: 3, requires: true, packages: { "": packageJson } };
  withShallowGitFixture(packageJson, lockfile, (root) => {
    assert.throws(() => check(root), /shallow git clone/);
    // The fixture's own dependency setup is already valid (empty deps,
    // node_modules present) — the shallow clone is the only thing this
    // check should be able to object to here.
    assert.throws(() => check(root), (error) => !/Cloud dependencies are not ready/.test(error.message));
  });
});

test("cloud check does not object to an ordinary, full (non-shallow) git clone", () => {
  const packageJson = { name: "fixture", version: "1.0.0" };
  const lockfile = { name: "fixture", lockfileVersion: 3, requires: true, packages: { "": packageJson } };
  withShallowGitFixture(packageJson, lockfile, (root) => {
    execFileSync("git", ["fetch", "--unshallow"], { cwd: root, stdio: "pipe" });
    assert.equal(isShallow(root), false);

    assert.match(check(root), /dependencies verified/);
  });
});
