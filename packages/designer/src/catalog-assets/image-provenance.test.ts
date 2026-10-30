/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadCatalog, resolve, type LibraryData } from "../catalog-core/index.js";
import { checkAssetProfile } from "./check.js";

describe("native Foundry image provenance", () => {
  it("pins the exact existing MIT resource bytes and passes A1 through real adoption", () => {
    const catalog = loadCatalog();
    const offer = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === "foundry/assets.image")!;
    const meta = offer.$extensions["com.clossys.fill"];
    const bytes = readFileSync(new URL("../../" + meta.pin!.file, import.meta.url));
    const resource = offer.assets!.image!.default!.$value as { src: string };
    expect(bytes).toEqual(Buffer.from(resource.src.split(",")[1]!, "base64"));
    expect(bytes.byteLength).toBe(115);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(meta.pin!.sha256);
    expect(meta.license).toBe("MIT");
    expect(readFileSync(new URL("../../LICENSE", import.meta.url), "utf8")).toContain("MIT License");
    const empty: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", fills: [] };
    const adopt = (data: typeof catalog) => applyLibraryChange(data, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "assets.image", source: "foundry" }] });
    const library = adopt(catalog);
    expect(resolve({ catalog, library }).members["assets.image.default"]!.origin).toMatchObject({ kind: "adopted", source: "foundry", license: "MIT", pin: meta.pin });
    expect(checkAssetProfile(catalog, library)).toContainEqual(expect.objectContaining({ code: "A1", subject: "assets.image.default", verdict: "satisfied" }));
    const missingPin = structuredClone(catalog);
    delete missingPin.fills.find(doc => doc.$extensions["com.clossys.fill"].id === meta.id)!.$extensions["com.clossys.fill"].pin;
    expect(checkAssetProfile(missingPin, adopt(missingPin))).toContainEqual(expect.objectContaining({ code: "A1", subject: "assets.image.default", verdict: "violated" }));
  });
});
