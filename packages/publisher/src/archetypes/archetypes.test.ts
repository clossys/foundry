import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPE_IDS, PAGE_ARCHETYPES, roleSections, writerGroupOf } from "./archetypes.js";
import { PAGE_FORMAT_IDS, PAGE_FORMATS } from "./formats.js";
import { SECTION_CLASSES, sectionFormats } from "./section-formats.js";
import { EXTENSION_FRAMES, EXTENSION_PACKAGES, EXTENSION_SECTION_CLASSES } from "./extensions.js";

const packages = resolve(import.meta.dirname, "../../..");
const ids = (path: string): Set<string> => new Set((JSON.parse(readFileSync(resolve(packages, path), "utf8")) as { id: string }[]).map(row => row.id));
const designerSections = ids("designer/src/catalog/slots/sections.json");
const designerFrames = ids("designer/src/catalog/slots/frames.json");
const writerPassages = ids("writer/src/catalog/slots/passages.json");
const directorCells = ids("director/src/catalog/cells/strategy.json");
// The repository's own consumer records: package extension slots name their package in `contract.package`.
const consumerDesigner = resolve(packages, "../clossys/agents/designer");
const extensionSlots = (layer: "sections" | "frames"): Map<string, string> => new Map(readdirSync(consumerDesigner, { withFileTypes: true })
  .filter(dir => dir.isDirectory() && dir.name.startsWith(`${layer}.`))
  .map(dir => JSON.parse(readFileSync(resolve(consumerDesigner, dir.name, "slot.json"), "utf8")) as { id: string; contract?: { package?: string; layer?: string } })
  .filter(slot => slot.contract?.layer === layer && (EXTENSION_PACKAGES as readonly string[]).includes(slot.contract.package ?? ""))
  .map(slot => [slot.id, slot.contract!.package!]));

describe("page archetype and format data", () => {
  it("declares eight archetypes and three formats", () => {
    expect(ARCHETYPE_IDS).toEqual(["marketing-home", "pricing", "contact", "legal", "docs", "app-page", "deck", "workspace", "workspace-home"]);
    expect(Object.keys(PAGE_ARCHETYPES)).toEqual([...ARCHETYPE_IDS]);
    expect(PAGE_FORMAT_IDS).toEqual(["vertical-page", "slide", "canvas"]);
    expect(PAGE_FORMATS.slide.aspectRatio).toEqual({ width: 16, height: 9 });
    expect(PAGE_FORMATS.slide.copy.longForm).toBe(false);
    expect(PAGE_FORMATS.slide.copy.maxWords).toBeGreaterThan(0);
    expect(PAGE_FORMATS["vertical-page"]).toMatchObject({ scroll: "document", stickyHeader: true });
    expect(PAGE_FORMATS.canvas.requiredActions).toEqual(expect.arrayContaining(["canvas.zoom", "canvas.minimap"]));
  });

  it("keeps the section-format sidecar equal to Designer's section slot ids", () => {
    expect(new Set(Object.keys(SECTION_CLASSES))).toEqual(designerSections);
  });

  it("keeps the package extension registry equal to the consumer's package extension slots", () => {
    expect(new Map(Object.entries(EXTENSION_SECTION_CLASSES).map(([id, row]) => [id, row.package]))).toEqual(extensionSlots("sections"));
    expect(new Map(Object.entries(EXTENSION_FRAMES))).toEqual(extensionSlots("frames"));
    for (const id of Object.keys(EXTENSION_SECTION_CLASSES)) expect(designerSections, id).not.toContain(id);
    for (const id of Object.keys(EXTENSION_FRAMES)) expect(designerFrames, id).not.toContain(id);
    for (const id of Object.keys(EXTENSION_FRAMES)) expect(Object.values(PAGE_FORMATS).some(format => format.frames.includes(id as `frames.${string}`)), id).toBe(true);
  });

  it("composes a package archetype only from its own package's extension slots", () => {
    const packaged = Object.values(PAGE_ARCHETYPES).filter(archetype => archetype.package !== undefined);
    expect(packaged.map(archetype => [archetype.id, archetype.package])).toEqual([["workspace", "producer"], ["workspace-home", "producer"]]);
    for (const archetype of packaged) {
      expect(archetype.frames.length, archetype.id).toBeGreaterThan(0);
      for (const frame of archetype.frames) expect(EXTENSION_FRAMES[frame], `${archetype.id} ${frame}`).toBe(archetype.package);
      for (const role of archetype.roles) {
        expect(role.writer, `${archetype.id}.${role.id}`).toBeNull();
        expect(role.gate, `${archetype.id}.${role.id}`).toBeUndefined();
        for (const section of roleSections(role)) expect(EXTENSION_SECTION_CLASSES[section]?.package, `${archetype.id}.${role.id} ${section}`).toBe(archetype.package);
      }
    }
  });

  it("names only real Designer sections, frames, Writer passages and Director cells", () => {
    for (const format of Object.values(PAGE_FORMATS)) for (const frame of format.frames) expect(designerFrames.has(frame) || Object.hasOwn(EXTENSION_FRAMES, frame), frame).toBe(true);
    for (const archetype of Object.values(PAGE_ARCHETYPES)) {
      if (archetype.package !== undefined) continue;
      for (const frame of archetype.frames) expect(designerFrames, `${archetype.id} ${frame}`).toContain(frame);
      for (const role of archetype.roles) {
        expect(role.writer).toBe(writerGroupOf(role.section));
        for (const section of roleSections(role)) {
          expect(designerSections, `${archetype.id}.${role.id} ${section}`).toContain(section);
          expect(writerPassages, `${archetype.id}.${role.id} ${writerGroupOf(section)}`).toContain(writerGroupOf(section));
        }
        if (role.gate) expect(directorCells, `${archetype.id}.${role.id} ${role.gate}`).toContain(role.gate);
      }
    }
  });

  it("keeps roles unambiguous, bounded and compatible with the archetype's default format", () => {
    for (const archetype of Object.values(PAGE_ARCHETYPES)) {
      const roleIds = archetype.roles.map(role => role.id);
      expect(new Set(roleIds).size, archetype.id).toBe(roleIds.length);
      const sections = archetype.roles.flatMap(roleSections);
      expect(new Set(sections).size, archetype.id).toBe(sections.length);
      expect(archetype.roles.some(role => role.required), archetype.id).toBe(true);
      for (const role of archetype.roles) {
        expect(role.min).toBeLessThanOrEqual(role.max);
        expect(role.required ? role.min >= 1 : role.min === 0, `${archetype.id}.${role.id}`).toBe(true);
        expect(sectionFormats(role.section), `${archetype.id}.${role.id}`).toContain(archetype.formats[0]);
      }
      for (const format of archetype.formats) for (const frame of archetype.frames) expect(PAGE_FORMATS[format].frames).toContain(frame);
    }
  });
});
