import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Items } from "./Items.js";
import { Item } from "./Item.js";
import { Matrix } from "../Matrix.js";
import type { ItemData, ItemsProps } from "./types.js";

const data = (count: number, linked = false): ItemData[] => Array.from({ length: count }, (_, i) => ({
  id: `entry-${i}`, heading: `Entry ${i}`, description: `Copy ${i}`, icon: <svg data-icon="" />,
  eyebrow: "Area", meta: 0, badge: { label: "Ready", tone: "info" }, ...(linked ? { href: `/entry-${i}` } : {}),
}));
const draw = (props: Partial<ItemsProps> = {}) => render(<Items arrangement="columns" items={data(3)} {...props} />);

describe("collection render profiles", () => {
  it.each(["columns", "bento", "stacked"] as const)("uses the frame size for Explain %s", arrangement => {
    const { container } = draw({ arrangement, items: data(arrangement === "columns" ? 3 : 2), treatment: "rule" });
    const heading = screen.getByRole("heading", { name: "Entry 0" });
    expect(heading).toHaveClass("text-h2", "font-display");
    expect(heading).not.toHaveClass("text-body-l", "text-h3", "text-h1");
    expect(container.querySelector("[data-item]")).toHaveClass("gap-md", "pt-xl");
    expect(container.querySelector("[data-item-description]")).toHaveClass("text-body");
    expect(container.querySelector("[data-item] > [aria-hidden=true]")).toContainElement(container.querySelector("[data-icon]"));
  });
  it.each(["columns", "bento", "stacked"] as const)("uses display headings only for a display Explain %s frame", arrangement => {
    draw({ arrangement, size: "display", items: data(arrangement === "columns" ? 3 : 2) });
    expect(screen.getByRole("heading", { name: "Entry 0" })).toHaveClass("text-h1");
  });
  it("uses a centred statement scale without adding slots", () => {
    draw({ emphasis: "statement", items: data(3).map(({ id, heading, description }) => ({ id, heading, description })) });
    const heading = screen.getByRole("heading", { name: "Entry 0" });
    expect(heading).toHaveClass("text-h0");
    expect(heading.closest("[data-item]")).toHaveClass("items-center", "text-center");
  });
  it.each([false, true])("keeps Index rows compact, with an inline icon (linked=%s)", linked => {
    const { container } = draw({ arrangement: "rows", treatment: "rule", items: data(2, linked), size: "display" });
    const heading = screen.getByRole("heading", { name: "Entry 0" });
    expect(heading).toHaveClass("text-body", "font-medium");
    expect(heading).not.toHaveClass("text-h1", "text-h2");
    expect(container.querySelector("[data-item-description]")).toHaveClass("text-body-s");
    const body = container.querySelector("[data-item]")!;
    expect(body).toHaveClass("flex-row", "gap-lg", "pt-lg");
    expect(body.querySelector(":scope > [aria-hidden=true]")).toContainElement(body.querySelector("[data-icon]"));
    const copy = body.querySelector(":scope > [data-item-copy]")!;
    expect([...copy.children].map(node => node.textContent?.trim())).toEqual(["AreaReady0", "Entry 0", "Copy 0"]);
    expect(body.querySelector(".bg-status-info-tint")?.parentElement).toHaveClass("bg-surface-base");
  });
  it.each([[2, 2], [2, 4], [2, 6], [3, 3], [3, 6]] as const)("accepts complete Index plate tiles %s x %s", (columns, count) => {
    const { container } = draw({ arrangement: "rows", treatment: "plate", columns, items: data(count, true) });
    expect(container.querySelector("[data-items]")).toHaveAttribute("data-columns", String(columns));
    expect(container.querySelector("[data-items]")).toHaveClass(columns === 3 ? "tablet-lg:grid-cols-3" : "tablet:grid-cols-2");
    expect(screen.getAllByRole("link")).toHaveLength(count);
    expect(screen.getByRole("heading", { name: "Entry 0" })).toHaveClass("text-body");
  });
  it.each([[2, 3], [2, 8], [3, 2], [3, 4]])("refuses incomplete Index tiles %s x %s", (columns, count) => {
    expect(() => draw({ arrangement: "rows", treatment: "plate", columns: columns as 1 | 2 | 3, items: data(count, true) })).toThrow(RangeError);
  });
  it.each([
    { treatment: "plain" as const }, { order: "numbered" as const },
    { groups: [{ id: "a", label: "A", items: ["entry-0", "entry-1", "entry-2"] }, { id: "b", label: "B", items: ["entry-3", "entry-4", "entry-5"] }] },
    { items: data(6) },
  ])("does not extend three-column rows beyond the narrow plate policy %j", override => {
    expect(() => draw({ arrangement: "rows", treatment: "plate", columns: 3, items: data(6, true), ...override })).toThrow(RangeError);
  });
  it("keeps linked Explain plates distinct from Index tiles", () => {
    draw({ treatment: "plate", items: data(3, true) });
    expect(screen.getByRole("heading", { name: "Entry 0" })).toHaveClass("text-h2");
    expect(screen.getByRole("link", { name: "Entry 0" })).not.toContainElement(screen.getByText("Copy 0"));
  });
  it("classifies numbered rows before Index arrangement", () => {
    draw({ arrangement: "rows", order: "numbered", items: data(3) });
    expect(screen.getByRole("heading", { name: "Entry 0" })).toHaveClass("text-body-l");
  });
  it("keeps the standalone Item measured scale", () => {
    render(<Item id="single" heading="Standalone" treatment="plain" size="standard" ground="base" />);
    expect(screen.getByText("Standalone")).toHaveClass("text-body-l", "font-semibold");
  });
  it.each([true, false, null])("rejects retired item featured=%s", featured => {
    expect(() => draw({ items: data(3).map(item => ({ ...item, featured })) as unknown as ItemData[] })).toThrow(/featured.*retired/);
  });
  it("preserves existing one-column linked plate rows", () => {
    draw({ arrangement: "rows", treatment: "plate", columns: 1, items: data(2, true) });
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it("uses the actual Matrix heading when a label is present", () => {
    render(<Matrix sides={[{ id: "a", label: "Before", heading: "Manual", points: ["One", "Two"] }, { id: "b", heading: "Automatic", points: ["One", "Two"] }]} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Manual", "Automatic"]);
    expect(screen.getByText("Before").tagName).toBe("P");
  });
  it.each([3, 4, 5])("aligns %s lane visuals with their own staggered body", count => {
    const { container } = draw({ arrangement: "stacked", order: "connected", lanes: [{ id: "a", label: "First" }, { id: "b", label: "Second" }], items: data(count).map((item, i) => ({ ...item, lane: i === 1 || i === 2 ? "b" : "a", visual: <div>Visual {i}</div> })) });
    for (const body of container.querySelectorAll("[data-item]")) {
      expect(body).not.toHaveClass("desktop:grid-rows-subgrid", "desktop:row-span-2");
      expect(body.querySelector("[data-item-visual]")).toHaveClass("mt-auto");
    }
    expect(container.querySelector("ol")).toHaveClass(count === 3 ? "tablet-lg:grid-cols-3" : count === 4 ? "desktop:grid-cols-4" : "desktop:grid-cols-5");
  });
});
