import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Timeline, type TimelineEntry } from "./Timeline.js";

function entries(count = 3): TimelineEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index}`,
    dateTime: `2026-${String(index % 12 + 1).padStart(2, "0")}`,
    date: `Release date ${index + 1}`,
    heading: `Release ${index + 1}`,
    body: `Changes for release ${index + 1}.`,
  }));
}

describe("Timeline", () => {
  it("retains each host dateTime on its visible time element (mutant: omit dateTime)", () => {
    const data = entries();
    data[1]!.dateTime = "2026-05-04";
    data[2]!.dateTime = "2026-05-04T10:30:00Z";
    const { container } = render(<Timeline entries={data} />);
    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(data.length);
    data.forEach((entry, index) => {
      expect(times[index]).toHaveAttribute("datetime", entry.dateTime);
      expect(times[index]).toHaveTextContent(String(entry.date));
    });
  });

  it.each([0, 21])("rejects %i entries (mutant: allow twenty-one)", count => {
    expect(() => render(<Timeline entries={entries(count)} />)).toThrow(/^Timeline:/);
  });

  it.each([1, 20])("renders the supported boundary of %i entries", count => {
    render(<Timeline entries={entries(count)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(count);
  });

  it.each(["yesterday", "2026/01/02", ""])("rejects malformed dateTime %j (mutant: omit validation)", dateTime => {
    expect(() => render(<Timeline entries={[{ ...entries(1)[0]!, dateTime }]} />)).toThrow(/^Timeline:/);
  });

  it("hides the decorative dot from assistive technology (mutant: omit aria-hidden)", () => {
    render(<Timeline entries={entries()} />);
    for (const item of screen.getAllByRole("listitem")) {
      const dot = item.querySelector("span.rounded-pill.bg-accent");
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("defaults item headings to h3 and accepts h5 (mutant: fixed h3)", () => {
    const view = render(<Timeline entries={entries(1)} />);
    expect(screen.getByRole("heading", { level: 3, name: "Release 1" })).toBeInTheDocument();
    view.rerender(<Timeline entries={entries(1)} headingLevel={5} />);
    expect(screen.getByRole("heading", { level: 5, name: "Release 1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("links only headings with a host href (mutant: always anchor)", () => {
    const data = entries(2);
    data[1]!.href = "/release-notes";
    render(<Timeline entries={data} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Release 2" })).toHaveAttribute("href", "/release-notes");
    expect(within(screen.getAllByRole("listitem")[0]!).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]!.querySelector("a")).toBeNull();
  });

  it("preserves authored order (mutant: sort entries by dateTime)", () => {
    const data = entries();
    data[0]!.dateTime = "2026-12";
    data[1]!.dateTime = "2026-01";
    data[2]!.dateTime = "2026-06";
    render(<Timeline entries={data} />);
    expect(screen.getAllByRole("heading").map(heading => heading.textContent)).toEqual(data.map(entry => entry.heading));
  });

  it("forwards root list attributes and renders a neutral host label", () => {
    const data = [{ ...entries(1)[0]!, label: "v2.4" }];
    render(<Timeline entries={data} aria-label="Release notes" className="gap-lg" style={{ marginBlockStart: 0 }} />);
    const root = screen.getByRole("list", { name: "Release notes" });
    expect(root.tagName).toBe("OL");
    expect(root).toHaveClass("gap-lg");
    expect(root).toHaveStyle({ marginBlockStart: 0 });
    expect(screen.getByText("v2.4")).toHaveClass("rounded-pill");
  });

  it.each([
    ["base", "text-ink-primary", "text-ink-secondary", "border-line-base", "bg-accent"],
    ["sunken", "text-ink-primary", "text-ink-secondary", "border-line-base", "bg-accent"],
    ["inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted", "border-line-on-inverse", "bg-accent-on-inverse"],
  ] as const)("uses %s ground inks, divider and dot", (ground, primary, secondary, border, dot) => {
    const { container } = render(<Timeline entries={entries(1)} ground={ground} />);
    expect(screen.getByRole("heading")).toHaveClass(primary);
    expect(container.querySelector("time")).toHaveClass(secondary);
    expect(screen.getByRole("heading").parentElement).toHaveClass("border-s", border);
    expect(container.querySelector(`span.${dot}`)).toHaveAttribute("aria-hidden", "true");
    if (ground !== "base") expect(screen.getByRole("list")).toHaveClass(`bg-surface-${ground}`);
  });
});
