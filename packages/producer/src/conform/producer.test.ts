/**
 * Producer as a conformance subject (foundry-build-0048 U9): every P row is green on an all-green world built from
 * Producer's real package data, and each turns red under one mutation that leaves the other rows green. Over the repo
 * and its fixture, the report names today's known reds.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packageLoopSet } from "../loop/agent-loops.js";
import { readProducerIa } from "../loop/producer-ia.js";
import { LOOP_NAMES, type LoopName } from "../loop/names.js";
import { cellOf, conform, conformProducer, formatReport, readRegistry } from "./run.js";
import { PRODUCER_ASSERTIONS, readProducerModel, type ProducerLoop, type ProducerModel } from "./producer.js";
import { readConformModel } from "./model.js";
import { runConformCli } from "../cli/conform.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = join(REPO, "packages/producer/test-fixtures/consumer/clossys");

type Mutable = { -readonly [K in keyof ProducerModel]: any };
/** Producer's real tree with the slot request queue placed, its real loops, the package loop set and a skill naming every leaf. */
function world(mutate: (model: Mutable) => void = () => {}): ProducerModel {
  const base = readProducerModel(FIXTURE);
  const ia = structuredClone(readProducerIa()) as any[];
  ia.find(layer => layer.layer === "queue").nodes.find((node: any) => node.id === "problems").children.push({ id: "problems-requests", label: "Requests", leaves: ["queue.slot"] });
  const leaves = ia.flatMap(layer => layer.nodes.flatMap((node: any) => node.children.flatMap((child: any) => child.leaves)));
  const model: Mutable = {
    ...base, ia, loops: new Map(structuredClone([...base.loops])), loopSet: packageLoopSet(), entries: [], awaited: new Set<string>(),
    skill: { path: "skill/SKILL.md", text: `runs ${leaves.join(", ")}.` },
  };
  mutate(model);
  return model as ProducerModel;
}
const red = (id: string, model: ProducerModel) => cellOf(id, id, PRODUCER_ASSERTIONS[id]!(model)).red;
const steps = (model: Mutable, loop: LoopName) => (model.loops.get(loop) as Extract<ProducerLoop, { ok: true }>).steps as any[];

/** One mutation per row: the fact that turns it red. */
const MUTATIONS: Record<string, (model: Mutable) => void> = {
  // The slot request queue the runner reads is not placed in the tree (today's state).
  P1: model => { model.ia.find((layer: any) => layer.layer === "queue").nodes.find((node: any) => node.id === "problems").children.pop(); },
  // Two ledgers swap places: each sits where the other loop sits.
  P2: model => { const runs = model.ia.find((layer: any) => layer.layer === "ledger").nodes[0].children; [runs[0].leaves, runs[1].leaves] = [runs[1].leaves, runs[0].leaves]; },
  // No loop raises the owner sign-off queue any more.
  P3: model => { for (const loop of LOOP_NAMES) { const read = model.loops.get(loop); if (read?.ok) model.loops.set(loop, { ok: true, steps: read.steps.filter((step: any) => !(step.decider?.by === "human" && step.decider.raise === "queue.approve")) }); } },
  // A failure route goes on to no loop.
  P4: model => { const step = steps(model, "loop.fill").find(each => each.onFail); step.onFail = { ...step.onFail, then: "loop.nowhere" }; },
  // An open fix entry about nothing a run can start from, and no waiting run holds it.
  P5: model => { model.entries = [{ queue: "queue.fix", id: "20261117T1200Z-orphan", status: "open", subject: "nothing", issues: [] }]; },
  // Producer's cascade connection loop is gone.
  P6: model => { const standards = new Map(model.loopSet.standards); standards.delete("loop.cascade"); model.loopSet = { ...model.loopSet, standards }; },
  // The skill no longer names the slot loop.
  P8: model => { model.skill = { ...model.skill, text: model.skill.text.replace("loop.slot", "the slot loop") }; },
};

describe("Producer conformance rows (U9)", () => {
  const registry = readRegistry();
  it("declares P1-P8, report-only, each with a judge; every red row has a mutation (P7 is report-only)", () => {
    expect(registry.producer.map(entry => entry.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
    expect(Object.keys(PRODUCER_ASSERTIONS).sort()).toEqual(registry.producer.map(entry => entry.id).sort());
    expect(registry.producer.every(entry => entry.status === "building" && entry.enforcedFor.length === 0)).toBe(true);
    expect(Object.keys(MUTATIONS).sort()).toEqual(registry.producer.map(entry => entry.id).filter(id => id !== "P7"));
  });
  it("is green on the all-green world", () => {
    const model = world();
    for (const id of Object.keys(PRODUCER_ASSERTIONS)) expect(PRODUCER_ASSERTIONS[id]!(model).rows, id).toEqual([]);
    for (const id of Object.keys(PRODUCER_ASSERTIONS)) expect(red(id, model), id).toBe(false);
  });
  it.each(Object.keys(MUTATIONS))("mutation proof: %s turns red, and only it", id => {
    const model = world(MUTATIONS[id]);
    expect(red(id, model)).toBe(true);
    for (const other of Object.keys(PRODUCER_ASSERTIONS).filter(each => each !== id)) expect(red(other, model), `${id} also turned ${other}`).toBe(false);
  });
  it("P1 names the slot request queue the tree misses, P2 a misplaced ledger, P4 the route, P5 the entry", () => {
    expect(PRODUCER_ASSERTIONS.P1!(world(MUTATIONS.P1)).rows).toEqual(["producer IA queue: queue.slot is not placed"]);
    // A leaf the runner does not use is no queue slot.
    const extra = world(model => { model.ia.find((layer: any) => layer.layer === "queue").nodes[0].children.push({ id: "choices-extra", label: "Extra", leaves: ["queue.extra"] }); });
    expect(PRODUCER_ASSERTIONS.P1!(extra).rows).toEqual(["producer IA queue: queue.extra is not a queue slot"]);
    // A leaf placed twice is one row (producerSlotPositions refuses it).
    const twice = world(model => { model.ia.find((layer: any) => layer.layer === "queue").nodes[0].children[0].leaves.push("queue.fix"); });
    expect(PRODUCER_ASSERTIONS.P1!(twice).rows.length).toBe(1);
    expect(PRODUCER_ASSERTIONS.P2!(world(MUTATIONS.P2)).rows).toEqual([
      "loop.fill: its ledger ledger.fill sits at 0.1.0, the loop at 0.0.0 (L1.L2.order)",
      "loop.refine: its ledger ledger.refine sits at 0.0.0, the loop at 0.1.0 (L1.L2.order)",
    ]);
    expect(PRODUCER_ASSERTIONS.P4!(world(MUTATIONS.P4)).rows).toEqual([expect.stringMatching(/^loop\.fill: step \S+ goes on to loop\.nowhere, which is no loop$/)]);
    expect(PRODUCER_ASSERTIONS.P5!(world(MUTATIONS.P5)).rows).toEqual(["queue.fix#20261117T1200Z-orphan: open, no waiting run holds it, and its subject nothing is no slot or publication a run can start from"]);
    // A waiting run that raised the entry takes it back: the same entry is no row then.
    expect(PRODUCER_ASSERTIONS.P5!(world(model => { MUTATIONS.P5!(model); model.awaited = new Set(["queue.fix#20261117T1200Z-orphan"]); })).rows).toEqual([]);
    // A slot request that does not read is no request loop.slot can take.
    expect(PRODUCER_ASSERTIONS.P5!(world(model => { model.entries = [{ queue: "queue.slot", id: "x", issues: ["$.id is required"] }]; })).rows).toEqual(["queue.slot#x: unreadable, so no loop can take it: $.id is required"]);
  });
  it("lists one-part splits as report-only findings, never red (P7)", () => {
    const judgement = PRODUCER_ASSERTIONS.P7!(world());
    expect(judgement.rows).toEqual([]);
    expect(judgement.findings).toContain("suspicious split: loops build/build-fill has one L3");
    expect(cellOf("P7", "P7", judgement)).toMatchObject({ red: false });
  });
  it("counts an unreadable tree or a missing skill as red (vacuous), never green", () => {
    const unread = world(model => { model.ia = []; model.iaIssue = "not JSON"; });
    for (const id of ["P1", "P2", "P7"]) expect(red(id, unread), id).toBe(true);
    expect(red("P8", world(model => { model.skill = { path: "skill/SKILL.md" }; }))).toBe(true);
  });
});

describe("Producer over the repo and its fixture (U9)", () => {
  it("reports Producer first, and today's known reds: the unplaced slot request queue and the skill's missing leaves", () => {
    const report = conform(readConformModel(REPO, FIXTURE, []), readRegistry(), { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false }, readProducerModel(FIXTURE));
    const producer = report.producer!;
    expect(producer.cells.map(cell => cell.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
    const rows = (id: string) => producer.cells.find(cell => cell.id === id)!.rows;
    expect(rows("P1")).toEqual(["producer IA queue: queue.slot is not placed"]);
    for (const id of ["P2", "P3", "P4", "P5"]) expect(rows(id), id).toEqual([]);
    expect(rows("P8")).toEqual(expect.arrayContaining(["loop.scope: packages/producer/skill/SKILL.md does not name it", "loop.slot: packages/producer/skill/SKILL.md does not name it"]));
    expect(report.ok).toBe(false);
    expect(formatReport(report)).toMatch(/^conform producer\n {2}RED {3}P1 /);
    expect(conformProducer(readProducerModel(FIXTURE), readRegistry()).agent).toBe("producer");
  });
  it("clossys conform --agent producer judges Producer alone and exits 1 while a row is red; an unknown subject is refused", async () => {
    const run = await runConformCli(["--agent", "producer", "--json"], REPO);
    expect(run.exitCode).toBe(1);
    expect(run.message).toMatch(/^conform producer\n/);
    expect(run.message).not.toMatch(/^conform director$/m);
    expect((run.output as { agents: unknown[] }).agents).toEqual([]);
    await expect(runConformCli(["--agent", "builder"], REPO)).rejects.toThrow(/--agent must be one of producer, director, designer, writer, publisher/);
  });
});
