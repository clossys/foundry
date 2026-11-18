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
import { packagePlaces } from "../loop/known-slots.js";
import { runCli } from "../cli/main.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { recordSchema } from "../records/slot.js";
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
/** Pins a consumer loop version; by default the owner's pick (basis picked, answers ref), the only pin a loop runs. */
function pin(root: string, loop: LoopName, content: unknown, by: "owner" | "planner" | "agent" = "owner"): void {
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent: "producer", slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: "2026-11-20T07:00:00Z", source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", loop, name), serializeCandidate(name, header, content));
  const id = `20261120T0700Z-${loop.replace(".", "-")}`;
  const record = by === "owner" ? { decidedBy: `owner:queue.pick#${id}`, basis: "picked" as const }
    : by === "agent" ? { decidedBy: "agent:producer", basis: "agent" as const } : { decidedBy: "planner", basis: "planner" as const };
  const refs = by === "owner" ? [{ to: "producer/queue.pick" as never, record: id, rel: "answers" as const }] : [];
  writePinDoc(pinPath(root, "producer", loop), buildPin({ agent: "producer", slotId: loop, record: { candidate: name, sha256, at: "2026-11-20T07:00:00Z", ...record }, refs, createdBy: cliActor("clossys pin") }));
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

describe("loop.create and loop.choose (foundry-build-0048 U3)", () => {
  it("kills a create that can end without candidates.certified, and a choose that can end without a resolving pin", () => {
    const create = packaged("loop.create");
    step(create, "certify").checks = ["<slot standard>"];
    expect(loopReachableIssues("loop.create", create, { packageVersion: true })).toEqual(["loop.create: the exit can be reached without candidates.certified: no step that runs for every slot checks it"]);
    const choose = packaged("loop.choose");
    step(choose, "pick").checks = [];
    step(choose, "pick").when = { ia: ["designer/themes"] };
    expect(loopReachableIssues("loop.choose", choose, { packageVersion: true })).toContain("loop.choose: the exit can be reached without pins.resolve: no step that runs for every slot checks it");
    // The trigger set is the loop's own: release's T8 never starts CREATE.
    const t8 = packaged("loop.create");
    t8.trigger = ["T8"];
    expect(loopReachableIssues("loop.create", t8, { packageVersion: true })).toEqual(["loop.create: trigger T8 does not start loop.create (it answers T2, T3, T4, T5, T6, T7)"]);
  });
  it("CHOOSE pins through the pin gate (clossys pin --by agent), and its rank step goes back to loop.create on a failure", () => {
    const choose = packaged("loop.choose");
    expect(step(choose, "pick")).toMatchObject({ cli: "clossys pin <ref> <candidate> --by agent:<agent>", decider: { by: "agent", verb: "pick" }, checks: ["pins.resolve"] });
    expect(step(choose, "rank")).toMatchObject({ checks: ["candidates.certified"], onFail: { raise: "queue.fix", then: "loop.create" } });
    expect(choose.steps.map(each => each.id)).toEqual(["rank", "owner-pick", "pick", "confirm", "cascade"]);
  });
});

describe("Producer IA tree (producer.md 1)", () => {
  it("places the seven loops, the four queues and one ledger per loop: 6 L1, 18 L2, 18 L3", () => {
    const layers = readProducerIa();
    expect(layers.map(layer => layer.layer)).toEqual(["loops", "queue", "ledger"]);
    expect(layers.flatMap(layer => layer.nodes)).toHaveLength(6);
    expect(layers.flatMap(layer => layer.nodes.flatMap(node => node.children))).toHaveLength(18);
    expect(producerSlotPositions(layers).size).toBe(18);
    expect(producerIaIssues(layers)).toEqual([]);
    expect(PRODUCER_LEAVES.ledger).toEqual(["ledger.fill", "ledger.refine", "ledger.create", "ledger.choose", "ledger.release", "ledger.audit", "ledger.cascade"]);
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

describe("review rulings (foundry-build-0013 fix r1)", () => {
  const issues = (loop: LoopName, change: (content: Content) => void): string[] => { const content = packaged(loop); change(content); return loopReachableIssues(loop, content); };

  it("B2: kills a when that names no known slot or IA path", () => {
    expect(issues("loop.fill", c => { step(c, "confirm").when = { ia: ["writer/lexicon/voice"] }; })).toContain("loop.fill: step confirm can never run: its when names ia writer/lexicon/voice, which no known slot matches");
    expect(issues("loop.fill", c => { step(c, "owner-pick").when = { slots: ["writer/passages.legal"] }; })).toContain("loop.fill: step owner-pick can never run: its when names slots writer/passages.legal, which no known slot matches");
    // The package positions as ia sync writes them reach: the shipped when values all match a real slot.
    expect(issues("loop.fill", () => {})).toEqual([]);
  });

  it("B2: kills a fill that pins before it creates candidates", () => {
    expect(issues("loop.fill", c => { const at = c.steps.findIndex(s => s.id === "pick"); const [pick] = c.steps.splice(at, 1); c.steps.splice(1, 0, pick!); }))
      .toContain("loop.fill: no create-candidates step for every slot runs before the first pinning step (pick)");
    expect(issues("loop.fill", c => { step(c, "create").when = { ia: ["designer"] }; })).toContain("loop.fill: no create-candidates step for every slot runs before the first pinning step (owner-pick)");
  });

  it("B1/B2: the owner's pick comes before the agent pick and checks pins.resolve", () => {
    expect(issues("loop.fill", c => { const at = c.steps.findIndex(s => s.id === "owner-pick"); const [owner] = c.steps.splice(at, 1); c.steps.splice(c.steps.findIndex(s => s.id === "pick") + 1, 0, owner!); }))
      .toContain("loop.fill: step pick pins before the owner's pick (owner-pick); the owner picks those slots directly");
    expect(issues("loop.refine", c => { step(c, "owner-pick").checks = ["answer.quote-required"]; }))
      .toContain("loop.refine: the exit can be reached without pins.resolve for the slots owner-pick picks: the owner's pick step must check it");
  });

  it("B2: kills a release whose gates, compile or build run after the sign-off, or whose ready-pin an agent decides", () => {
    const move = (id: string) => (c: Content) => { const at = c.steps.findIndex(s => s.id === id); const [moved] = c.steps.splice(at, 1); c.steps.splice(c.steps.findIndex(s => s.id === "signoff") + 1, 0, moved!); };
    expect(issues("loop.release", move("gates")).join("\n")).toMatch(/loop\.release: gates \(.*\) does not run for every publication before the owner's sign-off/);
    expect(issues("loop.release", move("compile")).join("\n")).toMatch(/loop\.release: compile \(.*\) does not run for every publication before the owner's sign-off/);
    expect(issues("loop.release", move("build")).join("\n")).toMatch(/loop\.release: build \(.*\) does not run for every publication before the owner's sign-off/);
    expect(issues("loop.release", c => { step(c, "gates").when = { ia: ["designer"] }; }).join("\n")).toMatch(/loop\.release: gates \(.*\) does not run for every publication/);
    expect(issues("loop.release", c => { step(c, "pin").decider = { by: "agent", agent: "publisher", verb: "pick", tier: "mid", skill: "x" }; }))
      .toContain("loop.release: the ready-pin (pin) is decided by agent; code writes it from the owner's sign-off");
  });

  it("B2: only the owner's pin runs a consumer loop version", () => {
    for (const by of ["planner", "agent"] as const) {
      const root = consumer();
      pin(root, "loop.fill", packaged("loop.fill"), by);
      const load = loadLoopVersion(root, "loop.fill");
      expect(load.ok, by).toBe(false);
      expect(!load.ok && load.reason, by).toMatch(/only the owner pins a loop version/);
    }
    const owned = consumer();
    pin(owned, "loop.fill", packaged("loop.fill"));
    const load = loadLoopVersion(owned, "loop.fill");
    expect(load.ok && load.loaded.source).toBe("pin");
  });

  it("B2: clossys check reports loop.reachable and fails on it", async () => {
    const root = consumer();
    const clean = await runCli(["check", "--root", root]);
    expect(clean.message).toContain("loop.reachable: pass");
    pin(root, "loop.fill", packaged("loop.fill"), "planner");
    const failed = await runCli(["check", "--root", root]);
    expect(failed.exitCode).toBeGreaterThanOrEqual(1);
    expect(failed.message).toMatch(/loop\.reachable: fail \(1\)\n  producer\/loop\.fill: loop\.fill: the consumer pin is decided by planner/);
    expect((failed as { checks?: Record<string, unknown> }).checks).toHaveProperty("loop.reachable");
  });

  it("B12: every package slot position, Director l2 ids with dots included, is a valid slot/2 ia", () => {
    const slotIa = (recordSchema("slot.json") as { properties: { ia: JsonSchema } }).properties.ia;
    const viewIa = (recordSchema("slot-view.json") as { properties: { slot: { properties: { ia: JsonSchema } } } }).properties.slot.properties.ia;
    const places = packagePlaces();
    const market = places.find(place => place.agent === "director" && place.slotId === "context.market.size");
    expect(market?.ia).toEqual({ l0: "strategy", l1: "context", l2: "context.market" });
    expect(places.filter(place => place.ia.l2.includes(".")).length).toBeGreaterThan(0);
    for (const place of places) {
      const ia = { ...place.ia, order: 0 };
      expect(validateAgainst(slotIa, ia), `${place.agent}/${place.slotId}`).toEqual([]);
      expect(validateAgainst(viewIa, { l0: ia.l0, l1: ia.l1, l2: ia.l2 }), `${place.agent}/${place.slotId} view`).toEqual([]);
    }
    expect(validateAgainst(slotIa, { l0: "strategy", l1: "context", l2: "context..market", order: 0 })).not.toEqual([]);
    expect(validateAgainst(slotIa, { l0: "strategy", l1: "context", l2: ".market", order: 0 })).not.toEqual([]);
  });
});
