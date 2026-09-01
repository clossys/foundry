import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusList, type StatusListLabels } from "./StatusList.js";

const LABELS: StatusListLabels = {
  available: "Available",
  partial: "Partial",
  planned: "Planned",
  dispositions: { "not-offered": "Not offered" },
};
const GROUPS = [
  {
    id: "coverage",
    heading: "Coverage",
    items: [
      { id: "reports", label: "Reports", state: "available" as const },
      { id: "exports", label: "Exports", state: "partial" as const },
    ],
  },
  {
    id: "future",
    heading: "Future",
    items: [
      { id: "alerts", label: "Alerts", state: "planned" as const },
      { id: "certifications", label: "Certifications", disposition: "not-offered" as const },
    ],
  },
];

describe("StatusList", () => {
  it("renders each group as a labelled section containing a real definition list", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Coverage" }).tagName).toBe("H4");
    expect(container.querySelectorAll("dl")).toHaveLength(2);
    expect(container.querySelectorAll("dt")).toHaveLength(4);
    expect(container.querySelectorAll("dd")).toHaveLength(4);
  });

  it("renders one section-level legend for the full closed vocabulary, not one per group", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" />);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Status" })).toBeInTheDocument();
    expect(container.querySelectorAll('ul[aria-label="Status"]')).toHaveLength(1);
    expect(container.querySelectorAll('ul[aria-label="Status"] li')).toHaveLength(4);
    expect(container.querySelector('[aria-label="Status legend"]')).toBeNull();
  });

  it("uses the caller-localized legend label as its semantic name", () => {
    render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Estado" />);
    expect(screen.getByRole("list", { name: "Estado" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Status legend")).not.toBeInTheDocument();
  });

  it("maps every closed state to a semantic tone while leaving its readable label on ink-primary", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" />);
    const dots = container.querySelectorAll('span[aria-hidden="true"]');
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-success"))).toBe(true);
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-warning"))).toBe(true);
    expect([...dots].some((dot) => dot.className.split(" ").includes("bg-status-info"))).toBe(true);
    const offAxisDot = [...dots].find((dot) => dot.className.split(" ").includes("bg-ink-muted"));
    expect(offAxisDot).toBeDefined();
    expect(offAxisDot?.className).not.toContain("bg-status-");
    expect(offAxisDot?.className).not.toContain("bg-status-warning");
    expect(offAxisDot?.className).not.toContain("bg-status-info");
    expect([...dots].some((dot) => dot.className.includes("-text"))).toBe(false);
    expect(screen.getByText("Available", { selector: "dd" }).className).toContain("text-ink-primary");
    expect(screen.getByText("Not offered", { selector: "dd" }).className).toContain("text-ink-primary");
  });

  it("forwards className and style to its section root", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" className="gap-2xl" style={{ marginTop: "8px" }} />);
    const root = container.querySelector("section") as HTMLElement;
    expect(root.className).toContain("gap-2xl");
    expect(root.style.marginTop).toBe("8px");
  });

  it.each([
    ["base", "", "text-ink-primary", "border-line-base", "bg-status-success", "bg-ink-muted"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "border-line-base", "ring-ink-primary", "ring-ink-primary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "border-line-on-inverse", "ring-ink-on-inverse", "ring-ink-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary, border, statusBoundary, offAxisBoundary) => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" ground={ground} />);
    const root = container.querySelector("section") as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(screen.getByText("Status")).toHaveClass(primary);
    expect(container.querySelectorAll("dl > div")[1]).toHaveClass(border);
    const availableDot = [...container.querySelectorAll('span[aria-hidden="true"]')].find((dot) => dot.className.includes("bg-status-success"));
    expect(availableDot).toHaveClass(statusBoundary);
    const offAxisDot = [...container.querySelectorAll('span[aria-hidden="true"]')].find((dot) => dot.className.includes("bg-ink-muted"));
    expect(offAxisDot).toHaveClass(offAxisBoundary);
  });
});

describe("StatusList optional slots", () => {
  const DETAILED = [{
    id: "coverage",
    heading: "Coverage",
    items: [
      { id: "reports", label: "Reports", detail: "Available in every region today.", state: "available" as const },
      { id: "certifications", label: "Certifications", detail: "Not offered because the audit is not ours to claim.", disposition: "not-offered" as const },
    ],
  }];

  it("renders a row detail as a second description of the same term, keeping definition-list semantics", () => {
    const { container } = render(<StatusList labels={LABELS} groups={DETAILED} legendLabel="Status" />);
    const row = container.querySelector("dl > div") as HTMLElement;
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(container.querySelectorAll("dd")).toHaveLength(4);
    expect(row.children[0].tagName).toBe("DT");
    expect(row.children[1].tagName).toBe("DD");
    expect(row.children[2].tagName).toBe("DD");
    expect(row.children[2].textContent).toBe("Available in every region today.");
    expect(screen.getByText("Not offered because the audit is not ours to claim.")).toBeTruthy();
  });

  it("leaves a row without a detail exactly as it rendered before the slot existed", () => {
    const { container } = render(<StatusList labels={LABELS} groups={GROUPS} legendLabel="Status" />);
    const rows = container.querySelectorAll("dl > div");
    expect(container.querySelectorAll("dd")).toHaveLength(4);
    for (const row of rows) {
      expect(row.children).toHaveLength(2);
      expect(row.className).not.toContain("flex-wrap");
    }
  });

  it("wraps only the rows that carry a detail, so an undetailed neighbour keeps its own row layout", () => {
    const mixed = [{ id: "mixed", heading: "Mixed", items: [{ id: "a", label: "A", detail: "Explained.", state: "available" as const }, { id: "b", label: "B", state: "planned" as const }] }];
    const rows = render(<StatusList labels={LABELS} groups={mixed} legendLabel="Status" />).container.querySelectorAll("dl > div");
    expect(rows[0].className).toContain("flex-wrap");
    expect(rows[1].className).not.toContain("flex-wrap");
  });

  it("renders an optional eyebrow above the heading and nothing at all without one", () => {
    const withEyebrow = render(<StatusList eyebrow="Posture" heading="Readiness" labels={LABELS} groups={GROUPS} legendLabel="Status" />).container;
    expect(screen.getByText("Posture").tagName).toBe("P");
    expect(withEyebrow.querySelector("h2")?.textContent).toBe("Readiness");

    const without = render(<StatusList heading="Readiness" labels={LABELS} groups={GROUPS} legendLabel="Status" />).container;
    expect(without.querySelector("h2")?.previousElementSibling).toBeNull();
  });
});
