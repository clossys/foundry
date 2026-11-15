import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { checkPinsResolve, PINS_RESOLVE } from "./pins-resolve.js";
import { writeTargetPin } from "../records/pin-map.js";
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
const createdBy = cliActor("clossys pin");
const QUEUE_ID = "20261114T1200Z-hero";

function pinned() {
  const w = world();
  w.slot("designer", "sections.hero");
  w.candidate("designer", "sections.hero", "hero-v1.json");
  writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v1.json", decidedBy: "planner", basis: "planner", at: AT, createdBy });
  w.slot("publisher", "chrome.site-header");
  w.packageDefault("publisher", "chrome.site-header", "header-v1.json");
  w.slot("designer", "sections.gone", { status: "retired" });
  return w;
}

describe(PINS_RESOLVE, () => {
  it("passes when every slot resolves by pin or package default (retired slots skipped)", () => {
    expect(checkPinsResolve(pinned().root)).toEqual({ check: PINS_RESOLVE, status: "pass", findings: [] });
  });

  it("fails when a pinned candidate changed after the pin (sha mismatch)", () => {
    const w = pinned();
    writeFileSync(candidatePath(w.root, "designer", "sections.hero", "hero-v1.json"), "{}");
    const run = checkPinsResolve(w.root);
    expect(run.status).toBe("fail");
    expect(run.findings).toEqual([expect.objectContaining({ subject: "designer/sections.hero", detail: expect.stringMatching(/sha256 .* does not match/) })]);
  });

  it("fails a pin to a missing candidate", () => {
    const w = pinned();
    const pin = w.readJson("designer/sections.hero/pin.json");
    w.writeJson("designer/sections.hero/pin.json", { ...pin, candidate: "hero-v9.json" });
    expect(checkPinsResolve(w.root).findings.map(f => f.detail).join()).toMatch(/hero-v9.json, which is not in/);
  });

  it("fails an owner basis with no queue answer ref, even with a package default to fall back on", () => {
    const w = pinned();
    w.packageDefault("designer", "sections.hero", "hero-v1.json");
    const pin = w.readJson("designer/sections.hero/pin.json");
    w.writeJson("designer/sections.hero/pin.json", { ...pin, decidedBy: "owner", basis: "picked" });
    const run = checkPinsResolve(w.root);
    expect(run.status).toBe("fail");
    expect(run.findings[0]!.detail).toMatch(/no answers ref/);
    w.queueEntry("pick", QUEUE_ID);
    w.writeJson("designer/sections.hero/pin.json", { ...pin, decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked", refs: [{ to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" }] });
    expect(checkPinsResolve(w.root).status).toBe("pass");
  });

  it("fails an unmigrated pin/1 and a slot with nothing to resolve", () => {
    const w = pinned();
    w.writeJson("designer/sections.hero/pin.json", { candidate: "hero-v1.json", sha256: "a".repeat(64), decidedBy: "planner", basis: "planner", at: AT });
    w.slot("designer", "sections.footer");
    const run = checkPinsResolve(w.root);
    expect(run.findings.map(f => f.subject)).toEqual(["designer/sections.footer", "designer/sections.hero"]);
    expect(run.findings[1]!.detail).toMatch(/pin-1-to-2/);
    expect(pinPath(w.root, "designer", "sections.hero")).toMatch(/pin\.json$/);
  });

  it("judges Writer record slots per record", () => {
    const w = world();
    w.slot("writer", "sections.hero.copy", { kind: "copy" });
    expect(checkPinsResolve(w.root).findings[0]!.detail).toMatch(/record slot with no pinned record/);
    w.packageDefault("writer", "sections.hero.copy", "home.hero-v1.json");
    w.candidate("writer", "sections.hero.copy", "about.hero-v1.json", {}, "about.hero");
    const run = checkPinsResolve(w.root);
    expect(run.findings.map(f => f.subject)).toEqual(["writer/sections.hero.copy#about.hero"]);
  });
});
