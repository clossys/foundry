/**
 * P2 (slot-constitution.md section 5 and 5b): `next --submit` refuses an adapt or create rung until
 * the slot's latest verdict is create for the latest options inputs, and `next --stage` records the
 * craft stages in order (brief, diverge, render, critique, at most 2 refine rounds) with 3 to 4
 * diverge directions.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { STEPS } from "../pipeline/steps/index.js";
import "./main.js";
import { runNextSubmitCli } from "./next.js";
import { runCraftCli } from "./craft.js";
import { craftIssues } from "../constitution/rules/r15.js";
import { loadRecipes, plumbCraftRunIssue } from "../records/recipes.js";
import { plumbCraftRefusal, writeCritique } from "../records/slot-write.js";

const ID = "components.button";
const DIRECTOR = "identity.brand.essence";
const STANDARD = "fixture-headline";
const RECIPE = "fixture-headline-craft";
const FIXTURES = fileURLToPath(new URL("../constitution/__fixtures__/", import.meta.url));
const VOICE = "---\nslot: \"identity.brand.essence\"\nsource: {\"kind\": \"original\", \"ref\": []}\nfeeds: []\nfunctions: []\n---\n\n## Direction\n- Essence: calm and plain.\n\n## Because\n- Fixture.\n\n## Watch\n- Fixture.\n";
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
  writeFileSync(join(slotDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", ia).get(ID), kind: "element", standard: STANDARD, contract: {}, inputs: [DIRECTOR], uses: [] }));
  // The brief's upstream: one pinned Director slot, the standard and the recipe it names.
  const director = join(workspace, "clossys", "agents", "director");
  const directorIa: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [DIRECTOR] }] }] };
  mkdirSync(join(director, DIRECTOR, "candidates"), { recursive: true });
  writeFileSync(join(director, "ia.json"), jsonBytes(directorIa));
  writeFileSync(join(director, DIRECTOR, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: DIRECTOR, agent: "director", ia: slotPositions("director", directorIa).get(DIRECTOR), kind: "brief", contract: { question: "What single idea should people remember us by?", mustContain: [{ key: "Essence", hint: "the idea" }] }, inputs: [], uses: [] }));
  writeFileSync(join(director, DIRECTOR, "candidates", "voice-v1.md"), VOICE);
  writeFileSync(join(director, DIRECTOR, "pin.json"), jsonBytes({ candidate: "voice-v1.md", sha256: createHash("sha256").update(VOICE).digest("hex"), decidedBy: "planner", basis: "planner", at: AT }));
  cpSync(join(FIXTURES, "standards", STANDARD), join(workspace, "packages", "designer", "standards", STANDARD), { recursive: true });
  cpSync(join(FIXTURES, "recipes", RECIPE), join(workspace, "packages", "designer", "recipes", RECIPE), { recursive: true });
  writeFileSync(join(workspace, "made.json"), jsonBytes({ name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source } }));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

// options is deterministic (model none, tier none); verdict runs an LLM.
const event = (op: string, fields: Record<string, unknown>) => ({ op, at: AT, by: "planner:fixture", verb: op, skill: { path: "packages/producer/actions/options/skill.md", sha256: null }, ...(op === "options" ? { model: "none", tier: "none" } : { model: "fixture-model", tier: "mid" }), ...fields });
const ledger = (...events: Record<string, unknown>[]) => writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events }));
const ops = () => (JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")) as { events: { op: string }[] }).events.map(each => each.op);
const submit = (...ladder: string[]) => runNextSubmitCli([`designer/${ID}`, "--submit", "made.json", "--model", "fixture-model", "--tier", "high", "--basis", "agent", "--skill", skill, ...ladder], workspace, undefined, undefined, UNGUARDED);
const stage = (name: string, file?: unknown, ...more: string[]) => {
  if (file !== undefined) writeFileSync(join(workspace, "stage.json"), JSON.stringify(file));
  return runNextSubmitCli([`designer/${ID}`, "--stage", name, "--model", "fixture-model", "--tier", "high", "--skill", skill, ...(file !== undefined ? ["--file", "stage.json"] : []), ...more], workspace);
};
const craft = (name: string, ...more: string[]) => runCraftCli([name, `designer/${ID}`, "--model", "fixture-model", "--tier", "high", "--skill", skill, ...more], workspace);
const lastEvent = () => (JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")) as { events: Record<string, unknown>[] }).events.at(-1)!;
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
    expect((await stage("diverge", same)).message).toMatch(/directions 1 and 2 share tone "quiet"; fix: .*cosmetic variant \(R15\.7\)/);
    expect((await stage("diverge", directions(3).map(direction => ({ ...direction, axes: { density: 1 } })))).message).toMatch(/directions 1 and 2 share density 1;/);
    const partial = directions(3).map((direction, index) => index ? direction : { ...direction, axes: { ...direction.axes, tone: "loud" } });
    expect((await stage("diverge", partial)).message).toMatch(/direction 2 has no value on axis tone; fix: .*\(R15\.7\)/);
    const blank = directions(3).map((direction, index) => ({ ...direction, axes: { ...direction.axes, tone: index === 1 ? "" : `t${index}` } }));
    expect((await stage("diverge", blank)).message).toMatch(/direction 2 has no value on axis tone; fix: /);
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

describe("craft brief: assembled from the pinned inputs, the contract and the standard", () => {
  it("records the pinned Director input, the contract sha, the standard's requirements and taste anchors, and the recipe axes", async () => {
    ledger(event("verdict", { verdict: "create" }));
    const made = await craft("brief", "--recipe", RECIPE);
    expect(made.exitCode, made.message).toBe(0);
    const assembled = lastEvent().assembled as Record<string, any>;
    expect(lastEvent().op).toBe("craft:brief");
    expect(assembled.inputs).toEqual([{ agent: "director", slot: DIRECTOR, candidate: "voice-v1.md", sha256: createHash("sha256").update(VOICE).digest("hex") }]);
    expect(assembled.contract).toEqual({ value: {}, sha256: createHash("sha256").update(jsonBytes({})).digest("hex") });
    expect(assembled.standard.id).toBe(STANDARD);
    expect(assembled.standard.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(assembled.standard.requirements.map((each: { check: string }) => each.check)).toEqual(["text.nonempty", "text.word-limit", "text.reading-grade", "lexicon.clean", "text.no-placeholder"]);
    expect(assembled.standard.taste.length).toBeGreaterThan(0);
    expect(Object.keys(assembled.standard.taste[0].anchors).length).toBeGreaterThan(0);
    expect(assembled.recipe).toEqual({ id: RECIPE, axes: ["tone", "length", "structure"] });
  });

  it("refuses at brief, with a fix, an unpinned input, a missing standard, an unknown recipe and a typed assembled part", async () => {
    ledger(event("verdict", { verdict: "create" }));
    rmSync(join(workspace, "clossys", "agents", "director", DIRECTOR, "pin.json"));
    expect((await craft("brief")).message).toMatch(/craft:brief refused: input director\/identity\.brand\.essence is unpinned; fix: pin every input first/);
    writeFileSync(join(workspace, "clossys", "agents", "director", DIRECTOR, "pin.json"), jsonBytes({ candidate: "voice-v1.md", sha256: createHash("sha256").update(VOICE).digest("hex"), decidedBy: "planner", basis: "planner", at: AT }));
    expect((await craft("brief", "--recipe", "no-such-recipe")).message).toMatch(/recipe no-such-recipe does not exist .*; fix: /);
    expect((await stage("brief", { assembled: { inputs: [] } })).message).toMatch(/assembled part is the CLI's/);
    rmSync(join(workspace, "packages", "designer", "standards", STANDARD), { recursive: true });
    expect((await craft("brief")).message).toMatch(/standard fixture-headline does not exist .*\(R05\.1\); fix: /);
    const doc = JSON.parse(readFileSync(join(slotDir, "slot.json"), "utf8")) as Record<string, unknown>;
    delete doc.standard;
    writeFileSync(join(slotDir, "slot.json"), jsonBytes(doc));
    expect((await craft("brief")).message).toMatch(/names no standard .*\(R05\.1\); fix: /);
    expect(ops().filter(op => op.startsWith("craft:"))).toEqual([]);
  });

  it("is next --stage under another name: the same order refusal", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await craft("render")).message).toMatch(/after nothing the next stage is not render/);
    await expect(craft("polish")).rejects.toThrow(/craft stage must be brief, diverge, render, critique, refine/);
  });
});

describe("craft diverge: pairwise-distinct axes, checked at once", () => {
  const direction = (id: string, axes: Record<string, unknown>) => ({ id, axes });
  it("refuses two directions sharing a value on an axis, and a direction missing an axis", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await stage("brief")).exitCode).toBe(0);
    const shared = [direction("d1", { density: 1, tone: "warm" }), direction("d2", { density: 2, tone: "cool" }), direction("d3", { density: 3, tone: "warm" })];
    expect((await stage("diverge", shared)).message).toMatch(/directions 1 and 3 share tone "warm"; fix: make every direction's value distinct on every axis/);
    const missing = [direction("d1", { density: 1, tone: "warm" }), direction("d2", { density: 2 }), direction("d3", { density: 3, tone: "dry" })];
    expect((await stage("diverge", missing)).message).toMatch(/direction 2 has no value on axis tone; fix: /);
    expect((await stage("diverge", [direction("d1", { density: 1, tone: "warm" }), direction("d2", { density: 2, tone: "cool" }), direction("d3", { density: 3, tone: "dry" })])).exitCode).toBe(0);
  });

  it("holds every direction to the brief's recipe axes", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await stage("brief", undefined, "--recipe", RECIPE)).exitCode).toBe(0);
    const partial = [direction("d1", { tone: "warm", length: 5 }), direction("d2", { tone: "cool", length: 8 }), direction("d3", { tone: "dry", length: 11 })];
    expect((await stage("diverge", partial)).message).toMatch(/direction 1 has no value on axis structure; fix: .*\(the recipe's axes: tone, length, structure\)/);
    const full = partial.map((each, index) => ({ ...each, axes: { ...each.axes, structure: ["claim", "question", "list"][index] } }));
    expect((await stage("diverge", full)).exitCode).toBe(0);
  });
});

describe("craft under a plumb recipe: the writer refuses what R15.7 rejects (one predicate)", () => {
  const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
  const plumbRecipe = () => {
    const path = join(workspace, "packages", "designer", "recipes", RECIPE, "recipe.json");
    writeFileSync(path, jsonBytes({ ...(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>), rung: "plumb", axes: [], action: "fixture.plumb" }));
  };
  const PLUMB = (stage: string) => new RegExp(`craft:${stage} refused: recipe ${RECIPE} is plumb: a plumb recipe records no craft events \\(its plumb action computes the candidate\\); fix: .*\\(R15\\.7\\)`);

  it("refuses every stage named under a plumb recipe, by next --stage and by craft, and records nothing", async () => {
    ledger(event("verdict", { verdict: "create" }));
    plumbRecipe();
    expect((await stage("brief", undefined, "--recipe", RECIPE)).message).toMatch(PLUMB("brief"));
    expect((await craft("brief", "--recipe", RECIPE)).message).toMatch(PLUMB("brief"));
    expect((await stage("diverge", { recipe: RECIPE, directions: directions(3) })).message).toMatch(PLUMB("diverge"));
    expect((await stage("render", { recipe: RECIPE })).message).toMatch(PLUMB("render"));
    expect(ops()).toEqual(["verdict"]);
  });

  it("refuses a later stage once the open run's brief names the plumb recipe, and the judge reports the same issue", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await stage("brief", undefined, "--recipe", RECIPE)).exitCode).toBe(0);
    plumbRecipe();
    expect((await stage("diverge", directions(3))).message).toMatch(PLUMB("diverge"));
    expect(() => writeCritique(join(workspace, "clossys"), "designer", ID, { verdict: "x" }, { at: AT, validate: () => [] }, { by: "planner" })).toThrow(PLUMB("critique"));
    expect(ops()).toEqual(["verdict", "craft:brief"]);
    const run = (JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")) as { events: Record<string, unknown>[] }).events.filter(each => String(each.op).startsWith("craft:"));
    const recipes = loadRecipes(workspace);
    expect(craftIssues(run, recipes, "designer")).toEqual([plumbCraftRunIssue(run, recipes, "designer")]);
  });

  it("still records a crafted (create) recipe's stages", async () => {
    ledger(event("verdict", { verdict: "create" }));
    expect((await stage("brief", undefined, "--recipe", RECIPE)).exitCode).toBe(0);
    expect(plumbCraftRefusal(join(workspace, "clossys"), "designer", [], "brief", { recipe: RECIPE })).toBeUndefined();
  });

  it("the release slot case: the real publisher release recipe (plumb) refuses a craft event, as R15.7 does", () => {
    const refusal = plumbCraftRefusal(join(REPO, "clossys"), "publisher", [], "brief", { recipe: "release" });
    expect(refusal).toMatch(/^craft:brief refused: recipe release is plumb: a plumb recipe records no craft events/);
    const events = [{ op: "craft:brief", recipe: "release" }];
    expect(craftIssues(events, loadRecipes(REPO), "publisher")).toEqual(["recipe release is plumb: a plumb recipe records no craft events (its plumb action computes the candidate)"]);
    // A crafted Publisher recipe is not refused.
    expect(plumbCraftRefusal(join(REPO, "clossys"), "publisher", [], "brief", { recipe: "assemble.page" })).toBeUndefined();
  });
});
