import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryHash, resolve, type CompositeCatalogData, type CompositeLibraryData } from "@clossys/designer/catalog";
import { readLibrary } from "@clossys/designer/catalog/node";
import { readConsumerLibrarySnapshot } from "./library.js";

vi.mock("@clossys/designer/catalog", async importOriginal => ({
  ...await importOriginal<typeof import("@clossys/designer/catalog")>(),
  libraryHash: vi.fn(), resolve: vi.fn(),
}));
vi.mock("@clossys/designer/catalog/node", () => ({ readLibrary: vi.fn() }));

const catalog: CompositeCatalogData = {
  values: { slots: [], standards: [], sources: [], fills: [], placements: [], retired: [] },
  components: { slots: [], fills: [] },
};
const source = { id: "example", kind: "consumer", author: "consumer", license: "MIT" } as const;
const emptyLibrary = (): CompositeLibraryData => ({ source, values: { fills: [] }, components: { fills: [], files: [] } });
afterEach(() => vi.resetAllMocks());

describe("readConsumerLibrarySnapshot", () => {
  it("projects owned leaves, scoped configs, resolved assets and the Designer version", async () => {
    const library = {
      ...emptyLibrary(), adoptedAt: "2026-01-01",
      surfaces: { version: 1, files: [], fills: [
        { frames: { shell: { slot: "frames.shell" } } },
        { sections: { hero: { slot: "sections.hero", configs: { wide: {}, compact: {} } } } },
        { sections: { detail: { slot: "sections.detail", configs: { compact: {} } } } },
      ] },
    } as unknown as CompositeLibraryData;
    vi.mocked(readLibrary).mockResolvedValue(library);
    vi.mocked(libraryHash).mockReturnValue("sha256:owned-version");
    vi.mocked(resolve).mockReturnValue({ members: {
      "assets.image.hero": {}, "tokens.color.ink": {}, "assets.icon.arrow": {},
    } } as never);

    expect(await readConsumerLibrarySnapshot("library", catalog)).toEqual({
      consumerId: "example", version: "sha256:owned-version",
      frames: [{ id: "frames.shell", configIds: ["default"] }],
      sections: [
        { id: "sections.detail", configIds: ["compact"] },
        { id: "sections.hero", configIds: ["compact", "wide"] },
      ],
      assetIds: ["assets.icon.arrow", "assets.image.hero"],
    });
    expect(readLibrary).toHaveBeenCalledWith("library", catalog);
    expect(libraryHash).toHaveBeenCalledWith(library);
    expect(resolve).toHaveBeenCalledWith({ catalog: catalog.values, library: {
      fills: [], source, adoptedAt: "2026-01-01",
    } });
  });

  it("reads a minimal consumer library through the real public Designer reader", async () => {
    const actual = await vi.importActual<typeof import("@clossys/designer/catalog")>("@clossys/designer/catalog");
    const node = await vi.importActual<typeof import("@clossys/designer/catalog/node")>("@clossys/designer/catalog/node");
    const root = await mkdtemp(join(tmpdir(), "publisher-library-"));
    try {
      await mkdir(join(root, "fills"));
      await writeFile(join(root, "source.json"), JSON.stringify(source));
      await writeFile(join(root, "metadata.json"), JSON.stringify({ format: "composite-v1", values: {}, components: {}, files: [] }));
      await writeFile(join(root, "selection.json"), actual.stableStringify(actual.generateSelection({ source, fills: [] })));
      vi.mocked(readLibrary).mockImplementationOnce(node.readLibrary);
      vi.mocked(libraryHash).mockImplementationOnce(actual.libraryHash);
      vi.mocked(resolve).mockImplementationOnce(actual.resolve);

      const snapshot = await readConsumerLibrarySnapshot(root, catalog);
      expect(snapshot).toEqual({ consumerId: "example", version: actual.libraryHash({
        ...emptyLibrary(), values: { fills: [], selection: actual.generateSelection({ source, fills: [] }) },
      }), frames: [], sections: [], assetIds: [] });
      expect(snapshot.version).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("preserves Designer read failures", async () => {
    const failure = new Error("Library selection drift");
    vi.mocked(readLibrary).mockRejectedValue(failure);
    await expect(readConsumerLibrarySnapshot("library", catalog)).rejects.toBe(failure);
    expect(resolve).not.toHaveBeenCalled();
  });
});
