// Regression coverage for #1328: check-contamination-classes.mjs used to
// read only positional[0] and silently ignore every other directory
// argument. A merge-train invocation like
// `check-contamination-classes.mjs packages/a packages/b …` reported a
// clean pass across every package while only `packages/a` had actually been
// scanned — "success over unexamined ground" (#914).
//
// These tests spawn the real CLI (never the exported internals — it has
// none; it is a top-level script) against small fixture directories, the
// same way scripts/check-foreign-references.test.mjs and
// scripts/test-gates.mjs's own CONTAM assertions do.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDir, "check-contamination-classes.mjs");

function run(args) {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  return { code: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") };
}

function cleanDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), "nothing to see here\n");
  return dir;
}

// A CLASS 1 finding: a dangling internal doc citation that resolves nowhere
// in this repository. Cheap and deterministic to trigger, unlike the other
// classes which need real package.json/npm-pack machinery.
function dirtyDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "note.md"), "See KIT-CONVENTIONS.md for the house rules.\n");
  return dir;
}

test("check-contamination-classes: multi-directory / non-existent-path regression (#1328)", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "contam-multiarg-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  await t.test("single directory: unchanged baseline behavior", () => {
    const clean = cleanDir(work, "solo-clean");
    const r = run([clean]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.match(r.out, /PASS — no contamination-class findings\./);

    const dirty = dirtyDir(work, "solo-dirty");
    const rd = run([dirty]);
    assert.equal(rd.code, 1, `expected exit 1, got ${rd.code}: ${rd.out}`);
    assert.match(rd.out, /FAIL — 1 finding\(s\)/);
  });

  await t.test("two directories, second one planted with a finding: both are scanned, not just positional[0]", () => {
    const first = cleanDir(work, "two-a-clean");
    const second = dirtyDir(work, "two-b-dirty");

    const r = run([first, second]);
    // The pre-fix defect: this used to read only positional[0] (`first`,
    // clean) and report a bare PASS, silently never looking at `second` at
    // all. The fix must scan every positional argument, so the planted
    // finding in the second directory must surface as a failure.
    assert.equal(r.code, 1, `expected exit 1 (finding in the second directory), got ${r.code}: ${r.out}`);
    assert.match(r.out, new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "output should mention the first (clean) directory");
    assert.match(r.out, new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "output should mention the second (dirty) directory");
    assert.match(r.out, /KIT-CONVENTIONS\.md/, "the second directory's finding must actually be reported");
  });

  await t.test("order independence: a finding planted in the FIRST of several directories is still caught", () => {
    const first = dirtyDir(work, "order-a-dirty");
    const second = cleanDir(work, "order-b-clean");
    const third = cleanDir(work, "order-c-clean");

    const r = run([first, second, third]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.match(r.out, /KIT-CONVENTIONS\.md/);
  });

  await t.test("several clean directories together still pass", () => {
    const a = cleanDir(work, "allclean-a");
    const b = cleanDir(work, "allclean-b");
    const c = cleanDir(work, "allclean-c");

    const r = run([a, b, c]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });

  await t.test("--json with several directories: one report object per directory, in order, none silently dropped", () => {
    const a = cleanDir(work, "json-a-clean");
    const b = dirtyDir(work, "json-b-dirty");
    const c = cleanDir(work, "json-c-clean");

    const r = run([a, b, c, "--json"]);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(r.out);
    }, `--json output should be valid JSON: ${r.out}`);
    assert.ok(Array.isArray(parsed), "multi-directory --json output should be an array, one entry per directory");
    assert.equal(parsed.length, 3, "every positional directory must produce its own report, none dropped");
    assert.equal(parsed[0].root, a);
    assert.equal(parsed[0].findings.length, 0);
    assert.equal(parsed[1].root, b);
    assert.ok(parsed[1].findings.some((f) => f.file === "note.md"), "the middle directory's finding must be present, not dropped");
    assert.equal(parsed[2].root, c);
    assert.equal(parsed[2].findings.length, 0);
  });

  await t.test("--json with a single directory keeps the original flat-object shape (no breaking change for existing callers)", () => {
    const clean = cleanDir(work, "json-solo-clean");
    const r = run([clean, "--json"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.out);
    assert.ok(!Array.isArray(parsed), "a single-directory --json report must stay a flat object, not an array");
    assert.ok("findings" in parsed && "root" in parsed);
  });

  await t.test("a non-existent directory anywhere in the argument list fails closed with exit 2 and names the path", () => {
    const real = cleanDir(work, "exists-clean");
    const missing = join(work, "definitely-does-not-exist-xyz");

    for (const args of [[missing, real], [real, missing]]) {
      const r = run(args);
      assert.equal(r.code, 2, `expected exit 2 for args ${JSON.stringify(args)}, got ${r.code}: ${r.out}`);
      assert.match(r.out, /no such directory/);
      assert.ok(r.out.includes(missing), `error output should name the missing path: ${r.out}`);
      assert.doesNotMatch(r.out, /PASS/, "must never report a bare PASS when a positional argument could not be scanned");
    }
  });

  await t.test("no positional arguments at all still prints usage and exits 2", () => {
    const r = run([]);
    assert.equal(r.code, 2);
    assert.match(r.out, /usage: check-contamination-classes\.mjs/);
  });
});
