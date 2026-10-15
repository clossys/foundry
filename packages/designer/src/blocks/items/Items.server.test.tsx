import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Items } from "./Items.server.js";

const items = Array.from({ length: 4 }, (_, i) => ({ id: `item-${i}`, heading: `Question ${i}`, description: `Answer ${i}` }));
const groups = [{ id: "first", label: "First", items: ["item-2", "item-0"] }, { id: "second", label: "Second", items: ["item-3", "item-1"] }];

describe("native Items disclosure", () => {
  it("uses independent closed details with a first direct summary and retained answers", () => {
    const { container } = render(<Items arrangement="rows" reveal="disclose" treatment="rule" headingLevel={4} items={items} />);
    const rows = [...container.querySelectorAll("details")];
    expect(rows).toHaveLength(4);
    for (const [i, row] of rows.entries()) {
      expect(row).not.toHaveAttribute("open");
      expect(row).not.toHaveAttribute("name");
      expect(row.firstElementChild?.tagName).toBe("SUMMARY");
      expect(row.firstElementChild?.children).toHaveLength(1);
      expect(row.firstElementChild?.firstElementChild?.tagName).toBe("H4");
      expect(row.firstElementChild?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(row).toHaveClass("details-motion");
      expect(row.querySelector(".disclosure-icon-motion")).toHaveAttribute("aria-hidden", "true");
      row.open = true; expect(row).toHaveAttribute("open");
      expect(row.querySelector(".disclosure-icon-motion")).toHaveClass("group-open/faq:rotate-180");
      row.open = false;
      expect(row.style.borderTopWidth).toContain("var(--ui-border-hairline");
      expect(row.lastElementChild).toHaveTextContent(`Answer ${i}`);
      expect(row.lastElementChild?.tagName).toBe("DIV");
    }
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
    expect(screen.getByText("Answer 0")).toBeInTheDocument();
  });
  it("defaults to an h3 child in each native summary", () => {
    const { container } = render(<Items arrangement="rows" reveal="disclose" items={items} />);
    expect(container.querySelectorAll("summary > h3")).toHaveLength(4);
  });
  it("permits an authored answer control outside summary and keeps legal heading structure", () => {
    const { container } = render(<Items arrangement="rows" reveal="disclose" items={items.map((item, i) => i === 0 ? { ...item, description: <a href="/reference">Reference</a> } : item)} />);
    expect(container.querySelector("summary a")).toBeNull();
    expect(container.querySelector("details > div a")).toHaveTextContent("Reference");
    expect(container.querySelector("summary article, summary p, summary div")).toBeNull();
  });
  it("keeps group IDs unique across duplicate native instances and numbers rendered membership order", () => {
    const { container } = render(<><Items arrangement="rows" reveal="disclose" order="numbered" items={items} groups={groups} /><Items arrangement="rows" reveal="disclose" order="numbered" items={items} groups={groups} /></>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(ids.length).toBeGreaterThanOrEqual(groups.length * 2); expect(new Set(ids).size).toBe(ids.length);
    for (const node of container.querySelectorAll("[aria-labelledby]")) {
      const label = container.querySelector(`[id="${node.getAttribute("aria-labelledby")}"]`);
      expect(label).not.toBeNull(); expect(node.closest('[role="group"]')!.contains(label)).toBe(true);
    }
    expect([...container.querySelectorAll("[data-item-ordinal]")].map(node => node.textContent)).toEqual(["1", "2", "3", "4", "1", "2", "3", "4"]);
  });
  it("retains native summary/answer markup in server output without synthetic expanded state", () => {
    const html = renderToStaticMarkup(<Items arrangement="rows" reveal="disclose" items={items} />);
    expect((html.match(/<details\b/g) ?? [])).toHaveLength(4);
    expect(html).not.toContain("aria-expanded"); expect(html).not.toContain("<button");
    expect(html).toContain("Answer 0"); expect(html).toContain("group-open/faq:rotate-180");
  });
});
