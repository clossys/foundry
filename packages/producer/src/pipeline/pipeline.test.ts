import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { parsePipelineArgs, runPipelineCli } from "../cli/pipeline.js";
import { defineStep, StepDefinitionError } from "./define.js";
import { buildGraph, deriveEdges, graphJson, schemaMismatches, untypedPorts } from "./graph.js";
import { computeLayout, LAYOUT_CONSTANTS } from "./layout.js";
import { portsOverlap } from "./globs.js";
import { stepOptions } from "./options.js";
import { runPipeline, selectStep } from "./runner.js";
import { validateFile } from "./schema.js";
import { readSeat } from "./seats.js";
import { pipelineStatus, slotCounts } from "./status.js";
import { STEPS } from "./steps/index.js";

const step = (id: string) => STEPS.find(candidate => candidate.id === id)!;
const dirs: string[] = [];
const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), "pipeline-"));
  dirs.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {}\n");
  const slot = (agent: string, id: string, candidates: string[], pin?: string) => {
    const dir = join(root, "clossys", "agents", agent, id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), "{}\n");
    for (const name of candidates) writeFileSync(join(dir, "candidates", name), "{}\n");
    if (pin) writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: pin }));
  };
  slot("designer", "hero", ["a.json", "b.json"], "a.json");
  slot("designer", "footer", ["a.json"]);
  slot("writer", "hero", []);
  return root;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("step definitions", () => {
  it("refuses hand-listed edges, options and config", () => {
    for (const key of ["edges", "options", "dependsOn", "configKeys"]) {
      expect(() => defineStep({ id: "x", kind: "plumb", actor: "code", stage: "check", summary: "x", inputs: [], outputs: [], command: { npm: "x" }, checks: [], [key]: [] } as never))
        .toThrow(StepDefinitionError);
    }
  });
  it("keeps plumb steps on code and decide steps off it", () => {
    expect(() => defineStep({ id: "x", kind: "plumb", actor: "owner", stage: "check", summary: "x", inputs: [], outputs: [], command: { npm: "x" }, checks: [] })).toThrow(/actor is code/);
    expect(() => defineStep({ id: "x", kind: "decide:judgment", actor: "code", stage: "pin", summary: "x", inputs: [], outputs: [], command: { manual: "x" }, checks: [] })).toThrow(/deciding actor/);
  });
  it("gives every decide step a seat file and no plumb step one", () => {
    for (const each of STEPS) expect(Boolean(each.seat)).toBe(each.kind !== "plumb");
    expect(step("pin").seat).toBe("clossys/agents/producer/pin/seat.json");
  });
});

describe("derived graph", () => {
  it("derives edges only from overlapping globs that name the same schema", () => {
    expect(portsOverlap("clossys/agents/*/*/pin.json", "clossys/agents/designer/*/pin.json")).toBe(true);
    expect(portsOverlap("clossys/agents/*/*/pin.json", "clossys/agents/*/*/slot.json")).toBe(false);
    const edges = deriveEdges(STEPS);
    expect(edges.some(edge => edge.from === "pin" && edge.to === "publish.install")).toBe(true);
    expect(edges.every(edge => edge.via.length > 0 && edge.via.every(via => typeof via.schema === "string"))).toBe(true);
    // studio-map.json names no schema yet: no edge, and the port is listed as untyped instead.
    expect(edges.some(edge => edge.from === "studio.map" && edge.to === "studio.checks")).toBe(false);
    expect(untypedPorts(STEPS)).toContainEqual({ step: "studio.map", port: "output", glob: "pkg:studio/generated/studio-map.json" });
    const make = (id: string, inputs: { glob: string; schema?: string }[], outputs: { glob: string; schema?: string }[]) =>
      defineStep({ id, kind: "plumb", actor: "code", stage: "check", summary: id, inputs, outputs, command: { npm: "x" }, checks: [] });
    const a = make("a", [], [{ glob: "x/*.json", schema: "slot" }]);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json", schema: "slot" }], [])])).toHaveLength(1);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json" }], [])])).toHaveLength(0);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json", schema: "pin" }], [])])).toHaveLength(0);
    expect(schemaMismatches([a, make("b", [{ glob: "x/b.json", schema: "pin" }], [])])).toHaveLength(1);
    expect(deriveEdges([a, make("b", [{ glob: "y/b.json", schema: "slot" }], [])])).toHaveLength(0);
  });
  it("lays out lanes by actor and ranks by longest path, breaking cycles in step id order from the sources", () => {
    const make = (id: string, actor: string, inputs: string[], outputs: string[]) =>
      defineStep({ id, kind: actor === "code" ? "plumb" : "decide:judgment", actor, stage: "check", summary: id,
        inputs: inputs.map(glob => ({ glob, schema: "slot" })), outputs: outputs.map(glob => ({ glob, schema: "slot" })), command: { npm: "x" }, checks: [] });
    const steps = [make("c", "code", ["q/*"], []), make("b", "owner", ["p/*"], ["q/1"]), make("a", "owner", ["q/*"], ["p/1"]), make("d", "agent:x", [], ["p/2"])];
    const edges = deriveEdges(steps);
    const layout = computeLayout(steps, edges);
    expect(layout.lanes.map(lane => lane.id)).toEqual(["owner", "agent:x", "code"]);
    expect(layout.cycleBreaks).toEqual([{ from: "a", to: "b" }]);
    expect(Object.fromEntries(Object.entries(layout.nodes).map(([id, node]) => [id, node.rank]))).toEqual({ a: 2, b: 1, c: 2, d: 0 });
    expect(layout.nodes.b).toEqual({ lane: "owner", rank: 1, x: LAYOUT_CONSTANTS.rankGap, y: 0 });
    expect(layout.nodes.c!.y).toBe(layout.lanes[2]!.y);
    expect(JSON.stringify(computeLayout([...steps].reverse(), [...edges].reverse()))).toBe(JSON.stringify(layout));
  });
  it("writes a layout for every node, byte-identical across builds", () => {
    const root = workspace();
    const graph = buildGraph(root);
    expect(graph.nodes.every(node => Number.isInteger(node.layout.x) && Number.isInteger(node.layout.y) && node.layout.lane === node.actor)).toBe(true);
    expect(graphJson(buildGraph(root))).toBe(graphJson(graph));
  });
  it("reads options from the verb's parser", () => {
    const flags = stepOptions(step("workspace.check"))!.map(option => option.flag);
    expect(flags).toContain("--report");
    expect(flags).not.toContain("--install");
    expect(stepOptions(step("workspace.check"))!.find(option => option.flag === "--report")!.value).toBe(true);
    expect(stepOptions(step("pin"))!.map(option => option.flag)).toContain("--by");
  });
  it("reads an unassigned seat as open and the pin seat as owner-held", () => {
    const root = workspace();
    expect(readSeat(root, step("pin"))!.state).toBe("unassigned");
    mkdirSync(join(root, "clossys", "agents", "producer", "pin"), { recursive: true });
    writeFileSync(join(root, "clossys", "agents", "producer", "pin", "seat.json"), JSON.stringify({ by: "owner", llm: null, human: { procedure: "p", command: "clossys pin" } }));
    const seat = readSeat(root, step("pin"))!;
    expect([seat.state, seat.by, seat.llm]).toEqual(["partial", "owner", "open"]);
    writeFileSync(join(root, "clossys", "agents", "producer", "pin", "seat.json"), JSON.stringify({ by: "code", llm: null, human: null }));
    expect(readSeat(root, step("pin"))!.state).toBe("invalid");
    expect(buildGraph(root).seats.pin!.state).toBe("invalid");
  });
});

describe("runner", () => {
  it("selects the most specific step for a verb's mode flags", () => {
    expect(selectStep("design", parseArgs(["design", "--check"]))!.id).toBe("designer.check");
    expect(selectStep("design", parseArgs(["design"]))!.id).toBe("designer.compile");
    expect(selectStep("publish", parseArgs(["publish", "--install", "--page", "x"]))!.id).toBe("publish.install");
  });
  it("refuses a pending step and a verb no step declares", async () => {
    const root = workspace();
    const later = defineStep({ id: "later", kind: "plumb", actor: "code", stage: "operate", summary: "x", inputs: [], outputs: [], command: { cli: { verb: "later" }, entry: "src/cli/later.ts#runLater" }, checks: [], pending: { branch: "claude/later", change: "adds" } });
    const pending = await runPipeline(["later"], root, [...STEPS, later]);
    expect(pending.exitCode).toBe(2);
    expect(pending.message).toMatch(/pending; it lands on claude\/later/);
    const without = await runPipeline(["check"], root, STEPS.filter(each => each.id !== "workspace.check"));
    expect([without.exitCode, without.message]).toEqual([2, "check: no pipeline step declares this command"]);
  });
});

describe("status", () => {
  it("counts slots, candidates, pins and open slots per agent from real files", () => {
    const root = workspace();
    expect(slotCounts(root).designer).toMatchObject({ slots: 2, candidates: 3, pinned: 1, notNeeded: 0, open: 1 });
    expect(slotCounts(root).writer).toMatchObject({ slots: 1, candidates: 0, pinned: 0, open: 1 });
    const status = pipelineStatus(root);
    expect(status.steps.find(each => each.id === "pin")!.state).toBe("ready");
    expect(status.steps.every(each => each.checks.every(check => check.state !== "pass" as never))).toBe(true);
  });
  it("prints status and graph through the pipeline verb", async () => {
    const root = workspace();
    expect(() => parsePipelineArgs(["status", "--out", "x"])).toThrow(/--out requires pipeline graph/);
    const graph = await runPipelineCli(["graph", "--root", root], root);
    expect(Object.keys(graph.output as object).sort()).toEqual(["edges", "layout", "nodes", "options", "rule", "schema", "seats", "status", "untyped"]);
    expect((await runPipeline(["pipeline", "status", "--root", root], root)).exitCode).toBe(0);
    expect((await runPipelineCli(["status"], tmpdir())).exitCode).toBe(2);
  });
});

describe("port schemas", () => {
  it("validates pins and seats against their schemas", () => {
    expect(validateFile("pin", "x/pin.json", JSON.stringify({ candidate: "hero-v1.json", sha256: "0".repeat(64), decidedBy: "owner:me", at: "2026-11-03T00:00:00Z" }))).toEqual([]);
    expect(validateFile("pin", "x/pin.json", JSON.stringify({ candidate: "hero-v1.json", sha256: "0".repeat(64), pinnedBy: "owner:me", at: "2026-11-03T00:00:00Z" })).length).toBeGreaterThan(0);
    expect(validateFile("pin", "x/pin.json", JSON.stringify({ candidate: "a.json" })).length).toBeGreaterThan(0);
    expect(validateFile("seat", "x/seat.json", JSON.stringify({ by: "owner", llm: null, human: null }))).toEqual([]);
    expect(validateFile("seat", "x/seat.json", JSON.stringify({ by: "owner", llm: { model: "m", tier: "max", promptFile: "p" }, human: null })).length).toBeGreaterThan(0);
  });
});
