// Negative controls for the issue #351 gate: a lifecycle hook that breaks
// publishing must go red HERE, before the real publish, which is production.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "rehearse-publish-lifecycle.mjs");

function packageWith(t, scripts, { manifest } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rehearse-lifecycle-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = join(root, "packages", "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), manifest ?? `${JSON.stringify({ name: "@gate-fixture/demo", version: "0.0.1", scripts }, null, 2)}\n`);
  return dir;
}

const rehearse = (dir) => {
  const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

test("a hook that succeeds is rehearsed and reported by name", (t) => {
  const dir = packageWith(t, { prepublishOnly: "node -e \"process.exit(0)\"" });
  const result = rehearse(dir);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /rehearsing prepublishOnly/);
  assert.match(result.out, /REHEARSED/);
});

test("NEGATIVE CONTROL: a prepublishOnly hook that exits non-zero fails the gate (exit 1)", (t) => {
  const dir = packageWith(t, { prepublishOnly: "node -e \"process.exit(2)\"" });
  const result = rehearse(dir);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /HOOK FAILED/);
  assert.match(result.out, /prepublishOnly/);
});

test("NEGATIVE CONTROL: every pre-upload hook is executed, not just the first", (t) => {
  const dir = packageWith(t, { prepublishOnly: "node -e \"process.exit(0)\"", prepack: "node -e \"process.exit(0)\"", prepare: "node -e \"process.exit(0)\"", postpack: "node -e \"process.exit(4)\"" });
  const result = rehearse(dir);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /postpack/);
});

test("a hook npm fires only AFTER the upload is refused rather than silently skipped (exit 1)", (t) => {
  const dir = packageWith(t, { prepublishOnly: "node -e \"process.exit(0)\"", postpublish: "node -e \"process.exit(0)\"" });
  const result = rehearse(dir);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /CANNOT BE REHEARSED/);
  assert.match(result.out, /postpublish/);
});

test("a package that declares no publish lifecycle script passes, and says that is why", (t) => {
  const dir = packageWith(t, { build: "node -e \"process.exit(0)\"" });
  const result = rehearse(dir);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /declares no publish lifecycle script/);
});

test("an unreadable or absent manifest is INDETERMINATE (exit 2), never a pass", (t) => {
  const broken = packageWith(t, {}, { manifest: "{ not json" });
  assert.equal(rehearse(broken).code, 2);
  assert.equal(rehearse(join(broken, "nope")).code, 2);
  assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 2);
});

test("every publishable package in this repository passes its own rehearsal shape check", async () => {
  // Shape only: this asserts that no manifest here declares an unrehearsable
  // post-upload hook. Actually running the hooks is publish.yml's job (they
  // compile and read the registry), not a unit test's.
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const packages = join(dirname(fileURLToPath(import.meta.url)), "..", "packages");
  for (const name of readdirSync(packages)) {
    const manifestPath = join(packages, name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const scripts = JSON.parse(readFileSync(manifestPath, "utf8")).scripts ?? {};
    for (const hook of ["publish", "postpublish"]) {
      assert.equal(scripts[hook], undefined, `packages/${name} declares a ${hook} hook, which no rehearsal can execute without a real upload`);
    }
  }
});
