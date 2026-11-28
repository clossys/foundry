import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReviewCli } from "../cli/review.js";
import { batchGate, GATE_FILES, gateBranch, importGate, judgeImport, publishGate, type GateResult, type ImportFacts } from "./cloud.js";
import type { ReviewConfig } from "./config.js";
import { scratch } from "./exec.js";
import { takeReceipt } from "./receipt.js";
import { runReview, type ReviewOptions } from "./review.js";

const roots: string[] = [];
const IDENTITY = { GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
const saved: Record<string, string | undefined> = {};
// publish writes its gate commit with the process's git identity; the temporary repositories get a fixed one.
beforeAll(() => { for (const [key, value] of Object.entries(IDENTITY)) { saved[key] = process.env[key]; process.env[key] = value; } });
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENTITY }, encoding: "utf8" }).trim();
const temp = (prefix: string) => { const dir = scratch(prefix); roots.push(dir); return dir; };

const CONFIG: ReviewConfig = { install: null, probePackages: [], counts: [], fixtures: [], e2e: null, leakScan: null, typecheck: ["true"], timeoutMs: 60_000 };
const review = (options: ReviewOptions) => runReview({ ...options, config: CONFIG });

const MODULE = (body: string) => `export function isAdult(age) {\n  return ${body};\n}\n`;
const TEST = [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert/strict\";",
  "import { isAdult } from \"./math.mjs\";",
  "test(\"isAdult\", () => { assert.equal(isAdult(18), true); assert.equal(isAdult(17), false); });", "",
].join("\n");
const PACKET = "# UNIT\n\n## Validation\n- `node check.mjs` exits 0.\n";
const PACKET_PLUS = "# UNIT\n\n## Validation\n- `node check.mjs` exits 0.\n- `node check.mjs --again` exits 0.\n";

function write(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
}

/**
 * A temporary repository with a bare remote: main at base, the unit branch checked out one commit later (head), both
 * pushed to the bare remote. Nothing here touches a real remote.
 */
function unitRepo(body = "age >= 18"): { repo: string; remote: string; base: string; head: string; packet: string } {
  const remote = temp("cloud-remote-");
  sh(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const repo = temp("cloud-repo-");
  sh(repo, "init", "--quiet", "--initial-branch=main");
  write(repo, { "package.json": `${JSON.stringify({ name: "fixture-checkout", version: "1.0.0", private: true })}\n`, "src/math.mjs": MODULE("age >= 18"), "src/math.test.mjs": TEST, "check.mjs": "console.log(\"checked\");\n", ".gitignore": "UNIT.receipt/\n" });
  sh(repo, "add", "-A");
  sh(repo, "commit", "--quiet", "-m", "base");
  const base = sh(repo, "rev-parse", "HEAD");
  sh(repo, "checkout", "--quiet", "-b", "unit");
  write(repo, { "src/math.mjs": MODULE(body) });
  sh(repo, "commit", "--quiet", "--allow-empty", "-am", "head");
  const head = sh(repo, "rev-parse", "HEAD");
  sh(repo, "remote", "add", "origin", remote);
  sh(repo, "push", "--quiet", "origin", "main", "unit");
  const packetDir = temp("cloud-packet-");
  const packet = join(packetDir, "UNIT.md");
  writeFileSync(packet, PACKET);
  takeReceipt(packet, repo);
  return { repo, remote, base, head, packet };
}

/** A unit published to its gate branch on the bare remote, then fetched as origin/<unit>-gate. */
function published(body?: string) {
  const unit = unitRepo(body);
  const result = publishGate({ repo: unit.repo, base: "main", head: "unit", packet: unit.packet, push: "origin", review });
  sh(unit.repo, "fetch", "--quiet", "origin", gateBranch("unit"));
  return { ...unit, result };
}

const packetFile = (text: string) => { const file = join(temp("cloud-import-packet-"), "UNIT.md"); writeFileSync(file, text); return file; };
const ids = (result: { refusals: readonly { id: string }[] }) => result.refusals.map(item => item.id);

describe("clossys review --publish", () => {
  it("publish leaves the unit branch unchanged", () => {
    const unit = unitRepo();
    const before = { local: sh(unit.repo, "rev-parse", "refs/heads/unit"), remote: sh(unit.remote, "rev-parse", "refs/heads/unit"), head: sh(unit.repo, "rev-parse", "HEAD"), status: sh(unit.repo, "status", "--porcelain"), branch: sh(unit.repo, "symbolic-ref", "HEAD") };
    const result = publishGate({ repo: unit.repo, base: "main", head: "unit", packet: unit.packet, push: "origin", review });
    expect(result.gate.verdict).toBe("PASS");
    expect(result.branch).toBe("unit-gate");
    expect(sh(unit.repo, "rev-parse", "refs/heads/unit")).toBe(before.local);
    expect(sh(unit.remote, "rev-parse", "refs/heads/unit")).toBe(before.remote);
    expect(sh(unit.repo, "rev-parse", "HEAD")).toBe(before.head);
    expect(sh(unit.repo, "symbolic-ref", "HEAD")).toBe(before.branch);
    expect(sh(unit.repo, "status", "--porcelain")).toBe(before.status);
    // Only the gate branch moved, on the remote too, and its commit holds only the result and the receipt.
    expect(sh(unit.remote, "rev-parse", "refs/heads/unit-gate")).toBe(result.commit);
    expect(sh(unit.remote, "for-each-ref", "--format=%(refname)").split("\n").sort()).toEqual(["refs/heads/main", "refs/heads/unit", "refs/heads/unit-gate"]);
    expect(sh(unit.repo, "ls-tree", "--name-only", result.commit).split("\n")).toEqual([...GATE_FILES]);
    const gate = JSON.parse(sh(unit.repo, "show", `${result.commit}:gate.json`)) as GateResult;
    expect([gate.head, gate.tree, gate.base, gate.unit]).toEqual([unit.head, sh(unit.repo, "rev-parse", "unit^{tree}"), unit.base, "unit"]);
    expect(gate.line).toBe(`GATE: PASS ${unit.head} ${gate.tree}`);
    // No local path is published.
    const text = sh(unit.repo, "show", `${result.commit}:gate.json`) + sh(unit.repo, "show", `${result.commit}:receipt.json`);
    for (const path of [unit.repo, dirname(unit.packet)]) expect(text).not.toContain(path);
    // A second publish adds a commit on top of the first.
    const again = publishGate({ repo: unit.repo, base: "main", head: "unit", packet: unit.packet, review });
    expect(sh(unit.repo, "rev-parse", `${again.commit}^`)).toBe(result.commit);
    expect(sh(unit.repo, "rev-parse", "refs/heads/unit")).toBe(before.local);
  });

  it("refuses a head that is not on the unit branch", () => {
    const unit = unitRepo();
    expect(() => publishGate({ repo: unit.repo, base: "main", head: unit.head, packet: unit.packet, review })).toThrow(/--unit/);
    expect(() => publishGate({ repo: unit.repo, base: "main", head: "main", unit: "unit", packet: unit.packet, review })).toThrow(/not at the head/);
  });
});

describe("clossys review --import", () => {
  it("an exact head imports the cloud PASS as the mechanical record, re-running nothing", async () => {
    const unit = published();
    const out = join(temp("cloud-record-"), "review.json");
    const cli = await runReviewCli(["--import", "origin/unit-gate", "--head", unit.head, "--base", "main", "--packet", packetFile(PACKET), "--record", out, "--root", unit.repo], unit.repo);
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toMatch(new RegExp(`IMPORT: PASS ${unit.head}$`));
    const record = JSON.parse(readFileSync(out, "utf8"));
    expect(record.schema).toBe("clossys.review/1");
    expect(record.line).toBe(unit.result.gate.review.line);
    expect(record.imported).toMatchObject({ ref: "origin/unit-gate", commit: unit.result.commit, gateVerdict: "PASS", head: unit.head, base: unit.base });
  });

  it("import refuses a result whose head differs", () => {
    const unit = published();
    write(unit.repo, { "src/math.mjs": MODULE("age > 17") });
    sh(unit.repo, "commit", "--quiet", "-am", "a later head");
    const later = sh(unit.repo, "rev-parse", "HEAD");
    const result = importGate({ repo: unit.repo, ref: "origin/unit-gate", head: later, base: "main", packet: packetFile(PACKET) });
    expect(result.status).toBe("REFUSED");
    expect(ids(result)).toContain("import.head");
    expect(result.refusals.filter(item => item.id === "import.head").map(item => item.subject)).toEqual(["result", "review", "receipt"]);
    expect(result.record).toBeUndefined();
    expect(result.next).toBe(`clossys review ${unit.base} ${later} --packet <unit.md>`);
    // The same result with only its head relabelled to the later head is still refused, on its tree.
    const relabelled = { ...unit.result.gate, head: later, review: { ...unit.result.gate.review, head: later }, receipt: { ...unit.result.gate.receipt, head: later } };
    const facts: ImportFacts = { head: later, tree: sh(unit.repo, "rev-parse", `${later}^{tree}`), base: unit.base, mergeBase: unit.base, commands: [{ run: "node check.mjs", expect: 0 }] };
    expect(ids(judgeImport(relabelled, facts, "x"))).toContain("import.tree");
  });

  it("import refuses a result whose base is not the recorded base", () => {
    const unit = published();
    const result = importGate({ repo: unit.repo, ref: "origin/unit-gate", head: unit.head, base: unit.base, packet: packetFile(PACKET) });
    expect(result.status).toBe("PASS");
    const other = importGate({ repo: unit.repo, ref: "origin/unit-gate", head: unit.head, base: unit.head, packet: packetFile(PACKET) });
    expect(other.status).toBe("REFUSED");
    expect(ids(other)).toEqual(["import.base"]);
  });

  it("import refuses a result with a missing command", () => {
    const unit = published();
    const result = importGate({ repo: unit.repo, ref: "origin/unit-gate", head: unit.head, base: "main", packet: packetFile(PACKET_PLUS) });
    expect(result.status).toBe("REFUSED");
    expect(ids(result)).toEqual(["import.command-missing"]);
    expect(result.refusals[0]!.subject).toBe("node check.mjs --again");
    const none = importGate({ repo: unit.repo, ref: "origin/unit-gate", head: unit.head, base: "main", packet: packetFile("# UNIT\n\n## Validation\n- nothing to run\n") });
    expect(ids(none)).toEqual(["import.no-commands"]);
  });

  it("a cloud FAIL imports as FAIL", async () => {
    const unit = published("age > 18");
    expect(unit.result.gate.verdict).toBe("FAIL");
    const out = join(temp("cloud-record-"), "review.json");
    const cli = await runReviewCli(["--import", "origin/unit-gate", "--head", unit.head, "--base", "main", "--packet", packetFile(PACKET), "--record", out, "--root", unit.repo, "--json"], unit.repo);
    expect(cli.exitCode).toBe(1);
    expect(cli.message).toMatch(new RegExp(`next: a local run, clossys review ${unit.base} ${unit.head}`));
    expect(cli.message).toMatch(new RegExp(`IMPORT: FAIL ${unit.head}$`));
    const record = JSON.parse(readFileSync(out, "utf8"));
    expect(record.verdict).toBe("FAIL");
    expect(record.line).toMatch(/^MECHANICAL: FAIL /);
    expect(record.imported.gateVerdict).toBe("FAIL");
    // A FAIL relabelled PASS is refused, never imported as a PASS.
    const gate = unit.result.gate;
    const facts: ImportFacts = { head: unit.head, tree: gate.tree, base: unit.base, mergeBase: unit.base, commands: [{ run: "node check.mjs", expect: 0 }] };
    const relabelled = { ...gate, verdict: "PASS", line: `GATE: PASS ${gate.head} ${gate.tree}`, review: { ...gate.review, verdict: "PASS", line: `MECHANICAL: PASS ${gate.head} ${gate.tree}` } };
    expect(judgeImport(relabelled, facts, "x").status).toBe("REFUSED");
    expect(ids(judgeImport(relabelled, facts, "x"))).toEqual(["import.inconsistent"]);
  });

  it("refuses a ref with no gate result", () => {
    const unit = unitRepo();
    const result = importGate({ repo: unit.repo, ref: "main", head: unit.head, base: "main", packet: packetFile(PACKET) });
    expect(ids(result)).toEqual(["import.malformed"]);
  });
});

describe("clossys review --batch", () => {
  it("names the merged batch tip as the one local re-run, over imported PASS records", async () => {
    const unit = published();
    const dir = temp("cloud-batch-");
    const pass = join(dir, "pass.json");
    expect((await runReviewCli(["--import", "origin/unit-gate", "--head", unit.head, "--base", "main", "--packet", packetFile(PACKET), "--record", pass, "--root", unit.repo], unit.repo)).exitCode).toBe(0);
    sh(unit.repo, "checkout", "--quiet", "-b", "batch", "main");
    write(unit.repo, { "local.txt": "made here\n" });
    sh(unit.repo, "add", "local.txt");
    sh(unit.repo, "commit", "--quiet", "-m", "local");
    sh(unit.repo, "merge", "--quiet", "--no-edit", "unit");
    const tip = sh(unit.repo, "rev-parse", "HEAD");
    const result = batchGate({ repo: unit.repo, tip: "batch", base: "main", imported: [pass] });
    expect(result.line).toBe(`BATCH: RERUN ${tip}`);
    expect(result.rerun).toBe(`clossys review ${unit.base} ${tip}`);
    expect(result.units.map(item => item.head)).toEqual([unit.head]);
    expect([...result.local].sort()).toEqual([tip, sh(unit.repo, "rev-parse", "HEAD^1")].sort());
    // An imported FAIL never joins a batch; a head not merged into the tip refuses it.
    const failed = JSON.parse(readFileSync(pass, "utf8"));
    writeFileSync(join(dir, "fail.json"), JSON.stringify({ ...failed, verdict: "FAIL", imported: { ...failed.imported, gateVerdict: "FAIL" } }));
    expect(ids(batchGate({ repo: unit.repo, tip: "batch", base: "main", imported: [join(dir, "fail.json")] }))).toEqual(["batch.not-pass"]);
    expect(ids(batchGate({ repo: unit.repo, tip: "main", base: "main", imported: [pass] }))).toEqual(["batch.not-merged"]);
    expect(batchGate({ repo: unit.repo, tip: "batch", base: "main", imported: [] }).line).toBe(`BATCH: REFUSED ${tip}`);
  });
});

/**
 * Parity records: three cloud gate results, each with the facts the import saw at import time (unit head, its tree,
 * recorded base, merge base, packet commands) and the verdict the planner's import recorded for it: one accepted, one
 * refused for a head mismatch, one cloud FAIL that fell back to a local run.
 */
interface ParityRecord {
  readonly id: string;
  readonly provenance: string;
  readonly recorded: { readonly status: "PASS" | "FAIL" | "REFUSED"; readonly refusals: readonly string[]; readonly fallback: "none" | "local-run" };
  readonly facts: ImportFacts;
  readonly gate: GateResult;
}
const DIR = new URL("./__fixtures__/cloud-gate/", import.meta.url);
const records = readdirSync(fileURLToPath(DIR)).filter(name => name.endsWith(".json")).sort()
  .map(name => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as ParityRecord);

describe("parity with the recorded cloud gate imports", () => {
  it("import matches the recorded cloud gate verdicts", () => {
    expect(records.map(record => [record.id, record.recorded.status])).toEqual([["accepted", "PASS"], ["cloud-fail-local-run", "FAIL"], ["head-mismatch", "REFUSED"]]);
    for (const record of records) {
      const result = judgeImport(record.gate, record.facts, `${record.gate.unit}-gate`);
      expect(result.status, record.id).toBe(record.recorded.status);
      expect([...new Set(ids(result))], record.id).toEqual(record.recorded.refusals);
      expect(result.next !== undefined, record.id).toBe(record.recorded.fallback === "local-run");
      if (result.record) expect(result.record.verdict, record.id).toBe(record.gate.verdict);
    }
  });
});
