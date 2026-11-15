import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { pinMapIssues, readPinFile, setPinMapRecord, writeTargetPin } from "../records/pin-map.js";
import { cliActor, pinPath } from "../records/pin.js";

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

const AT = "2026-11-14T12:00:00Z";
const QUEUE_ID = "20261114T1200Z-copy";
const createdBy = cliActor("clossys pin");

describe("clossys.pin-map/1 and writeTargetPin", () => {
  it("writes a pin/2 for a single-pin slot from the candidate bytes", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    const sha = w.candidate("designer", "sections.hero", "hero-v1.json");
    const doc = writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v1.json", decidedBy: "planner", basis: "planner", at: AT, createdBy });
    expect(doc).toMatchObject({ schema: "clossys.pin/2", sha256: sha, candidate: "hero-v1.json" });
    const read = readPinFile(pinPath(w.root, "designer", "sections.hero"), { agent: "designer", slotId: "sections.hero" });
    expect(read.kind).toBe("pin");
    expect(read.kind === "pin" && read.issues).toEqual([]);
  });

  it("refuses a pin to a missing candidate, and writes nothing", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    expect(() => writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v2.json", decidedBy: "planner", basis: "planner", at: AT, createdBy })).toThrow(/no candidate hero-v2.json/);
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("none");
  });

  it("refuses an owner basis with no queue answer ref", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    w.candidate("designer", "sections.hero", "hero-v1.json");
    expect(() => writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v1.json", decidedBy: "owner", basis: "picked", at: AT, createdBy })).toThrow(/no answers ref/);
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("none");
  });

  it("keeps one record per key for Writer copy slots", () => {
    const w = world();
    w.slot("writer", "sections.hero.copy", { kind: "copy" });
    w.candidate("writer", "sections.hero.copy", "home.hero-v1.json", { h: "a" }, "home.hero");
    w.candidate("writer", "sections.hero.copy", "about.hero-v1.json", { h: "b" }, "about.hero");
    const answers = { to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" };
    writeTargetPin(w.root, { agent: "writer", slotId: "sections.hero.copy", record: "home.hero", candidate: "home.hero-v1.json", decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked", at: AT, refs: [answers], createdBy });
    const map = writeTargetPin(w.root, { agent: "writer", slotId: "sections.hero.copy", record: "about.hero", candidate: "about.hero-v1.json", decidedBy: "planner", basis: "planner", at: "2026-11-14T13:00:00Z", createdBy });
    expect(map.kind).toBe("pin-map");
    if (map.kind !== "pin-map") return;
    expect(Object.keys(map.records)).toEqual(["about.hero", "home.hero"]);
    expect(map.status).toBe("confirm");
    expect(map.createdAt).toBe(AT);
    expect(map.refs).toEqual([answers]);
    expect(pinMapIssues(map, { agent: "writer", slotId: "sections.hero.copy" })).toEqual([]);
    expect(() => writeTargetPin(w.root, { agent: "writer", slotId: "sections.hero.copy", candidate: "home.hero-v1.json", decidedBy: "planner", basis: "planner", at: AT, createdBy })).toThrow(/pins per record/);
    expect(() => writeTargetPin(w.root, { agent: "writer", slotId: "sections.hero.copy", record: "about.hero", candidate: "home.hero-v1.json", decidedBy: "planner", basis: "planner", at: AT, createdBy })).toThrow(/not a candidate of record/);
  });

  it("flags a pin map record whose candidate is not of that record", () => {
    const map = setPinMapRecord(undefined, { agent: "writer", slotId: "sections.hero.copy", record: "home.hero", pin: { candidate: "about.hero-v1.json", sha256: "b".repeat(64), decidedBy: "planner", basis: "planner", at: AT }, createdBy, at: AT });
    expect(pinMapIssues(map, { agent: "writer", slotId: "sections.hero.copy" }).join()).toMatch(/not a file of record home.hero/);
    expect(setPinMapRecord(map!, { agent: "writer", slotId: "sections.hero.copy", record: "home.hero", pin: null, createdBy, at: AT })).toBeNull();
  });

  it("reads pin/1, invalid and unknown pin files without throwing", () => {
    const w = world();
    w.writeJson("designer/sections.hero/pin.json", { candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "owner", basis: "picked", at: AT });
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("pin/1");
    w.writeJson("designer/sections.hero/pin.json", { schema: "clossys.pin/9" });
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("invalid");
    writeFileSync(pinPath(w.root, "designer", "sections.hero"), "{");
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("invalid");
  });
});
