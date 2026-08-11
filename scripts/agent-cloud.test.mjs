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
