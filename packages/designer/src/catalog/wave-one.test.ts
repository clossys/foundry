/** Wave-one catalog joins; the older token/component/block inventories keep their own coverage tests. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadBuildCatalog } from "../catalog-core/index.js";
import { sectionCopyCatalog, loadSectionRegistry, sectionRegistryFindings } from "../catalog-core/sections-contract.js";
import { generatedFoundryFrameFiles, importFoundryFrames } from "../importers/foundry-frames.js";
import { generatedFoundrySectionFiles, importFoundrySections } from "../importers/foundry-sections.js";
import { surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRuntimeRenderers, surfaceRendererId } from "../runtime/index.js";

const FRAME = "frames.auth-shell";
const SECTIONS = ["sections.logo-mark", "sections.sign-in-form", "sections.boundary-message", "sections.error-message", "sections.legal-prose", "sections.account-summary"];
const leaves = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => key === "leaves" ? child as string[] : leaves(child));
};
// Anchor the module directory once; lazy import.meta resolution may consult a mocked cwd in test hosts.
const catalogDirectory = dirname(fileURLToPath(import.meta.url));
const committedFill = (id: string) => readFileSync(resolve(catalogDirectory, "fills/foundry", `${id}.json`), "utf8");
const json = (file: string) => JSON.parse(readFileSync(resolve(catalogDirectory, file), "utf8"));

describe("wave-one Section and Frame catalog joins", () => {
  it("places each new leaf once in its registered IA and preserves the existing logo-hero contract", () => {
    const sections = loadSectionRegistry(), frames = loadBuildCatalog().slots.filter(slot => slot.layer === "frames");
    expect(sectionRegistryFindings(sections)).toEqual([]);
    const sectionIA = leaves(json("./ia/sections.json")), frameIA = leaves(json("./ia/frames.json"));
    for (const id of SECTIONS) {
      expect(sections.slots.filter(slot => slot.id === id), id).toHaveLength(1);
      expect(sectionIA.filter(leaf => leaf === id), id).toHaveLength(1);
    }
    expect(frames.filter(slot => slot.id === FRAME)).toHaveLength(1);
    expect(frameIA.filter(leaf => leaf === FRAME)).toHaveLength(1);
    const oldLogo = sections.slots.find(slot => slot.id === "sections.logo-hero")!;
    expect(oldLogo.contract.slots.map(slot => slot.name)).toEqual(["mark", "name"]);
    expect(oldLogo.contract.copy.fields.map(field => field.key)).toEqual(["name"]);
  });

  it("pairs every new Section with its DG1 passage schema and gives logo-mark zero authored copy", () => {
    const registry = loadSectionRegistry(), rows = sectionCopyCatalog(registry);
    for (const id of SECTIONS) {
      const row = rows.find(candidate => candidate.id === id)!;
      expect(row, id).toBeDefined();
      expect(row.passageSchema, id).toBe(`passages.${id.slice("sections.".length)}`);
      expect(row.sourceLocale, id).toBe("en");
      expect(row.status, id).toBe("draft");
      expect(new Set(row.fields.map(field => field.key)).size, id).toBe(row.fields.length);
      if (id === "sections.logo-mark") expect(row.fields).toEqual([]);
      else expect(row.fields.length, id).toBeGreaterThan(0);
      for (const field of row.fields) {
        expect(field.dir, `${id}:${field.key}`).toBe("auto");
        expect(field.maxLength.en, `${id}:${field.key}`).toBeGreaterThan(0);
        expect(typeof field.required).toBe("boolean");
      }
    }
    const logo = registry.slots.find(slot => slot.id === "sections.logo-mark")!;
    expect(logo.contract.slots).toEqual([{ name: "mark", type: "media", required: true }]);
    expect(logo.contract.allowedReads.assets).toContain("assets.mark");
  });

  it("joins real Foundry descriptors, committed fills and the package runtime registry for all seven leaves", () => {
    const sectionImport = importFoundrySections(), frameImport = importFoundryFrames();
    const generated = { ...generatedFoundrySectionFiles(), ...generatedFoundryFrameFiles() };
    for (const id of [FRAME, ...SECTIONS]) {
      const imported = (id === FRAME ? frameImport : sectionImport).fills.filter(fill => fill.$extensions["com.clossys.fill"].slot === id);
      expect(imported, id).toHaveLength(1);
      const coverage = (id === FRAME ? frameImport : sectionImport).coverage.find(row => row.slot === id)!;
      expect(coverage, id).toBeDefined();
      expect(coverage.missingRequiredSlots, id).toEqual([]);
      const bytes = generated[`${id}.json`];
      expect(bytes, id).toBeDefined();
      expect(committedFill(id), id).toBe(bytes);
      expect(surfaceRuntimeRenderers[id]?.leaf, id).toBe(id);
      expect(surfaceRuntimePointers()[id], id).toEqual({ module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" });
      expect(surfaceRuntimeCallbacks([id])[surfaceRendererId(id)], id).toBe(surfaceRuntimeRenderers[id]!.render);
    }
  });

  it("reads committed fills relative to this module regardless of the caller cwd", () => {
    const before = committedFill(FRAME);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/");
    try {
      expect(committedFill(FRAME)).toBe(before);
      expect(JSON.parse(committedFill(FRAME)).$extensions["com.clossys.fill"].slot).toBe(FRAME);
      expect(cwd).not.toHaveBeenCalled();
    } finally { cwd.mockRestore(); }
  });

});
