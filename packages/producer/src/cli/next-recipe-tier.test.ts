/**
 * The recipe tier guard (CP1-L2): recipe.json declares the lowest tier a craft run under it runs at (its craft.md
 * "Tier:" line), and `next --stage --recipe` and `next --submit` refuse a lower `--tier` (low < mid < high).
 * - create.component is high: a brief at mid is refused by name, at high it is recorded; a mid submission closing an
 *   open create.component run is refused, a high one is taken.
 * - create.app-section is mid: the stages and the submission at mid are taken.
 * World: one P2 Designer slot (verdict create) whose one input is a pinned Director slot, with this repository's
 * Designer standards and recipes copied into packages/designer/ (code chooses the recipe from the slot's standard).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NO_HISTORY } from "../constitution/__fixtures__/workspace.js";
import { STEPS } from "../pipeline/steps/index.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import "./main.js";
import { runNextSubmitCli } from "./next.js";

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DIRECTOR = "identity.brand.essence";
const VOICE = "---\nslot: \"identity.brand.essence\"\nsource: {\"kind\": \"original\", \"ref\": []}\nfeeds: []\nfunctions: []\n---\n\n## Direction\n- Essence: calm and plain.\n\n## Because\n- Fixture.\n\n## Watch\n- Fixture.\n";
const AT = "2026-11-26T00:00:00.000Z";
const GUARD_OFF = { rules: [], refVerbatim: false, history: () => NO_HISTORY };
const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface World { root: string; dir: string; id: string }

/** A P2 Designer slot `id` judged by `standard`, its one input a pinned Director slot, with the repository's Designer standards and recipes. */
function world(id: string, standard: string): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "next-recipe-tier-")));
  roots.push(root);
  const agents = join(root, "clossys", "agents");
  const [group] = id.split(".");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: group!, label: "Group", children: [{ id: `${group}.fixture`, label: "Fixture", slots: [id] }] }] };
  const dir = join(agents, "designer", id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "designer", "ia.json"), jsonBytes(ia));
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: slotPositions("designer", ia).get(id), kind: "element", standard, contract: {}, inputs: [DIRECTOR], uses: [] }));
  const verdict = { op: "verdict", at: AT, by: "planner:fixture", verb: "verdict", skill: { path: "packages/producer/actions/verdict/skill.md", sha256: null }, model: "fixture-model", tier: "high", verdict: "create" };
  writeFileSync(join(dir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events: [verdict] }));
  const director = join(agents, "director");
  const directorIa: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [DIRECTOR] }] }] };
  mkdirSync(join(director, DIRECTOR, "candidates"), { recursive: true });
  writeFileSync(join(director, "ia.json"), jsonBytes(directorIa));
  writeFileSync(join(director, DIRECTOR, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: DIRECTOR, agent: "director", ia: slotPositions("director", directorIa).get(DIRECTOR), kind: "brief", contract: { question: "What single idea should people remember us by?", mustContain: [{ key: "Essence", hint: "the idea" }] }, inputs: [], uses: [] }));
  writeFileSync(join(director, DIRECTOR, "candidates", "voice-v1.md"), VOICE);
  writeFileSync(join(director, DIRECTOR, "pin.json"), jsonBytes({ candidate: "voice-v1.md", sha256: createHash("sha256").update(VOICE).digest("hex"), decidedBy: "planner", basis: "planner", at: AT }));
  for (const folder of ["recipes", "standards"]) cpSync(join(PACKAGES, "designer", folder), join(root, "packages", "designer", folder), { recursive: true });
  return { root, dir, id };
}

const ops = (w: World) => (JSON.parse(readFileSync(join(w.dir, "ledger.json"), "utf8")) as { events: { op: string }[] }).events.map(event => event.op);
const written = (w: World) => (existsSync(join(w.dir, "candidates")) ? readdirSync(join(w.dir, "candidates")).sort() : []);
const stage = (w: World, name: string, tier: string, file?: unknown, ...more: string[]) => {
  if (file !== undefined) writeFileSync(join(w.root, "stage.json"), JSON.stringify(file));
  return runNextSubmitCli([`designer/${w.id}`, "--stage", name, "--model", "fixture-model", "--tier", tier, "--skill", skill, ...(file !== undefined ? ["--file", "stage.json"] : []), ...more], w.root);
};
/** 3 directions, each a distinct value on every axis of `axes`. */
const directions = (axes: readonly string[]) => [0, 1, 2].map(index => ({ id: `d${index + 1}`, idea: `direction ${index + 1}`, axes: Object.fromEntries(axes.map(axis => [axis, `${axis}-${index}`])) }));
/** brief (naming `recipe`), diverge, render and critique, all at `tier`; each must be recorded. */
async function craftRun(w: World, recipe: string, axes: readonly string[], tier: string) {
  for (const [name, file, more] of [["brief", { goal: "fixture: a quieter take" }, ["--recipe", recipe]], ["diverge", directions(axes), []], ["render", undefined, []], ["critique", undefined, []]] as const) {
    const recorded = await stage(w, name, tier, file, ...more);
    expect(recorded.exitCode, `${name} at ${tier}: ${recorded.message}`).toBe(0);
  }
}
const submit = (w: World, tier: string, value: unknown) => {
  writeFileSync(join(w.root, "made.json"), jsonBytes(value));
  return runNextSubmitCli([`designer/${w.id}`, "--submit", "made.json", "--model", "fixture-model", "--tier", tier, "--basis", "agent", "--skill", skill, "--rung", "L4", "--reason", "fixture: no seed fits"], w.root, undefined, undefined, GUARD_OFF);
};
const COMPONENT = { name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } };
const CODE = 'import { Button } from "@clossys/designer-ui"\n\nexport function EmptyState({ action }: { action: string }) {\n  return <Button>{action}</Button>\n}\n';
const SECTION = {
  name: "empty-state", type: "registry:block", files: [{ path: "ui/empty-state.tsx", type: "registry:block", content: CODE }],
  meta: {
    source: { kind: "composition", ref: [], license: "MIT", parts: [{ slot: "components.button", files: ["registry/aria-nova/ui/button.tsx"] }] },
    element: { id: "empty-state", reason: "Realises director:identity.brand.essence: composes components.button only." },
  },
};
const COMPONENT_AXES = ["composition", "interaction", "density"];
const SECTION_AXES = ["layout", "density", "emphasis"];

describe("next --stage --recipe refuses a --tier below the recipe's tier", () => {
  it("(a) refuses a brief under create.component (high) at mid, naming the recipe and both tiers, and records nothing", async () => {
    const w = world("components.button", "component");
    const before = ops(w);
    const refused = await stage(w, "brief", "mid", { goal: "fixture: a quieter button" }, "--recipe", "create.component");
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toBe("next --stage refused: recipe-tier: recipe create.component is tier high, and this run is at tier mid (low < mid < high); fix: run it at --tier high or above, with a model seated at that tier");
    expect(ops(w)).toEqual(before);
    // low is below high too.
    expect((await stage(w, "brief", "low", { goal: "fixture" }, "--recipe", "create.component")).message).toContain("recipe create.component is tier high, and this run is at tier low");
    expect(ops(w)).toEqual(before);
  });

  it("(b) records the same brief at high", async () => {
    const w = world("components.button", "component");
    const recorded = await stage(w, "brief", "high", { goal: "fixture: a quieter button" }, "--recipe", "create.component");
    expect(recorded.exitCode, recorded.message).toBe(0);
    expect(ops(w).at(-1)).toBe("craft:brief");
  });
});

describe("next --submit refuses a P2 submission below the tier of the recipe code chooses", () => {
  it("(c) refuses a mid submission that closes an open create.component run, and takes the same one at high", async () => {
    const w = world("components.button", "component");
    await craftRun(w, "create.component", COMPONENT_AXES, "high");
    const refused = await submit(w, "mid", COMPONENT);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toContain("recipe-tier: recipe create.component is tier high, and this run is at tier mid (low < mid < high); fix: run it at --tier high or above");
    expect(written(w)).toEqual([]);
    expect(ops(w).includes("submit")).toBe(false);
    const taken = await submit(w, "high", COMPONENT);
    expect(taken.exitCode, taken.message).toBe(0);
    expect(written(w)).toEqual(["button-v1.json"]);
  });
});

describe("a mid recipe runs at mid", () => {
  it("(d) takes create.app-section's stages and its submission at mid", async () => {
    const w = world("sections.empty-state", "section.app");
    await craftRun(w, "create.app-section", SECTION_AXES, "mid");
    expect(ops(w).filter(op => op.startsWith("craft:"))).toEqual(["craft:brief", "craft:diverge", "craft:render", "craft:critique"]);
    const taken = await submit(w, "mid", SECTION);
    expect(taken.exitCode, taken.message).toBe(0);
    expect(written(w)).toEqual(["empty-state-v1.json"]);
  });
});
