import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopicList, type TopicListItem } from "./TopicList.js";

const ITEMS: TopicListItem[] = [
  { id: "a", heading: "Ownership records", description: "Who holds what, and since when." },
  { id: "b", heading: "Signed agreements", description: "Current terms and amendments." },
  { id: "c", heading: "Insurance", icon: <svg data-testid="icon" /> },
  { id: "d", heading: "Permits" },
];

describe("TopicList", () => {
  it("renders a real list, one item per topic", () => {
    render(<TopicList items={ITEMS} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-topic-list");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("is two columns from tablet by default, one below", () => {
    render(<TopicList items={ITEMS} />);
    expect(screen.getByRole("list")).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2", "tablet:gap-x-3xl");
  });

  it("stays one column when asked", () => {
    render(<TopicList items={ITEMS} columns={1} />);
    expect(screen.getByRole("list").className).not.toMatch(/grid-cols-2/);
  });

  it("separates rows with a hairline rule and py-lg", () => {
    render(<TopicList items={ITEMS} />);
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("border-t", "border-line-base", "py-lg");
      expect(item.style.borderBlockStartWidth).toBe("var(--ui-border-hairline, 1px)");
    }
  });

  it("sets the heading at item-heading scale and the description in secondary body", () => {
    render(<TopicList items={ITEMS} />);
    expect(screen.getByText("Ownership records")).toHaveClass("text-body-l", "font-medium");
    expect(screen.getByText("Who holds what, and since when.")).toHaveClass("text-body", "text-ink-secondary");
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("takes inverse ink and rules on an inverse ground", () => {
    render(<TopicList items={ITEMS} ground="inverse" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("border-line-on-inverse");
    expect(screen.getByText("Permits")).toHaveClass("text-ink-on-inverse");
  });
});
