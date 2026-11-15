import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateAgainst } from "../constitution/schema.js";
import { lineAnchorsToSlots } from "../records/citations.js";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { checkSlotModel } from "../records/slot-check.js";
import "./main.js";
import { RETIRE_SCHEMA } from "./owner.js";
import { exactDependencies, runReissueCli } from "./reissue.js";

const ID = "components.button";
const CARD = "components.card";
const AT = "2026-11-14T12:00:00.000Z";
const BY = "agent:designer.reissue";
// The verb's own mechanics; guard.e2e.test.ts proves the guard. An empty registry guards nothing.
const NO_GUARD = { rules: [] };
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const source = { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] };
const OLD = jsonBytes({
  name: "button", type: "registry:ui", dependencies: ["react", "clsx@2.1.1"], registryDependencies: ["card"], files: [],
  meta: {
    source, preview: { fixtures: { file: "button.fixture.tsx", export: "Default", props: { label: "Go" } } },
    notes: ["copy from designer:components.card@3#L12", "see components.card@2 for the variant"],
    anchors: [{ ref: "components.card@2", line: 4 }],
  },
});

let workspace: string;
let agents: string;
let slotDir: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-reissue-")));
  agents = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID, CARD] }] }] };
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(workspace, "package-lock.json"), jsonBytes({ name: "fixture", lockfileVersion: 3, packages: { "": { name: "fixture" }, "node_modules/react": { version: "18.3.1" }, "node_modules/clsx": { version: "2.1.1" } } }));
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  for (const id of [ID, CARD]) {
    const dir = join(agents, id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: slotPositions("designer", ia).get(id), kind: "element", contract: {}, inputs: [], uses: [] }));
  }
  slotDir = join(agents, ID);
  writeFileSync(join(slotDir, "candidates", "btn-v1.json"), OLD);
  writeFileSync(join(slotDir, "pin.json"), jsonBytes({ candidate: "btn-v1.json", sha256: sha256Hex(OLD), decidedBy: "owner:2026-11-14 go", basis: "picked", at: AT }));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const reissue = (...args: string[]) => runReissueCli([`designer/${ID}`, ...args], workspace, NO_GUARD);
const ledger = () => (load(join(slotDir, "ledger.json")) as { events: Record<string, unknown>[] }).events;

describe("clossys reissue <agent>/<slot> <candidate>", () => {
  it("writes the next version under the slot's leaf with exact deps, uses, no preview props and slot-id line anchors", async () => {
    const result = await reissue("btn-v1", "--by", BY, "--at", AT);
    expect(result.exitCode, result.message).toBe(0);
    const next = load(join(slotDir, "candidates", "button-v2.json"));
    expect(next.dependencies).toEqual(["react@18.3.1", "clsx@2.1.1"]);
    expect(next.registryDependencies).toEqual([]);
    expect(next.meta.preview).toEqual({ fixtures: { file: "button.fixture.tsx", export: "Default" } });
    // Line anchors move to slot ids (D3b); a versioned ref that is not a line anchor stays for the citations codemod.
    expect(next.meta.notes).toEqual(["copy from designer:components.card#L12", "see components.card@2 for the variant"]);
    expect(next.meta.anchors).toEqual([{ ref: "components.card", line: 4 }]);
    expect(load(join(slotDir, "slot.json")).uses).toEqual([CARD]);
    expect(result.decision).toMatchObject({ candidate: "button-v2.json", rung: "L1", retired: "superseded", repinned: true, usesChanged: true, anchors: 2 });
  });

  it("records rung adopt with seed <slot>/<old>@<sha>, retires the old file and repins with the same basis plus reissue: true", async () => {
    expect((await reissue("btn-v1.json", "--by", BY, "--at", AT)).exitCode).toBe(0);
    const sha = sha256Hex(readFileSync(join(slotDir, "candidates", "button-v2.json"), "utf8"));
    const events = ledger();
    expect(events.map(event => event.op)).toEqual(["slot", "submit", "pin", "retire-candidate"]);
    expect(events.every(event => event.verb === "reissue" && event.by === BY && (event.skill as { path: string }).path === "packages/producer/actions/reissue/skill.md")).toBe(true);
    expect(events[1]).toMatchObject({ op: "submit", name: "button-v2.json", sha256: sha, rung: "L1", seed: `${ID}/btn-v1.json@${sha256Hex(OLD)}` });
    expect(events[2]).toMatchObject({ op: "pin", candidate: "button-v2.json", sha256: sha, decidedBy: "owner:2026-11-14 go", basis: "picked", reissue: true });
    expect(load(join(slotDir, "pin.json"))).toEqual({ candidate: "button-v2.json", sha256: sha, decidedBy: "owner:2026-11-14 go", basis: "picked", at: AT });
    expect(existsSync(join(slotDir, "candidates", "btn-v1.json"))).toBe(false);
    expect(readFileSync(join(slotDir, "retired", "btn-v1.json"), "utf8")).toBe(OLD);
    const record = load(join(slotDir, "retired", "btn-v1.json.json"));
    expect(record).toEqual({ schema: RETIRE_SCHEMA, slot: ID, candidate: "btn-v1.json", sha256: sha256Hex(OLD), by: BY, reason: "superseded: reissued as button-v2.json", at: AT });
    expect(validateAgainst("retire", record)).toEqual([]);
    expect(events[3]).toMatchObject({ op: "retire-candidate", name: "btn-v1.json", sha256: sha256Hex(OLD), code: "superseded" });
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });

  it("retires edited-in-place when the old bytes are not the ones its submit recorded", async () => {
    writeFileSync(join(slotDir, "ledger.json"), jsonBytes({ schema: "clossys.ledger/1", events: [{ op: "submit", at: AT, by: "planner", verb: "submit", skill: { path: "packages/designer/actions/designer.candidates/skill.md", sha256: null }, model: "m", tier: "high", name: "btn-v1.json", sha256: "0".repeat(64), rung: "L2", seed: "x/y" }] }));
    const result = await reissue("btn-v1", "--by", BY, "--at", AT);
    expect(result.exitCode, result.message).toBe(0);
    expect(result.decision).toMatchObject({ retired: "edited-in-place", rung: "L2" });
    expect(load(join(slotDir, "retired", "btn-v1.json.json")).reason).toMatch(/^edited-in-place: /);
  });

  it("refuses a dependency the lock does not hold and writes nothing", async () => {
    writeFileSync(join(slotDir, "candidates", "btn-v1.json"), OLD.replace('"react"', '"cn"'));
    writeFileSync(join(slotDir, "pin.json"), jsonBytes({ candidate: "btn-v1.json", sha256: sha256Hex(OLD.replace('"react"', '"cn"')), decidedBy: "owner:2026-11-14 go", basis: "picked", at: AT }));
    const result = await reissue("btn-v1", "--by", BY, "--at", AT);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/dependency cn is not in the root package-lock.json/) });
    expect(existsSync(join(slotDir, "candidates", "button-v2.json"))).toBe(false);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
  });

  it("restores every file when the guard refuses", async () => {
    const before = { pin: readFileSync(join(slotDir, "pin.json"), "utf8"), slot: readFileSync(join(slotDir, "slot.json"), "utf8") };
    const firing = { rules: [{ id: "R08", statement: "", scope: "all-records", status: "enforced", check: "", test: "", checks: [], run: [{ id: "R08.1", status: "enforced", guard: ["reissue"], fn: () => [{ rule: "R08", check: "R08.1", agent: "designer", slot: ID, candidate: "button-v2.json", reason: "synthetic", path: "x" }] }] }] };
    const result = await runReissueCli([`designer/${ID}`, "btn-v1", "--by", BY, "--at", AT], workspace, firing as never);
    expect(result).toMatchObject({ exitCode: 1, output: { schema: "clossys.reissue-refused/1", checks: ["R08.1"] } });
    expect(readFileSync(join(slotDir, "candidates", "btn-v1.json"), "utf8")).toBe(OLD);
    expect(existsSync(join(slotDir, "candidates", "button-v2.json"))).toBe(false);
    expect(existsSync(join(slotDir, "retired"))).toBe(false);
    expect(existsSync(join(slotDir, "ledger.json"))).toBe(false);
    expect(readFileSync(join(slotDir, "pin.json"), "utf8")).toBe(before.pin);
    expect(readFileSync(join(slotDir, "slot.json"), "utf8")).toBe(before.slot);
  });

  it("is an agent seat's verb: --by agent:<seat> is required", async () => {
    await expect(reissue("btn-v1", "--by", "owner")).rejects.toThrow(/--by agent:<seat>/);
    await expect(reissue("btn-v1")).rejects.toThrow(/--by agent:<seat>/);
    expect((await reissue("btn-v9", "--by", BY)).exitCode).toBe(1);
  });
});

describe("clossys reissue producer/<seat>", () => {
  // A Producer seat (kind seat, JSON candidates) reissues like any slot: R08.1 names the next version by the leaf.
  const SEAT_ID = "seat.owner.decisions";
  const SEAT = jsonBytes({ by: "owner", llm: { model: "fixture-llm", tier: "mid", promptFile: "packages/producer/actions/owner.decisions/skill.md" }, human: { procedure: "Record an owner decision through the verb.", command: "clossys owner-decision" } });
  let seatDir: string;
  beforeEach(() => {
    const producer = join(workspace, "clossys", "agents", "producer");
    const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "direct", label: "Direct", children: [{ id: "direct.brief", label: "Brief", slots: [SEAT_ID] }] }] };
    seatDir = join(producer, SEAT_ID);
    mkdirSync(join(seatDir, "candidates"), { recursive: true });
    writeFileSync(join(producer, "ia.json"), jsonBytes(ia));
    writeFileSync(join(seatDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: SEAT_ID, agent: "producer", ia: slotPositions("producer", ia).get(SEAT_ID), kind: "seat", contract: { step: "owner.decisions", fixture: { step: "owner.decisions" } }, inputs: [], uses: [] }));
    writeFileSync(join(seatDir, "candidates", "owner.decisions-v1.json"), SEAT);
    writeFileSync(join(seatDir, "pin.json"), jsonBytes({ candidate: "owner.decisions-v1.json", sha256: sha256Hex(SEAT), decidedBy: "planner", basis: "planner", at: AT }));
  });

  it("writes <leaf>-v<n>, retires the old seat file and repins with the same basis", async () => {
    const result = await runReissueCli([`producer/${SEAT_ID}`, "owner.decisions-v1.json", "--by", "agent:producer.reissue", "--at", AT], workspace, NO_GUARD);
    expect(result.exitCode, result.message).toBe(0);
    expect(result.decision).toMatchObject({ candidate: "decisions-v2.json", rung: "adopt", retired: "superseded", repinned: true, usesChanged: false });
    expect(readFileSync(join(seatDir, "candidates", "decisions-v2.json"), "utf8")).toBe(SEAT);
    expect(readFileSync(join(seatDir, "retired", "owner.decisions-v1.json"), "utf8")).toBe(SEAT);
    expect(load(join(seatDir, "pin.json"))).toEqual({ candidate: "decisions-v2.json", sha256: sha256Hex(SEAT), decidedBy: "planner", basis: "planner", at: AT });
    const events = (load(join(seatDir, "ledger.json")) as { events: Record<string, unknown>[] }).events;
    expect(events.map(event => event.op)).toEqual(["submit", "pin", "retire-candidate"]);
    expect(events[0]).toMatchObject({ rung: "adopt", seed: `${SEAT_ID}/owner.decisions-v1.json@${sha256Hex(SEAT)}`, name: "decisions-v2.json" });
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });
});

describe("lineAnchorsToSlots", () => {
  const owner = (slot: string) => (slot === "copy.hero" ? "writer" : slot === CARD ? "designer" : undefined);
  it("drops the version from line anchors of known slots only", () => {
    const text = "writer:copy.hero@3#L12 copy.hero@2#direction-L4 director:copy.hero@2#L1 copy.unknown@2#L3 react@18.3.1 copy.hero@4";
    expect(lineAnchorsToSlots(text, owner)).toEqual({ text: "writer:copy.hero#L12 copy.hero#direction-L4 director:copy.hero@2#L1 copy.unknown@2#L3 react@18.3.1 copy.hero@4", count: 2 });
    expect(lineAnchorsToSlots('{ "ref": "components.card@2", "line": 4 }', owner).text).toBe('{ "ref": "components.card", "line": 4 }');
    const once = lineAnchorsToSlots(text, owner).text;
    expect(lineAnchorsToSlots(once, owner)).toEqual({ text: once, count: 0 });
  });
});

describe("exactDependencies", () => {
  const lock = { versions: new Map([["a", new Set(["1.0.0", "2.0.0"])], ["b", new Set(["3.1.4"])]]), root: new Map([["a", "2.0.0"]]) };
  it("keeps exact locked entries, takes the root version, else the one version, else refuses", () => {
    expect(exactDependencies(["a@1.0.0", "a", "b@^3", "c"], lock)).toEqual({ dependencies: ["a@1.0.0", "a@2.0.0", "b@3.1.4"], issues: ["dependency c is not in the root package-lock.json"] });
  });
});
