import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { buildPin, cliActor, pinPath, writePinDoc } from "../records/pin.js";
import { PACKAGE_LOOPS_DIR, readPackageLoop } from "../loop/files.js";
import { LOOP_NAMES, type LoopName } from "../loop/names.js";
import { PRODUCER_LEAVES, producerIaIssues, producerSlotPositions, readProducerIa } from "../loop/producer-ia.js";
import { judgeLoopFile, loadLoopVersion } from "../loop/version.js";
import { LOOP_REACHABLE, loopReachableIssues, runLoopReachable } from "./loop-reachable.js";

type Content = { trigger: string[]; steps: Record<string, any>[]; maxRounds: number } & Record<string, unknown>;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function packaged(loop: LoopName): Content {
  const read = readPackageLoop(loop);
  if (!read.ok) throw new Error(read.reason);
  return structuredClone(read.content) as Content;
}
const step = (content: Content, id: string) => content.steps.find(s => s.id === id)!;

function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), "loop-reachable-"));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
function pin(root: string, loop: LoopName, content: unknown): void {
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent: "producer", slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: "2026-11-20T07:00:00Z", source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", loop, name), serializeCandidate(name, header, content));
  writePinDoc(pinPath(root, "producer", loop), buildPin({ agent: "producer", slotId: loop, record: { candidate: name, sha256, decidedBy: "planner", basis: "planner", at: "2026-11-20T07:00:00Z" }, createdBy: cliActor("clossys pin") }));
}

describe(LOOP_REACHABLE, () => {
  it("passes every package v1 and a consumer that pins none", () => {
    for (const loop of LOOP_NAMES) expect(loopReachableIssues(loop, packaged(loop), { packageVersion: true }), loop).toEqual([]);
    expect(runLoopReachable(consumer())).toEqual({ check: LOOP_REACHABLE, status: "pass", findings: [] });
    for (const loop of LOOP_NAMES) {
      const load = loadLoopVersion(consumer(), loop);
      expect(load.ok && load.loaded.source).toBe("package");
    }
  });

  it("kills a step with no decider (mutation 1)", () => {
    const content = packaged("loop.fill");
    delete step(content, "check").decider;
    expect(loopReachableIssues("loop.fill", content)).toContain("loop.fill: step check names no decider");
    const root = consumer();
    pin(root, "loop.fill", content);
    const load = loadLoopVersion(root, "loop.fill");
    expect(load.ok).toBe(false);
    expect(!load.ok && load.reason).toMatch(/producer\/loop\.fill\/fill-v2\.json fails loop\.reachable: loop\.fill: step check names no decider/);
    expect(runLoopReachable(root).findings).toContainEqual({ subject: "producer/loop.fill/fill-v2.json", detail: "loop.fill: step check names no decider" });
  });

  it("kills a release that can end without the ready-pin being checked (mutation 2)", () => {
    const noPin = packaged("loop.release");
    noPin.steps = noPin.steps.filter(s => s.id !== "pin");
    expect(loopReachableIssues("loop.release", noPin)).toEqual(expect.arrayContaining([
      "loop.release: the exit can be reached without release.ready: no step that runs for every slot checks it",
      "loop.release: the last step (signoff) must be the ready-pin (checks release.ready, no when)",
    ]));

    const skippable = packaged("loop.release");
    step(skippable, "pin").when = { slots: ["publisher/release.site"] };
    expect(loopReachableIssues("loop.release", skippable)).toContain("loop.release: the exit can be reached without release.ready: no step that runs for every slot checks it");

    const early = packaged("loop.release");
    step(early, "gates").checks.push("release.ready");
    expect(loopReachableIssues("loop.release", early)).toContain("loop.release: release.ready is checked before the last step; nothing runs after the ready-pin");

    const unsigned = packaged("loop.release");
    unsigned.steps = unsigned.steps.filter(s => s.id !== "signoff");
    expect(loopReachableIssues("loop.release", unsigned)).toContain("loop.release: the ready-pin has no owner queue.approve sign-off before it");

    // The same rule for the other exits: fill cannot end without pins.resolve on a step every slot runs.
    const fill = packaged("loop.fill");
    step(fill, "pick").when = { ia: ["director"] };
    expect(loopReachableIssues("loop.fill", fill)).toContain("loop.fill: the exit can be reached without pins.resolve: no step that runs for every slot checks it");
  });

  it("kills a model in a package loop version (mutation 3); a consumer version may name one", () => {
    const content = packaged("loop.refine");
    step(content, "create").decider.model = "some-model";
    expect(loopReachableIssues("loop.refine", content, { packageVersion: true })).toEqual([
      "loop.refine: step create names a model (some-model); a package loop version carries tier only (system.md 14.6)",
    ]);
    expect(judgeLoopFile({ ok: true, loop: "loop.refine", source: "package", candidate: "refine-v1.json" as never, ref: "producer/loop.refine/package:refine-v1.json", file: "x", sha256: "0".repeat(64) as never, content }).ok).toBe(false);
    expect(loopReachableIssues("loop.refine", content)).toEqual([]);
    // The shipped files themselves: tier on every agent decider, no model anywhere.
    for (const dir of readdirSync(PACKAGE_LOOPS_DIR)) for (const name of readdirSync(join(PACKAGE_LOOPS_DIR, dir))) {
      const text = readFileSync(join(PACKAGE_LOOPS_DIR, dir, name), "utf8");
      expect(text, `${dir}/${name}`).not.toMatch(/"model"/);
      for (const s of (JSON.parse(text) as { content: Content }).content.steps) if (s.decider.by === "agent") expect(s.decider.tier, `${dir}/${name} ${s.id}`).toMatch(/^(low|mid|high)$/);
    }
  });

  it("kills an unknown agent, a non-owner human, a bad onFail, a reused step id and a trigger the loop does not answer", () => {
    const issuesOf = (change: (content: Content) => void): string => { const content = packaged("loop.fill"); change(content); return loopReachableIssues("loop.fill", content).join("\n"); };
    expect(issuesOf(c => { step(c, "create").decider.agent = "stranger"; })).toMatch(/create.*stranger|decider/);
    expect(issuesOf(c => { step(c, "confirm").decider.who = "planner"; })).toMatch(/steps\[5\]\.decider must match exactly one alternative/);
    expect(issuesOf(c => { step(c, "check").onFail.then = "loop.ship"; })).toMatch(/onFail|then/);
    expect(issuesOf(c => { c.steps.push({ ...step(c, "cascade") }); })).toMatch(/step id cascade is used twice/);
    expect(issuesOf(c => { c.trigger = ["T1", "T8"]; })).toMatch(/trigger T8 does not start loop\.fill/);
  });
});

describe("Producer IA tree (producer.md 1)", () => {
  it("places the four loops, the four queues and one ledger per loop: 6 L1, 12 L2, 12 L3", () => {
    const layers = readProducerIa();
    expect(layers.map(layer => layer.layer)).toEqual(["loops", "queue", "ledger"]);
    expect(layers.flatMap(layer => layer.nodes)).toHaveLength(6);
    expect(layers.flatMap(layer => layer.nodes.flatMap(node => node.children))).toHaveLength(12);
    expect(producerSlotPositions(layers).size).toBe(12);
    expect(producerIaIssues(layers)).toEqual([]);
    expect(PRODUCER_LEAVES.ledger).toEqual(["ledger.fill", "ledger.refine", "ledger.release", "ledger.audit"]);
  });

  it("names a leaf placed twice, a missing loop and a stray leaf", () => {
    const layers = structuredClone(readProducerIa()) as any[];
    layers[0].nodes[0].children[0].leaves = ["loop.fill", "loop.ship"];
    layers[0].nodes[0].children[1].leaves = [];
    expect(producerIaIssues(layers)).toEqual(["producer IA loops: loop.refine is not placed", "producer IA loops: loop.ship is not a loops slot"]);
    layers[1].nodes[0].children[0].leaves.push("loop.fill");
    expect(producerIaIssues(layers)).toEqual(["producer IA: loop.fill is placed twice"]);
  });
});
