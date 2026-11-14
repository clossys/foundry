import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import "./main.js";
import { runCritiqueCli, runCritiquePacketCli, type PacketItem } from "./critique.js";

const ID = "components.button";
const AT = "2026-11-14T12:00:00.000Z";
const STANDARD = "element.bold";
let workspace: string;
let slotDir: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-critique-")));
  const agents = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID] }] }] };
  slotDir = join(agents, ID);
  mkdirSync(join(slotDir, "candidates"), { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  writeFileSync(join(slotDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", ia).get(ID), kind: "element", contract: {}, inputs: [], uses: [] }));
  const standard = join(workspace, "packages", "designer", "standards", STANDARD);
  mkdirSync(join(standard, "exemplars"), { recursive: true });
  writeFileSync(join(standard, "taste.md"), "# Taste\n");
  for (const name of ["a.png", "b.png", "c.png", "d.png"]) writeFileSync(join(standard, "exemplars", name), name);
  mkdirSync(join(workspace, "renders"), { recursive: true });
  for (const name of ["one", "two", "three"]) writeFileSync(join(workspace, "renders", `${name}.png`), `render ${name}`);
  mkdirSync(join(workspace, "packages", "designer", "recipes"), { recursive: true });
  writeFileSync(join(workspace, "packages", "designer", "recipes", "button.json"), "{}");
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const packet = (...args: string[]) => runCritiquePacketCli([`designer/${ID}`, "--standard", STANDARD, ...args], workspace);
const renders = ["--render", "renders/one.png", "--render", "renders/two.png", "--render", "renders/three.png"];

describe("clossys critique-packet", () => {
  it("lists a closed manifest: taste.md, at most 3 exemplars, the contract and anonymised, shuffled renders", async () => {
    const result = await packet(...renders);
    expect(result.exitCode, result.message).toBe(0);
    const out = result.output as { items: PacketItem[]; manifest: { role: string; ref: string }[] };
    expect(out.items.map(item => item.role)).toEqual(["taste", "exemplar", "exemplar", "exemplar", "contract", "render", "render", "render"]);
    expect(out.manifest.map(item => item.ref).slice(0, 5)).toEqual([
      `packages/designer/standards/${STANDARD}/taste.md`, ...["a", "b", "c"].map(name => `packages/designer/standards/${STANDARD}/exemplars/${name}.png`), `clossys/agents/designer/${ID}/slot.json#contract`,
    ]);
    expect(out.items.filter(item => item.role === "render").map(item => item.label)).toEqual(["A", "B", "C"]);
    // The order is the bytes', never the maker's: any order of --render gives the same packet.
    const reversed = await packet("--render", "renders/three.png", "--render", "renders/one.png", "--render", "renders/two.png");
    expect(reversed.output).toEqual(result.output);
    expect(readFileSync(join(slotDir, "slot.json"), "utf8")).toContain(ID);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
  });

  it("refuses anything of the maker, a missing taste.md and more than 3 exemplars", async () => {
    expect((await packet("--render", "packages/designer/recipes/button.json")).message).toMatch(/never a recipe file, direction notes or the maker/);
    expect((await packet(...renders, "--exemplar", "x", "--exemplar", "y", "--exemplar", "z", "--exemplar", "w")).message).toMatch(/at most 3/);
    rmSync(join(workspace, "packages", "designer", "standards", STANDARD, "taste.md"));
    expect((await packet(...renders)).message).toMatch(/taste.md is missing/);
  });
});

describe("clossys critique --record", () => {
  const record = (manifest: { role: string; ref: string }[], slot = ID) => {
    writeFileSync(join(workspace, "critique.json"), JSON.stringify({ schema: "clossys.critique/1", slot, candidate: "button-v1.json", standard: STANDARD, scores: { "taste.contrast": 4 }, packet: { manifest } }));
    return runCritiqueCli([`designer/${ID}`, "--record", "critique.json", "--model", "fixture-critic", "--tier", "high", "--at", AT], workspace);
  };
  const allowed = [{ role: "taste", ref: `packages/designer/standards/${STANDARD}/taste.md` }, { role: "contract", ref: `clossys/agents/designer/${ID}/slot.json#contract` }, { role: "render", ref: "renders/one.png" }];
  const craft = (...stages: string[]) => writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events: stages.map(stage => ({ op: `craft:${stage}`, at: AT, by: "agent:designer.candidates", verb: "submit", skill: { path: "packages/designer/actions/designer.candidates/skill.md", sha256: null }, model: "m", tier: "high" })) }));

  it("writes critiques/<leaf>-v<n>.json and its craft:critique event after render", async () => {
    craft("brief", "diverge", "render");
    const result = await record(allowed);
    expect(result.exitCode, result.message).toBe(0);
    expect(JSON.parse(readFileSync(join(slotDir, "critiques", "button-v1.json"), "utf8")).scores).toEqual({ "taste.contrast": 4 });
    const events = JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")).events as Record<string, unknown>[];
    expect(events.at(-1)).toMatchObject({ op: "craft:critique", verb: "critique", by: "agent:designer.critic", model: "fixture-critic", tier: "high", critique: "critiques/button-v1.json" });
  });

  it("refuses a manifest listing the maker, another slot's record and a critique out of craft order", async () => {
    craft("brief", "diverge", "render");
    expect((await record([...allowed, { role: "render", ref: "packages/designer/recipes/button.json" }])).message).toMatch(/never a recipe file/);
    expect((await record(allowed, "components.card")).message).toMatch(/names slot components.card/);
    expect(existsSync(join(slotDir, "critiques"))).toBe(false);
    craft("brief");
    expect((await record(allowed)).message).toMatch(/next stage is not critique/);
    expect(existsSync(join(slotDir, "critiques", "button-v1.json"))).toBe(false);
  });
});
