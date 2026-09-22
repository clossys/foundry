import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { DEFERRALS_PATH, IndeterminateError, UsageError, argsFrom, removeDeferral } from "./remove-qualification-deferral.mjs";

const execFile = promisify(execFileCallback);
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(sourceRoot, "remove-qualification-deferral.mjs");

async function fixtureRoot(t, doc) {
  const root = await mkdtemp(join(tmpdir(), "remove-deferral-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const governanceDir = join(root, "governance");
  await mkdir(governanceDir, { recursive: true });
  await writeFile(join(governanceDir, "release-qualification-deferrals.json"), JSON.stringify(doc, null, 2) + "\n");
  return root;
}

function baseDoc(deferrals) {
  return { schemaVersion: 1, $comment: "fixture", deferrals };
}

test("argsFrom requires both flags", () => {
  assert.throws(() => argsFrom(["node", "script", "--package", "controller"]), UsageError);
  assert.throws(() => argsFrom(["node", "script", "--version", "0.9.8"]), UsageError);
  assert.deepEqual(argsFrom(["node", "script", "--package", "controller", "--version", "0.9.8"]), {
    package: "controller",
    version: "0.9.8",
  });
});

test("removeDeferral throws IndeterminateError when the file is missing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "remove-deferral-missing-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("removeDeferral throws IndeterminateError on invalid JSON", async (t) => {
  const root = await fixtureRoot(t, baseDoc([]));
  await writeFile(join(root, "governance", "release-qualification-deferrals.json"), "{ not json");
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("removeDeferral throws IndeterminateError on the wrong shape", async (t) => {
  const root = await fixtureRoot(t, { schemaVersion: 1, deferrals: "not-an-array" });
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), IndeterminateError);
});

test("removeDeferral is a no-op, not an error, when no entry matches", async (t) => {
  const doc = baseDoc([{ package: "inspector", version: "0.2.4", reason: "x".repeat(25), issue: 948 }]);
  const root = await fixtureRoot(t, doc);
  const result = removeDeferral({ root, package: "controller", version: "0.9.8" });
  assert.equal(result.removed, false);
  assert.equal(result.issue, null);
  assert.deepEqual(result.doc.deferrals, doc.deferrals);
});

test("removeDeferral removes exactly the matching entry and preserves the rest", async (t) => {
  const doc = baseDoc([
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 948 },
    { package: "controller", version: "0.9.9", reason: "z".repeat(25), issue: 833 },
    { package: "inspector", version: "0.2.4", reason: "w".repeat(25), issue: 948 },
  ]);
  const root = await fixtureRoot(t, doc);
  const result = removeDeferral({ root, package: "controller", version: "0.9.8" });
  assert.equal(result.removed, true);
  assert.equal(result.issue, 948);
  assert.deepEqual(result.doc.deferrals, [
    { package: "controller", version: "0.9.9", reason: "z".repeat(25), issue: 833 },
    { package: "inspector", version: "0.2.4", reason: "w".repeat(25), issue: 948 },
  ]);
  // Top-level fields other than `deferrals` are preserved verbatim.
  assert.equal(result.doc.schemaVersion, doc.schemaVersion);
  assert.equal(result.doc.$comment, doc.$comment);
});

test("removeDeferral refuses to guess between duplicate entries", async (t) => {
  const doc = baseDoc([
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 948 },
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 949 },
  ]);
  const root = await fixtureRoot(t, doc);
  assert.throws(() => removeDeferral({ root, package: "controller", version: "0.9.8" }), /refusing to guess/);
});

test("CLI: removes the matching entry, writes the file, and exits 0", async (t) => {
  const doc = baseDoc([
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 948 },
    { package: "inspector", version: "0.2.4", reason: "w".repeat(25), issue: 948 },
  ]);
  const root = await fixtureRoot(t, doc);
  const { stdout } = await execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root });
  assert.match(stdout, /DEFERRAL REMOVED — controller@0\.9\.8 \(issue #948\)/);
  const written = JSON.parse(await readFile(join(root, DEFERRALS_PATH), "utf8"));
  assert.deepEqual(written.deferrals, [{ package: "inspector", version: "0.2.4", reason: "w".repeat(25), issue: 948 }]);
});

test("CLI: reports no-op and exits 0 when nothing matches", async (t) => {
  const root = await fixtureRoot(t, baseDoc([]));
  const { stdout } = await execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root });
  assert.match(stdout, /NO DEFERRAL TO REMOVE/);
});

test("CLI: exits 2 on usage error", async () => {
  await assert.rejects(execFile(process.execPath, [scriptPath, "--package", "controller"]), (error) => {
    assert.equal(error.code, 2);
    return true;
  });
});

test("CLI: exits 1 on duplicate entries", async (t) => {
  const doc = baseDoc([
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 948 },
    { package: "controller", version: "0.9.8", reason: "y".repeat(25), issue: 949 },
  ]);
  const root = await fixtureRoot(t, doc);
  await assert.rejects(execFile(process.execPath, [scriptPath, "--package", "controller", "--version", "0.9.8"], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    return true;
  });
});
