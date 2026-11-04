import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { parsePipelineArgs, runPipelineCli } from "../cli/pipeline.js";
import { defineStep, STAGES, StepDefinitionError } from "./define.js";
import type { Stage } from "./define.js";
import { buildGraph, deriveEdges, graphJson, schemaMismatches, untypedPorts } from "./graph.js";
import { computeLayout, LAYOUT_CONSTANTS, UNSTAGED } from "./layout.js";
import { holderOf, laneIds, laneOf, ROSTER, UNASSIGNED } from "./roster.js";
import { portsOverlap } from "./globs.js";
import { stepOptions } from "./options.js";
import { runPipeline, selectStep } from "./runner.js";
import { loadSchema, validateFile } from "./schema.js";
import { ELEMENT_SCHEMA, SELECTION_SCHEMA } from "../records/schemas.js";
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
    // studio-map.json is typed, so it feeds the Studio checks; a port with no schema feeds no edge and is listed as untyped.
    expect(edges.some(edge => edge.from === "studio.map" && edge.to === "studio.checks")).toBe(true);
    expect(edges.some(edge => edge.from === "studio.map" && edge.to === "capture")).toBe(true);
    expect(untypedPorts(STEPS)).not.toContainEqual({ step: "studio.map", port: "output", glob: "pkg:studio/generated/studio-map.json" });
    expect(untypedPorts(STEPS)).toContainEqual({ step: "studio.map", port: "output", glob: "pkg:studio/generated/assembly-bindings.ts" });
    const make = (id: string, inputs: { glob: string; schema?: string }[], outputs: { glob: string; schema?: string }[]) =>
      defineStep({ id, kind: "plumb", actor: "code", stage: "check", summary: id, inputs, outputs, command: { npm: "x" }, checks: [] });
    const a = make("a", [], [{ glob: "x/*.json", schema: "slot" }]);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json", schema: "slot" }], [])])).toHaveLength(1);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json" }], [])])).toHaveLength(0);
    expect(deriveEdges([a, make("b", [{ glob: "x/b.json", schema: "pin" }], [])])).toHaveLength(0);
    expect(schemaMismatches([a, make("b", [{ glob: "x/b.json", schema: "pin" }], [])])).toHaveLength(1);
    expect(deriveEdges([a, make("b", [{ glob: "y/b.json", schema: "slot" }], [])])).toHaveLength(0);
  });
  it("gives each rank in a stage its own block of sub-columns, lower ranks further left", () => {
    // r0a..r0d wrap into two sub-columns at rank 0 in one cell; s1 (rank 1, another lane) starts after both.
    const steps = [...["r0a", "r0b", "r0c", "r0d"].map(id => ({ id, lane: "you", stage: "make" })), { id: "s1", lane: "checks", stage: "make" }, { id: "t2", lane: "you", stage: "make" }];
    const layout = computeLayout(steps, [{ from: "r0a", to: "s1" }, { from: "s1", to: "t2" }], { lanes: ROSTER, stages: STAGES });
    const n = layout.nodes, C = LAYOUT_CONSTANTS;
    expect([n.r0a!.rank, n.s1!.rank, n.t2!.rank]).toEqual([0, 1, 2]);
    const rank0 = Math.max(...["r0a", "r0b", "r0c", "r0d"].map(id => n[id]!.x));
    expect(rank0).toBe(n.r0a!.x + C.columnGap);
    expect(n.s1!.x).toBe(rank0 + C.columnGap);
    expect(n.t2!.x).toBe(n.s1!.x + C.columnGap);
    const make = layout.stages.find(stage => stage.id === "make")!;
    expect(make.width).toBe(3 * C.columnGap + C.nodeWidth);
  });
  it("lays out lanes by holder and columns by stage, ranking by longest path and breaking cycles in step id order", () => {
    const make = (id: string, stage: Stage, inputs: string[], outputs: string[]) => ({ id, stage, inputs: inputs.map(glob => ({ glob, schema: "slot" })), outputs: outputs.map(glob => ({ glob, schema: "slot" })) });
    const lanes = { c: "checks", b: "you", a: "you", d: "designer" } as Record<string, string>;
    const steps = [make("c", "check", ["q/*"], []), make("b", "pin", ["p/*"], ["q/1"]), make("a", "brief", ["q/*"], ["p/1"]), make("d", "make", [], ["p/2"])];
    const edges = deriveEdges(steps as never);
    const axes = { lanes: ROSTER, stages: STAGES };
    const layout = computeLayout(steps.map(step => ({ id: step.id, lane: lanes[step.id]!, stage: step.stage })), edges, axes);
    const C = LAYOUT_CONSTANTS;
    // Every roster entry is a lane, empty ones included; every stage is a column, in STAGES order.
    expect(layout.lanes.map(lane => lane.id)).toEqual([...ROSTER]);
    expect(layout.stages.map(stage => stage.id)).toEqual([...STAGES]);
    expect(layout.cycleBreaks).toEqual([{ from: "a", to: "b" }]);
    expect(Object.fromEntries(Object.entries(layout.nodes).map(([id, node]) => [id, node.rank]))).toEqual({ a: 2, b: 1, c: 2, d: 0 });
    const stageX = (id: string) => layout.stages.find(stage => stage.id === id)!.x;
    expect(layout.nodes.b).toEqual({ lane: "you", stage: "pin", rank: 1, x: stageX("pin"), y: 0 });
    expect(layout.nodes.a!.x).toBeLessThan(layout.nodes.b!.x);
    expect(layout.nodes.c!.y).toBe(layout.lanes.find(lane => lane.id === "checks")!.y);
    expect(layout.stages.every(stage => stage.y === -C.stageLabelHeight)).toBe(true);
    // A stage outside STAGES sits in the trailing unstaged column instead of throwing.
    const odd = computeLayout([{ id: "x", lane: "you", stage: "later" }], [], axes);
    expect(odd.stages.at(-1)!.id).toBe(UNSTAGED);
    expect(odd.nodes.x!.stage).toBe(UNSTAGED);
    const reversed = [...steps].reverse();
    expect(JSON.stringify(computeLayout(reversed.map(step => ({ id: step.id, lane: lanes[step.id]!, stage: step.stage })), [...edges].reverse(), axes))).toBe(JSON.stringify(layout));
  });
  it("orders cells by barycenter and wraps a cell past cellRows into sub-columns", () => {
    const make = (id: string, inputs: string[], outputs: string[]) =>
      defineStep({ id, kind: "plumb", actor: "code", stage: id.startsWith("t") ? "brief" : "check", summary: id,
        inputs: inputs.map(glob => ({ glob, schema: "slot" })), outputs: outputs.map(glob => ({ glob, schema: "slot" })), command: { npm: "x" }, checks: [] });
    // s1..s5 share one checks/check cell: three rows, the rest wrap into a second sub-column.
    const steps = [make("t1", [], ["a/1"]), make("t2", [], ["b/1"]), ...["s1", "s2", "s3", "s4"].map(id => make(id, ["a/*"], [])), make("s5", ["b/*"], [])];
    const axes = { lanes: ["checks"], stages: STAGES };
    const toLayout = (list: typeof steps) => list.map(step => ({ id: step.id, lane: "checks", stage: step.stage }));
    const layout = computeLayout(toLayout(steps), deriveEdges(steps), axes);
    const C = LAYOUT_CONSTANTS;
    const cell = ["s1", "s2", "s3", "s4", "s5"].map(id => layout.nodes[id]!);
    const check = layout.stages.find(stage => stage.id === "check")!;
    expect(new Set(cell.map(node => node.stage))).toEqual(new Set(["check"]));
    expect(Math.max(...cell.map(node => node.y)) - layout.lanes[0]!.y).toBe((C.cellRows - 1) * C.rowGap);
    expect(new Set(cell.map(node => node.x - check.x))).toEqual(new Set([0, C.columnGap]));
    expect(check.width).toBe(C.columnGap + C.nodeWidth);
    expect(new Set(cell.map(node => `${node.x},${node.y}`)).size).toBe(5);
    expect(layout.crossings.after).toBeLessThanOrEqual(layout.crossings.before);
    const reversed = [...steps].reverse();
    expect(JSON.stringify(computeLayout(toLayout(reversed), deriveEdges(reversed), axes))).toBe(JSON.stringify(layout));
  });
  it("writes a layout for every node, byte-identical across builds", () => {
    const root = workspace();
    const graph = buildGraph(root);
    expect(graph.nodes.every(node => Number.isInteger(node.layout.x) && Number.isInteger(node.layout.y) && node.layout.lane === laneOf(node.holder) && node.layout.stage === node.stage)).toBe(true);
    expect(graphJson(buildGraph(root))).toBe(graphJson(graph));
  });
  it("derives each step's holder from its seat file or its kind, and lists every roster entry", () => {
    const root = workspace();
    const graph = buildGraph(root);
    const holder = (id: string) => graph.nodes.find(node => node.id === id)!.holder;
    expect(holder("ia")).toEqual({ id: "you", kind: "you", source: "derived", tier: null });
    expect(holder("designer.candidates")).toEqual({ id: "designer", kind: "ai", source: "derived", tier: null });
    expect(holder("decisions")).toEqual({ id: "checks", kind: "code", source: "derived", tier: null });
    expect(holder("compile")).toEqual({ id: "publisher", kind: "code", source: "derived", tier: null });
    expect(graph.roster.map(entry => entry.id)).toEqual([...ROSTER]);
    expect(graph.roster.reduce((sum, entry) => sum + entry.steps, 0)).toBe(graph.nodes.length);
    expect(holderOf({ kind: "decide:judgment", actor: "owner", stage: "pin" }, { path: "x", state: "partial", by: "agent:writer", llm: { model: "m", tier: "mid", promptFile: "p" }, human: "open", issues: [] }))
      .toEqual({ id: "writer", kind: "ai", source: "file", tier: "mid" });
    expect(holderOf({ kind: "decide:judgment", actor: "owner", stage: "pin" }, { path: "x", state: "partial", by: "planner", llm: "open", human: "open", issues: [] }).id).toBe("planner");
    expect(laneIds([{ id: "planner", kind: null, source: "file", tier: null }])).toEqual([...ROSTER, UNASSIGNED]);
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
    const later = defineStep({ id: "later", kind: "plumb", actor: "code", stage: "publish", summary: "x", inputs: [], outputs: [], command: { cli: { verb: "later" }, entry: "src/cli/later.ts#runLater" }, checks: [], pending: { branch: "claude/later", change: "adds" } });
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
    expect(Object.keys(graph.output as object).sort()).toEqual(["edges", "layout", "nodes", "options", "roster", "rule", "schema", "seats", "status", "untyped"]);
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
  it("keeps the library element and selection port schemas equal to the record schemas", () => {
    expect(loadSchema("library-element")).toEqual(JSON.parse(JSON.stringify(ELEMENT_SCHEMA)));
    expect(loadSchema("selection")).toEqual(JSON.parse(JSON.stringify(SELECTION_SCHEMA)));
  });
  it("validates the source receipt", () => {
    expect(validateFile("source-receipt", "x/source-receipt.json", JSON.stringify({ schemaVersion: 1, sourceHead: "a".repeat(40), sourceDirty: false }))).toEqual([]);
    expect(validateFile("source-receipt", "x/source-receipt.json", JSON.stringify({ schemaVersion: 1, sourceHead: "HEAD", sourceDirty: false })).length).toBeGreaterThan(0);
  });
});
