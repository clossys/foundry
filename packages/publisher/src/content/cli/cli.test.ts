import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainPublisherContent } from "./index.js";
import type { PublisherCommand, PublisherCommandResult } from "./types.js";
import type { ContentCandidate, ContentSlot } from "../model.js";
import type { ReviewReport } from "../review/types.js";
import { loadContentStore, writeContentStore } from "../node.js";
import { at, designerFixture, emptyRegistry, slotInput, writerContent } from "./__fixtures__/workflow.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function storeBytes(root: string): Promise<Record<string, string>> {
  const bytes: Record<string, string> = {};
  async function visit(path: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), name + "/");
      else bytes[name] = (await readFile(join(path, entry.name))).toString("base64");
    }
  }
  await visit(root);
  return bytes;
}

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "publisher-cli-")); roots.push(parent);
  const root = join(parent, "publisher"), designer = join(parent, "designer");
  const { catalog, version } = await designerFixture(designer);
  const catalogFile = join(parent, "catalog.json");
  await writeFile(catalogFile, JSON.stringify(catalog));
  await writeContentStore(root, emptyRegistry());
  let count = 0;
  async function argv(command: PublisherCommand, input: unknown): Promise<string[]> {
    const inputFile = join(parent, `command-${++count}.json`);
    await writeFile(inputFile, JSON.stringify(input));
    return [command, "--root", root, "--designer", designer, "--catalog", catalogFile, "--input", inputFile, "--at", at];
  }
  return {
    root, designer, catalog, version, parent, argv,
    run: async (command: PublisherCommand, input: unknown) => mainPublisherContent(await argv(command, input)),
    load: () => loadContentStore(root, { designer: { root: designer, catalog } }),
  };
}

function clean<T>(result: PublisherCommandResult): T {
  expect(result).toMatchObject({ exitCode: 0, findings: [] });
  expect(result.data).toBeDefined();
  return result.data as T;
}

async function draft(f: Awaited<ReturnType<typeof fixture>>) {
  const { slot } = clean<{ slot: ContentSlot }>(await f.run("slot-create", { slot: slotInput }));
  expect(slot.id).toMatch(/^sl_[a-z0-9]{10}$/);
  expect(slot).toMatchObject({ ...slotInput, releases: [], createdAt: at });
  expect(slot).not.toHaveProperty("activeCandidateId");
  const { candidate } = clean<{ candidate: ContentCandidate }>(await f.run("candidate-add", { slotId: slot.id, content: writerContent(f.version) }));
  expect(candidate).toMatchObject({ id: "c1", slotId: slot.id, origin: "agent-draft", state: "draft", revision: "r1" });
  expect(candidate.history).toHaveLength(1);
  expect(candidate).not.toHaveProperty("approval");
  return { slot, candidate };
}

describe("Publisher content command workflow", () => {
  it("runs an empty real PB4 store through Writer revision, review, explicit owner approval, activation and immutable releases", async () => {
    const f = await fixture();
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await f.load()).registry).toEqual(emptyRegistry());
    const { slot, candidate } = await draft(f);
    const beforeRevision = await storeBytes(f.root);
    const revised = clean<{ candidate: ContentCandidate }>(await f.run("candidate-revise", { candidateId: candidate.id, content: writerContent(f.version, "Revised welcome") })).candidate;
    expect(revised).toMatchObject({ id: candidate.id, slotId: slot.id, state: "draft", revision: "r2" });
    expect(revised.history.map(row => row.revision)).toEqual(["r1", "r2"]);
    expect(revised.composition?.sections[0]?.fields).toEqual([{ key: "heading", locale: "en", value: "Revised welcome", source: "writer" }]);
    const afterRevision = await storeBytes(f.root);
    const immutableRevision = Object.entries(beforeRevision).filter(([name]) => /(?:r1\.json|r1\.copy\.json)$/.test(name));
    expect(immutableRevision).toHaveLength(2);
    for (const [name, bytes] of immutableRevision) expect(afterRevision[name]).toBe(bytes);
    const rejoined = (await f.load()).registry;
    expect(rejoined.slots).toHaveLength(1); expect(rejoined.candidates).toHaveLength(1);
    expect(rejoined.candidates[0]).toEqual(revised);
    const copy = JSON.parse(await readFile(join(f.root, "en", slot.id, candidate.id, "r2.copy.json"), "utf8"));
    expect(copy).toEqual([
      { key: "title", locale: "en", value: "Home", source: "writer" },
      { key: "description", locale: "en", value: "Consumer owned home page", source: "writer" },
      { key: "heading", locale: "en", value: "Revised welcome", source: "writer" },
    ]);

    const reviewed = clean<{ candidate: ContentCandidate; report: ReviewReport }>(await f.run("review", { candidateId: candidate.id }));
    expect(reviewed.candidate.state).toBe("in-review");
    expect(reviewed.report).toMatchObject({ candidateId: candidate.id, revision: "r2", findings: [], needs: [], checkedAgainst: { libraryVersion: f.version, locales: ["en"] } });
    expect(reviewed.report.digest).toMatch(/^[a-f0-9]{64}$/);
    const approved = clean<{ candidate: ContentCandidate }>(await f.run("approve", { candidateId: candidate.id, by: "owner", revision: reviewed.report.revision, digest: reviewed.report.digest })).candidate;
    expect(approved).toMatchObject({ state: "approved", approval: { source: "owner", by: "owner", at, revision: "r2", digest: reviewed.report.digest } });
    const active = clean<{ candidate: ContentCandidate }>(await f.run("activate", { candidateId: candidate.id })).candidate;
    expect(active.state).toBe("active");
    expect((await f.load()).registry.slots[0]?.activeCandidateId).toBe(candidate.id);

    clean(await f.run("release", { candidateId: candidate.id, approvedBy: "owner" }));
    const prefix = join(f.root, "_releases", "public");
    expect((await readdir(prefix)).sort()).toEqual(["1.build.json", "1.handover.json", "1.json"]);
    const manifest = JSON.parse(await readFile(join(prefix, "1.json"), "utf8"));
    expect(manifest).toMatchObject({ targetId: "public", n: 1, at, approvedBy: "owner", entries: [{ slotId: slot.id, candidateId: candidate.id, revision: "r2", digest: reviewed.report.digest, route: "/" }] });
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(await readFile(join(prefix, "1.build.json"), "utf8"))).toMatchObject({ targetId: "public", releaseN: 1, routes: [{ slotId: slot.id, revision: "r2", digest: reviewed.report.digest, path: "/" }] });
    expect(JSON.parse(await readFile(join(prefix, "1.handover.json"), "utf8"))).toEqual({ targetId: "public", releaseN: 1, receiver: "builder", matches: false, status: "pending", observedAt: null });
    const first = await storeBytes(prefix);
    clean(await f.run("release", { candidateId: candidate.id, approvedBy: "owner" }));
    const second = await storeBytes(prefix);
    expect(Object.keys(second).sort()).toEqual(["1.build.json", "1.handover.json", "1.json", "2.build.json", "2.handover.json", "2.json"]);
    for (const [name, bytes] of Object.entries(first)) expect(second[name]).toBe(bytes);
    expect(JSON.parse(await readFile(join(prefix, "2.json"), "utf8"))).toMatchObject({ targetId: "public", n: 2 });
    expect(output).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it("rejects activation before review and approval with stage findings and no store changes", async () => {
    const f = await fixture(), { candidate } = await draft(f);
    const before = await storeBytes(f.root);
    const result = await f.run("activate", { candidateId: candidate.id });
    expect(result.exitCode).toBe(1);
    expect(result.findings.map(finding => finding.rule)).toContain("approval-required");
    expect(result.findings.map(finding => finding.rule)).toContain("stage-prerequisite");
    expect(await storeBytes(f.root)).toEqual(before);
    expect((await f.load()).registry.candidates[0]?.state).toBe("draft");
  });

  it("rejects forged workflow metadata, stale approval and bypass flags without changing stored bytes", async () => {
    const f = await fixture(), { slot, candidate } = await draft(f);
    const before = await storeBytes(f.root);
    for (const metadata of [{ state: "active" }, { origin: "imported" }, { approval: { source: "owner", by: "forged", at, revision: "r1", digest: "a".repeat(64) } }, { history: [] }, { revision: "r99" }]) {
      const result = await f.run("candidate-add", { slotId: slot.id, content: { ...writerContent(f.version), ...metadata } });
      expect(result.exitCode).toBe(1); expect(result.findings.map(finding => finding.rule)).toEqual(["unknown-field"]);
      expect(await storeBytes(f.root)).toEqual(before);
    }
    const reviewed = clean<{ report: ReviewReport }>(await f.run("review", { candidateId: candidate.id }));
    const beforeApproval = await storeBytes(f.root);
    const stale = await f.run("approve", { candidateId: candidate.id, by: "owner", revision: reviewed.report.revision, digest: "0".repeat(64) });
    expect(stale.exitCode).toBe(1); expect(stale.findings.map(finding => finding.rule)).toContain("approval-digest");
    expect(await storeBytes(f.root)).toEqual(beforeApproval);
    for (const flag of ["--force", "--skip-review", "--skip-approval", "--allow-draft", "--imported-baseline"]) {
      const result = await mainPublisherContent([...await f.argv("activate", { candidateId: candidate.id }), flag]);
      expect(result.exitCode).toBe(2); expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.map(finding => finding.rule)).toEqual(["publisher-cli-input"]);
      expect(await storeBytes(f.root)).toEqual(beforeApproval);
    }
  });

  it("returns structured execution errors for invalid syntax and unreadable JSON", async () => {
    const f = await fixture();
    const before = await storeBytes(f.root);
    const valid = await f.argv("review", { candidateId: "missing" });
    const malformed = join(f.parent, "malformed.json"); await writeFile(malformed, "{");
    const malformedArgs = [...valid]; malformedArgs[malformedArgs.indexOf("--input") + 1] = malformed;
    for (const args of [[], ["publish"], valid.slice(0, -2), [...valid, "--at", at], malformedArgs]) {
      const result = await mainPublisherContent(args);
      expect(result.exitCode).toBe(2); expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.map(finding => finding.rule)).toEqual(["publisher-cli-input"]);
      for (const finding of result.findings) expect(finding).toEqual({ path: expect.any(String), rule: expect.any(String), message: expect.any(String) });
      expect(await storeBytes(f.root)).toEqual(before);
    }
  });
});
