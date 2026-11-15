import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { writeTargetPin } from "../records/pin-map.js";
import { cliActor } from "../records/pin.js";
import { parseRefString, resolveRef, resolveSlot } from "../records/resolve.js";

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
const planner = { decidedBy: "planner", basis: "planner" as const, at: AT, createdBy };

describe("resolution order: consumer pin, then package default", () => {
  it("parses ref strings", () => {
    expect(parseRefString("designer/sections.hero")).toEqual({ agent: "designer", slotId: "sections.hero" });
    expect(parseRefString("writer/sections.hero.copy#home.hero")).toMatchObject({ agent: "writer", slotId: "sections.hero.copy", record: "home.hero" });
    expect(parseRefString("designer/sections.hero/package:hero-v1.json")).toMatchObject({ candidate: "hero-v1.json", packageDefault: true });
    expect(parseRefString("nobody/sections.hero")).toBeUndefined();
  });

  it("uses a valid consumer pin first", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    w.packageDefault("designer", "sections.hero", "hero-v1.json");
    const sha = w.candidate("designer", "sections.hero", "hero-v2.json");
    writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v2.json", ...planner });
    expect(resolveSlot(w.root, "designer", "sections.hero")).toMatchObject({ state: "pinned", candidate: "hero-v2.json", sha256: sha, status: "confirm" });
  });

  it("falls back to the package default as a sample", () => {
    const w = world();
    w.slot("publisher", "chrome.site-header");
    w.packageDefault("publisher", "chrome.site-header", "header-v1.json");
    expect(resolveSlot(w.root, "publisher", "chrome.site-header")).toMatchObject({ state: "sample", candidate: "header-v1.json", basis: "package-default" });
    expect(resolveSlot(w.root, "publisher", "chrome.site-header")).not.toHaveProperty("pinIssue");
  });

  it("reads Producer loop defaults from loops/<slot-id>/", () => {
    const w = world();
    w.slot("producer", "loop.release", { kind: "loop" });
    w.packageDefault("producer", "loop.release", "release-v1.json");
    expect(resolveSlot(w.root, "producer", "loop.release")).toMatchObject({ state: "sample", candidate: "release-v1.json" });
  });

  it("does not resolve a pin whose candidate bytes changed (sha mismatch)", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    w.candidate("designer", "sections.hero", "hero-v2.json");
    writeTargetPin(w.root, { agent: "designer", slotId: "sections.hero", candidate: "hero-v2.json", ...planner });
    writeFileSync(candidatePath(w.root, "designer", "sections.hero", "hero-v2.json"), "{\"changed\":true}");
    const broken = resolveSlot(w.root, "designer", "sections.hero");
    expect(broken.state).toBe("unresolved");
    expect(broken.state === "unresolved" && broken.reason).toMatch(/changed after it was pinned/);
    w.packageDefault("designer", "sections.hero", "hero-v1.json");
    const fallback = resolveSlot(w.root, "designer", "sections.hero");
    expect(fallback).toMatchObject({ state: "sample", candidate: "hero-v1.json" });
    expect(fallback.state === "sample" && fallback.pinIssue).toMatch(/changed after it was pinned/);
  });

  it("is unresolved with no pin and no default, or with several defaults", () => {
    const w = world();
    w.slot("designer", "sections.hero");
    expect(resolveSlot(w.root, "designer", "sections.hero")).toMatchObject({ state: "unresolved", reason: "no pin and no package default" });
    w.packageDefault("designer", "sections.hero", "a-v1.json");
    w.packageDefault("designer", "sections.hero", "b-v1.json");
    expect(resolveSlot(w.root, "designer", "sections.hero").state).toBe("unresolved");
  });

  it("resolves Writer records one by one", () => {
    const w = world();
    w.slot("writer", "sections.hero.copy", { kind: "copy" });
    w.packageDefault("writer", "sections.hero.copy", "home.hero-v1.json");
    w.candidate("writer", "sections.hero.copy", "about.hero-v1.json", {}, "about.hero");
    writeTargetPin(w.root, { agent: "writer", slotId: "sections.hero.copy", record: "about.hero", candidate: "about.hero-v1.json", ...planner });
    expect(resolveRef(w.root, "writer/sections.hero.copy#about.hero")).toMatchObject({ state: "pinned", candidate: "about.hero-v1.json" });
    expect(resolveRef(w.root, "writer/sections.hero.copy#home.hero")).toMatchObject({ state: "sample", candidate: "home.hero-v1.json" });
    expect(resolveRef(w.root, "writer/sections.hero.copy#blog.hero").state).toBe("unresolved");
    expect(resolveRef(w.root, "writer/sections.hero.copy/about.hero-v1.json").state).toBe("invalid");
  });
});
