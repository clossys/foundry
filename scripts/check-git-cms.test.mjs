import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SEAT_TREES, checkGitCms, iaSlots } from "./check-git-cms.mjs";

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
  assert.deepEqual(summary.designer, { slots: 2, pinned: 1, notNeeded: 1, basis: { picked: 1, bulk: 0, planner: 0, agent: 0 }, findings: 0 });
  const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /every agent tree is green/);
}));

test("an agent folder without ia.json fails, and nothing is exempt", () => withRepo(({ repo }) => {
  mkdirSync(join(repo, "clossys", "agents", "controller", "pin"), { recursive: true });
  writeFileSync(join(repo, "clossys", "agents", "controller", "pin", "seat.json"), "{}\n");
  assert.deepEqual(rules(repo), ["missing-ia controller/ia.json", "stray-entry controller/pin"]);
  const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^red {3}controller: /m);
  assert.match(run.stdout, /^green designer: /m);
}));

const SEAT = { by: "owner", llm: null, human: { procedure: "Pin one candidate.", command: "clossys pin" } };
const seatIa = (ids) => json({ schema: "clossys.ia/1", source: "@clossys/producer#steps", extensions: [], nodes: [{ id: "design", label: "Design", children: [{ id: "design.pin", label: "Pin", slots: ids }] }] });
function withSeats(repo, ids = ["pin.designer", "pick.designer"]) {
  const producer = join(repo, "clossys", "agents", "producer");
  mkdirSync(producer, { recursive: true });
  writeFileSync(join(producer, "ia.json"), seatIa(ids));
  for (const id of ids) writeSeat(producer, id, SEAT);
  return producer;
}
/** A seat as the slot pin contract holds it: one candidate file and the pin.json that chooses it. */
function writeSeat(producer, id, value) {
  const candidates = join(producer, id, "candidates"), name = `${id}-v1.json`, bytes = json(value);
  mkdirSync(candidates, { recursive: true });
  writeFileSync(join(candidates, name), bytes);
  writeFileSync(join(producer, id, "pin.json"), json({ candidate: name, sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "migrated", basis: "planner", at: "2026-11-04T00:00:00.000Z" }));
}

test("the seat-kind trees match the slot model's FOLDER_KIND", () => {
  const types = readFileSync(resolve(dirname(scriptPath), "..", "packages", "producer", "src", "records", "slot-model", "types.ts"), "utf8");
  const table = /FOLDER_KIND[^=]*=\s*\{([^}]*)\}/.exec(types)?.[1] ?? "";
  const seats = [...table.matchAll(/(\w+):\s*"seat"/g)].map((match) => match[1]);
  assert.deepEqual([...SEAT_TREES], seats);
  assert.deepEqual(seats, ["producer"]);
});

test("a Producer seat tree placed by ia.json is green and counted as seats", () => withRepo(({ repo }) => {
  withSeats(repo);
  const { findings, summary } = checkGitCms(join(repo, "clossys"));
  assert.deepEqual(findings, []);
  assert.deepEqual(summary.producer, { seats: 2, llm: 0, human: 2, findings: 0 });
  const run = spawnSync(process.execPath, [scriptPath, "--repo", repo], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^green producer: 2 seats \(llm 0, human 2\), 0 finding\(s\)$/m);
}));

test("a Producer tree without ia.json, an unlisted or missing seat, and a misshapen seat fail", () => withRepo(({ repo }) => {
  const producer = withSeats(repo);
  unlinkSync(join(producer, "ia.json"));
  assert.deepEqual(rules(repo), ["missing-ia producer/ia.json", "unlisted-seat producer/pick.designer", "unlisted-seat producer/pin.designer"]);
  writeFileSync(join(producer, "ia.json"), seatIa(["pin.designer", "pin.writer"]));
  assert.deepEqual(rules(repo), ["unlisted-seat producer/pick.designer", "missing-seat producer/pin.writer"]);
  writeFileSync(join(producer, "ia.json"), seatIa(["pin.designer", "pick.designer"]));
  writeFileSync(join(producer, "pin.designer", "notes.md"), "x\n");
  writeFileSync(join(producer, "pick.designer", "seat.json"), json(SEAT));
  writeFileSync(join(producer, "README.md"), "x\n");
  assert.deepEqual(rules(repo), ["stray-entry producer/README.md", "seat-shape producer/pin.designer/notes.md", "seat-shape producer/pick.designer/seat.json"]);
  unlinkSync(join(producer, "pick.designer", "seat.json"));
  writeSeat(producer, "pick.designer", { llm: null });
  assert.deepEqual(rules(repo).slice(1), ["seat-shape producer/pin.designer/notes.md", "seat-shape producer/pick.designer/pin.json"]);
  writeFileSync(join(producer, "pick.designer", "candidates", "pick.designer-v1.json"), json(SEAT));
  assert.deepEqual(rules(repo).slice(1), ["seat-shape producer/pin.designer/notes.md", "pin-hash producer/pick.designer/pin.json"]);
  unlinkSync(join(producer, "pick.designer", "pin.json"));
  assert.deepEqual(rules(repo).slice(1), ["seat-shape producer/pin.designer/notes.md", "seat-shape producer/pick.designer/pin.json"]);
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
  assert.deepEqual(checkGitCms(join(repo, "clossys")).findings.map((row) => row.message), ["pin has no basis (picked | bulk | planner | agent)"]);
  editPin(pinned, (pin) => ({ ...pin, basis: "owner" }));
  assert.deepEqual(rules(repo), ["pin-attribution designer/components.pinned/pin.json"]);
  for (const basis of ["picked", "bulk", "planner", "agent"]) {
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
