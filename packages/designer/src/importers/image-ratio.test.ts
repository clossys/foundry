// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog, applyLibraryChange, libraryHash, resolve } from "../catalog-core/index.js";
import type { LibraryData } from "../catalog-core/types.js";
import { checkAssetProfile } from "../catalog-assets/check.js";
import { stableStringify } from "../catalog-core/stable.js";
import { importImageRatios } from "./image-ratio.js";
const catalog = { ...loadCatalog(), fills: [...loadCatalog().fills.filter(fill => fill.$extensions["com.clossys.fill"].slot !== "assets.image-ratio"), ...importImageRatios()] };
const empty: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT", extends: "foundry" }, fills: [], adoptedAt: "2026-10-24" };
const adopted = () => applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "assets.image-ratio", source: "foundry" }] });
describe("image crop candidate", () => {
  it("offers exact cinema and share presets on the existing image-ratio leaf", () => {
    const fill = importImageRatios()[0]!;
    const ratios = (fill.assets as Record<string, Record<string, { $value: unknown }>>)["image-ratio"]!;
    expect(ratios.cinema!.$value).toEqual({ width: 21, height: 9 });
    expect(ratios.share!.$value).toEqual({ width: 191, height: 100 });
  });
  it("regenerates the exact descriptor without making upstream or conformance claims", () => {
    expect(readFileSync(new URL("../catalog/fills/foundry/assets.image-ratio.json", import.meta.url), "utf8")).toBe(stableStringify(importImageRatios()[0]));
    expect(importImageRatios()[0]!.$extensions["com.clossys.fill"]).toMatchObject({ author: "foundry", conforms: [], evidence: [] });
  });
  it("adopts through the public value API and checks real crop tolerance and accessible content", () => {
    const library = adopted();
    const image = { id: "photo", width: 1600, height: 900, format: "webp", bytes: 100, maxBytes: 1000, alt: "A mountain" };
    const judge = (patch: object) => checkAssetProfile(catalog, library, { images: [{ ...image, ...patch }] }).filter(row => row.code === "A10" && row.subject === "photo");
    expect(judge({})).toContainEqual(expect.objectContaining({ verdict: "satisfied" }));
    expect(judge({ width: 1608 })).toContainEqual(expect.objectContaining({ verdict: "satisfied" }));
    for (const patch of [{ width: 1900 }, { alt: "" }, { bakedCorners: true }]) expect(judge(patch)).toContainEqual(expect.objectContaining({ verdict: "violated" }));
    expect(judge({ alt: "", decorative: true })).toContainEqual(expect.objectContaining({ verdict: "satisfied" }));
  });
  it.each([0, -1, Infinity, NaN])("refuses a mutated non-positive or non-finite ratio %s", width => {
    const library = adopted(), profile = resolve({ catalog, library });
    profile.members["assets.image-ratio.wide"]!.value.light = { width, height: 9 };
    expect(checkAssetProfile(catalog, library, { resolved: profile })).toContainEqual(expect.objectContaining({ code: "A10", subject: "assets.image-ratio.wide", verdict: "violated" }));
  });
});
