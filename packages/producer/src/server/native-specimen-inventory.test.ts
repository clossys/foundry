import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentModule, agentRoot, readCells } from "./cells.js";
import { agentSpecimenInventory, planDataInterop } from "./native-specimen-inventory.js";
import { agentSpecimenPlan } from "../../studio/lib/agent-specimen-data";
import { directorNativePlan } from "../../studio/lib/director-native-inventory";
import { projectStudioAgentIA } from "../../studio/lib/studio-agent-ia";
import { parseCellResponse, parseCellsResponse } from "../../studio/lib/cells-client";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
let root: string;
beforeEach(async () => { await mkdir(join(repo, "scratch"), { recursive: true }); root = await mkdtemp(join(repo, "scratch/a251-native-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const directorId = "identity.purpose.promise", writerId = "example.page";
async function tree(agent: "director" | "writer", id: string) {
  const target = agentRoot(root, agent); await mkdir(join(target, "cells", id), { recursive: true });
  await writeFile(join(target, "tree.json"), JSON.stringify({ schemaVersion: 1, active: { [id]: 1 }, tree: [{ id: "identity", name: "Identity", children: [{ id: "purpose", name: "Purpose", cells: [id] }] }] }));
  return target;
}
async function director() {
  const api = await agentModule("director", "index.js"); const store = await agentModule("director", "cell-format/index.js");
  const target = await tree("director", directorId);
  const bullet = (text: string) => ({ text, refs: [], line: 1 });
  await writeFile(join(target, store.cellPath(directorId, 1)), api.serializeCell({ id: directorId, version: 1, status: "active", updated: "2026-10-30", cites: [], feeds: [], functions: [], confirmed: { kind: "msg", session: "2026-10-30-1", line: "U1" }, direction: [bullet("ExampleCo helps readers finish their work.")], because: [bullet("Readers need complete source context.")], watch: [bullet("Completion remains measurable.")], path: "" }));
  await store.propose(target, directorId);
  for (const version of [1, 2]) expect(api.parseCell(await readFile(join(target, store.cellPath(directorId, version)), "utf8"), store.cellPath(directorId, version)).issues ?? []).toEqual([]);
}
async function writer() {
  const api = await agentModule("writer", "cells/parse.js"); const store = await agentModule("director", "cell-format/index.js");
  const target = await tree("writer", writerId);
  for (const version of [1, 2]) await writeFile(join(target, store.cellPath(writerId, version)), api.serializeWriterCell({ id: writerId, version, status: version === 1 ? "active" : "draft", updated: "2026-10-30", links: [], ...(version === 1 ? { confirmed: "migration:2026-10-30" } : {}), locales: ["en", "ar"], records: [
    { locale: "en", record: { id: "example.body", context: "example.page.body", text: "ExampleCo first line.\n\n## A literal heading\n### A literal context\n<!-- Literal metadata -->\nFinal line." }, bindings: [] },
    { locale: "ar", record: { id: "example.body", context: "example.page.body", text: "نص كامل" }, bindings: [] },
  ] }));
}
async function designer() {
  const input = join(root, "example-library");
  await cp(join(repo, "packages/designer/src/library-cli/__fixtures__/agent-receipted"), input, { recursive: true });
  const api = await agentModule("designer", "library-cli/cells.js");
  await api.libraryToCells(input, agentRoot(root, "designer"), { date: "2026-10-30" });
}
async function snapshot(directory: string): Promise<Record<string, { hash: string; mtime: number }>> {
  const result: Record<string, { hash: string; mtime: number }> = {};
  async function walk(path: string) {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) await walk(name);
      else result[name] = { hash: createHash("sha256").update(await readFile(join(directory, name))).digest("hex"), mtime: (await stat(join(directory, name))).mtimeMs };
    }
  }
  await walk(""); return result;
}

describe("canonical read-only specimen source inventory", () => {
  it("reads all three native profiles, versions, locales and authored IA without writing source", async () => {
    await director(); await writer(); await designer();
    const before = await snapshot(root);
    for (const agent of ["director", "designer", "writer"] as const) await readCells(root, agent);
    const sources = await Promise.all((["director", "designer", "writer"] as const).map(agent => agentSpecimenInventory(root, agent)));
    expect(sources.every(source => source.sourceComplete && source.state === "ready")).toBe(true);
    expect(sources.map(source => source.provenance.parser)).toEqual(["parseCell", "parseLibraryCell", "parseWriterCell"]);
    const [strategy, design, copy] = sources;
    expect(strategy!.cells.map(cell => [cell.version, cell.status])).toEqual([[1, "active"], [2, "draft"]]);
    expect(strategy!.index.cells).toMatchObject([{ version: 2, status: "draft" }]);
    const strategyData = planDataInterop(strategy!);
    expect(projectStudioAgentIA(strategyData.index).groups[0]?.collections[0]?.cells[0]?.id).toBe(directorId);
    const strategyPlan = directorNativePlan(strategyData.index, strategyData.cells, directorId);
    expect(strategyPlan.issues).toEqual([]); expect(strategyPlan.expectedVariantIds).toHaveLength(6);
    expect(strategyPlan.items.map(item => item.version)).toEqual([2, 2, 2, 1, 1, 1]);
    const copyData = planDataInterop(copy!); const detail = copyData.cells.find(cell => cell.version === 2)!;
    expect(detail.native).toMatchObject({ agent: "writer", locales: ["en", "ar"], records: [{ record: { text: expect.stringContaining("## A literal heading\n### A literal context") } }, { locale: "ar" }] });
    const copyPlan = agentSpecimenPlan(copyData.index, detail);
    expect(copyPlan.issues).toEqual([]); expect(copyPlan.expectedVariantIds).toHaveLength(1);
    expect(copyPlan.items[0]?.value).toContain("<!-- Literal metadata -->\nFinal line.");
    expect(JSON.stringify(copyPlan.items)).not.toContain("locales:");
    expect(design!.cells).toHaveLength(103);
    expect(design!.cells.find(cell => cell.id === "tokens.accent-color")?.native).toMatchObject({ agent: "designer", kind: "token", layer: "tokens", valueKind: "color" });
    expect(sources.flatMap(source => source.cells).every(cell => !cell.sourceBody.startsWith("---"))).toBe(true);
    expect(await snapshot(root)).toEqual(before);
  }, 20_000);
  it("carries canonical projection through the existing HTTP response adapters", async () => {
    await writer(); const source = await agentSpecimenInventory(root, "writer");
    const index = parseCellsResponse({ agents: [source.index] })[0]!;
    const version = source.cells[1]!;
    const detail = parseCellResponse({ agent: "writer", state: "ready", cell: { ...version, source: "Full source belongs only in Source." } }, "writer", writerId);
    expect(agentSpecimenPlan(index, detail).items[0]?.value).toContain("## A literal heading");
    expect(() => parseCellsResponse({ agents: [{ ...source.index, cells: [{ ...version, native: { agent: "director" } }] }] })).toThrow("another agent");
  });
  it.each(["director", "designer", "writer"] as const)("keeps absent %s roots incomplete instead of passing 0/0", async agent => {
    expect(await agentSpecimenInventory(root, agent)).toMatchObject({ state: "missing", sourceComplete: false, cells: [], issues: [expect.any(String)] });
  });
  it("rejects a missing active version, malformed native body and symlink source", async () => {
    await writer(); const target = agentRoot(root, "writer");
    const treeFile = join(target, "tree.json"); const originalTree = await readFile(treeFile, "utf8");
    const badTree = JSON.parse(originalTree); badTree.active[writerId] = 3; await writeFile(treeFile, JSON.stringify(badTree));
    expect(await agentSpecimenInventory(root, "writer")).toMatchObject({ state: "error", sourceComplete: false, cells: [] });
    await writeFile(treeFile, originalTree);
    const path = join(target, "cells", writerId, "v2.md"); const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("## en", "## xx"));
    expect(await agentSpecimenInventory(root, "writer")).toMatchObject({ state: "error", sourceComplete: false });
    await writeFile(path, original); await symlink(target, agentRoot(root, "designer"));
    expect(await agentSpecimenInventory(root, "designer")).toMatchObject({ state: "error", sourceComplete: false, cells: [] });
  });
  it("keeps an initialized empty tree explicitly incomplete", async () => {
    const target = agentRoot(root, "writer"); await mkdir(target, { recursive: true });
    await writeFile(join(target, "tree.json"), JSON.stringify({ schemaVersion: 1, active: {} }));
    const source = await agentSpecimenInventory(root, "writer");
    expect(source).toMatchObject({ state: "ready", sourceComplete: false, cells: [], issues: ["The native source inventory contains no cells."] });
    expect(planDataInterop(source).index.state).toBe("error");
  });
});
