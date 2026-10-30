import { describe, expect, it } from "vitest";
import { loadCatalog } from "./index.js";
import { assetPresentation, assetSlotDetails, libraryColumns, libraryRoster, tokenBaseline, tokenBaselineReset } from "./library-roster.js";
import { checkBoardColumns, rosterOffers, sourceRoster } from "./token-contract.js";

describe("library roster presentation contract", () => {
  it("offers only Custom token proposals, preserving historical source data", () => {
    const catalog = loadCatalog();
    for (const slot of catalog.slots.filter(slot => slot.layer === "tokens")) {
      expect(libraryRoster(slot.layer, slot.id).map(entry => entry.id)).toEqual(["custom"]);
    }
    expect(catalog.sources.some(source => source.id === "tailwind-default")).toBe(true);
    expect(libraryRoster("assets", "assets.icon-home").map(entry => entry.id)).toEqual(["lucide", "phosphor", "custom"]);
    expect(libraryRoster("assets", "assets.lockup").map(entry => entry.id)).toEqual(["custom"]);
    expect(libraryRoster("assets", "assets.favicon").map(entry => entry.id)).toEqual(["custom"]);
  });

  it("reads every column from the source roster: shadcn@aria first, Foundry gap seats, Custom last, no references", () => {
    const components = libraryRoster("components", "components.button");
    expect(components.map(entry => entry.id)).toEqual(["shadcn@aria", "custom"]);
    expect(components[0]?.license).toBe("MIT");
    expect(libraryRoster("components", "components.native-action").map(entry => [entry.id, entry.reason])).toEqual([["foundry", "no external covers"], ["custom", undefined]]);
    expect(libraryRoster("components", "components.chart-bar").map(entry => entry.id)).toEqual(["shadcn-charts", "custom"]);
    expect(libraryRoster("sections", "sections.band").map(entry => entry.id)).toEqual(["foundry", "custom"]);
    expect(libraryRoster("frames", "frames.app-shell").map(entry => entry.id)).toEqual(["foundry", "custom"]);
    const catalog = loadCatalog();
    const never = new Set(sourceRoster.never);
    for (const slot of catalog.slots) {
      const roster = libraryRoster(slot.layer, slot.id).map(entry => entry.id);
      expect(roster, slot.id).toEqual(rosterOffers(sourceRoster, slot.id));
      expect(roster.at(-1), slot.id).toBe("custom");
      expect(roster.filter(id => never.has(id)), slot.id).toEqual([]);
      expect(libraryRoster(slot.layer, slot.id).some(entry => entry.role === "reference"), slot.id).toBe(false);
    }
    expect(libraryColumns("tokens", ["tokens.color-ramp"], ["tailwind-default", "foundry", "example"], "example").map(column => column.source)).toEqual(["example"]);
    expect(libraryColumns("tokens", ["tokens.color-ramp"], ["tailwind-default"], "example")).toEqual([]);
    expect(libraryColumns("assets", ["assets.icon-home", "assets.icon-check"], ["lucide", "phosphor", "example"], "example").map(column => column.source)).toEqual(["lucide", "phosphor", "example"]);
    expect(libraryColumns("components", ["components.button"], ["base-ui", "rac-starter", "heroui-v3"], "example")).toEqual([]);
    expect(libraryColumns("components", ["components.button"], [], "example")).toEqual([]);
  });

  it("R8: every roster row renders as at most three columns, all from the roster", () => {
    for (const layer of ["components", "assets", "sections", "frames"] as const) for (const row of sourceRoster[layer]) {
      const offered = row.offers.map(offer => offer.source);
      const columns = libraryColumns(layer, row.leaves, [...offered, "example"], "example").map(column => column.id);
      expect(checkBoardColumns(sourceRoster, row.leaves, columns), row.l2).toEqual([]);
    }
  });

  it("presents Media and pending additions without forging frozen leaf membership", () => {
    const catalog = loadCatalog();
    const original = structuredClone(catalog.placements);
    const presentation = assetPresentation(catalog.placements.find(tree => tree.layer === "assets")!);
    expect(presentation.status).toBe("build-pending-owner-freeze");
    expect(presentation.placement.nodes.find(node => node.id === "imagery")?.label).toBe("Media");
    expect(presentation.pendingLeaves.map(leaf => leaf.id)).toEqual(["assets.photography", "assets.illustration", "assets.video", "assets.pattern", "assets.typeface", "assets.share-image"]);
    expect(catalog.placements).toEqual(original);
    expect(assetSlotDetails("assets.image-ratio").classification).toBe("legacy-setting");
    expect(assetSlotDetails("assets.video").settings).toContain("reduced-motion-still");
    expect(assetSlotDetails("assets.video").guidelines).toContain("media-accessibility");
    expect(assetSlotDetails("assets.favicon").guidelines).toContain("favicon-sizes");
    expect(assetSlotDetails("assets.pattern").tokenInputs).toEqual(["color", "scale", "opacity"]);
  });

  it("compares and resets exact catalog baseline tokens without mutating input", () => {
    const catalog = loadCatalog();
    const baseline = tokenBaseline(catalog, "tokens.font-weight", "normal");
    expect(baseline?.source).toBe("tailwind-default");
    expect(baseline?.pin?.version).toBe("4.3.3");
    expect(baseline?.token.$value).toBe(400);
    expect(tokenBaseline(catalog, "tokens.font-weight", "normal", baseline?.token)?.differs).toBe(false);
    expect(tokenBaseline(catalog, "tokens.font-weight", "normal", { $type: "fontWeight", $value: 401 })?.differs).toBe(true);
    const before = structuredClone(catalog);
    const reset = tokenBaselineReset(catalog, "tokens.font-weight", "normal");
    expect(reset).toEqual({ op: "adopt", slot: "tokens.font-weight", source: "tailwind-default", members: ["tokens.font-weight.normal"] });
    expect(catalog).toEqual(before);
    expect(tokenBaseline(catalog, "tokens.action-color", "made-up")).toBeUndefined();
    expect(tokenBaselineReset(catalog, "tokens.action-color", "made-up")).toBeUndefined();
  });
});
