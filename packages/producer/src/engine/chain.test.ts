import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineEventError, EngineLogError, EVENTS_FILE, eventLine, sha256, verifyChain } from "./chain.js";
import { appendEvent } from "./log.js";
import { GENESIS, eventIssues, type EngineEvent, type EventDraft } from "./types.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "engine-chain-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const draft = (n: number): EventDraft => ({ actor: "code:test", kind: "slot.submit", subject: `director/slot-${n}`, inputs: [{ path: `clossys/agents/director/slot-${n}/ledger.json`, sha256: sha256(String(n)) }] });
const log = () => join(root, EVENTS_FILE);
const lines = () => readFileSync(log(), "utf8").split("\n").slice(0, -1);
const put = (next: readonly string[]) => writeFileSync(log(), next.map(line => `${line}\n`).join(""));
const codes = () => verifyChain(root).issues.map(issue => [issue.line, issue.code]);

describe("event chain (engine/chain.ts, engine/log.ts)", () => {
  it("appends chained events and verifies them", () => {
    const events = [0, 1, 2, 3].map(n => appendEvent(root, draft(n)));
    expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3]);
    expect(events[0]!.prev).toBe(GENESIS);
    const text = lines();
    for (let n = 1; n < text.length; n++) expect(events[n]!.prev).toBe(sha256(text[n - 1]!));
    for (const event of events) expect(eventIssues(event)).toEqual([]);
    const report = verifyChain(root);
    expect(report).toMatchObject({ ok: true, count: 4, head: sha256(text[3]!), issues: [] });
    expect(report.events.map(event => event.subject)).toEqual(events.map(event => event.subject));
  });

  it("verifies an empty or missing log", () => {
    expect(verifyChain(root)).toMatchObject({ ok: true, count: 0, head: null, issues: [] });
  });

  it("detects a tampered line (an edited field)", () => {
    for (const n of [0, 1, 2]) appendEvent(root, draft(n));
    const text = lines();
    put([text[0]!, text[1]!.replace("director/slot-1", "director/slot-9"), text[2]!]);
    // Line numbers are 1-based: line 2 no longer hashes to its id, and line 3 names the old hash as prev.
    expect(codes()).toEqual([[2, "edit"], [3, "edit"]]);
  });

  it("detects a line rewritten with a fresh id (the next line's prev no longer matches)", () => {
    for (const n of [0, 1, 2]) appendEvent(root, draft(n));
    const text = lines();
    const { id: _id, ...fields } = JSON.parse(text[1]!) as EngineEvent;
    const forged = eventLine({ ...fields, actor: "owner" }).line;
    put([text[0]!, forged, text[2]!]);
    expect(codes()).toEqual([[3, "edit"]]);
  });

  it("detects a reordered line", () => {
    for (const n of [0, 1, 2, 3]) appendEvent(root, draft(n));
    const text = lines();
    put([text[0]!, text[2]!, text[1]!, text[3]!]);
    const found = codes();
    expect(found).toContainEqual([3, "reorder"]);
    expect(verifyChain(root).ok).toBe(false);
  });

  it("detects a duplicated line as a reorder", () => {
    for (const n of [0, 1]) appendEvent(root, draft(n));
    const text = lines();
    put([text[0]!, text[1]!, text[1]!]);
    expect(codes()).toEqual([[3, "reorder"]]);
  });

  it("detects a gap (a removed middle line)", () => {
    for (const n of [0, 1, 2]) appendEvent(root, draft(n));
    const text = lines();
    put([text[0]!, text[2]!]);
    expect(codes()).toEqual([[2, "gap"]]);
  });

  it("detects a torn last line and a malformed line, and appendEvent refuses to chain onto them", () => {
    for (const n of [0, 1]) appendEvent(root, draft(n));
    const text = readFileSync(log(), "utf8");
    writeFileSync(log(), text.slice(0, -1));
    expect(codes()).toContainEqual([2, "torn"]);
    expect(() => appendEvent(root, draft(2))).toThrow(EngineLogError);
    writeFileSync(log(), `${text}not json\n`);
    expect(codes()).toEqual([[3, "malformed"]]);
    expect(() => appendEvent(root, draft(2))).toThrow(EngineLogError);
    expect(readFileSync(log(), "utf8")).toBe(`${text}not json\n`);
  });

  it("refuses an invalid draft and writes nothing", () => {
    expect(() => appendEvent(root, { ...draft(0), kind: "Submit" })).toThrow(EngineEventError);
    expect(() => appendEvent(root, { ...draft(0), actor: "two\nlines" })).toThrow(EngineEventError);
    expect(() => appendEvent(root, { ...draft(0), inputs: [{ path: "/abs/path", sha256: null }] })).toThrow(EngineEventError);
    expect(() => appendEvent(root, { ...draft(0), inputs: [{ path: "../outside", sha256: null }] })).toThrow(EngineEventError);
    expect(verifyChain(root).count).toBe(0);
  });

  it("sorts inputs so a line's bytes do not depend on the caller's order", () => {
    mkdirSync(join(root, ".clossys"), { recursive: true });
    const event = appendEvent(root, { ...draft(0), inputs: [{ path: "b.json", sha256: null }, { path: "a.json", sha256: null }] });
    expect(event.inputs.map(input => input.path)).toEqual(["a.json", "b.json"]);
  });
});
