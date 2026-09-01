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
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Coverage" }).tagName).toBe("H4");
    expect(container.querySelectorAll("dl")).toHaveLength(2);
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelectorAll("dd")).toHaveLength(3);
  });

  it("renders one section-level legend for the full closed vocabulary, not one per group", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" />);
    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Readiness" })).toBeInTheDocument();
    expect(container.querySelectorAll('ul[aria-label="Readiness"]')).toHaveLength(1);
    expect(container.querySelectorAll('ul[aria-label="Readiness"] li')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Status legend"]')).toBeNull();
  });

  it("uses the caller-localized legend label as its semantic name", () => {
    render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Disponibilidad" />);
    expect(screen.getByRole("list", { name: "Disponibilidad" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Status legend")).not.toBeInTheDocument();
  });

  it("maps every closed state to a status token while leaving its readable label on ink-primary", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" />);
    const dots = container.querySelectorAll('span[aria-hidden="true"]');
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-success"))).toBe(true);
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-warning"))).toBe(true);
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-info"))).toBe(true);
    expect([...dots].some((dot) => dot.className.includes("-text"))).toBe(false);
    expect(screen.getByText("Available", { selector: "dd" }).className).toContain("text-ink-primary");
  });

  it("forwards className and style to its section root", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" className="gap-2xl" style={{ marginTop: "8px" }} />);
    const root = container.querySelector("section") as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.style.marginTop).toBe("8px");
  });

  it.each([
    ["base", "bg-surface-base", "text-ink-primary", "border-line-base", "bg-status-success"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "border-line-base", "ring-ink-primary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "border-line-on-inverse", "ring-ink-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary, border, statusBoundary) => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Readiness" ground={ground} />);
    expect(container.querySelector("section")).toHaveClass(surface);
    expect(screen.getByText("Readiness")).toHaveClass(primary);
    expect(container.querySelectorAll("dl > div")[1]).toHaveClass(border);
    const availableDot = [...container.querySelectorAll('span[aria-hidden="true"]')].find((dot) => dot.className.includes("bg-status-success"));
    expect(availableDot).toHaveClass(statusBoundary);
  });
});
