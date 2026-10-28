import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadContentStore, writeContentStore } from "../node.js";
import * as contentApi from "../index.js";
import { leafRegistryFixture, reviewFixture, at } from "../__fixtures__/review.js";
import { createContentRevision } from "../revisions.js";
import { readConsumerLibrarySnapshot } from "./library.js";
import type { ContentStoreOptions } from "./index.js";

vi.mock("./library.js", () => ({ readConsumerLibrarySnapshot: vi.fn() }));
const options = { designer: { root: "sample-library", catalog: {} } } as ContentStoreOptions;
const roots: string[] = [];
async function temporary(): Promise<string> {
  const parent = await fs.mkdtemp(join(tmpdir(), "publisher-store-")); roots.push(parent);
  return join(parent, "content", "publisher");
}
function draft(): any {
  const registry: any = structuredClone(reviewFixture());
  registry.workspace.locales.push("fr"); registry.slots[0].locales.push("fr");
  delete registry.slots[0].activeCandidateId;
  const candidate = registry.candidates[0]; candidate.state = "draft"; delete candidate.approval;
  candidate.composition.sections[0].fields.push({ key: "heading", locale: "fr", value: "Exemple", source: "writer" });
  candidate.composition.sections.push({ ...structuredClone(candidate.composition.sections[0]), key: "ending" });
  candidate.history = [createContentRevision(candidate, "r1", at)];
  return registry;
}
beforeEach(() => {
  vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue({ consumerId: "sample", version: "1", frames: [], sections: [], assetIds: [] });
});
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); vi.clearAllMocks(); });

describe("consumer content store", () => {
  it("round-trips the eighteen-slot consumer tree without creating content or releases", async () => {
    const root = await temporary(), registry = leafRegistryFixture();
    const before = structuredClone(registry);
    await writeContentStore(root, registry);
    const loaded = await loadContentStore(root, options);
    expect(loaded.registry).toEqual(registry);
    expect(loaded.registry.slots).toHaveLength(18);
    expect(loaded.libraries).toEqual([{ consumerId: "sample", version: "1", frames: [], sections: [], assetIds: [] }]);
    expect(readConsumerLibrarySnapshot).toHaveBeenCalledWith(options.designer.root, options.designer.catalog);
    expect(registry).toEqual(before);
    expect(await fs.readdir(root)).not.toContain("_releases");
  });
  it("stores structure separately and rejoins exact locale values into every revision", async () => {
    const root = await temporary(), registry = draft(), candidate = registry.candidates[0];
    const directory = `_registry/candidates/${candidate.slotId}/${candidate.id}`;
    await writeContentStore(root, registry);
    const structure = JSON.parse(await fs.readFile(join(root, directory, "r1.json"), "utf8"));
    expect(structure.content.composition.sections[0].fields).toEqual([
      { key: "heading", locale: "en", source: "writer" }, { key: "heading", locale: "fr", source: "writer" },
    ]);
    const english = JSON.parse(await fs.readFile(join(root, "en", candidate.slotId, candidate.id, "r1.copy.json"), "utf8"));
    expect(english).toEqual([
      { key: "heading", locale: "en", value: "Sample", source: "writer" },
      { key: "heading", locale: "en", value: "Sample", source: "writer" },
    ]);
    const metadata = JSON.parse(await fs.readFile(join(root, directory, "candidate.json"), "utf8"));
    expect(metadata).not.toHaveProperty("history"); expect(metadata).not.toHaveProperty("composition");
    expect((await loadContentStore(root, options)).registry).toEqual(registry);
  });
  it("appends revisions and updates workflow metadata while preserving old bytes", async () => {
    const root = await temporary(), registry = draft(), candidate = registry.candidates[0];
    const directory = `_registry/candidates/${candidate.slotId}/${candidate.id}`;
    await writeContentStore(root, registry);
    const old = await fs.readFile(join(root, directory, "r1.json"));
    const oldCopy = await fs.readFile(join(root, "fr", candidate.slotId, candidate.id, "r1.copy.json"));
    candidate.composition.sections[0].fields[1].value = "Nouveau";
    candidate.revision = "r2"; candidate.tags = ["revised"];
    candidate.history.push(createContentRevision(candidate, "r2", at));
    await writeContentStore(root, registry);
    expect(await fs.readFile(join(root, directory, "r1.json"))).toEqual(old);
    expect(await fs.readFile(join(root, "fr", candidate.slotId, candidate.id, "r1.copy.json"))).toEqual(oldCopy);
    expect((await loadContentStore(root, options)).registry).toEqual(registry);
    candidate.tags = ["workflow-only"];
    await writeContentStore(root, registry);
    expect((await loadContentStore(root, options)).registry.candidates[0]?.tags).toEqual(["workflow-only"]);
  });
  it("refuses an edited immutable revision before changing stored metadata", async () => {
    const root = await temporary(), registry = draft(), candidate = registry.candidates[0];
    await writeContentStore(root, registry);
    const metadataPath = join(root, "_registry", "candidates", candidate.slotId, candidate.id, "candidate.json");
    const oldMetadata = await fs.readFile(metadataPath);
    candidate.composition.sections[0].fields[0].value = "Rewrite";
    candidate.history = [createContentRevision(candidate, "r1", at)]; candidate.tags = ["changed"];
    await expect(writeContentStore(root, registry)).rejects.toThrow("immutable");
    expect(await fs.readFile(metadataPath)).toEqual(oldMetadata);
  });
  it("detects tampered, missing and extra locale copy without fallback", async () => {
    for (const fault of ["tampered", "missing", "extra"] as const) {
      const root = await temporary(), registry = draft(), candidate = registry.candidates[0];
      await writeContentStore(root, registry);
      const path = join(root, "fr", candidate.slotId, candidate.id, "r1.copy.json");
      const copy = JSON.parse(await fs.readFile(path, "utf8"));
      if (fault === "missing") await fs.unlink(path);
      else { if (fault === "extra") copy.push(copy[0]); else copy[0].value = "Tampered"; await fs.writeFile(path, JSON.stringify(copy)); }
      await expect(loadContentStore(root, options)).rejects.toThrow();
    }
  });
  it("does not silently discard unsnapshotted draft text or stored identities", async () => {
    const root = await temporary(), registry = draft();
    await writeContentStore(root, registry);
    const changed = structuredClone(registry); changed.candidates[0].composition.sections[0].fields[0].value = "Unsaved";
    await expect(writeContentStore(root, changed)).rejects.toThrow("Snapshot");
    await expect(writeContentStore(root, { ...registry, candidates: [], slots: [] })).rejects.toThrow("removed");
  });
  it("rejects filenames that disagree with identities and foreign Designer consumers", async () => {
    const root = await temporary(), registry = leafRegistryFixture(); await writeContentStore(root, registry);
    vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue({ consumerId: "foreign", version: "1", frames: [], sections: [], assetIds: [] });
    await expect(loadContentStore(root, options)).rejects.toThrow("consumers differ");
    vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue({ consumerId: "sample", version: "1", frames: [], sections: [], assetIds: [] });
    await fs.rename(join(root, "_registry/slots", `${registry.slots[0]!.id}.json`), join(root, "_registry/slots/sl_aaaaaaaaaa.json"));
    await expect(loadContentStore(root, options)).rejects.toThrow("identity differ");
  });
  it("does not follow locale symlinks or accept candidate path segments", async () => {
    const root = await temporary(), registry = draft(); await fs.mkdir(root, { recursive: true });
    const outside = await temporary(); await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, join(root, "en"));
    await expect(writeContentStore(root, registry)).rejects.toThrow("ancestors");
    expect(await fs.readdir(outside)).toEqual([]);
    registry.candidates[0].id = "../escape";
    await expect(writeContentStore(await temporary(), registry)).rejects.toThrow("segment");
  });
  it("leaves later-unit release and need records untouched and keeps writes Node-only", async () => {
    const root = await temporary(), registry = leafRegistryFixture(); await writeContentStore(root, registry);
    await fs.mkdir(join(root, "_needs")); await fs.writeFile(join(root, "_needs/sample.json"), "retained\n");
    await writeContentStore(root, registry);
    expect(await fs.readFile(join(root, "_needs/sample.json"), "utf8")).toBe("retained\n");
    expect(contentApi).not.toHaveProperty("writeContentStore"); expect(typeof writeContentStore).toBe("function");
  });
});
