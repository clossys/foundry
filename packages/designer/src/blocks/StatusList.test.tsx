import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusList, type StatusListLabels } from "./StatusList.js";

const LABELS: StatusListLabels = { available: "Available", partial: "Partial", planned: "Planned" };
const GROUPS = [
  {
    id: "coverage",
    heading: "Coverage",
    items: [
      { id: "reports", label: "Reports", state: "available" as const },
      { id: "exports", label: "Exports", state: "partial" as const },
    ],
  },
  { id: "future", heading: "Future", items: [{ id: "alerts", label: "Alerts", state: "planned" as const }] },
];

describe("StatusList", () => {
  it("renders each group as a labelled section containing a real definition list", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Coverage" }).tagName).toBe("H4");
    expect(container.querySelectorAll("dl")).toHaveLength(2);
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelectorAll("dd")).toHaveLength(3);
  });

  it("renders one section-level legend for the full closed vocabulary, not one per group", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" />);
    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-label="Status legend"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Status legend"] li')).toHaveLength(3);
  });

  it("maps every closed state to a status token while leaving its readable label on ink-primary", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} />);
    const dots = container.querySelectorAll('span[aria-hidden="true"]');
    expect([...dots].some((dot) => dot.className.includes("bg-status-success-text"))).toBe(true);
    expect([...dots].some((dot) => dot.className.includes("bg-status-warning-text"))).toBe(true);
    expect([...dots].some((dot) => dot.className.includes("bg-status-info-text"))).toBe(true);
    expect(screen.getByText("Available", { selector: "dd" }).className).toContain("text-ink-primary");
  });

  it("forwards className and style to its section root", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} className="gap-2xl" style={{ marginTop: "8px" }} />);
    const root = container.querySelector("section") as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.style.marginTop).toBe("8px");
  });
});
