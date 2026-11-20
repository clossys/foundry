/**
 * `clossys verdict --record` (slot-constitution.md section 5, P1): a pick pins with basis agent, a
 * create routes the slot to P2, every cited id exists in the slot's standard or brief, and the
 * verdict guard undoes a refused write. A Producer seat slot takes a create verdict and then crafts
 * (next --stage) and is critiqued (critique-packet, critique --record) like any slot.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { STEPS } from "../pipeline/steps/index.js";
import "./main.js";
import { runCritiqueCli, runCritiquePacketCli } from "./critique.js";
import { runNextSubmitCli } from "./next.js";
import { runVerdictCli, verdictIssues } from "./verdict.js";

const ID = "components.button";
const AT = "2026-11-14T12:00:00.000Z";
// The verb's own mechanics; the firing registry below proves the guard is called and undoes the write.
const NO_GUARD = { rules: [] };
const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const CANDIDATE = jsonBytes({ name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } });
let workspace: string;
let slotDir: string;

const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const events = (dir = slotDir) => (load(join(dir, "ledger.json")) as { events: Record<string, unknown>[] }).events;
function slot(agent: string, ia: IaDoc, id: string, fields: Record<string, unknown>): string {
  const dir = join(workspace, "clossys", "agents", agent, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(workspace, "clossys", "agents", agent, "ia.json"), jsonBytes(ia));
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent, ia: slotPositions(agent as never, ia).get(id), inputs: [], uses: [], ...fields }));
  return dir;
}
/** A pinned Director slot `id`, declared as the Designer fixture slot's one input. */
function pinnedDirectorInput(id: string): void {
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "identity", label: "Identity", children: [{ id: "identity.visual", label: "Visual", slots: [id] }] }] };
  const dir = slot("director", ia, id, { kind: "brief", contract: { question: "How do we look?" } });
  const bytes = `---\nslot: "${id}"\nsource: {"kind":"derived","ref":["finding:fixture"]}\nfeeds: []\nfunctions: ["brand"]\n---\n\n## Direction\n- Feel: quiet and exact.\n\n## Because\n- fixture\n\n## Watch\n- fixture\n`;
  writeFileSync(join(dir, "candidates", "style-v1.md"), bytes);
  writeFileSync(join(dir, "pin.json"), jsonBytes({ candidate: "style-v1.md", sha256: sha256Hex(bytes), decidedBy: "planner:fixture", basis: "picked", at: AT }));
  const doc = load(join(slotDir, "slot.json"));
  writeFileSync(join(slotDir, "slot.json"), jsonBytes({ ...doc, inputs: [id] }));
}
const standard = (agent: string, id: string) => cpSync(join(PACKAGES, agent, "standards", id), join(workspace, "packages", agent, "standards", id), { recursive: true });

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-verdict-")));
  mkdirSync(join(workspace, "clossys"), { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID] }] }] };
  slotDir = slot("designer", ia, ID, { kind: "element", standard: "component", contract: { variant: "solid" } });
  writeFileSync(join(slotDir, "candidates", "button-v1.json"), CANDIDATE);
  // component is adopt-first with createGaps missing-behavior, a11y-failure, foundry-signature; taste ids fidelity, composition, polish.
  standard("designer", "component");
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const record = (doc: Record<string, unknown>, target = `designer/${ID}`, guard: unknown = NO_GUARD, by = "agent:designer.verdict") => {
  writeFileSync(join(workspace, "verdict.json"), JSON.stringify({ schema: "clossys.verdict/1", slot: ID, ...doc }));
  return runVerdictCli([target, "--record", "verdict.json", "--model", "fixture-model", "--tier", "high", "--by", by, "--at", AT], workspace, guard as never);
};
const pick = { pick: "button-v1.json", reason: "fixture: the stock button fits", criteria: ["fidelity", "polish"] };
const create = { create: true, reason: "fixture: no candidate has the loading state", gaps: [{ id: "fidelity", class: "missing-behavior" }, { id: "brief:variant", class: "a11y-failure" }] };

describe("clossys verdict --record", () => {
  it("refuses a pick on a clossys.slot/1 slot (migrate first) and writes nothing (U13 one format)", async () => {
    // A verdict pick used to pin/1 the slot basis agent; one format (U13) writes slot/2 and pin/2 only, and a
    // slot/2 pick moves through the CHOOSE gate (clossys pin), never a verdict.
    const result = await record(pick);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/is a clossys\.slot\/1 slot; .*run clossys migrate slots --apply first/);
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
  });

  it("records a create with the latest options inputsHash, which opens P2 (next --stage brief)", async () => {
    const hash = "a".repeat(64);
    writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events: [{ op: "options", at: AT, by: "planner:fixture", verb: "options", skill: { path: "packages/producer/actions/options/skill.md", sha256: null }, model: "none", tier: "none", inputsHash: hash }] }));
    expect((await record({ ...create, inputsHash: "b".repeat(64) })).message).toMatch(/inputsHash/);
    const result = await record({ ...create, inputsHash: hash });
    expect(result.exitCode, result.message).toBe(0);
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
    expect(events().at(-1)).toMatchObject({ op: "verdict", verdict: "create", create: true, inputsHash: hash, gaps: create.gaps });
    // The brief cites pinned upstream values (R20): the element realises a pinned Director slot.
    pinnedDirectorInput("identity.visual.style");
    const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
    writeFileSync(join(workspace, "brief.json"), JSON.stringify({ goal: "a button with a loading state" }));
    const brief = await runNextSubmitCli([`designer/${ID}`, "--stage", "brief", "--model", "fixture-model", "--tier", "high", "--skill", skill, "--file", "brief.json"], workspace);
    expect(brief.exitCode, brief.message).toBe(0);
  });

  it("refuses ids the standard and brief do not hold, and an adopt-first create without an allowed class (R03.5)", async () => {
    expect((await record({ ...pick, criteria: ["contrast"] })).message).toMatch(/criterion contrast is not a taste criterion of standard component/);
    expect((await record({ ...pick, criteria: ["fidelity", "fidelity"] })).message).toMatch(/criteria repeat an id/);
    expect((await record({ ...create, gaps: [{ id: "brief:size", class: "missing-behavior" }] })).message).toMatch(/gap brief:size is not/);
    expect((await record({ ...create, gaps: [{ id: "fidelity" }] })).message).toMatch(/every gap names a class/);
    expect((await record({ ...create, gaps: [{ id: "fidelity", class: "taste" }] })).message).toMatch(/needs a gap of class missing-behavior, a11y-failure, foundry-signature \(R03\.5\)/);
    expect((await record({ ...create, gaps: [] })).message).toMatch(/is not a verdict \(verdict\.schema\.json\)/);
    expect((await record({ ...pick, slot: "components.card" })).message).toMatch(/names slot components\.card/);
    expect((await record({ ...pick, pick: "button-v9.json" })).message).toMatch(/has no candidate button-v9\.json/);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
  });

  it("refuses a slot with no standard, an owner pin and a by that is not an agent seat", async () => {
    writeFileSync(join(slotDir, "pin.json"), jsonBytes({ candidate: "button-v1.json", sha256: sha256Hex(CANDIDATE), decidedBy: "owner:2026-11-14 go", basis: "picked", at: AT }));
    expect((await record(pick)).message).toMatch(/holds an owner pick/);
    await expect(record(pick, `designer/${ID}`, NO_GUARD, "owner")).rejects.toThrow(/--by agent:<seat>/);
    const doc = load(join(slotDir, "slot.json"));
    delete doc.standard;
    writeFileSync(join(slotDir, "slot.json"), jsonBytes(doc));
    expect((await record(pick)).message).toMatch(/names no standard/);
  });

  it("undoes the verdict when the guard refuses", async () => {
    const path = `clossys/agents/designer/${ID}/ledger.json`;
    const firing = { rules: [{ id: "R14", statement: "", scope: "all-records", status: "enforced", check: "", test: "", checks: [], run: [{ id: "R14.1", status: "enforced", guard: ["verdict"], fn: () => [{ rule: "R14", check: "R14.1", agent: "designer", slot: ID, reason: "synthetic", path }] }] }] };
    const result = await record(create, `designer/${ID}`, firing);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/R14\.1/);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });
});

describe("verdictIssues", () => {
  const ids = { taste: new Set(["fidelity"]), requirements: new Set(["source.ref"]), brief: new Set(["variant"]) };
  it("takes requirement checks as gaps and DEFAULT_CREATE_GAPS when an adopt-first standard lists none", () => {
    expect(verdictIssues({ create: true, gaps: [{ id: "source.ref", class: "missing-behavior" }] }, ids, { id: "x", mode: "adopt-first" })).toEqual([]);
    expect(verdictIssues({ create: true, gaps: [{ id: "source.ref" }] }, ids, { id: "x", mode: "craft" })).toEqual([]);
  });
});

describe("a Producer seat slot through P1 and P2", () => {
  const SEAT_ID = "seat.owner.decisions";
  const seatSkill = STEPS.find(step => step.id === "seats")!.command.skill!;
  let seatDir: string;
  beforeEach(() => {
    const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "direct", label: "Direct", children: [{ id: "direct.brief", label: "Brief", slots: [SEAT_ID] }] }] };
    seatDir = slot("producer", ia, SEAT_ID, { kind: "seat", standard: "seat", contract: { step: "owner.decisions", fixture: { step: "owner.decisions" } } });
    // seat is a craft standard: requirements seat.assigned, seat.prompt-owner; taste right-owner, tier-fit, procedure-clarity.
    standard("producer", "seat");
    mkdirSync(join(workspace, "renders"), { recursive: true });
    for (const name of ["one", "two", "three"]) writeFileSync(join(workspace, "renders", `${name}.png`), `render ${name}`);
  });
  const target = `producer/${SEAT_ID}`;
  const stage = (name: string, file?: unknown) => {
    if (file !== undefined) writeFileSync(join(workspace, "stage.json"), JSON.stringify(file));
    return runNextSubmitCli([target, "--stage", name, "--model", "fixture-model", "--tier", "mid", "--skill", seatSkill, ...(file !== undefined ? ["--file", "stage.json"] : [])], workspace);
  };
  const seatRecord = (doc: Record<string, unknown>) => {
    writeFileSync(join(workspace, "verdict.json"), JSON.stringify({ schema: "clossys.verdict/1", slot: SEAT_ID, ...doc }));
    return runVerdictCli([target, "--record", "verdict.json", "--model", "fixture-model", "--tier", "mid", "--by", "agent:producer.verdict", "--at", AT], workspace, NO_GUARD as never);
  };

  it("takes a create verdict, crafts brief, diverge and render under the seats skill, then is critiqued", async () => {
    expect((await stage("brief", { goal: "a seat for owner decisions" })).message).toMatch(/craft is P2/);
    expect((await seatRecord({ pick: "decisions-v1.json", reason: "fixture", criteria: ["tier-fit"] })).message).toMatch(/is a Producer seat: a seat is pinned by clossys seat owner\.decisions/);
    const created = await seatRecord({ create: true, reason: "fixture: no seat yet", gaps: [{ id: "seat.assigned" }, { id: "right-owner" }] });
    expect(created.exitCode, created.message).toBe(0);
    expect((await stage("brief", { goal: "a seat for owner decisions" })).exitCode).toBe(0);
    const directions = ["agent", "owner", "split"].map((by, index) => ({ id: `d${index + 1}`, idea: by, axes: { holder: by } }));
    expect((await stage("diverge", directions)).exitCode).toBe(0);
    expect((await stage("render")).exitCode).toBe(0);

    const packet = await runCritiquePacketCli([target, "--standard", "seat", "--render", "renders/one.png", "--render", "renders/two.png", "--render", "renders/three.png"], workspace);
    expect(packet.exitCode, packet.message).toBe(0);
    const manifest = (packet.output as { manifest: { role: string; ref: string }[] }).manifest;
    expect(manifest[0]).toMatchObject({ role: "taste", ref: "packages/producer/standards/seat/taste.md" });
    writeFileSync(join(workspace, "critique.json"), JSON.stringify({ schema: "clossys.critique/1", slot: SEAT_ID, candidate: "decisions-v1.json", standard: "seat", scores: { "tier-fit": 4 }, packet: { manifest } }));
    const critique = await runCritiqueCli([target, "--record", "critique.json", "--model", "fixture-critic", "--tier", "high", "--at", AT], workspace);
    expect(critique.exitCode, critique.message).toBe(0);
    expect(events(seatDir).map(event => event.op)).toEqual(["verdict", "craft:brief", "craft:diverge", "craft:render", "craft:critique"]);
    expect(events(seatDir)[1]).toMatchObject({ by: "agent:seats", skill: { path: seatSkill } });
    expect(events(seatDir).at(-1)).toMatchObject({ verb: "critique", model: "fixture-critic", critique: "critiques/decisions-v1.json" });
    expect(existsSync(join(seatDir, "critiques", "decisions-v1.json"))).toBe(true);
  });
});
