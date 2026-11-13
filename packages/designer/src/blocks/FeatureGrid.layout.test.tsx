import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureGrid, type FeatureGridItem } from "./FeatureGrid.js";

const ITEMS: FeatureGridItem[] = [
  { id: "one", icon: <svg data-icon="one" />, heading: "Feature one", description: "Feature one description." },
  { id: "two", heading: "Feature two", description: "Feature two description." },
];
/** The feature collection is the root's last child in every layout. */
const items = (container: Element) => container.firstElementChild!.lastElementChild as HTMLElement;

describe("FeatureGrid layout", () => {
  it("keeps the default grid byte-identical whether layout is omitted or grid", () => {
    const omitted = renderToStaticMarkup(<FeatureGrid heading="Features" items={ITEMS} ground="sunken" />);
    expect(renderToStaticMarkup(<FeatureGrid heading="Features" items={ITEMS} ground="sunken" layout="grid" />)).toBe(omitted);
    expect(omitted).toContain("grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3");
  });

  it("list stacks one feature per row with its icon beside the copy", () => {
    const { container } = render(<FeatureGrid heading="Features" items={ITEMS} layout="list" />);
    const list = items(container);
    expect(list).toHaveClass("grid", "grid-cols-1");
    expect(list.className).not.toMatch(/grid-cols-[23]/);
    const first = list.firstElementChild as HTMLElement;
    expect(first).toHaveClass("flex", "items-start", "gap-md");
    expect(first.className.split(/\s+/)).not.toContain("flex-col");
    expect(first.firstElementChild?.querySelector("[data-icon=one]")).not.toBeNull();
    const copy = first.lastElementChild as HTMLElement;
    expect(copy).toHaveClass("flex", "flex-col", "gap-sm");
    expect(copy.textContent).toBe("Feature oneFeature one description.");
  });

  it("split puts the heading region beside a two-column feature grid from desktop", () => {
    const { container } = render(<FeatureGrid heading="Features" items={ITEMS} layout="split" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("flex", "flex-col", "desktop:grid", "desktop:grid-cols-2", "desktop:items-start");
    expect(root.children).toHaveLength(2);
    expect(root.firstElementChild?.querySelector("h2")?.textContent).toBe("Features");
    const grid = items(container);
    expect(grid).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2");
    expect(grid.className).not.toContain("desktop:grid-cols-3");
  });

  it("split without a heading region keeps one full-width feature grid", () => {
    const { container } = render(<FeatureGrid items={ITEMS} layout="split" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("desktop:grid-cols-2");
    expect(root.children).toHaveLength(1);
  });

  it("each layout value renders distinct markup", () => {
    const markup = (["grid", "list", "split"] as const).map(layout => renderToStaticMarkup(<FeatureGrid heading="Features" items={ITEMS} layout={layout} />));
    expect(new Set(markup).size).toBe(3);
  });
});
