/**
 * P2 (slot-constitution.md section 5 and 5b): `next --submit` refuses an adapt or create rung until
 * the slot's latest verdict is create for the latest options inputs, and `next --stage` records the
 * craft stages in order (brief, diverge, render, critique, at most 2 refine rounds) with 3 to 4
 * diverge directions.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { STEPS } from "../pipeline/steps/index.js";
import "./main.js";
import { runNextSubmitCli } from "./next.js";

const ID = "components.button";
const AT = "2026-11-14T12:00:00.000Z";
const UNGUARDED = { rules: [] };
const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
const source = { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] };
let workspace: string;
let slotDir: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-craft-")));
  const agents = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID] }] }] };
  slotDir = join(agents, ID);
  mkdirSync(join(slotDir, "candidates"), { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  writeFileSync(join(slotDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", ia).get(ID), kind: "element", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(workspace, "made.json"), jsonBytes({ name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source } }));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

// options is deterministic (model none, tier none); verdict runs an LLM.
const event = (op: string, fields: Record<string, unknown>) => ({ op, at: AT, by: "planner:fixture", verb: op, skill: { path: "packages/producer/actions/options/skill.md", sha256: null }, ...(op === "options" ? { model: "none", tier: "none" } : { model: "fixture-model", tier: "mid" }), ...fields });
const ledger = (...events: Record<string, unknown>[]) => writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events }));
const ops = () => (JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")) as { events: { op: string }[] }).events.map(each => each.op);
const submit = (...ladder: string[]) => runNextSubmitCli([`designer/${ID}`, "--submit", "made.json", "--model", "fixture-model", "--tier", "high", "--basis", "agent", "--skill", skill, ...ladder], workspace, undefined, undefined, UNGUARDED);
const stage = (name: string, file?: unknown) => {
  if (file !== undefined) writeFileSync(join(workspace, "stage.json"), JSON.stringify(file));
  return runNextSubmitCli([`designer/${ID}`, "--stage", name, "--model", "fixture-model", "--tier", "high", "--skill", skill, ...(file !== undefined ? ["--file", "stage.json"] : [])], workspace);
};
const directions = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `d${index + 1}`, axes: { density: index } }));

describe("P2 precondition on next --submit", () => {
  it("lets adopt through with no verdict and refuses adapt and create until the latest verdict is create", async () => {
    expect((await submit("--rung", "L3", "--seed", "shadcn-aria/button")).message).toMatch(/rung L3 \(adapt\) is P2, which needs the slot's latest verdict to be create; the slot has no verdict/);
    expect((await submit("--rung", "L4", "--reason", "fixture: nothing fits")).exitCode).toBe(1);
    ledger(event("verdict", { verdict: "adopt" }));
    expect((await submit("--rung", "L4", "--reason", "fixture: nothing fits")).message).toMatch(/it is adopt/);
    ledger(event("verdict", { verdict: "adopt" }), event("verdict", { verdict: "create" }));
    const made = await submit("--rung", "L4", "--reason", "fixture: nothing fits");
    expect(made.exitCode, made.message).toBe(0);
    expect(ops().at(-1)).toBe("submit");
  });

  it("refuses a create verdict for other inputs than the latest options packet's", async () => {
    ledger(event("options", { inputsHash: "a".repeat(64) }), event("verdict", { verdict: "create", inputsHash: "a".repeat(64) }), event("options", { inputsHash: "b".repeat(64) }));
    expect((await submit("--rung", "L4", "--reason", "fixture: nothing fits")).message).toMatch(/create verdict is for inputsHash a+, not the latest options packet's b+; re-run P1/);
  });

  it("needs no verdict for adopt", async () => {
    const made = await submit("--rung", "L1", "--seed", "shadcn-aria/button");
    expect(made.exitCode, made.message).toBe(0);
  });
});

describe("next --stage", () => {
  it("is P2 only: refused while the slot has no create verdict", async () => {
    expect((await stage("brief")).message).toMatch(/craft is P2/);
  });

  it("records brief, diverge, render, critique and at most 2 refine rounds, in order", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await stage("diverge", directions(3))).message).toMatch(/after nothing the next stage is not diverge/);
    expect((await stage("brief", { goal: "a quieter button" })).exitCode).toBe(0);
    expect((await stage("render")).message).toMatch(/next stage is not render/);
    expect((await stage("diverge", directions(2))).message).toMatch(/2 directions; 3 to 4 required \(cap 4\)/);
    expect((await stage("diverge", directions(5))).message).toMatch(/5 directions; 3 to 4 required/);
    expect((await stage("diverge", [{ id: "d1" }, ...directions(2)])).message).toMatch(/direction 1 carries no axes/);
    // R15.7 at write time: identical axis values are cosmetic variants, and every direction names every axis.
    const same = directions(3).map(direction => ({ ...direction, axes: { ...direction.axes, tone: "quiet" } }));
    expect((await stage("diverge", same)).message).toMatch(/directions repeat a value on axis tone: cosmetic variants \(R15\.7\)/);
    expect((await stage("diverge", directions(3).map(direction => ({ ...direction, axes: { density: 1 } })))).message).toMatch(/repeat a value on axis density/);
    const partial = directions(3).map((direction, index) => index ? direction : { ...direction, axes: { ...direction.axes, tone: "loud" } });
    expect((await stage("diverge", partial)).message).toMatch(/a direction has no value on axis tone \(R15\.7\)/);
    expect(ops().filter(op => op === "craft:diverge")).toEqual([]);
    expect((await stage("diverge", directions(4))).exitCode).toBe(0);
    for (const name of ["render", "critique", "refine", "render", "critique", "refine", "render", "critique"]) expect((await stage(name)).exitCode, name).toBe(0);
    expect((await stage("refine")).message).toMatch(/at most 2 refine rounds/);
    expect(ops().filter(op => op.startsWith("craft:"))).toEqual(["craft:brief", "craft:diverge", "craft:render", "craft:critique", "craft:refine", "craft:render", "craft:critique", "craft:refine", "craft:render", "craft:critique"]);
    // A submit closes the run: the next run starts at brief again.
    expect((await submit("--rung", "L4", "--reason", "fixture: nothing fits")).exitCode).toBe(0);
    expect((await stage("render")).exitCode).toBe(1);
    expect((await stage("brief")).exitCode).toBe(0);
  });
});
