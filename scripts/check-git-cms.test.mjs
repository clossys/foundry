import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkGitCms, iaSlots } from "./check-git-cms.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-git-cms.mjs");
const CANDIDATE = '{\n  "name": "example"\n}\n';
const sha = (text) => createHash("sha256").update(text).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const IDS = ["components.pinned", "components.unused"];

// One valid agent tree: a pinned slot and a not-needed slot, both listed in ia.json. Each test
// then breaks exactly one thing.
function withRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), "check-git-cms-test-"));
  try {
    const agent = join(repo, "clossys", "agents", "designer");
    mkdirSync(agent, { recursive: true });
    writeFileSync(join(agent, "ia.json"), json({ schema: "clossys.ia/1", extensions: [], nodes: [{ id: "components", children: [{ id: "group", slots: IDS }] }] }));
    for (const id of IDS) {
      mkdirSync(join(agent, id, "candidates"), { recursive: true });
      writeFileSync(join(agent, id, "candidates", "example-v1.json"), CANDIDATE);
    }
    const pinned = join(agent, IDS[0]), unused = join(agent, IDS[1]);
    writeFileSync(join(pinned, "slot.json"), json({ schema: "clossys.slot/1", id: IDS[0] }));
    writeFileSync(join(pinned, "pin.json"), json({ candidate: "example-v1.json", sha256: sha(CANDIDATE), decidedBy: "owner", basis: "picked", at: "2026-11-03T00:00:00.000Z" }));
    writeFileSync(join(unused, "slot.json"), json({ schema: "clossys.slot/1", id: IDS[1], notNeeded: { reason: "No toolbar.", since: "2026-11-03", decidedBy: "owner" } }));
    return fn({ repo, agent, pinned, unused });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}
const rules = (repo) => checkGitCms(join(repo, "clossys")).findings.map((row) => `${row.rule} ${row.path}`);
const editPin = (dir, edit) => {
  const path = join(dir, "pin.json");
  writeFileSync(path, json(edit(JSON.parse(readFileSync(path, "utf8")))));
};

test("iaSlots reads node children and extensions", () => {
  assert.deepEqual([...iaSlots({ nodes: [{ children: [{ slots: ["a", "b"] }] }], extensions: ["c"] })], ["a", "b", "c"]);
  assert.equal(iaSlots({ nodes: [] }), undefined);
  assert.equal(iaSlots([]), undefined);
});

test("a tree in the flat layout is green and the CLI exits 0", () => withRepo(({ repo }) => {
  const { findings, summary } = checkGitCms(join(repo, "clossys"));
  assert.deepEqual(findings, []);
  assert.deepEqual(summary.designer, { slots: 2, pinned: 1, notNeeded: 1, basis: { picked: 1, bulk: 0, planner: 0 }, findings: 0 });
  const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /every agent tree is green/);
}));

test("an agent folder without ia.json fails, and nothing is exempt", () => withRepo(({ repo }) => {
  mkdirSync(join(repo, "clossys", "agents", "producer", "pin"), { recursive: true });
  writeFileSync(join(repo, "clossys", "agents", "producer", "pin", "seat.json"), "{}\n");
  assert.deepEqual(rules(repo), ["missing-ia producer/ia.json", "stray-entry producer/pin"]);
  const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^red {3}producer: /m);
  assert.match(run.stdout, /^green designer: /m);
}));

test("evidence, notes and files inside an agent or slot folder are stray entries", () => withRepo(({ repo, agent, pinned }) => {
  mkdirSync(join(agent, "_evidence"));
  writeFileSync(join(agent, "_evidence", "note.md"), "x\n");
  writeFileSync(join(agent, "README.md"), "x\n");
  writeFileSync(join(pinned, "notes.md"), "x\n");
  mkdirSync(join(pinned, "candidates", "nested"));
  assert.deepEqual(rules(repo), [
    "stray-entry designer/README.md", "stray-entry designer/_evidence",
    "stray-entry designer/components.pinned/notes.md", "stray-entry designer/components.pinned/candidates/nested",
  ]);
}));

test("a slot folder ia.json does not list, and an ia.json slot without a folder, fail", () => withRepo(({ repo, agent }) => {
  mkdirSync(join(agent, "components.extra"));
  writeFileSync(join(agent, "components.extra", "slot.json"), json({ id: "components.extra" }));
  writeFileSync(join(agent, "ia.json"), json({ nodes: [{ children: [{ slots: [...IDS, "components.ghost"] }] }] }));
  assert.deepEqual(rules(repo), ["unlisted-slot designer/components.extra", "missing-slot designer/components.ghost"]);
}));

test("a slot with zero candidates fails", () => withRepo(({ repo, unused }) => {
  unlinkSync(join(unused, "candidates", "example-v1.json"));
  assert.deepEqual(rules(repo), ["no-candidates designer/components.unused"]);
}));

test("a pin whose candidate is missing, or whose sha256 differs, fails", () => withRepo(({ repo, pinned }) => {
  editPin(pinned, (pin) => ({ ...pin, sha256: "0".repeat(64) }));
  assert.deepEqual(rules(repo), ["pin-hash designer/components.pinned/pin.json"]);
  editPin(pinned, (pin) => ({ ...pin, candidate: "example-v9.json" }));
  assert.deepEqual(rules(repo), ["pin-candidate designer/components.pinned/pin.json"]);
}));

test("a pin without decidedBy, without basis, or with another basis fails", () => withRepo(({ repo, pinned }) => {
  editPin(pinned, ({ decidedBy, ...rest }) => rest);
  assert.deepEqual(rules(repo), ["pin-attribution designer/components.pinned/pin.json"]);
  editPin(pinned, ({ basis, ...rest }) => ({ ...rest, decidedBy: "owner" }));
  assert.deepEqual(checkGitCms(join(repo, "clossys")).findings.map((row) => row.message), ["pin has no basis (picked | bulk | planner)"]);
  editPin(pinned, (pin) => ({ ...pin, basis: "owner" }));
  assert.deepEqual(rules(repo), ["pin-attribution designer/components.pinned/pin.json"]);
  for (const basis of ["picked", "bulk", "planner"]) {
    editPin(pinned, (pin) => ({ ...pin, basis }));
    assert.deepEqual(rules(repo), []);
  }
}));

test("notNeeded without a reason fails", () => withRepo(({ repo, unused }) => {
  writeFileSync(join(unused, "slot.json"), json({ schema: "clossys.slot/1", id: IDS[1], notNeeded: { since: "2026-11-03", decidedBy: "owner" } }));
  assert.deepEqual(rules(repo), ["not-needed-reason designer/components.unused/slot.json"]);
}));

test("the CLI refuses a repository without clossys/agents (exit 2)", () => {
  const repo = mkdtempSync(join(tmpdir(), "check-git-cms-empty-"));
  try {
    assert.equal(spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" }).status, 2);
    assert.equal(spawnSync(process.execPath, [scriptPath, "--repo"], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
