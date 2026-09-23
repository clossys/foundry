import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectExistingPackItems, foundPackItem } from "./adopt.js";

describe("detectExistingPackItems", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "foundry-publisher-pack-adopt-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("registers an existing file as found, with its real sha256 fingerprint", async () => {
    await mkdir(join(root, "materials"), { recursive: true });
    const bytes = Buffer.from("<svg>existing logo</svg>");
    await writeFile(join(root, "materials", "logo.svg"), bytes);

    const found = await detectExistingPackItems(root, [{ itemId: "brand-kit", path: "materials/logo.svg" }]);

    expect(found).toEqual([{ itemId: "brand-kit", path: "materials/logo.svg", fingerprint: createHash("sha256").update(bytes).digest("hex") }]);
  });

  it("silently skips a candidate path that does not exist — missing is absent, not an error", async () => {
    const found = await detectExistingPackItems(root, [{ itemId: "brand-kit", path: "nowhere.svg" }]);
    expect(found).toEqual([]);
  });

  it("propagates a non-ENOENT filesystem error rather than swallowing it", async () => {
    await mkdir(join(root, "a-directory"));
    await expect(detectExistingPackItems(root, [{ itemId: "x", path: "a-directory" }])).rejects.toThrow();
  });
});

describe("foundPackItem", () => {
  it("builds a found item with the adoption's fingerprint as its one source pin, and no premature judgment", () => {
    const item = foundPackItem(
      { itemId: "brand-kit", path: "materials/logo.svg", fingerprint: "a".repeat(64) },
      { layer: "identity", owner: "designer", visibility: "internal", needs: [] },
      "2026-09-22T00:00:00.000Z",
    );
    expect(item).toEqual({
      id: "brand-kit",
      layer: "identity",
      owner: "designer",
      visibility: "internal",
      needs: [],
      status: "found",
      condition: "current",
      version: "v0.1",
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
      approvedAt: null,
      verifiedAt: null,
      sourcePins: [{ path: "materials/logo.svg", fingerprint: "a".repeat(64) }],
      outputPaths: [],
      publishedTo: [],
      nextAction: "judge against world-class and propose the next iteration as a diff",
    });
  });
});
