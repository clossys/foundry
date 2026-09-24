import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { DEFERRALS_DIR, IndeterminateError, UsageError, argsFrom, deferralFileName, removeDeferral } from "./remove-qualification-deferral.mjs";

const execFile = promisify(execFileCallback);
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(sourceRoot, "remove-qualification-deferral.mjs");

// One file per package@version (issue #1254), matching the real
// governance/release-qualification-deferrals/<package>@<version>.json
// layout, in place of the old single shared-array file.
async function fixtureRoot(t, entries) {
  const root = await mkdtemp(join(tmpdir(), "remove-deferral-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = join(root, DEFERRALS_DIR);
  await mkdir(dir, { recursive: true });
  for (const entry of entries) {
    await writeFile(join(dir, deferralFileName(entry.package, entry.version)), JSON.stringify(entry, null, 2) + "\n");
  }
  return root;
}

function entry(overrides = {}) {
  return { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 948, ...overrides };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("argsFrom requires both flags", () => {
  assert.throws(() => argsFrom(["node", "script", "--package", "controller"]), UsageError);
  assert.throws(() => argsFrom(["node", "script", "--version", "0.9.8"]), UsageError);
  assert.deepEqual(argsFrom(["node", "script", "--package", "controller", "--version", "0.9.8"]), {
    package: "controller",
    version: "0.9.8",
  });
});

test("removeDeferral throws IndeterminateError when the store directory is missing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "remove-deferral-missing-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("removeDeferral throws IndeterminateError when the exact target file is invalid JSON", async (t) => {
  const root = await fixtureRoot(t, []);
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8.json"), "{ not json");
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("removeDeferral throws IndeterminateError when the exact target file is the wrong shape", async (t) => {
  const root = await fixtureRoot(t, []);
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8.json"), JSON.stringify({ package: "controller" }));
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("an unrelated broken file elsewhere in the store does not block removal of the file actually requested", async (t) => {
  const root = await fixtureRoot(t, [entry()]);
  await writeFile(join(root, DEFERRALS_DIR, "broken.json"), "{ not json");
  const result = removeDeferral({ root, package: "controller", version: "0.9.8" });
  assert.equal(result.removed, true);
  assert.equal(result.issue, 948);
});

test("removeDeferral is a no-op, not an error, when no file matches", async (t) => {
  const root = await fixtureRoot(t, [entry({ package: "inspector", version: "0.2.4" })]);
  const result = removeDeferral({ root, package: "controller", version: "0.9.8" });
  assert.equal(result.removed, false);
  assert.equal(result.issue, null);
  assert.equal(result.path, `${DEFERRALS_DIR}/controller@0.9.8.json`);
});

test("removeDeferral identifies exactly the matching file among several, without touching the others", async (t) => {
  const root = await fixtureRoot(t, [entry({ version: "0.9.8", issue: 948 }), entry({ version: "0.9.9", issue: 833 }), entry({ package: "inspector", version: "0.2.4", issue: 948 })]);
  const result = removeDeferral({ root, package: "controller", version: "0.9.8" });
  assert.equal(result.removed, true);
  assert.equal(result.issue, 948);
  assert.equal(result.path, `${DEFERRALS_DIR}/controller@0.9.8.json`);
  // removeDeferral is pure — it decides, main() writes. Both sibling files
  // (and the requested one, since nothing has deleted it yet) must still be
  // on disk.
  const remaining = (await readdir(join(root, DEFERRALS_DIR))).sort();
  assert.deepEqual(remaining, ["controller@0.9.8.json", "controller@0.9.9.json", "inspector@0.2.4.json"]);
});

test("removeDeferral refuses to guess between two files that both name the same package@version, even under different filenames", async (t) => {
  const root = await fixtureRoot(t, []);
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8.json"), JSON.stringify(entry({ issue: 948 })) + "\n");
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8-duplicate.json"), JSON.stringify(entry({ issue: 949 })) + "\n");
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), /refusing to guess/);
});

test("CLI: removes exactly the matching file, deletes it from disk, and exits 0", async (t) => {
  const root = await fixtureRoot(t, [entry({ version: "0.9.8", issue: 948 }), entry({ package: "inspector", version: "0.2.4", issue: 948 })]);
  const { stdout } = await execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root });
  assert.match(stdout, /DEFERRAL REMOVED — controller@0\.9\.8 \(issue #948\) removed from governance\/release-qualification-deferrals\/controller@0\.9\.8\.json/);
  assert.equal(await exists(join(root, DEFERRALS_DIR, "controller@0.9.8.json")), false, "the removed file must actually be gone from disk");
  assert.equal(await exists(join(root, DEFERRALS_DIR, "inspector@0.2.4.json")), true, "an unrelated file must be untouched");
});

test("CLI: reports no-op and exits 0 when nothing matches", async (t) => {
  const root = await fixtureRoot(t, []);
  const { stdout } = await execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root });
  assert.match(stdout, /NO DEFERRAL TO REMOVE/);
});

test("CLI: exits 2 on usage error", async () => {
  await assert.rejects(execFile(process.execPath, [scriptPath, "--package", "controller"]), (error) => {
    assert.equal(error.code, 2);
    return true;
  });
});

test("CLI: exits 1 on duplicate files for the same package@version", async (t) => {
  const root = await fixtureRoot(t, []);
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8.json"), JSON.stringify(entry({ issue: 948 })) + "\n");
  await writeFile(join(root, DEFERRALS_DIR, "controller@0.9.8-duplicate.json"), JSON.stringify(entry({ issue: 949 })) + "\n");
  await assert.rejects(execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    return true;
  });
});
