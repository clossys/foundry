import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Comparison, type ComparisonSide } from "./Comparison.js";

const BEFORE: ComparisonSide = {
  label: "Today",
  heading: "Records in many places",
  points: ["Files arrive by email", "Dates live in a spreadsheet"],
};
const AFTER: ComparisonSide = {
  label: "With one record",
  heading: "One place for every file",
  points: ["Files land in one record", "Dates are tracked for you"],
};

describe("Comparison", () => {
  it("renders two sections named by their labels as real headings", () => {
    render(<Comparison before={BEFORE} after={AFTER} />);
    const before = screen.getByRole("heading", { name: "Today" });
    const after = screen.getByRole("heading", { name: "With one record" });
    expect(before.tagName).toBe("H3");
    expect(after.tagName).toBe("H3");
    expect(before.closest("section")).toHaveAttribute("data-comparison-side", "before");
    expect(after.closest("section")).toHaveAttribute("data-comparison-side", "after");
  });

  it("puts before first in the DOM, stacked below tablet and two columns from tablet", () => {
    const { container } = render(<Comparison before={BEFORE} after={AFTER} />);
    const root = container.querySelector("[data-comparison]") as HTMLElement;
    expect(root).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2", "tablet:gap-x-4xl");
    const sides = root.querySelectorAll("section");
    expect(sides[0]).toHaveAttribute("data-comparison-side", "before");
  });

  it("waits for tablet-lg before going side by side when the sides carry visuals", () => {
    const { container } = render(
      <Comparison before={{ ...BEFORE, visual: <div /> }} after={{ ...AFTER, visual: <div /> }} />,
    );
    const root = container.querySelector("[data-comparison]") as HTMLElement;
    expect(root).toHaveClass("tablet-lg:grid-cols-2");
    expect(root.className).not.toMatch(/(^|\s)tablet:grid-cols-2/);
    for (const visual of container.querySelectorAll("[data-comparison-visual]")) expect(visual).toHaveClass("mt-auto");
  });

  it("sets after on a plate in primary ink and before on the ground in secondary ink", () => {
    const { container } = render(<Comparison before={BEFORE} after={AFTER} />);
    const after = container.querySelector('[data-comparison-side="after"] > div') as HTMLElement;
    expect(after).toHaveAttribute("data-variant", "plate");
    expect(screen.getByText("Files land in one record").closest("li")).toHaveClass("text-ink-primary");
    expect(screen.getByText("Files arrive by email").closest("li")).toHaveClass("text-ink-secondary");
    const before = container.querySelector('[data-comparison-side="before"]') as HTMLElement;
    expect(before.className).not.toMatch(/(^|\s)bg-/);
  });

  it("hides the marks and the arrow from assistive technology", () => {
    const { container } = render(<Comparison before={BEFORE} after={AFTER} />);
    const arrow = container.querySelector("[data-comparison-arrow]") as HTMLElement;
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow).toHaveClass("hidden", "tablet:flex");
    for (const item of screen.getAllByRole("listitem")) {
      expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
    const afterList = within(container.querySelector('[data-comparison-side="after"]') as HTMLElement).getAllByRole("listitem");
    expect(afterList[0]!.querySelector("svg")).toHaveClass("text-accent");
  });

  it("renders a description instead of points", () => {
    render(
      <Comparison
        before={{ label: "Before", description: "Work moves between inboxes." }}
        after={{ label: "After", description: "Work stays in one record." }}
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Work stays in one record.")).toHaveClass("text-body");
  });
});
