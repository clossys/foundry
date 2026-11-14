import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateSchema, type JsonSchema } from "../constitution/schema.js";
import { sha256Hex } from "./hash.js";
import { eventIssues, expectedCandidateSha, lastDecision, lastRecordState, LEDGER_FILE, LEDGER_SCHEMA, ledgerEventsOf, ledgerIssues, modelTierIssues, PRODUCER_ROOT, skillFile, skillPath } from "./ledger.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc } from "./slot-model/index.js";
import { readLedger } from "./slots.js";
import { appendRetireCandidate, appendRetireSlot, appendSlotDocEvent, rewriteCitationsInPlace, SLOT_LOCK, writeCandidate, writeConfirm, writeNotNeeded, writePin, writeSlotOptions } from "./slot-write.js";

const ID = "identity.brand.essence";
const at = "2026-11-13T00:00:00Z";
const source = { kind: "original", ref: [] };
const body = "## Direction\n- Essence: x\n\n## Because\n- y\n\n## Watch\n- z\n";
const brief = (essence: string) => serializeFrontmatter({ slot: ID, source, feeds: [], functions: [] }, body.replace("Essence: x", `Essence: ${essence}`));
const SCHEMA = JSON.parse(readFileSync(new URL("../../pipeline/schemas/ledger.schema.json", import.meta.url), "utf8")) as JsonSchema;
let root: string, consumer: string, dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ledger-")));
  consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  dir = join(consumer, "agents", "director", ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "director", ia: slotPositions("director", ia).get(ID), kind: "brief", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ledger = () => readLedger(dir, "slot")!;
const events = () => ledger().events as unknown as Record<string, unknown>[];
const fileSha = (path: string) => sha256Hex(readFileSync(path));

describe("ledger events (records/ledger.ts)", () => {
  const good = { op: "submit", at, by: "planner", verb: "submit", skill: { path: "packages/director/actions/director.candidates/skill.md", sha256: null }, model: "none", tier: "none", name: "essence-v1.md", sha256: "a".repeat(64) };

  it("accepts a whole event and names every defect of a broken one", () => {
    expect(eventIssues(good)).toEqual([]);
    expect(eventIssues({ ...good, op: "dance", at: "today", by: "", verb: "sing", skill: { path: "x.md", sha256: null }, model: "claude", tier: "none", records: [{ file: "notes.md", sha256: null }] })).toEqual([
      "op dance is not a slot ledger op", "at is not an ISO timestamp", "names no by", "verb sing is not in the verb table",
      "skill.path is not packages/<pkg>/actions/<step>/skill.md", "model claude with tier none is neither none/none nor a model with tier low|mid|high",
      "records[] entries are {file: pin.json|slot.json|ia.json|policy.json, sha256: 64 hex or null}",
    ]);
    expect(eventIssues({ ...good, name: undefined, sha256: "short" })).toEqual(["submit needs name (candidate file name)", "submit needs sha256 (64 hex)"]);
    expect(eventIssues({ ...good, op: "retire-slot", code: "not-needed" }, "agent")).toEqual(["retire-slot needs slot (the retired slot id)"]);
    expect(eventIssues({ ...good, op: "ia" }, "slot")).toEqual(["op ia is not a slot ledger op"]);
    expect(eventIssues({ ...good, op: "craft:render" })).toEqual([]);
    expect(ledgerIssues({ schema: LEDGER_SCHEMA, events: [good, { ...good, by: "" }], extra: 1 })).toEqual(["unknown keys extra", "events[1]: names no by"]);
  });

  it("pairs model and tier by verb (R14.3)", () => {
    expect(modelTierIssues({ verb: "verdict", model: "none", tier: "none" })).toEqual(["verb verdict runs an LLM and must name its model and tier"]);
    expect(modelTierIssues({ verb: "pin", model: "claude-opus-5-5", tier: "high" })).toEqual(["verb pin is deterministic and records model none, tier none"]);
    expect(modelTierIssues({ verb: "submit", model: "claude-opus-5-5", tier: "high" })).toEqual([]);
    expect(modelTierIssues({ verb: "submit", model: "none", tier: "none" })).toEqual([]);
    expect(modelTierIssues({ verb: "submit" })).toEqual(["names no model and tier (deterministic verbs record model none, tier none)"]);
  });

  it("follows a submit through matching migrate events and finds record states and decisions", () => {
    const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
    const list = [
      { op: "submit", name: "x-v1.md", sha256: a },
      { op: "migrate", files: [{ name: "x-v1.md", from: c, to: b }] },
      { op: "pin", candidate: "x-v1.md", records: [{ file: "pin.json", sha256: c }] },
      { op: "migrate", files: [{ name: "x-v1.md", from: a, to: b }], records: [{ file: "pin.json", sha256: a }] },
    ];
    expect(expectedCandidateSha(list, "x-v1.md")).toEqual({ submitted: true, sha256: b });
    expect(expectedCandidateSha(list, "x-v2.md")).toEqual({ submitted: false });
    expect(lastRecordState(list, "pin.json")).toEqual({ file: "pin.json", sha256: a });
    expect(lastRecordState(list, "slot.json")).toBeUndefined();
    expect(lastDecision(list)).toMatchObject({ op: "pin" });
    expect(ledgerEventsOf([1, { op: "x" }])).toEqual([{ op: "x" }]);
    expect(ledgerEventsOf("nope")).toBeUndefined();
  });

  it("resolves action skill paths to the installed files", () => {
    expect(skillPath("producer", "retire")).toBe("packages/producer/actions/retire/skill.md");
    expect(skillFile("packages/producer/actions/next/skill.md", "/p/producer/")).toBe("/p/producer/actions/next/skill.md");
    expect(skillFile("packages/designer/actions/pick.designer/skill.md", "/p/producer/")).toBe("/p/designer/actions/pick.designer/skill.md");
    expect(() => skillFile("docs/skill.md")).toThrow(/not an action skill path/);
    expect(existsSync(PRODUCER_ROOT)).toBe(true);
  });
});

describe("the single writer appends one ledger event per write", () => {
  it("records submit, pin, confirm, options, not-needed, slot, retire and migrate, each with the bytes it wrote", () => {
    const first = writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, fields: { basis: "planner" }, provenance: { by: "agent:director", model: "claude-opus-5-5", tier: "high" } });
    expect(first).toEqual({ name: "essence-v1.md", sha256: fileSha(join(dir, "candidates", "essence-v1.md")) });
    writeCandidate(consumer, "director", ID, "essence", brief("two"), { at });
    writePin(consumer, "director", ID, "essence-v1.md", { decidedBy: "agent:director", basis: "agent", at });
    writeConfirm(consumer, "director", ID, "essence-v1.md", { by: "owner", ref: "clossys/workspace#46 issuecomment-1", at });
    writePin(consumer, "director", ID, "essence-v2.md", { decidedBy: "owner", basis: "picked", at });
    expect(writeSlotOptions(consumer, "director", ID, { options: 2, varyOn: "tone", at })).toBe(true);
    expect(writeSlotOptions(consumer, "director", ID, { options: 2, varyOn: "tone", at })).toBe(false);
    appendSlotDocEvent(consumer, "director", ID, { by: "planner", at, verb: "ia", skill: skillPath("producer", "ia"), fields: { note: "renumbered" } });
    const v1 = readFileSync(join(dir, "candidates", "essence-v1.md"), "utf8");
    const rewritten = rewriteCitationsInPlace(consumer, "director", ID, { candidates: [{ name: "essence-v1.md", before: v1, after: v1.replace("Essence: one", "Essence: one ") }] }, { by: "planner", at });
    expect(rewritten).toHaveLength(1);
    writeNotNeeded(consumer, "director", ID, { reason: "covered elsewhere", since: "2026-11-13", decidedBy: "owner" }, { at });
    appendRetireCandidate(consumer, "director", ID, { name: "essence-v2.md", sha256: "f".repeat(64), reason: "superseded: v3", by: "planner", at });

    const list = events();
    expect(list.map(event => `${String(event.op)}/${String(event.verb)}`)).toEqual([
      "submit/submit", "submit/submit", "pick/pick", "confirm/pin", "pin/pin", "slot/options", "slot/ia", "migrate/migrate", "not-needed/pin", "retire-candidate/retire",
    ]);
    expect(list[0]).toMatchObject({ by: "agent:director", model: "claude-opus-5-5", tier: "high", basis: "planner", name: "essence-v1.md", skill: { path: "packages/director/actions/director.candidates/skill.md" } });
    expect(list[1]).toMatchObject({ by: "planner", model: "none", tier: "none", name: "essence-v2.md" });
    expect(list[2]).toMatchObject({ by: "agent:director", candidate: "essence-v1.md", basis: "agent", skill: { path: "packages/director/actions/pick.director/skill.md" } });
    expect(list[4]).toMatchObject({ by: "owner", candidate: "essence-v2.md", basis: "picked", skill: { path: "packages/producer/actions/pin.director/skill.md" } });
    expect(list[7]).toMatchObject({ migration: "citations-to-slots", files: [{ name: "essence-v1.md", from: first.sha256, to: fileSha(join(dir, "candidates", "essence-v1.md")) }] });
    expect(list[8]).toMatchObject({ reason: "covered elsewhere", records: [{ file: "slot.json", sha256: fileSha(join(dir, "slot.json")) }, { file: "pin.json", sha256: null }] });
    expect(list[9]).toMatchObject({ name: "essence-v2.md", code: "superseded" });
    // Every record's last state is the bytes on disk, and every candidate's submit sha follows it (R14.1, R08.2).
    expect(lastRecordState(list, "slot.json")?.sha256).toBe(fileSha(join(dir, "slot.json")));
    expect(lastRecordState(list, "pin.json")?.sha256).toBeNull();
    expect(expectedCandidateSha(list, "essence-v1.md").sha256).toBe(fileSha(join(dir, "candidates", "essence-v1.md")));
    // The document is the schema's, and the writer's own check.
    expect(ledgerIssues(ledger())).toEqual([]);
    expect(validateSchema(SCHEMA, ledger())).toEqual([]);
    expect(validateSchema(SCHEMA, { schema: LEDGER_SCHEMA, events: [{ ...list[0], verb: "sing" }] })).not.toEqual([]);
  });

  it("writes retire --slot events to the slot ledger and the agent ledger with ia.json's state", () => {
    writeCandidate(consumer, "director", ID, "essence", brief("one"), { at });
    const written = appendRetireSlot(consumer, "director", ID, { reason: "not-needed: merged", by: "owner", at });
    expect(written.map(event => event.op)).toEqual(["retire-slot", "retire-slot"]);
    expect(events().at(-1)).toMatchObject({ op: "retire-slot", code: "not-needed", verb: "retire" });
    const agent = readLedger(join(consumer, "agents", "director"), "agent")!;
    expect(agent.events).toEqual([expect.objectContaining({ op: "retire-slot", slot: ID, code: "not-needed", records: [{ file: "ia.json", sha256: fileSha(join(consumer, "agents", "director", "ia.json")) }] })]);
    expect(() => appendRetireSlot(consumer, "director", ID, { reason: "because", by: "owner", at })).toThrow(/does not start with a retire code/);
  });

  it("refuses a candidate that fails verify, or a slot whose ledger is unreadable, and leaves nothing behind", () => {
    expect(() => writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, verify: file => [`${file} is wrong`] })).toThrow(/candidate refused: essence-v1\.md fails the slot model check: essence-v1\.md is wrong/);
    expect(readdirSync(join(dir, "candidates"))).toEqual([]);
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(false);
    writeFileSync(join(dir, LEDGER_FILE), "{not json");
    expect(() => writeCandidate(consumer, "director", ID, "essence", brief("one"), { at })).toThrow();
    expect(readdirSync(join(dir, "candidates"))).toEqual([]);
    expect(readFileSync(join(dir, LEDGER_FILE), "utf8")).toBe("{not json");
    expect(() => writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { verb: "verdict" } })).toThrow();
    expect(readdirSync(join(dir, "candidates"))).toEqual([]);
  });

  it("refuses an event whose provenance is incomplete and keeps the candidate out", () => {
    expect(() => writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { verb: "verdict" } })).toThrow(/ledger event refused: verb verdict runs an LLM/);
    expect(readdirSync(join(dir, "candidates"))).toEqual([]);
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(false);
  });
});

describe("two writers on one slot (withDirLock)", () => {
  /** A child process that writes `count` candidates through slot-write.ts, retrying while the slot lock is held. */
  const CHILD = `
import { register } from "node:module";
const hook = 'import { existsSync } from "node:fs"; import { fileURLToPath } from "node:url";' +
  'export async function resolve(s, c, n) { if ((s.startsWith(".") || s.startsWith("/")) && s.endsWith(".js") && c.parentURL) {' +
  ' const ts = new URL(s.slice(0, -3) + ".ts", c.parentURL); if (existsSync(fileURLToPath(ts))) return n(ts.href, c); } return n(s, c); }';
register("data:text/javascript," + encodeURIComponent(hook), import.meta.url);
const [writer, consumer, id, tag, count, template] = process.argv.slice(2);
const { writeCandidate } = await import(writer);
const { readFileSync } = await import("node:fs");
const text = readFileSync(template, "utf8");
const brief = essence => text.replace("__ESSENCE__", essence);
let busy = 0;
for (let i = 0; i < Number(count); i++) {
  for (;;) {
    try { writeCandidate(consumer, "director", id, "essence", brief(tag + "-" + i), { at: "2026-11-13T00:00:00Z", provenance: { by: "agent:" + tag } }); break; }
    catch (error) { if (!/another decision write is in progress/.test(String(error))) throw error; busy++; await new Promise(done => setTimeout(done, 1)); }
  }
}
console.log(JSON.stringify({ tag, busy }));
`;
  const run = (script: string, args: string[]) => new Promise<{ code: number | null; out: string; err: string }>(done => {
    const child = spawn(process.execPath, ["--no-warnings", script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("close", code => done({ code, out, err }));
  });

  it("leaves one consistent ledger: one submit per file, versions unique, every sha the file's bytes", async () => {
    writeCandidate(consumer, "director", ID, "essence", brief("seed"), { at });
    const script = join(root, "writer-child.mjs");
    writeFileSync(script, CHILD);
    const writer = fileURLToPath(new URL("./slot-write.ts", import.meta.url));
    const COUNT = 12;
    const template = join(root, "brief-template.md");
    writeFileSync(template, brief("__ESSENCE__"));
    const results = await Promise.all(["a", "b"].map(tag => run(script, [writer, consumer, ID, tag, String(COUNT), template])));
    for (const result of results) expect(result, result.err).toMatchObject({ code: 0 });

    const files = readdirSync(join(dir, "candidates")).sort();
    const list = events();
    const submits = list.filter(event => event.op === "submit");
    expect(files).toHaveLength(1 + 2 * COUNT);
    expect(submits).toHaveLength(files.length);
    expect(new Set(submits.map(event => event.name)).size).toBe(files.length);
    expect(submits.map(event => event.name).sort()).toEqual(files);
    for (const name of files) expect(expectedCandidateSha(list, name)).toEqual({ submitted: true, sha256: fileSha(join(dir, "candidates", name)) });
    expect(submits.filter(event => event.by === "agent:a")).toHaveLength(COUNT);
    expect(submits.filter(event => event.by === "agent:b")).toHaveLength(COUNT);
    expect(ledgerIssues(ledger())).toEqual([]);
    expect(existsSync(join(dir, SLOT_LOCK))).toBe(false);
  }, 60_000);
});
