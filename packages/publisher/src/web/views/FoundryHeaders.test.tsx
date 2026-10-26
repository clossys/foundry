// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SECTION_GROUND_CLASSES } from "@clossys/designer/blocks/server";
import { sectionedViewBlocks as clientBlocks } from "./SectionedViewBlocks.js";
import { sectionedViewBlocks as serverBlocks } from "./SectionedViewBlocks.server.js";
import { renderSectionedViewSections } from "./SectionedViewContent.js";
import type { ResolvedSectionedViewSection } from "../../core/sectioned-view.js";

afterEach(cleanup);
const grounds = ["base", "sunken", "inverse"] as const;
const resolutions = [{ ref: { id: "headers.copy" }, text: "Metrics", recordId: "headers", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "headers.copy" }];
function statGrid(copy: { heading?: string; eyebrow?: string; description?: string }, ground: typeof grounds[number] = "base") {
  const section: ResolvedSectionedViewSection = { id: "metrics", kind: "stat-grid", ground, ...copy, items: [{ id: "users", label: "Users", value: "42" }] };
  const [{ node }] = renderSectionedViewSections({ id: "headers", resolutions, sections: [section] }, serverBlocks, {});
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<>{node}</>);
  return root.querySelector("#metrics")!;
}

describe("Foundry-owned Publisher section headers", () => {
  it.each(grounds)("preserves stat-grid title/copy geometry and inks on %s", ground => {
    const root = statGrid({ eyebrow: "Activity", heading: "Metrics", description: "Latest totals" }, ground);
    const colors = SECTION_GROUND_CLASSES[ground];
    const header = root.firstElementChild!;
    expect(header).toHaveClass("flex", "flex-col", "gap-xs");
    expect(root).toHaveClass("flex", "flex-col", "gap-lg");
    if (colors.surface) expect(root).toHaveClass(colors.surface);
    const heading = within(root as HTMLElement).getByRole("heading", { level: 2, name: "Metrics" });
    expect(heading).toHaveClass("text-h2", "font-display", colors.primary);
    expect(header.children).toHaveLength(3);
    expect(header.firstElementChild).toHaveTextContent("Activity");
    expect(header.firstElementChild).toHaveClass("text-caption", "uppercase", "tracking-label", colors.muted);
    expect(header.lastElementChild).toHaveTextContent("Latest totals");
    expect(header.lastElementChild).toHaveClass("text-body", colors.secondary);
    expect(root.lastElementChild).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2", "desktop:grid-cols-4");
    expect(root.lastElementChild).toHaveTextContent("Users");
    expect(root.lastElementChild).toHaveTextContent("42");
  });

  it("keeps rejecting stat-grid copy with no heading at the actual render boundary", () => {
    expect(() => statGrid({})).toThrow("sections.0.heading must be resolved non-blank copy");
  });

  it("keeps rejecting explicit undefined stat-grid headings even when eyebrow copy is present", () => {
    expect(() => statGrid({ heading: undefined, eyebrow: "Activity" })).toThrow("sections.0.heading must be resolved non-blank copy");
  });

  for (const [entry, blocks] of [["client", clientBlocks], ["server", serverBlocks]] as const) {
    it.each(grounds)(`preserves ${entry} pricing eyebrow truthiness, ground and its single owned title on %s`, ground => {
      for (const eyebrow of ["Plans", "", undefined]) {
        const props = { id: "pricing", ground, eyebrow, heading: "Pricing", description: "Choose a tier", headingLevel: 3 as const, items: [{ id: "team", name: "Team", price: "$12", features: ["Seats"], cta: "Choose" }] };
        const element = <blocks.PricingTable {...props} />;
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(element);
        const band = root.querySelector("#pricing")!;
        const headings = [...band.querySelectorAll("h3")].filter(node => node.textContent === "Pricing");
        expect(headings).toHaveLength(1);
        expect(band.querySelector("h2")).toBeNull();
        expect(band.textContent).toContain("Choose a tier");
        const eyebrowNode = [...band.querySelectorAll("p")].find(node => node.textContent === "Plans");
        expect(Boolean(eyebrowNode)).toBe(Boolean(eyebrow));
        if (eyebrowNode) expect(eyebrowNode).toHaveClass("text-caption", "uppercase", "tracking-label", SECTION_GROUND_CLASSES[ground].muted);
        if (entry === "client") {
          const mounted = render(element);
          expect(within(mounted.container).getAllByRole("heading", { level: 3, name: "Pricing" })).toHaveLength(1);
          expect(within(mounted.container).queryByText("Plans")).toBe(eyebrow ? mounted.container.querySelector("#pricing > div p") : null);
          mounted.unmount();
        }
      }
    });
  }
});
