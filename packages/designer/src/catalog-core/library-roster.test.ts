import { describe, expect, it } from "vitest";
import { loadCatalog } from "./index.js";
import { assetPresentation, assetSlotDetails, libraryColumns, libraryRoster, tokenBaseline, tokenBaselineReset } from "./library-roster.js";

describe("library roster presentation contract", () => {
  it("offers only Custom token proposals, preserving historical source data", () => {
    const catalog = loadCatalog();
    for (const slot of catalog.slots.filter(slot => slot.layer === "tokens")) {
      expect(libraryRoster(slot.layer, slot.id).map(entry => entry.id)).toEqual(["custom"]);
    }
    expect(catalog.sources.some(source => source.id === "tailwind-default")).toBe(true);
    expect(libraryRoster("assets", "assets.icon-home").map(entry => entry.id)).toEqual(["lucide", "phosphor", "custom"]);
    expect(libraryRoster("assets", "assets.lockup").map(entry => entry.id)).toEqual(["custom"]);
    expect(libraryRoster("assets", "assets.typeface").map(entry => entry.id)).toEqual(["google-fonts", "fontshare-ofl", "custom"]);
    expect(libraryRoster("assets", "assets.pattern").map(entry => entry.id)).toEqual(["hero-patterns", "custom"]);
  });

  it("keeps reference catalog entries separate from implementation availability", () => {
    const components = libraryRoster("components", "components.button");
    expect(components.map(entry => entry.id)).toEqual(["shadcn@aria", "shadcn-ui", "foundry", "heroui-v3", "untitled-ui-react", "radix-themes", "mantine", "park-ui", "base-ui", "custom"]);
    expect(components.find(entry => entry.id === "base-ui")?.role).toBe("reference");
    expect(components.find(entry => entry.id === "heroui-v3")?.license).toBe("Apache-2.0");
    expect(libraryRoster("sections", "sections.hero").map(entry => entry.id)).toEqual(["custom", "foundry", "shadcn-blocks"]);
    expect(libraryRoster("frames", "frames.app-shell").map(entry => entry.id)).toEqual(["foundry", "shadcn-blocks", "custom"]);
    expect(libraryRoster("assets", "assets.typeface")[1]?.restriction).toContain("OFL");
    expect(libraryColumns("tokens", ["tokens.color-ramp"], ["tailwind-default", "foundry", "example"], "example").map(column => column.source)).toEqual(["example"]);
    expect(libraryColumns("tokens", ["tokens.color-ramp"], ["tailwind-default"], "example")).toEqual([]);
    expect(libraryColumns("assets", ["assets.icon-home", "assets.icon-check"], ["lucide", "phosphor", "example"], "example").map(column => column.source)).toEqual(["lucide", "phosphor", "example"]);
    expect(libraryColumns("components", ["components.button"], ["base-ui"], "example")[0]?.referenceOnly).toBe(true);
    expect(libraryColumns("components", ["components.button"], [], "example")).toEqual([]);
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
