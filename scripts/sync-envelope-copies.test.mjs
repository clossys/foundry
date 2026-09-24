// Regression tests for sync-envelope-copies.mjs (issue #1384): the one
// generator for a zero-dependency package's copy of the shared
// check-output envelope, and the drift check that keeps every copy
// byte-for-byte equal to what it would generate now.
//
// Temp directories are always removed via t.after, including when a test
// fails (issue #1250).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_ENVELOPE_PATH, CANONICAL_VERDICT_PATH, ENVELOPE_COPY_PATH, listEnvelopeCopies, renderEnvelopeCopy, renderEnvelopeCopyFromRoot } from "./sync-envelope-copies.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const scriptPath = join(scriptDir, "sync-envelope-copies.mjs");

function makeTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "sync-envelope-copies-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [CANONICAL_ENVELOPE_PATH, CANONICAL_VERDICT_PATH]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(join(repoRoot, path), "utf8"));
  }
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  writeFileSync(join(root, "packages", "alpha", "package.json"), JSON.stringify({ name: "@scope/alpha", version: "0.1.0" }));
  return root;
}

function run(args) {
  try { return { status: 0, out: execFileSync(process.execPath, [scriptPath, ...args], { stdio: "pipe" }).toString("utf8") }; }
  catch (error) { if (error.stdout === undefined) throw error; return { status: error.status, out: `${error.stdout}${error.stderr}` }; }
}

test("the copy of the real canonical source is self-contained: GateVerdict inlined, no import left, constructor kept", () => {
  const copy = renderEnvelopeCopyFromRoot(repoRoot);
  assert.doesNotMatch(copy, /^import /m);
  assert.match(copy, /^export type GateVerdict = "satisfied" \| "violated" \| "indeterminate";$/m);
  assert.match(copy, /export function buildCheckOutputEnvelope\(/);
  assert.match(copy, /export function envelopeToExitCode\(/);
  assert.ok(copy.startsWith("// GENERATED FILE -- do not edit."));
});

test("everything after the import block is carried over byte for byte", () => {
  const envelope = readFileSync(join(repoRoot, CANONICAL_ENVELOPE_PATH), "utf8");
  const copy = renderEnvelopeCopyFromRoot(repoRoot);
  const tail = envelope.slice(envelope.indexOf("export interface CheckFinding"));
  assert.ok(copy.endsWith(tail));
});

test("generation fails loudly when either canonical input no longer has the expected shape", () => {
  const result = readFileSync(join(repoRoot, CANONICAL_VERDICT_PATH), "utf8");
  assert.throws(() => renderEnvelopeCopy("export const x = 1;\n", result), /GateVerdict import block/);
  assert.throws(() => renderEnvelopeCopy(readFileSync(join(repoRoot, CANONICAL_ENVELOPE_PATH), "utf8"), "export const y = 2;\n"), /GateVerdict = \.\.\./);
});

test("CLI: --add writes a copy, the default check passes, a one-byte edit fails, --write repairs it", (t) => {
  const root = makeTempRoot(t);
  assert.equal(run([root]).status, 0);
  assert.equal(run(["--add", "alpha", root]).status, 0);
  assert.deepEqual(listEnvelopeCopies(root), ["alpha"]);
  const copyPath = join(root, "packages", "alpha", ENVELOPE_COPY_PATH);
  assert.equal(readFileSync(copyPath, "utf8"), renderEnvelopeCopyFromRoot(root));
  assert.equal(run([root]).status, 0);
  writeFileSync(copyPath, `${readFileSync(copyPath, "utf8")} `);
  const drifted = run([root]);
  assert.equal(drifted.status, 1);
  assert.match(drifted.out, /DRIFTED/);
  assert.equal(run(["--write", root]).status, 0);
  assert.equal(run([root]).status, 0);
});

test("CLI: exits 2 when the canonical source is missing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sync-envelope-copies-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run([root]).status, 2);
});
