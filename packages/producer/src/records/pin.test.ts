import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { buildPin, cliActor, ownerAnswerRef, pinIssues, pinRecordIssues, toIsoZ } from "../records/pin.js";
import type { PinRecord } from "../records/types.js";
import { runPinCli } from "../cli/pin.js";

// A temp workspace: a `packages/` folder (so package defaults and versions read from it) and a `clossys/` consumer.
function world() {
  const root = mkdtempSync(join(tmpdir(), "target-records-"));
  for (const agent of ["designer", "writer", "publisher", "producer"]) {
    mkdirSync(join(root, "packages", agent), { recursive: true });
    writeFileSync(join(root, "packages", agent, "package.json"), JSON.stringify({ name: `@clossys/${agent}`, version: "1.2.3" }));
  }
  const at = "2026-11-14T12:00:00Z";
  const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const api = {
    root,
    slot(agent: AgentId, slotId: string, extra: Record<string, unknown> = {}): void {
      put(join(slotDir(root, agent, slotId), "slot.json"), JSON.stringify({ schema: "clossys.slot/2", id: `${agent}/${slotId}`, agent, kind: "section", status: "open", ...extra }));
    },
    /** Writes a consumer candidate and returns its sha256. */
    candidate(agent: AgentId, slotId: string, name: string, content: unknown = { n: name }, record?: string): string {
      const header = buildCandidateHeader({ agent, slotId, name, createdBy: { actor: "planner", ref: "test" }, createdAt: at, source: { kind: "original", ref: [] }, ...(record ? { record } : {}) });
      const file = candidatePath(root, agent, slotId, name);
      mkdirSync(dirname(file), { recursive: true });
      return writeCandidateFile(file, serializeCandidate(name, header, content));
    },
    packageDefault(agent: AgentId, slotId: string, name: string): string {
      const header = buildCandidateHeader({ agent, slotId, name, createdBy: candidateCreatedBy(root, { actor: "package", agent }), createdAt: at, source: { kind: "package-default", ref: [] }, packageDefault: true });
      const file = join(packageDefaultDir(root, agent, slotId), name);
      mkdirSync(dirname(file), { recursive: true });
      return writeCandidateFile(file, serializeCandidate(name, header, { n: name }));
    },
    queueEntry(kind: string, id: string): void {
      put(join(root, "clossys", "agents", "producer", `queue.${kind}`, "entries", `${id}.json`), JSON.stringify({ id, kind: "queue-entry" }));
    },
    writeJson(rel: string, doc: unknown): void { put(join(root, "clossys", "agents", rel), JSON.stringify(doc, null, 2)); },
    readJson(rel: string): any { return JSON.parse(readFileSync(join(root, "clossys", "agents", rel), "utf8")); },
  };
  return api;
}

const SHA = "a".repeat(64);
const AT = "2026-11-14T12:00:00Z";
const QUEUE_ID = "20261114T1200Z-hero";
const record = (over: Partial<PinRecord>): PinRecord => ({ candidate: "hero-v1.json", sha256: SHA, decidedBy: "planner", basis: "planner", at: AT, ...over });
const answers = { to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" };

describe("clossys.pin/2 rules", () => {
  it("pairs decidedBy and basis", () => {
    expect(pinRecordIssues(record({}), [])).toEqual([]);
    expect(pinRecordIssues(record({ decidedBy: "agent:designer", basis: "agent" }), [])).toEqual([]);
    expect(pinRecordIssues(record({ decidedBy: "agent:designer", basis: "planner" }), []).join()).toMatch(/agent pick/);
    expect(pinRecordIssues(record({ decidedBy: "planner", basis: "picked" }), []).join()).toMatch(/planner pin/);
    expect(pinRecordIssues(record({ decidedBy: "owner", basis: "planner" }), []).join()).toMatch(/basis planner needs decidedBy planner/);
    expect(pinRecordIssues(record({ basis: "agent" }), []).join()).toMatch(/basis agent needs decidedBy agent/);
  });

  it("refuses an owner basis with no queue answer ref (no invented owner basis)", () => {
    expect(pinRecordIssues(record({ decidedBy: "owner", basis: "picked" }), []).join()).toMatch(/no answers ref/);
    expect(pinRecordIssues(record({ decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "bulk" }), []).join()).toMatch(/no answers ref/);
    expect(pinRecordIssues(record({ decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked" }), [answers])).toEqual([]);
    expect(pinRecordIssues(record({ decidedBy: "owner", basis: "picked" }), [answers])).toEqual([]);
    expect(pinRecordIssues(record({ decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked" }), [{ ...answers, record: "20261114T1200Z-other" }]).join()).toMatch(/no answers ref lists/);
    expect(pinRecordIssues(record({ decidedBy: "agent:writer", basis: "picked" }), [answers]).join()).toMatch(/owner's/);
    expect(pinRecordIssues(record({ decidedBy: "migrated", basis: "picked" }), [])).toEqual([]);
  });

  it("allows confirmed only on an agent pick, after the pick", () => {
    const confirmed = { by: "owner" as const, ref: "producer/queue.approve#x", at: "2026-11-14T13:00:00Z" };
    expect(pinRecordIssues(record({ decidedBy: "agent:designer", basis: "agent", confirmed }), [])).toEqual([]);
    expect(pinRecordIssues(record({ confirmed }), []).join()).toMatch(/only for a basis agent/);
    expect(pinRecordIssues(record({ decidedBy: "agent:designer", basis: "agent", confirmed: { ...confirmed, at: "2026-11-14T11:00:00Z" } }), []).join()).toMatch(/before the pick/);
  });

  it("builds a schema-valid pin/2 and keeps createdAt when replacing", () => {
    const w = world();
    const createdBy = cliActor("clossys pin");
    expect(createdBy.actor).toBe("code");
    const pin = buildPin({ agent: "designer", slotId: "sections.hero", record: record({}), createdBy });
    expect(pinIssues(pin, { agent: "designer", slotId: "sections.hero" })).toEqual([]);
    expect(pin.status).toBe("confirm");
    expect(pinIssues(pin, { agent: "designer", slotId: "sections.footer" }).join()).toMatch(/pin id/);
    const later = buildPin({ agent: "designer", slotId: "sections.hero", record: record({ at: "2026-11-15T00:00:00Z" }), createdBy, previous: pin });
    expect(later.createdAt).toBe(AT);
    expect(later.updatedAt).toBe("2026-11-15T00:00:00Z");
    expect(buildPin({ agent: "designer", slotId: "sections.hero", record: record({ decidedBy: "owner", basis: "picked" }), refs: [answers], createdBy }).status).toBe("pinned");
    expect(w.root).toBeTruthy();
  });

  it("reads queue answers out of decidedBy and normalizes timestamps", () => {
    expect(ownerAnswerRef(`owner:queue.pick#${QUEUE_ID}`)).toEqual(answers);
    expect(ownerAnswerRef("owner")).toBeUndefined();
    expect(ownerAnswerRef("owner:product#12")).toBeUndefined();
    expect(toIsoZ("2026-11-14T12:00:00.000Z")).toBe("2026-11-14T12:00:00.000Z");
    expect(toIsoZ("2026-11-14T13:00:00+01:00")).toBe("2026-11-14T12:00:00Z");
    expect(toIsoZ("yesterday")).toBeUndefined();
  });

  it("the pin verb writes pin/2 for a clossys.slot/2 slot, and never invents an owner basis", async () => {
    const w = world();
    writeFileSync(join(w.root, "clossys", "clossys.config.ts"), "export default {};\n");
    w.slot("designer", "sections.hero");
    const sha = w.candidate("designer", "sections.hero", "hero-v1.json");
    const bare = await runPinCli(["designer/sections.hero", "hero-v1.json", "--by", "owner", "--at", AT], w.root, false);
    expect(bare.exitCode).toBe(1);
    expect(bare.message).toMatch(/names no queue answer/);
    const missingEntry = await runPinCli(["designer/sections.hero", "hero-v1.json", "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT], w.root, false);
    expect(missingEntry.message).toMatch(/is not a queue entry/);
    const missing = await runPinCli(["designer/sections.hero", "hero-v2.json", "--by", "planner", "--at", AT], w.root, false);
    expect(missing.message).toMatch(/no candidate hero-v2.json/);
    w.queueEntry("pick", QUEUE_ID);
    const ok = await runPinCli(["designer/sections.hero", "hero-v1.json", "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT], w.root, false);
    expect(ok.exitCode).toBe(0);
    const pin = w.readJson("designer/sections.hero/pin.json");
    expect(pin).toMatchObject({ schema: "clossys.pin/2", sha256: sha, basis: "picked", decidedBy: `owner:queue.pick#${QUEUE_ID}`, refs: [answers], createdBy: { actor: "code", cli: "clossys pin" } });
    expect(pinIssues(pin, { agent: "designer", slotId: "sections.hero" })).toEqual([]);
  });
});
