// @vitest-environment node
import { describe, expect, it } from "vitest";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { BACKDROP_REGISTRY } from "../tokens/interactive-backdrops.js";
import {
  BACKDROP_REQUIREMENT,
  catalogBackdropSlot,
  catalogBackdropSurfaces,
  catalogSurfaceContract,
  framePlacementFindings,
  sectionPlacementFindings,
} from "./media-placement.js";
import { loadBuildCatalog } from "./index.js";

/** A section contract with one figure and one backdrop that satisfy every placement rule. */
const section = () => ({
  slots: [
    { name: "header", type: "region", required: true },
    { name: "art", type: "media", required: true, placement: "figure", alt: { copy: "art.title" } } as Record<string, unknown>,
    { name: "logo", type: "media", required: false, placement: "figure", alt: { asset: "assets.logo" } } as Record<string, unknown>,
    { name: "ground", type: "media", required: false, placement: "backdrop" } as Record<string, unknown>,
  ],
  members: { names: ["root", "ground.scrim.light"] },
  copy: { fields: [{ key: "header.heading", required: true }, { key: "art.title", required: true }] },
  allowedReads: { themes: BACKDROP_REGISTRY.colors.map(color => `themes.${color}`), assets: ["assets.logo"] },
  requirements: [{ check: BACKDROP_REQUIREMENT }],
});
const frame = () => ({
  slots: [{ id: "main", required: true, accepts: ["sections"] }, { id: "ground", required: false, accepts: ["assets"], placement: "backdrop" } as Record<string, unknown>],
  members: { names: ["ground.scrim.strong"] },
  allowedReads: { themes: BACKDROP_REGISTRY.colors.map(color => `themes.${color}`) },
});
const sectionFindings = (contract: ReturnType<typeof section>) => sectionPlacementFindings({ id: "sections.x", contract });
const frameFindings = (contract: ReturnType<typeof frame>) => framePlacementFindings({ id: "frames.x", contract });
const slot = (contract: { slots: Record<string, unknown>[] }, name: string) => contract.slots.find(row => (row.name ?? row.id) === name)!;

describe("media placement in contract data (foundry-build-0048 U23)", () => {
  it("a contract whose figures name their alt and whose backdrop is decorative passes", () => {
    expect(sectionFindings(section())).toEqual([]);
    expect(frameFindings(frame())).toEqual([]);
  });

  it("every catalog media slot declares a placement, every figure an alt, and the catalog is clean", () => {
    for (const entry of sectionSlots) {
      const contract = entry.contract as unknown as Parameters<typeof sectionPlacementFindings>[0]["contract"];
      expect(sectionPlacementFindings({ id: entry.id, contract }), entry.id).toEqual([]);
      for (const row of (entry.contract.slots as { name: string; type: string; placement?: string; alt?: unknown }[]).filter(item => item.type === "media")) {
        expect(["figure", "backdrop"], `${entry.id} ${row.name}`).toContain(row.placement);
        if (row.placement === "figure") expect(row.alt, `${entry.id} ${row.name}`).toBeDefined();
      }
    }
    for (const entry of frameSlots) expect(framePlacementFindings({ id: entry.id, contract: entry.contract as never }), entry.id).toEqual([]);
    expect(() => loadBuildCatalog()).not.toThrow();
  });

  it.each([
    ["a media slot with no placement", (c: ReturnType<typeof section>) => { delete slot(c, "art").placement; }, /declares placement figure or backdrop/],
    ["an unknown placement", (c: ReturnType<typeof section>) => { slot(c, "art").placement = "inline"; }, /declares placement figure or backdrop/],
    ["a figure with no alt", (c: ReturnType<typeof section>) => { delete slot(c, "art").alt; }, /names its text alternative/],
    ["a figure alt of two kinds", (c: ReturnType<typeof section>) => { slot(c, "art").alt = { copy: "art.title", asset: "assets.logo" }; }, /names its text alternative/],
    ["a figure alt naming no copy field", (c: ReturnType<typeof section>) => { slot(c, "art").alt = { copy: "art.caption" }; }, /alt copy art\.caption is not a declared copy field/],
    ["a required figure with an optional alt field", (c: ReturnType<typeof section>) => { c.copy.fields[1]!.required = false; }, /a required figure needs a required alt field/],
    ["a figure alt naming an unread asset", (c: ReturnType<typeof section>) => { c.allowedReads.assets = []; }, /alt asset assets\.logo is not an asset the contract may read/],
    ["a placement on a non-media slot", (c: ReturnType<typeof section>) => { slot(c, "header").placement = "figure"; }, /only a media slot declares placement or alt/],
    ["a required backdrop", (c: ReturnType<typeof section>) => { slot(c, "ground").required = true; }, /decorative and must be optional/],
    ["a backdrop with alt", (c: ReturnType<typeof section>) => { slot(c, "ground").alt = { copy: "art.title" }; }, /aria-hidden and carries no alt/],
    ["a backdrop with copy", (c: ReturnType<typeof section>) => { c.copy.fields.push({ key: "ground.label", required: false }); }, /carries no copy, but the contract declares ground\.label/],
    ["a backdrop with no scrim member", (c: ReturnType<typeof section>) => { c.members.names = ["root"]; }, /keeps text contrast through ground\.scrim\.\* members/],
    ["a backdrop whose contract may not read a registry colour", (c: ReturnType<typeof section>) => { c.allowedReads.themes = c.allowedReads.themes.filter(theme => theme !== "themes.border"); }, /may not read themes\.border/],
    ["two backdrops", (c: ReturnType<typeof section>) => { slot(c, "logo").placement = "backdrop"; delete slot(c, "logo").alt; }, /places 2 backdrops; a surface has at most one/],
    ["a backdrop without the interactive.backdrop requirement", (c: ReturnType<typeof section>) => { c.requirements = []; }, /without the interactive\.backdrop requirement/],
  ])("a section refuses %s", (_label, mutate, message) => {
    const contract = section();
    mutate(contract);
    const findings = sectionFindings(contract);
    expect(findings.some(finding => message.test(finding)), findings.join("; ")).toBe(true);
  });

  it.each([
    ["a figure placement", (c: ReturnType<typeof frame>) => { slot(c, "ground").placement = "figure"; }, /places only a backdrop/],
    ["an alt", (c: ReturnType<typeof frame>) => { slot(c, "main").alt = { copy: "x" }; }, /a frame slot carries no alt/],
    ["a required backdrop", (c: ReturnType<typeof frame>) => { slot(c, "ground").required = true; }, /must be optional/],
    ["a backdrop with no scrim", (c: ReturnType<typeof frame>) => { c.members.names = []; }, /ground\.scrim\.\* members/],
    ["two backdrops", (c: ReturnType<typeof frame>) => { slot(c, "main").placement = "backdrop"; slot(c, "main").required = false; c.members.names.push("main.scrim.light"); }, /places 2 backdrops/],
  ])("a frame refuses %s", (_label, mutate, message) => {
    const contract = frame();
    mutate(contract);
    const findings = frameFindings(contract);
    expect(findings.some(finding => message.test(finding)), findings.join("; ")).toBe(true);
  });

  it("the catalog surface lookup: sections and frames have contracts, other layers none", () => {
    expect(catalogSurfaceContract("sections.hero")).toBeDefined();
    expect(catalogSurfaceContract("frames.site-shell")).toBeDefined();
    expect(catalogSurfaceContract("components.button")).toBeUndefined();
    expect(catalogSurfaceContract("sections.nope")).toBeUndefined();
    expect(catalogBackdropSlot("sections.hero")).toBe("backdrop");
    expect(catalogBackdropSlot("sections.call-to-action")).toBeUndefined();
    expect(catalogBackdropSurfaces()).toEqual(["sections.hero"]);
  });
});
