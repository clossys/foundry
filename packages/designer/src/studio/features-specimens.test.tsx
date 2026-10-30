import { Suspense } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isImageResource } from "../catalog-assets/media.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { sectionRenderers } from "../runtime/sections/index.js";
import { renderFeaturesSection } from "../runtime/sections/features.js";
import { featuresInputs } from "../runtime/sections/features.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { marketingComponentSelection } from "./marketing-component-selection.js";
import { FEATURES_SPECIMEN_LAYOUTS, FeaturesSpecimen, featuresSpecimenContent, featuresSpecimenInput } from "./features-specimens.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("selected Features specimens", () => {
  it.each(FEATURES_SPECIMEN_LAYOUTS)("renders layout.%s through the actual selected Card", async layout => {
    const selection = marketingComponentSelection();
    expect(selection.profile.components.components["components.card"]!.impl.kind).toBe("source");
    expect(selection.profile.components.components["components.card"]!.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
    const input = featuresSpecimenInput(layout);
    expect(sectionRenderers["sections.features"]!.render).toBe(renderFeaturesSection);
    const view = render(<ConsumerComponentProvider value={selection}><Suspense><FeaturesSpecimen layout={layout} /></Suspense></ConsumerComponentProvider>);
    expect(await screen.findByRole("heading", { name: featuresSpecimenContent.header.heading })).toBeVisible();
    expect(view.container.querySelector('[data-slot="card"]')).toHaveClass("group/card");
    expect(view.container.querySelector('[data-ds-leaf="sections.features"]')).toHaveAttribute("data-ds-fill", "foundry/sections.features");
    for (const item of featuresSpecimenContent.items) expect(isImageResource(item.figure.resource)).toBe(true);
    for (const member of input.selection.members) expect(featuresInputs.members).toContain(member);
    if (layout === "tabs") {
      expect(selection.profile.components.components["components.tabs"]!.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
      expect(await screen.findByRole("tablist")).toHaveAccessibleName(featuresSpecimenContent.header.heading);
      expect(screen.getAllByRole("tab")).toHaveLength(featuresSpecimenContent.items.length);
      expect(view.container.querySelector('[data-slot="tabs"]')).not.toBeNull();
      expect(view.container.querySelector('[data-slot="tabs-list"]')).not.toBeNull();
      expect(view.container.querySelector('[data-slot="tabs-trigger"]')).not.toBeNull();
      expect(view.container.querySelector('[data-slot="tabs-content"]')).not.toBeNull();
    } else {
      for (const item of featuresSpecimenContent.items) expect(screen.getByText(item.description)).toBeVisible();
    }
  });

  it("selects each real shadcn Tabs panel and media with keyboard input", async () => {
    const user = userEvent.setup();
    render(<ConsumerComponentProvider value={marketingComponentSelection()}><Suspense><FeaturesSpecimen layout="tabs" /></Suspense></ConsumerComponentProvider>);
    await screen.findByRole("tablist");
    await user.click(screen.getAllByRole("tab")[0]!);
    for (const item of featuresSpecimenContent.items.slice(1)) {
      await user.keyboard("{ArrowRight}");
      const panel = screen.getByRole("tabpanel", { name: item.heading });
      expect(within(panel).getByText(item.description)).toBeVisible();
      expect(within(panel).getByRole("img", { name: item.figure.resource.alt })).toHaveAttribute("src", item.figure.resource.src);
    }
    await user.keyboard("{Home}");
    expect(screen.getAllByRole("tab")[0]).toHaveFocus();
  });

  it("keeps every scroll step and image under the selected Card with reduced motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.stubGlobal("CSS", { supports: () => true });
    vi.stubGlobal("IntersectionObserver", vi.fn());
    const view = render(<ConsumerComponentProvider value={marketingComponentSelection()}><Suspense><FeaturesSpecimen layout="scroll" /></Suspense></ConsumerComponentProvider>);
    await screen.findByRole("heading", { name: featuresSpecimenContent.header.heading });
    expect(view.container.querySelector("[data-feature-sticky]")).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(featuresSpecimenContent.items.length);
  });

  it("reports the existing unmapped semantic member explicitly", () => {
    const coverage = importFoundrySections().coverage.find(row => row.slot === "sections.features")!;
    expect(coverage.missingMembers).toEqual(["about.features"]);
    const input = featuresSpecimenInput();
    expect(() => renderFeaturesSection({ ...input, selection: { ...input.selection, members: ["about.features"] } })).toThrow(/about.features is not mapped/);
  });
});
