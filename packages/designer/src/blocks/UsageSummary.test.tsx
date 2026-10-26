import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { UsageSummary } from "./UsageSummary.js";
import { usageSummarySample } from "./usage-summary/sample.js";

describe("UsageSummary", () => {
  it("US1: renders one UsageMeter per meter record inside a named list", () => {
    render(<UsageSummary {...usageSummarySample} />);
    const region = screen.getByRole("region", { name: "Plan usage" });
    const rows = within(within(region).getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(region).getAllByRole("meter")).toHaveLength(3);
    for (const text of ["API requests", "8,420 requests", "Seats", "41 GB", "of 100 GB"]) expect(within(region).getByText(text)).toBeVisible();
    expect(within(rows[0]!).getByText("You have used at least 80 percent of this limit.")).toBeVisible();
  });

  it("US2: renders the empty state for no meters, and refuses no meters without one", () => {
    const { container } = render(<UsageSummary {...usageSummarySample} meters={[]} />);
    expect(within(container).getByText("No metered usage")).toBeVisible();
    expect(container.querySelector("ul")).toBeNull();
    expect(() => render(<UsageSummary aria-label="Plan usage" meters={[]} />)).toThrow(/UsageSummary: meters is empty and no emptyState/);
  });
});
