/** @vitest-environment node */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../references/manifest.json" with { type: "json" };
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import sections from "../catalog/slot-contracts/sections.json" with { type: "json" };
import frames from "../catalog/slot-contracts/frames.json" with { type: "json" };
import { slotContractFindings, type SlotContractContext, type SlotContractRecord } from "./slot-contracts.js";

const references = fileURLToPath(new URL("../../references/", import.meta.url));
const folderExists = (dir: string) => existsSync(references + dir) && statSync(references + dir).isDirectory();
const context = (layer: "sections" | "frames"): SlotContractContext => ({ layer, slots: (layer === "sections" ? sectionSlots : frameSlots) as unknown as SlotContractContext["slots"], manifest, folderExists });
const committed = { sections: sections as unknown as SlotContractRecord[], frames: frames as unknown as SlotContractRecord[] };

describe("section and frame slot contracts", () => {
  it("covers exactly the Home page section and frame L3 slots and the shared section shell", () => {
    expect(committed.sections.map(row => row.slot)).toEqual(["sections.band", "sections.section-header", "sections.hero", "sections.features", "sections.comparison", "sections.pricing", "sections.call-to-action", "sections.form", "sections.legal-prose", "sections.steps"]);
    expect(committed.frames.map(row => row.slot)).toEqual(["frames.site-header", "frames.site-footer", "frames.site-shell"]);
  });

  it.each(["sections", "frames"] as const)("resolves every %s contract reference to a pinned references/ folder", layer => {
    expect(slotContractFindings(committed[layer], context(layer))).toEqual([]);
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
