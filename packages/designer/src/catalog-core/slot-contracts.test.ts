/** @vitest-environment node */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../references/manifest.json" with { type: "json" };
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import assetSlots from "../catalog/slots/assets.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import themes from "../catalog/slot-contracts/themes.json" with { type: "json" };
import assets from "../catalog/slot-contracts/assets.json" with { type: "json" };
import components from "../catalog/slot-contracts/components.json" with { type: "json" };
import sections from "../catalog/slot-contracts/sections.json" with { type: "json" };
import frames from "../catalog/slot-contracts/frames.json" with { type: "json" };
import { slotContractFindings, type SlotContractContext, type SlotContractLayer, type SlotContractRecord } from "./slot-contracts.js";

const references = fileURLToPath(new URL("../../references/", import.meta.url));
const folderExists = (dir: string) => existsSync(references + dir) && statSync(references + dir).isDirectory();
const catalog = { themes: themeSlots, assets: assetSlots, components: componentSlots, sections: sectionSlots, frames: frameSlots };
const context = (layer: SlotContractLayer): SlotContractContext => ({ layer, slots: catalog[layer] as unknown as SlotContractContext["slots"], manifest, folderExists });
const committed = { themes, assets, components, sections, frames } as unknown as Record<SlotContractLayer, SlotContractRecord[]>;
const LAYERS = ["themes", "assets", "components", "sections", "frames"] as const;

describe("Designer slot contracts", () => {
  it("has one record for each of the 236 canonical Designer slots, hand records first", () => {
    for (const layer of LAYERS) expect(committed[layer].map(row => row.slot).sort(), layer).toEqual(catalog[layer].map(slot => slot.id).sort());
    expect(LAYERS.map(layer => committed[layer].length)).toEqual([42, 49, 68, 66, 11]);
    expect(committed.sections.slice(0, 10).map(row => row.slot)).toEqual(["sections.band", "sections.section-header", "sections.hero", "sections.features", "sections.comparison", "sections.pricing", "sections.call-to-action", "sections.form", "sections.legal-prose", "sections.steps"]);
    expect(committed.frames.slice(0, 3).map(row => row.slot)).toEqual(["frames.site-header", "frames.site-footer", "frames.site-shell"]);
  });

  it.each(LAYERS)("checks every %s contract clean against its catalog and references/", layer => {
    expect(slotContractFindings(committed[layer], context(layer))).toEqual([]);
  });

  it("fails a canonical slot without a record, a wrong specimen and inputs the slot does not declare", () => {
    const [accent, ...restThemes] = committed.themes;
    expect(slotContractFindings(restThemes, context("themes"))).toEqual([`${accent!.slot}: canonical slot has no contract record`]);
    const font = committed.themes.find(row => row.slot === "themes.font-sans")!;
    expect(font.specimenKind).toBe("text");
    expect(slotContractFindings(committed.themes.map(row => row === font ? { ...font, specimenKind: "visual" as const } : row), context("themes"))).toEqual(["themes.font-sans: specimenKind must be text"]);
    const lockup = committed.assets.find(row => row.slot === "assets.lockup")!;
    const forgedAsset = { ...lockup, inputs: [...lockup.inputs, { name: "inverse", kind: "data" as const, required: true }] };
    expect(slotContractFindings(committed.assets.map(row => row === lockup ? forgedAsset : row), context("assets"))).toEqual(["assets.lockup: data inverse is not a slot member"]);
    const button = committed.components.find(row => row.slot === "components.button")!;
    const forgedButton = { ...button, inputs: [...button.inputs, { name: "tone", kind: "prop" as const, required: false }] };
    expect(slotContractFindings(committed.components.map(row => row === button ? forgedButton : row), context("components"))).toEqual(["components.button: prop tone is not a slot prop or member axis"]);
  });

  it("derives theme, asset and component records from the slot catalog contract", () => {
    const accent = committed.themes.find(row => row.slot === "themes.accent")!;
    expect(accent).toMatchObject({ specimenKind: "visual", inputs: [{ name: "default", kind: "data", required: true }], limits: { "$type": "color", "emit.default": "--accent", modes: "light,dark" } });
    const favicon = committed.assets.find(row => row.slot === "assets.favicon")!;
    expect(favicon.specimenKind).toBe("media");
    expect(favicon.inputs.map(row => [row.name, row.required])).toEqual([["small", false], ["vector", true]]);
    expect(committed.assets.find(row => row.slot === "assets.image")!.inputs.map(row => row.name)).toEqual(["entries"]);
    const button = committed.components.find(row => row.slot === "components.button")!;
    expect(button.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ name: "variant", kind: "prop" }), expect.objectContaining({ name: "assets.icon-chevron-right", kind: "asset" })]));
    expect(button.limits["compose.components"]).toBe("components.icon");
    expect(button.references.map(row => `${row.registry}/${row.item}`)).toEqual(["shadcn/button"]);
  });

  it("names copy keys, theme vars and assets the slot declares", () => {
    const hero = committed.sections.find(row => row.slot === "sections.hero")!;
    expect(hero.inputs).toEqual(expect.arrayContaining([
      { name: "header.heading", kind: "copy", required: true },
      expect.objectContaining({ kind: "theme", name: "themes.foreground" }),
      expect.objectContaining({ kind: "asset", name: "assets.image" }),
    ]));
    expect(hero.references).toEqual([expect.objectContaining({ registry: "tailark-oss", item: "mist-hero-section-1" })]);
    const shell = committed.frames.find(row => row.slot === "frames.site-shell")!;
    expect(shell.references.map(row => `${row.registry}/${row.item}`)).toEqual(["tailark-oss/mist-hero-section-1-header", "tailark-oss/mist-footer-1", "shadcn/sonner", "diceui/skip-nav"]);
    expect(shell.limits["references.blocked"]).toBeUndefined();
    const form = committed.sections.find(row => row.slot === "sections.form")!;
    expect(form.references.map(row => `${row.registry}/${row.item}`)).toContain("shadcn/field");
    const legal = committed.sections.find(row => row.slot === "sections.legal-prose")!;
    expect(legal.references).toEqual([expect.objectContaining({ registry: "tailwindcss-typography", item: "typography" })]);
    expect(shell.inputs.some(row => row.kind === "cell")).toBe(true);
  });

  it("makes every section that names the band compose the shell and its tokens", () => {
    const band = committed.sections.find(row => row.slot === "sections.band")!;
    expect(String(band.limits["emits.theme"]).split(",")).toEqual(expect.arrayContaining(["--spacing-section", "--container-measure", "--text-display", "--text-heading", "--text-figure"]));
    for (const row of committed.sections.filter(row => row.slot !== "sections.band")) {
      expect(row.limits["compose.band"], row.slot).toBe("sections.band");
      for (const rule of ["rule.spacing", "rule.type", "rule.decoration", "rule.copy", "rule.overflow"]) expect(row.limits[rule], `${row.slot} ${rule}`).toEqual(expect.any(String));
    }
    expect(committed.sections.find(row => row.slot === "sections.legal-prose")!.limits["compose.header"]).toBeUndefined();
    expect(committed.sections.find(row => row.slot === "sections.comparison")!.limits["compose.header"]).toBe("sections.section-header");
    for (const slot of ["frames.site-header", "frames.site-footer"]) expect(committed.frames.find(row => row.slot === slot)!.limits["compose.measure"]).toBe("sections.band");
  });

  it("fails a section contract that points at a missing reference folder", () => {
    const [band, header, hero, ...rest] = committed.sections;
    const moved = { ...hero!, references: [{ ...hero!.references[0]!, version: "0000000" }] };
    expect(slotContractFindings([band!, header!, moved, ...rest], context("sections"))).toEqual([`sections.hero: missing reference folder references/tailark-oss/mist-hero-section-1@0000000`]);
  });

  it("fails reads, copy keys and hashes the slot or manifest does not back", () => {
    const [band, header, hero, ...rest] = committed.sections;
    const forged = { ...hero!, inputs: [...hero!.inputs, { name: "themes.chart-5", kind: "theme" as const, required: true }, { name: "header.subtitle", kind: "copy" as const, required: false }], references: [{ ...hero!.references[0]!, hash: "sha256:" + "0".repeat(64) }] };
    expect(slotContractFindings([band!, header!, forged, ...rest], context("sections"))).toEqual([
      "sections.hero: theme read themes.chart-5 is not allowed by the slot",
      "sections.hero: copy key header.subtitle is not declared by the slot",
      "sections.hero: reference tailark-oss/mist-hero-section-1@8139698 hash differs from references/manifest.json",
    ]);
  });
});
