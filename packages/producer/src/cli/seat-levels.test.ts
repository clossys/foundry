/**
 * CP1-D7B: the seat tree carries the package's L0 layer and closed axes (src/catalog/ia/levels.json). After the seat
 * verb places the rounds, producer ia.json has the Pipeline layer over the placed rounds and the package axes, every
 * seat slot.json sits at its layered position, `ia sync --check` finds no producer drift, and R01 reports no
 * producer row (diagnosis-cp1-d7 option 5: no R01.7, R01.8 or R01.12 on the seat tree).
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli, runSeatCli } from "./owner.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { readPipelineSeats } from "../records/slot-model/pipeline-seats.js";
import { buildContext } from "../constitution/context.js";
import { R01 } from "../constitution/checks/R01-catalog.js";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const AT = "2026-11-26T00:00:00Z";
const levels = JSON.parse(readFileSync(join(PRODUCER_ROOT, "src", "catalog", "ia", "levels.json"), "utf8")) as { layers: { id: string; label: string; nodes: string[] }[]; axes: Record<string, unknown> };

function consumer(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "seat-levels-")));
  temps.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
/** Seat `step` with its package default (pipeline/seats.json), the tier placeholder filled with a fixture model. */
async function seat(root: string, step: string) {
  const at = readPipelineSeats().seats[step]!;
  const argv = [step, "--by", at.by, "--decided-by", "planner:cp1-d7b-fixture", "--at", AT, "--root", root];
  if (at.llm) argv.push("--model", `fixture-${at.llm.tier}`, "--tier", at.llm.tier, "--prompt-file", at.llm.promptFile); else argv.push("--no-llm");
  if (at.human) argv.push("--procedure", at.human.procedure, "--command", at.human.command);
  const result = await runSeatCli(argv, root);
  expect(result.exitCode, `seat ${step}: ${result.message}`).toBe(0);
}
const producerIa = (root: string) => JSON.parse(readFileSync(join(root, "clossys", "agents", "producer", "ia.json"), "utf8")) as { nodes: { id: string; children: { id: string; slots: string[] }[] }[]; layers?: unknown; axes?: unknown };

describe("the seat verb levels the producer IA by the package's Pipeline layer and axes", { timeout: 120_000 }, () => {
  it("the package declares one Pipeline L0 over the Direct, Design and Publish rounds", () => {
    expect(levels.layers).toEqual([{ id: "pipeline", label: "Pipeline", nodes: readPipelineSeats().nodes.map(node => node.id) }]);
    expect(levels.axes).toEqual({ L0: { name: "Pipeline stage", values: ["Pipeline"] }, L1: { pipeline: { name: "Seat round", values: readPipelineSeats().nodes.map(node => node.label) } } });
  });

  it("a first seat writes the Pipeline layer over the one round it places", async () => {
    const root = consumer();
    await seat(root, "ia");
    const ia = producerIa(root);
    expect(ia.nodes.map(node => node.id)).toEqual(["direct"]);
    expect(ia.layers).toEqual([{ id: "pipeline", label: "Pipeline", nodes: ["direct"] }]);
    expect(ia.axes).toEqual(levels.axes);
  });

  it("after every package seat, ia.json carries the layer and axes, ia sync finds no producer drift and R01 no producer row", async () => {
    const root = consumer();
    for (const step of Object.keys(readPipelineSeats().seats)) await seat(root, step);
    const ia = producerIa(root);
    expect(ia.layers).toEqual(levels.layers);
    expect(ia.axes).toEqual(levels.axes);
    // Every seat slot.json sits where the layered IA places it (pipeline/<round>/<stage>, the stage without its round prefix).
    for (const node of ia.nodes) for (const child of node.children) for (const id of child.slots) {
      const doc = JSON.parse(readFileSync(join(root, "clossys", "agents", "producer", id, "slot.json"), "utf8")) as { ia: { l0: string; l1: string; l2: string } };
      expect(doc.ia, id).toMatchObject({ l0: "pipeline", l1: `pipeline/${node.id}`, l2: `pipeline/${node.id}/${child.id.slice(node.id.length + 1)}` });
    }
    const check = await runIaCli(["sync", "--check", "--agent", "producer", "--root", root], root);
    expect(check.exitCode, check.message).toBe(0);
    expect(check.message).toContain("producer: in sync");
    const ctx = buildContext(root, join(root, "clossys"));
    const rows = Object.values(R01.checks).flatMap(each => each(ctx)).filter(row => row.agent === "producer");
    expect(rows.map(row => `${row.check} ${row.slot}: ${row.reason}`)).toEqual([]);
  });
});
