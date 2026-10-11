import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Items } from "./Items.js";
import type { ItemData, ItemsProps } from "./types.js";

const data = (count: number): ItemData[] => Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, heading: `Title ${i}` }));
const draw = (props: Partial<ItemsProps>) => render(<Items arrangement="columns" items={data(3)} {...props} />);

describe("Items arrangement policy", () => {
  it.each([[2, 2], [2, 4], [2, 6], [3, 3], [3, 6]] as const)("accepts columns %s count %s", (columns, count) => {
    const { container } = draw({ columns, items: data(count) });
    expect(container.querySelector("[data-items]")).toHaveAttribute("data-columns", String(columns));
    expect(container.querySelectorAll("[data-item]")).toHaveLength(count);
  });
  it.each([[1, 2], [2, 3], [2, 5], [3, 2], [3, 4], [3, 5], [3, 7], [4, 4]])("refuses columns %s count %s", (columns, count) => {
    expect(() => draw({ columns: columns as 1 | 2 | 3, items: data(count) })).toThrow(RangeError);
  });
  it("defaults columns to three and item size to standard", () => {
    const { container } = draw({});
    expect(container.querySelector("[data-items]")).toHaveAttribute("data-columns", "3");
    expect(screen.getByText("Title 0")).toHaveClass("text-body-l", "font-semibold");
  });
  it.each([2, 3, 4, 5, 6, 7, 8])("accepts %s one-column rows", (count) => {
    const { container } = draw({ arrangement: "rows", items: data(count) });
    expect(container.querySelector("[data-items]")).toHaveAttribute("data-columns", "1");
  });
  it.each([2, 4, 6, 8])("accepts %s two-column rows", (count) => draw({ arrangement: "rows", columns: 2, items: data(count) }));
  it.each([1, 3, 5, 7, 9])("refuses %s two-column rows", (count) => expect(() => draw({ arrangement: "rows", columns: 2, items: data(count) })).toThrow(RangeError));
  it.each([2, 3, 4])("accepts %s stacked items", (count) => draw({ arrangement: "stacked", items: data(count) }));
  it.each([1, 5])("refuses %s stacked items", (count) => expect(() => draw({ arrangement: "stacked", items: data(count) })).toThrow(RangeError));
  it.each(["bento", "stacked"] as const)("refuses columns on %s", (arrangement) => expect(() => draw({ arrangement, columns: 2, items: data(2) })).toThrow(TypeError));
  it.each([2, 4, 6])("defaults %s bento spans to half", (count) => {
    const { container } = draw({ arrangement: "bento", items: data(count) });
    expect(container.querySelectorAll('[data-span="half"]')).toHaveLength(count);
    expect(screen.getByText("Title 0")).toHaveClass("text-h3");
  });
  it.each([3, 5])("refuses %s incomplete default bento spans", (count) => expect(() => draw({ arrangement: "bento", items: data(count) })).toThrow(RangeError));
  it.each([
    ["third", "two-thirds"], ["third", "third", "third"], ["half", "half", "full"],
  ])("accepts ordered complete bento rows %s", (...spans) => draw({ arrangement: "bento", items: data(spans.length).map((item, i) => ({ ...item, span: spans[i] as ItemData['span'] })) }));
  it.each([["two-thirds", "two-thirds", "third", "third"], ["constructor", "full"], ["toString", "full"], ["__proto__", "full"]])("refuses overflow or inherited span %s", (...spans) => expect(() => draw({ arrangement: "bento", items: data(spans.length).map((item, i) => ({ ...item, span: spans[i] as ItemData['span'] })) })).toThrow(RangeError));
  it.each([["third", "third", "third"], ["third", "two-thirds"]])("fills lone tablet thirds without changing desktop spans", (...spans) => {
    const { container } = draw({ arrangement: "bento", items: data(spans.length).map((item, i) => ({ ...item, span: spans[i] as ItemData["span"] })) });
    const nodes = container.querySelectorAll("li");
    const lone = spans.length === 3 ? nodes[2] : nodes[0];
    expect(lone).toHaveClass("tablet:col-span-12", "tablet-lg:col-span-4");
    expect([...nodes].map(node => node.textContent)).toEqual(data(spans.length).map(item => item.heading));
  });
  it("renders statement headings at text-h2 with a semantic h4", () => {
    draw({ emphasis: "statement", treatment: "rule", headingLevel: 4 });
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(3);
    expect(screen.getByText("Title 0")).toHaveClass("text-h2");
  });
  it.each(["icon", "eyebrow", "meta", "visual", "href", "featured", "span", "lane"])("rejects statement slot %s", (slot) => {
    const items = data(3); items[0] = { ...items[0]!, [slot]: slot === "featured" ? false : "value" };
    expect(() => draw({ emphasis: "statement", items })).toThrow(TypeError);
  });
  it("rejects statement plates and non-three columns", () => {
    expect(() => draw({ emphasis: "statement", treatment: "plate" })).toThrow(TypeError);
    expect(() => draw({ emphasis: "statement", columns: 2, items: data(4) })).toThrow(TypeError);
  });
  it("renders groups in stable authored membership order with named groups", () => {
    const { container } = draw({ arrangement: "rows", items: data(4), groups: [{ id: "b", label: "Second", items: ["item-2", "item-0"] }, { id: "a", label: "First", items: ["item-3", "item-1"] }] });
    expect(screen.getAllByRole("group").map((node) => node.textContent)).toEqual(["SecondTitle 2Title 0", "FirstTitle 3Title 1"]);
    expect(container.querySelector("[data-items]")).not.toHaveClass("tablet-lg:grid-cols-4");
  });
  it.each([
    [{ id: "a", label: "A", items: ["item-0"] }, { id: "b", label: "B", items: ["item-1", "item-2", "item-3"] }],
    [{ id: "a", label: "A", items: ["item-0", "item-1"] }, { id: "b", label: "B", items: ["item-1", "item-3"] }],
    [{ id: "a", label: "A", items: ["item-0", "item-1"] }, { id: "a", label: "B", items: ["item-2", "item-3"] }],
    [{ id: "a", label: " ", items: ["item-0", "item-1"] }, { id: "b", label: "B", items: ["item-2", "unknown"] }],
  ])("refuses malformed group partitions", (...groups) => expect(() => draw({ arrangement: "rows", items: data(4), groups })).toThrow());
  it("permits only one featured item in columns or bento", () => {
    expect(() => draw({ items: data(3).map((item) => ({ ...item, featured: true })) })).toThrow(TypeError);
    for (const arrangement of ["rows", "stacked"] as const) expect(() => draw({ arrangement, items: data(2).map((item) => ({ ...item, featured: false })) })).toThrow(TypeError);
    expect(() => draw({ items: [{ ...data(3)[0]!, featured: "yes" } as unknown as ItemData, ...data(3).slice(1)] })).toThrow(TypeError);
  });
  it("requires stable unique nonblank identifiers", () => {
    for (const ids of [["same", "same", "third"], [" ", "second", "third"]]) expect(() => draw({ items: data(3).map((item, i) => ({ ...item, id: ids[i]! })) })).toThrow(TypeError);
  });
  it("requires all or no links, at most six, with unique normalized destinations", () => {
    expect(() => draw({ items: data(3).map((item, i) => i === 0 ? { ...item, href: "/one" } : item) })).toThrow(TypeError);
    expect(() => draw({ arrangement: "rows", items: data(7).map((item, i) => ({ ...item, href: `/route-${i}` })) })).toThrow(RangeError);
    expect(() => draw({ items: data(3).map((item, i) => ({ ...item, href: ["/one/#a", "/one#b", "/other"][i] })) })).toThrow(TypeError);
  });
  it.each(["", " ", "//example.test", "javascript:alert(1)", "data:text/plain,value", "/path\\file", "https://name:pass@example.test", "https://example.test\n"])('refuses unsafe href %s', (href) => expect(() => draw({ items: data(3).map((item) => ({ ...item, href })) })).toThrow(TypeError));
  it("tabs once per linked item through RTL copy, then reaches the sentinel", async () => {
    const user = userEvent.setup();
    render(<div dir="rtl"><Items arrangement="columns" items={data(3).map((item, i) => ({ ...item, href: `/route-${i}`, badge: { label: "Beta", tone: "info" }, meta: "Actor", visual: <img src="/example.png" alt="Example" /> }))} /><button>After items</button></div>);
    for (const link of screen.getAllByRole("link")) { await user.tab(); expect(link).toHaveFocus(); }
    await user.tab(); expect(screen.getByRole("button", { name: "After items" })).toHaveFocus();
  });
  it("rejects groups outside rows and sparse item arrays", () => {
    expect(() => draw({ items: data(4), columns: 2, groups: [{ id: "a", label: "A", items: ["item-0", "item-1"] }, { id: "b", label: "B", items: ["item-2", "item-3"] }] })).toThrow(TypeError);
    const items = data(3); delete items[1]; expect(() => draw({ items })).toThrow(TypeError);
  });
  it.each(["columns", "rows"] as const)("refuses an explicit null %s column count", (arrangement) => {
    expect(() => draw({ arrangement, columns: null as unknown as 1, items: data(arrangement === "columns" ? 3 : 2) })).toThrow(RangeError);
  });
  it("refuses a null bento span rather than defaulting it", () => {
    expect(() => draw({ arrangement: "bento", items: data(2).map(item => ({ ...item, span: null as unknown as "half" })) })).toThrow(RangeError);
  });
  it.each([{ span: ["half"] }, { span: new String("half") }])("refuses coerced non-primitive spans", ({ span }) => {
    expect(() => draw({ arrangement: "bento", items: data(2).map(item => ({ ...item, span: span as unknown as "half" })) })).toThrow(RangeError);
  });
  it("refuses blank native group labels", () => {
    expect(() => draw({ arrangement: "rows", items: data(4), groups: [{ id: "a", label: <span />, items: ["item-0", "item-1"] }, { id: "b", label: "B", items: ["item-2", "item-3"] }] })).toThrow(TypeError);
  });
  it("treats explicit undefined optional axes as omission", () => draw({ columns: undefined, treatment: undefined, emphasis: undefined, groups: undefined, size: undefined }));
});


describe("canonical collection semantics", () => {
  it.each(["columns", "rows", "bento", "stacked"] as const)("renders %s as a reset list with one list item per entry", (arrangement) => {
    const count = arrangement === "columns" ? 3 : 2;
    draw({ arrangement, items: data(count) });
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("role", "list");
    expect(list).toHaveClass("m-0", "list-none", "p-0");
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(count);
    for (const entry of entries) {
      expect(entry.tagName).toBe("LI");
      expect(entry).toHaveClass("h-full", "min-w-0");
      expect(entry.parentElement).toBe(list);
      expect(entry.querySelector("[data-item]")).not.toBeNull();
    }
  });
  it("names each grouped list through a group rather than adding region landmarks", () => {
    draw({ arrangement: "rows", items: data(4), groups: [{ id: "a", label: "First", items: ["item-1", "item-0"] }, { id: "b", label: "Second", items: ["item-3", "item-2"] }] });
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    const groups = screen.getAllByRole("group");
    expect(groups.map(node => node.tagName)).toEqual(["DIV", "DIV"]);
    expect(screen.getByRole("group", { name: "First" })).toBe(groups[0]);
    expect(within(groups[0]!).getAllByRole("listitem").map(node => node.textContent)).toEqual(["Title 1", "Title 0"]);
    expect(screen.getAllByRole("list")).toHaveLength(2);
  });
});
