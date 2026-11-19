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
  figureAltIssues,
  framePlacementFindings,
  previewFigureAltIssues,
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
  requirements: [{ check: BACKDROP_REQUIREMENT }],
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
    ["a backdrop without the interactive.backdrop requirement", (c: ReturnType<typeof frame>) => { c.requirements = []; }, /without the interactive\.backdrop requirement/],
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

describe("a filled figure ships with its alt (foundry-build-0048 U23 review N1)", () => {
  const contract = () => ({
    slots: [
      { name: "header", type: "region", required: true },
      { name: "media", type: "media", required: false, placement: "figure", alt: { copy: "media.title" } },
      { name: "images", type: "media", required: true, placement: "figure", alt: { copy: "images.items[].label" } },
      { name: "logo", type: "media", required: false, placement: "figure", alt: { asset: "assets.logo" } },
      { name: "ground", type: "media", required: false, placement: "backdrop" },
    ],
  });
  const images = { items: [{ src: "a.png", label: "First" }, { src: "b.png", label: { $copy: "gallery.second" } }] };

  it("an absent optional figure needs nothing; a present one with its alt passes", () => {
    expect(figureAltIssues({ header: {}, images }, "sections.x", contract())).toEqual([]);
    expect(figureAltIssues({ media: { kind: "mark", title: "Clossys mark" }, images }, "sections.x", contract())).toEqual([]);
    expect(figureAltIssues({ media: { title: { $copy: "home.hero.media" } }, images, logo: { $asset: "assets.logo" }, ground: {} }, "sections.x", contract())).toEqual([]);
  });

  it.each([
    ["an absent alt", { media: { kind: "mark" } }, /figure media is filled, but its text alternative media\.title is absent or blank/],
    ["a blank alt", { media: { title: "   " } }, /media\.title is absent or blank/],
    ["an empty alt (an unbound copy slot binds empty)", { media: { title: "" } }, /media\.title is absent or blank/],
    ["a blank $copy reference", { media: { title: { $copy: " " } } }, /media\.title is absent or blank/],
    ["a non-text alt", { media: { title: 7 } }, /media\.title is absent or blank/],
    ["one blank item of a list", { images: { items: [{ label: "First" }, { label: "" }] } }, /images\.items\[\]\.label is absent or blank/],
    ["a list with no alt anywhere", { images: { items: [{}, {}] } }, /at 2 positions/],
  ])("a present figure refuses %s", (_label, props, message) => {
    const issues = figureAltIssues(props, "sections.x", contract());
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
  });

  it("the candidate wrapper reads meta.preview.fixtures, and the catalog hero contract applies", () => {
    const hero = catalogSurfaceContract("sections.hero");
    const item = (fixtures: unknown) => ({ meta: { preview: { schema: "clossys.element-preview/1", fixtures } } });
    expect(previewFigureAltIssues(item({ header: {} }), "sections.hero", hero)).toEqual([]);
    expect(previewFigureAltIssues(item({ media: { kind: "mark", title: { $copy: "home.hero.media" } } }), "sections.hero", hero)).toEqual([]);
    expect(previewFigureAltIssues(item({ media: { kind: "mark" } }), "sections.hero", hero)).toEqual([
      "sections.hero figure media is filled, but its text alternative media.title is absent or blank; a present figure ships with its alt",
    ]);
    expect(previewFigureAltIssues({ meta: { preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { media: { kind: "mark", title: "" } } } } } }, "sections.hero", hero)).toHaveLength(1);
    expect(previewFigureAltIssues({ meta: { preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { media: { kind: "mark", title: "Mark" } } } } } }, "sections.hero", hero)).toEqual([]);
    expect(previewFigureAltIssues({}, "sections.hero", hero)).toEqual([]);
    expect(previewFigureAltIssues(item({ media: {} }), "components.button", undefined)).toEqual([]);
  });
});
