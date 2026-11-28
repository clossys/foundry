import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkReportGuards, ENTRIES, REGISTRY } from "./check-report-guards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "check-report-guards.mjs");
const FIXTURE = resolve(here, "rules", "fixtures", "R-REPORT-GUARD");
const REPEAT = "20261127T0900Z-report-verb-pin-bug";
const UNGUARDED = "20261122T1000Z-report-verb-next-gap";
const FIXED = "20261120T1000Z-report-verb-pin-bug";

// A copy of the R-REPORT-GUARD violation fixture (records `clossys request` wrote); each test edits the copy only.
function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "check-report-guards-test-"));
  try {
    cpSync(FIXTURE, root, { recursive: true });
    const entry = id => join(root, ...ENTRIES, `${id}.json`);
    const read = id => JSON.parse(readFileSync(entry(id), "utf8"));
    const write = (id, doc) => writeFileSync(entry(id), `${JSON.stringify(doc, null, 2)}\n`);
    fn({ root, entry, read, write });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const rules = root => checkReportGuards(root).findings.map(row => `${row.rule} ${row.id}`).sort();
/** The store as it is once both findings are dealt with: the old close names its guard, the repeat is closed again. */
function repair({ read, write }) {
  write(UNGUARDED, { ...read(UNGUARDED), guard: "R-PIN-GUARD" });
  const repeat = read(REPEAT);
  write(REPEAT, { ...repeat, status: "closed", outcome: "fixed", result: "foundry@0.1.1", guard: "R-PIN-GUARD", closedAt: "2026-11-28T10:00:00Z" });
}

test("the violation fixture fails on a fixed close without a guard and on a repeat after a fixed close", () => {
  assert.deepEqual(rules(FIXTURE), [`repeat-open ${REPEAT}`, `unguarded-fixed ${UNGUARDED}`]);
  const ran = spawnSync(process.execPath, [scriptPath, "--root", FIXTURE], { encoding: "utf8" });
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /\[unguarded-fixed\] queue\.report#20261122T1000Z-report-verb-next-gap closed fixed/);
  assert.match(ran.stdout, /\[repeat-open\] queue\.report#20261127T0900Z-report-verb-pin-bug is a REPEAT of queue\.report#20261120T1000Z-report-verb-pin-bug/);
});

test("a store with every fixed close guarded and no open repeat passes", () => withRoot(ctx => {
  repair(ctx);
  assert.deepEqual(rules(ctx.root), []);
  const ran = spawnSync(process.execPath, [scriptPath, "--root", ctx.root], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout);
  assert.match(ran.stdout, /3 reports, 0 findings/);
}));

test("a root with no report store passes", () => {
  const root = mkdtempSync(join(tmpdir(), "check-report-guards-empty-"));
  try { assert.deepEqual(checkReportGuards(root).findings, []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a guard the registry does not list, or lists with no fixture run, fails", () => withRoot(ctx => {
  repair(ctx);
  ctx.write(UNGUARDED, { ...ctx.read(UNGUARDED), guard: "R-NOT-THERE" });
  assert.deepEqual(rules(ctx.root), [`guard-unknown ${UNGUARDED}`]);
  const registry = join(ctx.root, ...REGISTRY);
  const doc = JSON.parse(readFileSync(registry, "utf8"));
  writeFileSync(registry, JSON.stringify({ ...doc, rules: doc.rules.map(rule => ({ ...rule, fixture_runs: [] })) }));
  ctx.write(UNGUARDED, { ...ctx.read(UNGUARDED), guard: "R-PIN-GUARD" });
  assert.deepEqual(rules(ctx.root), [`guard-no-fixture ${FIXED}`, `guard-no-fixture ${UNGUARDED}`, `guard-no-fixture ${REPEAT}`]);
  rmSync(registry);
  assert.deepEqual(rules(ctx.root), [`guard-unknown ${FIXED}`, `guard-unknown ${UNGUARDED}`, `guard-unknown ${REPEAT}`]);
}));

test("an open signed report matching a fixed close with no repeatOf fails", () => withRoot(ctx => {
  ctx.write(UNGUARDED, { ...ctx.read(UNGUARDED), guard: "R-PIN-GUARD" });
  const { repeatOf: _repeatOf, ...unlinked } = ctx.read(REPEAT);
  ctx.write(REPEAT, { ...unlinked, events: unlinked.events.filter(event => event.op !== "repeat") });
  assert.deepEqual(rules(ctx.root), [`repeat-unlinked ${REPEAT}`]);
  // Another signature on the same topic is a new report, not a repeat.
  ctx.write(REPEAT, { ...ctx.read(REPEAT), evidence: { signature: "pin: the candidate file is missing" } });
  assert.deepEqual(rules(ctx.root), []);
}));

test("an entry that is not a JSON object fails", () => withRoot(ctx => {
  repair(ctx);
  writeFileSync(ctx.entry("20261128T1000Z-report-verb-x-bug"), "not json");
  assert.deepEqual(rules(ctx.root), ["unreadable 20261128T1000Z-report-verb-x-bug.json"]);
  assert.equal(readdirSync(join(ctx.root, ...ENTRIES)).length, 4);
}));

test("an unknown argument is a usage error", () => {
  const ran = spawnSync(process.execPath, [scriptPath, "--bogus"], { encoding: "utf8" });
  assert.equal(ran.status, 2);
});
