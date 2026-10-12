import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { Items } from "./Items.js";
import type { ItemData, ItemsProps } from "./types.js";

const data = (count: number): ItemData[] => Array.from({ length: count }, (_, i) => ({ id: `step-${i}`, heading: `Step ${i + 1}`, description: `Support ${i + 1}` }));
const lanes = [{ id: "team", label: "Team" }, { id: "review", label: "Review" }] as const;
const laneData = (sequence: string) => [...sequence].map((lane, i) => ({ ...data(sequence.length)[i]!, lane: lane === "a" ? "team" : "review" }));
const draw = (props: Partial<ItemsProps>) => render(<Items arrangement="columns" items={data(3)} {...props} />);
const assertRefused = (props: Partial<ItemsProps>) => expect(() => renderToStaticMarkup(<Items arrangement="columns" items={data(3)} {...props} />)).toThrow();

describe("Items order", () => {
  it("numbers an ordered list in item reading order without changing the body heading", () => {
    const { container } = draw({ order: "numbered", headingLevel: 4 });
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect([...container.querySelectorAll("[data-item-ordinal]")].map(node => node.textContent)).toEqual(["1", "2", "3"]);
    expect(screen.getAllByRole("heading", { level: 4 }).map(node => node.textContent)).toEqual(["Step 1", "Step 2", "Step 3"]);
    expect(container.querySelector("[data-item-end]")).toBeNull();
  });
  it.each([3, 4, 5])("accepts %s connected steps and ends beyond the last step", (count) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = draw({ order: "connected", items: data(count) });
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(container.querySelectorAll("li")).toHaveLength(count);
    expect(container.querySelector("li:last-child [data-item-end]")).toHaveAttribute("data-item-end", "ends");
    expect(container.querySelectorAll("[data-item-end]")).toHaveLength(1);
    for (const end of container.querySelectorAll("[data-item-end]")) {
      expect(end.closest("[data-item-ordinal]")).toBeNull();
      expect(end).toHaveAttribute("aria-hidden", "true");
    }
    if (count === 4) expect(warn).toHaveBeenCalledWith(expect.stringMatching(/three or five/));
    else expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it.each([2, 6])("refuses %s connected steps", count => assertRefused({ order: "connected", items: data(count) }));
  it.each(["rows", "bento"] as const)("refuses connected %s", arrangement => assertRefused({ arrangement, order: "connected", items: data(4) }));
  it.each([3, 4, 5])("accepts a connected stacked sequence of %s", count => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    draw({ arrangement: "stacked", order: "connected", items: data(count) });
    if (count === 4) expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it.each([[2, 3], [2, 4], [2, 5], [3, 3], [3, 4], [3, 5]] as const)("honors %s columns with %s connected steps", (columns, count) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = draw({ order: "connected", columns, items: data(count) });
    expect(container.querySelector("[data-items]")).toHaveAttribute("data-columns", String(columns));
    expect(container.querySelector("[data-items]")).toHaveClass("tablet:grid-cols-2");
    if (columns === 3) expect(container.querySelector("[data-items]")).toHaveClass("tablet-lg:grid-cols-3");
    else expect(container.querySelector("[data-items]")).not.toHaveClass("tablet-lg:grid-cols-3");
    expect(container.querySelectorAll("li")).toHaveLength(count);
    expect(container.querySelectorAll("[data-item-end]")).toHaveLength(1);
    warn.mockRestore();
  });
  it.each(["lanes", "end", "endLabel", "caption"])("refuses %s outside connected order", field => assertRefused({ [field]: field === "lanes" ? lanes : field === "end" ? "ends" : "Value" }));
  it("permits an unlabelled continuing terminal as decoration without fallback copy", () => {
    const { container } = draw({ order: "connected", end: "continues" });
    expect(container.querySelector("[data-item-end]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-item-end] svg")).not.toBeNull();
    expect(container.querySelector("[data-item-end-label]")).toBeNull();
  });
  it.each([undefined, null, false, "", " ", <span />])("omits a non-content end label without synthesizing copy", endLabel => {
    const { container } = draw({ order: "connected", end: "continues", endLabel });
    expect(container.querySelector("[data-item-end-label]")).toBeNull();
    expect(container.querySelector("[data-item-end]")).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toBe(data(3).map(item => `${item.heading}${item.description}`).map((text, i) => `${i + 1}${text}`).join(""));
  });
  it("renders authored end copy once after the last item body and caption outside the list", () => {
    const { container } = draw({ order: "connected", endLabel: "Complete", caption: "Example sequence", items: data(3).map((item, i) => i === 1 ? { ...item, visual: <span>Panel</span> } : item) });
    expect(container.querySelectorAll("[data-item-end-label]")).toHaveLength(1);
    const label = container.querySelector("[data-item-end-label]")!;
    expect(label).toHaveTextContent("Complete");
    expect(label.closest("[data-item]")).toBeNull();
    expect(label.closest("li")).toBe(container.querySelector("li:last-child"));
    const caption = container.querySelector("[data-item-caption]")!;
    expect(caption.previousElementSibling?.tagName).toBe("OL");
    expect(caption.closest("ol")).toBeNull();
    assertRefused({ order: "connected", caption: "Example" });
  });
  it.each(["aba", "abbaa"])("uses array lane ids for %s without reordering steps", sequence => {
    const { container } = draw({ arrangement: "stacked", order: "connected", lanes, items: laneData(sequence) });
    expect([...container.querySelectorAll("li")].map(node => node.getAttribute("data-lane"))).toEqual([...sequence].map(lane => lane === "a" ? "team" : "review"));
    expect([...container.querySelectorAll("[data-item-lane-label]")].map(node => node.textContent)).toEqual([...sequence].map(lane => lane === "a" ? "Team" : "Review"));
    expect([...container.querySelectorAll("[data-item-heading]")].map(node => node.textContent)).toEqual(data(sequence.length).map(item => item.heading));
  });
  it("accepts visuals in five lane steps", () => draw({ arrangement: "stacked", order: "connected", lanes, items: laneData("abbaa").map(item => ({ ...item, visual: <span>Panel</span> })) }));
  it("refuses unknown, absent, first-second or unused lane ids", () => {
    for (const sequence of ["baa", "aaa"]) assertRefused({ arrangement: "stacked", order: "connected", lanes, items: laneData(sequence) });
    assertRefused({ arrangement: "stacked", order: "connected", lanes, items: data(3) });
    assertRefused({ arrangement: "stacked", order: "connected", lanes, items: laneData("aba").map((item, i) => i === 1 ? { ...item, lane: "unknown" } : item) });
    assertRefused({ order: "connected", lanes, items: laneData("aba") });
    assertRefused({ arrangement: "stacked", order: "connected", lanes, items: laneData("abba") });
    assertRefused({ arrangement: "stacked", order: "connected", items: laneData("aba") });
    assertRefused({ items: laneData("aba") });
  });
  it("refuses malformed lane definitions and closed-axis runtime violations", () => {
    for (const value of [[], [lanes[0]], [...lanes, { id: "extra", label: "Extra" }], [null, lanes[1]], [undefined, lanes[1]], Array(2), [{ id: "", label: "Team" }, lanes[1]], [{ id: " ", label: "Team" }, lanes[1]], [{ id: 7, label: "Team" }, lanes[1]], [{ id: "team", label: "Team" }, { id: "team", label: "Review" }], [{ id: "team", label: " " }, lanes[1]], [{ id: "team", label: <span /> }, lanes[1]], { a: "Team", b: "Review" }]) assertRefused({ arrangement: "stacked", order: "connected", lanes: value as unknown as ItemsProps["lanes"], items: laneData("aba") });
    for (const value of [null, "unknown"]) {
      assertRefused({ order: value as ItemsProps["order"] });
      assertRefused({ order: "connected", end: value as ItemsProps["end"] });
    }
  });
  it("uses opaque lane ids as map keys without inherited-name collisions", () => {
    const special = [{ id: "constructor", label: "First" }, { id: "__proto__", label: "Second" }];
    const { container } = draw({ arrangement: "stacked", order: "connected", lanes: special, items: data(3).map((item, i) => ({ ...item, lane: special[i === 1 ? 1 : 0]!.id })) });
    expect([...container.querySelectorAll("[data-item-lane-label]")].map(node => node.textContent)).toEqual(["First", "Second", "First"]);
  });
  it("keeps every track and label outside a linked body's hit context and tabs in source order", async () => {
    const user = userEvent.setup();
    const { container } = render(<div dir="rtl"><Items arrangement="stacked" order="connected" lanes={lanes} endLabel="Complete" items={laneData("aba").map(item => ({ ...item, href: `/step/${item.id}` }))} /><button>After</button></div>);
    for (const li of container.querySelectorAll("li")) {
      const hit = li.querySelector("a")!.closest(".isolate")!;
      expect(hit).not.toBe(li); expect(li).not.toHaveClass("isolate");
      for (const decoration of li.querySelectorAll("[data-item-ordinal], [data-item-connector], [data-item-join], [data-item-end], [data-item-lane-label], [data-item-end-label]")) expect(hit.contains(decoration)).toBe(false);
    }
    for (const link of screen.getAllByRole("link")) { await user.tab(); expect(link).toHaveFocus(); }
    await user.tab(); expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });
});
