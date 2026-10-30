import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { applyLibraryChange, assetCoverageReport, check, consumptionReport, deriveIdentity, emit, emitGlyphModule, libraryHash, loadCatalog, resolve, stableStringify, type Source } from "./index.js";
import { emitWebIcons } from "./server.js";
import { compare } from "./model.js";

const source: Source = { id: "example-complete-catalog", kind: "consumer", author: "consumer", license: "MIT" };
const catalog = loadCatalog();
const library = completedCatalogLibrary(catalog, source, "2026-10-23");

describe("complete consumer token and asset library", () => {
  it("serves every one of 105 leaves including the pending gradient leaf and all 230 CSS bindings with zero check errors", () => {
    const result = check({ catalog, library });
    expect(result.findings.filter(finding => finding.severity === "error")).toEqual([]); expect(result.ok).toBe(true);
    expect(library.complete).toBe(true); expect(library.fills).toHaveLength(105);
    const profile = resolve({ catalog, library });
    expect(new Set(Object.values(profile.members).map(member => member.slot)).size).toBe(105);
    expect(Object.values(profile.members).filter(member => member.emit)).toHaveLength(230);
    expect(assetCoverageReport(catalog, library)).toMatchObject({ total: 49, served: 49 });
    expect(catalog.rules?.map(rule => rule.id)).toContain("token-diverging-neutral@1");
    expect(result.findings.some(finding => finding.code === "A6" && finding.severity === "notice")).toBe(true);
    const tokensOnly = completedTokenLibrary(catalog, source, "2026-10-23");
    expect(check({ catalog, library: tokensOnly }).findings.some(finding => finding.code === "A12" && finding.severity === "error")).toBe(true);
  });

  it("records generated reverse edges, orphan counts and per-leaf consumer origins", async () => {
    const profile = resolve({ catalog, library }); const consumption = consumptionReport({ catalog, library });
    expect(consumption.counts.orphanEdges).toBe(0); expect(consumption.leaves).toHaveLength(105);
    const leaves = catalog.slots.map(slot => {
      const members = Object.entries(profile.members).filter(([, member]) => member.slot === slot.id);
      return { slot: slot.id, members: members.length, sources: [...new Set(members.map(([, member]) => member.origin?.kind === "adopted" ? member.origin.source : source.id))].sort(compare), originKinds: [...new Set(members.map(([, member]) => member.origin?.kind))].sort(), rules: [...new Set(members.flatMap(([, member]) => member.origin?.kind === "derived" ? [member.origin.rule] : []))].sort(compare) };
    }).sort((a, b) => compare(a.slot, b.slot));
    const coverage = { kind: "materialized-consumer-coverage", consumer: source.id, complete: library.complete, slots: leaves.length, served: leaves.filter(leaf => leaf.members > 0).length, tokenLeaves: leaves.filter(leaf => leaf.slot.startsWith("tokens.")).length, assetLeaves: leaves.filter(leaf => leaf.slot.startsWith("assets.")).length, boundProperties: Object.values(profile.members).filter(member => member.emit).length, leaves };
    await expect(stableStringify(consumption)).toMatchFileSnapshot("__golden__/complete-consumption.json");
    await expect(stableStringify(coverage)).toMatchFileSnapshot("__golden__/complete-coverage.json");
  });

  it("retains materialized output offline and explicitly refreshes assets after a token change", async () => {
    const profile = resolve({ catalog, library }); const offline = { ...catalog, fills: [], sources: [] };
    expect(stableStringify(resolve({ catalog: offline, library }))).toBe(stableStringify(profile));
    expect(emit(resolve({ catalog: offline, library }), ["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"])).toEqual(emit(profile, ["css-brand", "css-scales", "css-fonts", "tailwind-theme", "notices"]));
    expect(emitGlyphModule(resolve({ catalog: offline, library }))).toBe(emitGlyphModule(profile));
    const changed = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.text-color", tokens: { primary: { $type: "color", $value: "#111111", $extensions: { "com.clossys.css": { raw: "#111111" }, "com.clossys.modes": { dark: "#ffffff" } } } } }] });
    expect(resolve({ catalog, library: changed }).members["assets.favicon.vector"]!.value.light).toBe(profile.members["assets.favicon.vector"]!.value.light);
    expect(check({ catalog, library: changed }).findings.some(finding => finding.code === "C10" && finding.message.includes("stale inputsHash"))).toBe(true);
    const refreshed = deriveIdentity(catalog, changed); const freshProfile = resolve({ catalog, library: refreshed });
    expect(check({ catalog, library: refreshed }).findings.filter(finding => finding.severity === "error")).toEqual([]);
    const files = await emitWebIcons(freshProfile, { name: "Example", rasterize: async (svg, size) => new Uint8Array(await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()) });
    const svg = new TextDecoder().decode(files.find(file => file.path === "favicon.svg")!.bytes);
    expect(svg).toBe(freshProfile.members["assets.favicon.vector"]!.value.light); expect(svg).not.toBe(profile.members["assets.favicon.vector"]!.value.light);
  });
});
