// Exercise the external qualification observations with the compiled CLI.
// Needs the Launcher build; check:launcher-help runs this after CI builds.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "governance/release-qualification-fixtures/launcher/current-direct");
const adapter = JSON.parse(readFileSync(join(root, "governance/release-qualification-adapters/launcher/current-direct.json"), "utf8"));

function check(input) {
  // Observed versions make this path offline. Do not inherit shell credentials.
  const result = spawnSync(process.execPath, [join(root, "packages/launcher/dist/check-cli.js"), "--input", input], {
    cwd: root,
    env: {},
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test("external Launcher qualification preserves satisfied, violated, and indeterminate outcomes", () => {
  assert.deepEqual(adapter.cases.map(({ id, exitCode }) => [id, exitCode]), [
    ["plan-satisfied", 0],
    ["plan-violated", 1],
    ["plan-indeterminate", 2],
  ]);
  for (const entry of adapter.cases) {
    assert.equal(entry.bin, "launcher-check");
    assert.equal(entry.args[0].literal, "--input");
    assert.equal(entry.args.length, 2);
    assert.ok(adapter.fixtures.includes(entry.args[1].fixture));
    const result = check(join(fixtureRoot, entry.args[1].fixture));
    assert.equal(result.status, entry.exitCode, `${entry.id}: ${result.stderr}`);
  }
});

test("removing the satisfied observation's Integrator version refuses an indeterminate plan", () => {
  const observation = JSON.parse(readFileSync(join(fixtureRoot, "observation-satisfied.json"), "utf8"));
  assert.equal(typeof observation.integratorVersion, "string");
  delete observation.integratorVersion;
  const temp = mkdtempSync(join(tmpdir(), "launcher-qualification-"));
  try {
    const input = join(temp, "observation.json");
    writeFileSync(input, JSON.stringify(observation));
    const result = check(input);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot read a public @clossys\/integrator version/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
