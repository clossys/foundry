import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { checkPinsResolve } from "../check/pins-resolve.js";
import { readPinFile } from "../records/pin-map.js";
import { pinPath } from "../records/pin.js";
import { convertPin1, migratePins } from "./pin-1-to-2.js";

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

const QUEUE_ID = "20261114T1200Z-hero";

function int2World() {
  const w = world();
  w.slot("designer", "sections.hero");
  const hero = w.candidate("designer", "sections.hero", "hero-v1.json");
  w.writeJson("designer/sections.hero/pin.json", { candidate: "hero-v1.json", sha256: hero, decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked", at: "2026-11-14T13:00:00+01:00" });
  w.slot("designer", "sections.footer");
  const footer = w.candidate("designer", "sections.footer", "footer-v1.json");
  w.writeJson("designer/sections.footer/pin.json", { candidate: "footer-v1.json", sha256: footer, decidedBy: "migration:SLOT-MODEL", basis: "bulk", at: "2026-11-14T12:00:00.000Z" });
  w.slot("writer", "sections.hero.copy", { kind: "copy" });
  const copy = w.candidate("writer", "sections.hero.copy", "home.hero-v1.json", { h: "x" }, "home.hero");
  w.writeJson("writer/sections.hero.copy/pin.json", { candidate: "home.hero-v1.json", sha256: copy, decidedBy: "owner", basis: "picked", at: "2026-11-14T12:00:00Z" });
  w.slot("designer", "sections.agent");
  const agentSha = w.candidate("designer", "sections.agent", "agent-v1.json");
  w.writeJson("designer/sections.agent/pin.json", { candidate: "agent-v1.json", sha256: agentSha, decidedBy: "agent:designer", basis: "agent", at: "2026-11-14T12:00:00Z", confirmed: { by: "owner:product#7", ref: "clossys/workspace#46 comment 1", at: "2026-11-14T14:00:00Z" } });
  w.queueEntry("pick", QUEUE_ID);
  return w;
}

describe("pin-1-to-2 migration", () => {
  it("maps int2 fields to pin/2 and refuses what pin/2 cannot hold", () => {
    const ok = convertPin1({ candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "migration", basis: "bulk", at: "2026-11-14T12:00:00Z" });
    expect(ok).toEqual({ ok: true, record: { candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "migrated", basis: "bulk", at: "2026-11-14T12:00:00Z" }, refs: [] });
    const bad = convertPin1({ candidate: "hero.json", sha256: "x", decidedBy: "someone", basis: "vibes", at: "never" } as never);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.issues.length).toBe(5);
  });

  it("migrates every pin/1, writing pin maps for Writer copy, and lists owner pins with no queue answer", () => {
    const w = int2World();
    const report = migratePins(w.root);
    expect(report.written).toBe(4);
    expect(report.rows.every(row => row.outcome === "migrated")).toBe(true);
    expect(report.needsOwnerAnswer).toEqual(["writer/sections.hero.copy"]);
    const hero = w.readJson("designer/sections.hero/pin.json");
    expect(hero).toMatchObject({ schema: "clossys.pin/2", decidedBy: `owner:queue.pick#${QUEUE_ID}`, at: "2026-11-14T12:00:00Z", refs: [{ to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" }], createdBy: { actor: "code", cli: "clossys migrate pin-1-to-2" } });
    expect(w.readJson("designer/sections.footer/pin.json")).toMatchObject({ decidedBy: "migrated", basis: "bulk", at: "2026-11-14T12:00:00Z" });
    expect(w.readJson("designer/sections.agent/pin.json")).toMatchObject({ status: "pinned", confirmed: { by: "owner", ref: "clossys/workspace#46 comment 1" } });
    const copy = readPinFile(pinPath(w.root, "writer", "sections.hero.copy"));
    expect(copy.kind).toBe("pin-map");
    expect(copy.kind === "pin-map" && Object.keys(copy.doc.records)).toEqual(["home.hero"]);
    // Nothing invented: the owner copy pin still fails pins.resolve until the owner answers.
    const run = checkPinsResolve(w.root);
    expect(run.findings.map(f => f.subject)).toEqual(["writer/sections.hero.copy#home.hero"]);
    expect(run.findings[0]!.detail).toMatch(/no answers ref/);
  });

  it("is idempotent: a second run writes nothing and changes no byte", () => {
    const w = int2World();
    migratePins(w.root);
    const before = ["designer/sections.hero", "designer/sections.footer", "writer/sections.hero.copy", "designer/sections.agent"].map(slot => readFileSync(join(w.root, "clossys/agents", slot, "pin.json"), "utf8"));
    const again = migratePins(w.root);
    expect(again.written).toBe(0);
    expect(again.rows.every(row => row.outcome === "already-2")).toBe(true);
    const after = ["designer/sections.hero", "designer/sections.footer", "writer/sections.hero.copy", "designer/sections.agent"].map(slot => readFileSync(join(w.root, "clossys/agents", slot, "pin.json"), "utf8"));
    expect(after).toEqual(before);
  });

  it("is deterministic and plans without writing on a dry run", () => {
    const a = int2World(), b = int2World();
    const plan = migratePins(a.root, { dryRun: true });
    expect(plan.written).toBe(0);
    expect(readPinFile(pinPath(a.root, "designer", "sections.hero")).kind).toBe("pin/1");
    migratePins(a.root); migratePins(b.root);
    expect(a.readJson("designer/sections.footer/pin.json")).toEqual(b.readJson("designer/sections.footer/pin.json"));
  });

  it("refuses a pin/1 with no pin/2 form and leaves it in place", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    w.writeJson("designer/sections.hero/pin.json", { candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "someone-else", basis: "picked", at: "2026-11-14T12:00:00Z" });
    const report = migratePins(w.root);
    expect(report.rows).toEqual([{ slot: "designer/sections.hero", outcome: "refused", issues: ["decidedBy someone-else has no pin/2 form"] }]);
    expect(readPinFile(pinPath(w.root, "designer", "sections.hero")).kind).toBe("pin/1");
  });
});
