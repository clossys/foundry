import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, packageDefaultDir, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import type { AgentId } from "../records/types.js";
import { CANDIDATE_IMMUTABLE, checkCandidateImmutable } from "./candidate-immutable.js";

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

const ledger = (id: string, wrote: { file: string; sha256: string | null }[]) => ({ id, kind: "ledger-entry", steps: [{ wrote }] });

describe(CANDIDATE_IMMUTABLE, () => {
  it("passes while every submitted candidate keeps the bytes the ledger recorded", () => {
    const w = world();
    const sha = w.candidate("designer", "sections.hero", "hero-v1.json");
    w.writeJson("producer/ledger.fill/entries/20261114T1200Z-a.json", ledger("20261114T1200Z-a", [
      { file: "designer/sections.hero/candidates/hero-v1.json", sha256: sha },
      { file: "designer/sections.hero/pin.json", sha256: "f".repeat(64) },
      { file: "designer/sections.hero/candidates/hero-v2.json", sha256: null },
    ]));
    expect(checkCandidateImmutable(w.root)).toEqual({ check: CANDIDATE_IMMUTABLE, status: "pass", findings: [] });
  });

  it("fails when candidate bytes changed after submit", () => {
    const w = world();
    const sha = w.candidate("designer", "sections.hero", "hero-v1.json");
    w.writeJson("producer/ledger.fill/entries/20261114T1200Z-a.json", ledger("20261114T1200Z-a", [{ file: "designer/sections.hero/candidates/hero-v1.json", sha256: sha }]));
    writeFileSync(candidatePath(w.root, "designer", "sections.hero", "hero-v1.json"), "{\"edited\":true}");
    const run = checkCandidateImmutable(w.root);
    expect(run.status).toBe("fail");
    expect(run.findings).toEqual([expect.objectContaining({ subject: "designer/sections.hero/candidates/hero-v1.json", detail: expect.stringMatching(/differs from/) })]);
  });

  it("fails when a candidate is deleted or recorded twice with different digests", () => {
    const w = world();
    w.writeJson("producer/ledger.fill/entries/20261114T1200Z-a.json", ledger("20261114T1200Z-a", [{ file: "designer/sections.hero/candidates/hero-v1.json", sha256: "a".repeat(64) }]));
    w.writeJson("producer/ledger.fill/entries/20261114T1300Z-b.json", ledger("20261114T1300Z-b", [{ file: "designer/sections.hero/candidates/hero-v1.json", sha256: "b".repeat(64) }]));
    const details = checkCandidateImmutable(w.root).findings.map(f => f.detail).join("\n");
    expect(details).toMatch(/the candidate was rewritten/);
    expect(details).toMatch(/the file is gone/);
  });

  it("fails a ledger entry that is not JSON", () => {
    const w = world();
    mkdirSync(join(w.root, "clossys/agents/producer/ledger.fill/entries"), { recursive: true });
    writeFileSync(join(w.root, "clossys/agents/producer/ledger.fill/entries/bad.json"), "{");
    expect(checkCandidateImmutable(w.root).findings[0]!.detail).toBe("ledger entry is not JSON");
    expect(readFileSync(join(w.root, "packages/designer/package.json"), "utf8")).toMatch(/1\.2\.3/);
  });
});
