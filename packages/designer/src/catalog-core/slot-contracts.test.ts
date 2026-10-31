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
  it("covers exactly the Home page section and frame L3 slots", () => {
    expect(committed.sections.map(row => row.slot)).toEqual(["sections.hero", "sections.features", "sections.comparison", "sections.pricing", "sections.call-to-action", "sections.steps"]);
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
    expect(shell.references.map(row => `${row.registry}/${row.item}`)).toEqual(["tailark-oss/mist-hero-section-1-header", "tailark-oss/mist-footer-1", "shadcn/sonner"]);
    expect(shell.inputs.some(row => row.kind === "cell")).toBe(true);
  });

  it("fails a section contract that points at a missing reference folder", () => {
    const [hero, ...rest] = committed.sections;
    const moved = { ...hero!, references: [{ ...hero!.references[0]!, version: "0000000" }] };
    expect(slotContractFindings([moved, ...rest], context("sections"))).toEqual([`sections.hero: missing reference folder references/tailark-oss/mist-hero-section-1@0000000`]);
  });

  it("fails reads, copy keys and hashes the slot or manifest does not back", () => {
    const [hero, ...rest] = committed.sections;
    const forged = { ...hero!, inputs: [...hero!.inputs, { name: "themes.chart-5", kind: "theme" as const, required: true }, { name: "header.subtitle", kind: "copy" as const, required: false }], references: [{ ...hero!.references[0]!, hash: "sha256:" + "0".repeat(64) }] };
    expect(slotContractFindings([forged, ...rest], context("sections"))).toEqual([
      "sections.hero: theme read themes.chart-5 is not allowed by the slot",
      "sections.hero: copy key header.subtitle is not declared by the slot",
      "sections.hero: reference tailark-oss/mist-hero-section-1@8139698 hash differs from references/manifest.json",
    ]);
  });
});
