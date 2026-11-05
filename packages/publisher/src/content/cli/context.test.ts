import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSelection, stableStringify, type CompositeCatalogData, type SectionSlot } from "@clossys/designer/catalog";
import { at, libraryFixture, reviewFixture } from "../__fixtures__/review.js";
import { computeContentDigest } from "../digest.js";
import { reviewCandidate } from "../review/index.js";
import { writeContentStore } from "../store/index.js";
import { readConsumerLibrarySnapshot } from "../store/library.js";
import { loadPublisherContext } from "./context.js";

// Keep PB4's real filesystem validation; mock only its external Designer seam.
vi.mock("../store/library.js", () => ({ readConsumerLibrarySnapshot: vi.fn() }));

const roots: string[] = [];
const section = (): SectionSlot => ({
  id: "sections.sample", layer: "sections", requires: [], status: "draft",
  contract: {
    kind: "section", passageSchema: "passages.sample",
    copy: { sourceLocale: "en", fields: [{ key: "heading", kind: "plain", required: true, maxLength: { en: 80 }, dir: "auto" }] },
    root: "section", anatomy: { band: null, header: null },
    slots: [{ name: "heading", type: "copy", required: true }],
    members: { mode: "closed", names: [] }, allowedComposes: [], parts: [],
    allowedReads: { tokens: [], assets: [] }, data: "host-injected", surface: "both",
  },
});
const catalog = (...slots: SectionSlot[]): CompositeCatalogData => ({
  values: { slots: [], standards: [], sources: [], fills: [], placements: [], retired: [] },
  components: { slots: [], fills: [] },
  surfaces: { slots, fills: [], transforms: [], rules: [], materializations: [] },
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), "publisher-context-")); roots.push(root);
  const contentRoot = join(root, "content");
  const registry = reviewFixture();
  await writeContentStore(contentRoot, registry);
  return { root, contentRoot, registry };
}
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) await visit(name);
      else result[name] = await readFile(join(root, name), "utf8");
    }
  }
  await visit("");
  return result;
}
beforeEach(() => { vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue(libraryFixture()[0]!); });
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.resetAllMocks();
});

describe("Publisher command context", () => {
  it("loads the real PB4 store and enriches only consumer-owned registrations", async () => {
    const { contentRoot, registry } = await store();
    const owned = { ...libraryFixture()[0]!, sections: [{ id: "sections.sample", configIds: ["compact", "wide"] }] };
    vi.mocked(readConsumerLibrarySnapshot).mockResolvedValue(owned);
    const slots = [section(), { ...section(), id: "sections.unowned" }];
    const input = catalog(...slots), before = structuredClone(input);
    const context = await loadPublisherContext(contentRoot, "designer-library", input);
    expect(context.registry).toEqual(registry);
    expect(context.libraries).toEqual([{ ...owned, sections: [{
      ...owned.sections[0]!, passageSchema: slots[0]!.contract.passageSchema,
      copy: slots[0]!.contract.copy, slots: slots[0]!.contract.slots,
    }] }]);
    expect(context.libraries[0]).not.toHaveProperty("assetKinds");
    expect(context.libraries[0]!.sections[0]).not.toHaveProperty("assetKinds");
    expect(input).toEqual(before);
    expect(owned).toEqual({ ...libraryFixture()[0]!, sections: [{ id: "sections.sample", configIds: ["compact", "wide"] }] });
    expect(readConsumerLibrarySnapshot).toHaveBeenCalledWith("designer-library", input);
  });

  it("preserves missing DG-1 copy evidence and produces the actual Designer Need", async () => {
    const { contentRoot } = await store();
    const missing = section();
    Reflect.deleteProperty(missing.contract, "copy");
    const context = await loadPublisherContext(contentRoot, "designer-library", catalog(missing));
    expect(context.libraries[0]!.sections[0]).not.toHaveProperty("copy");
    const report = reviewCandidate({ ...context, candidateId: "sample", digest: computeContentDigest(context.registry.candidates[0]!), raisedAt: at });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "invalid-copy-schema" })]));
    expect(report.needs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "copy-schema", target: "designer" })]));
  });

  it("does not turn catalog contracts or configs into owned registrations", async () => {
    const { contentRoot } = await store();
    const context = await loadPublisherContext(contentRoot, "designer-library", catalog());
    expect(context.libraries).toEqual(libraryFixture());
    const report = reviewCandidate({ ...context, candidateId: "sample", digest: computeContentDigest(context.registry.candidates[0]!), raisedAt: at });
    expect(report.needs.some(need => need.kind === "copy-schema" && need.target === "designer")).toBe(true);
  });

  it("refuses ambiguous catalog section contracts", async () => {
    const { contentRoot } = await store();
    await expect(loadPublisherContext(contentRoot, "designer-library", catalog(section(), section())))
      .rejects.toThrow(/duplicate.*sections\.sample/i);
  });

  it("preserves PB4 validation errors instead of reconstructing a registry", async () => {
    const { contentRoot } = await store();
    const workspace = join(contentRoot, "workspace.json");
    await writeFile(workspace, "{}");
    await expect(loadPublisherContext(contentRoot, "designer-library", catalog())).rejects.toThrow();
    expect(await readFile(workspace, "utf8")).toBe("{}");
  });

  it("reads a minimal real consumer-owned Designer library with the public reader", async () => {
    const actual = await vi.importActual<typeof import("../store/library.js")>("../store/library.js");
    vi.mocked(readConsumerLibrarySnapshot).mockImplementationOnce(actual.readConsumerLibrarySnapshot);
    const { root, contentRoot } = await store();
    const designerRoot = join(root, "designer");
    const source = { id: "sample", kind: "consumer", author: "consumer", license: "MIT" } as const;
    await mkdir(join(designerRoot, "fills"), { recursive: true });
    await writeFile(join(designerRoot, "source.json"), JSON.stringify(source));
    await writeFile(join(designerRoot, "metadata.json"), JSON.stringify({ format: "composite-v1", values: {}, components: {}, files: [] }));
    await writeFile(join(designerRoot, "selection.json"), stableStringify(generateSelection({ source, fills: [] })));
    const before = await files(root);
    const context = await loadPublisherContext(contentRoot, designerRoot, catalog(section()));
    expect(context.libraries).toEqual([{ consumerId: "sample", version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), frames: [], sections: [], assetIds: [] }]);
    expect(await files(root)).toEqual(before);
  });
});
