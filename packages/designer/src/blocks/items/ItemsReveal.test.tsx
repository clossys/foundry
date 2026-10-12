import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import userEvent from "@testing-library/user-event";
import { Items } from "./Items.js";
import type { ItemData, ItemsProps } from "./types.js";
import { assertItems } from "./policies.js";

const data = (count = 4): ItemData[] => Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, heading: `Question ${i}`, description: `Answer ${i}` }));
const draw = (props: Partial<ItemsProps> = {}) => render(<Items arrangement="rows" reveal="disclose" items={data()} {...props} />);
const assertRefused = (props: Partial<ItemsProps>) => expect(() => renderToStaticMarkup(<Items arrangement="rows" reveal="disclose" items={data()} {...props} />)).toThrow();

describe("Items disclosure", () => {
  it("starts every independent row collapsed with its answer retained and wired", () => {
    draw();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-expanded", "false");
      const panel = document.getElementById(button.getAttribute("aria-controls")!);
      expect(panel).not.toBeNull(); expect(panel).not.toBeVisible();
      expect(panel).toHaveClass("disclosure-panel-motion");
      expect(panel).toHaveAttribute("aria-labelledby", button.id);
      expect(button.closest("li")?.contains(panel)).toBe(true);
    }
    expect(screen.getByText("Answer 0")).not.toBeVisible();
  });
  it("opens with Enter and Space, independently, and closes without removing answers", async () => {
    const user = userEvent.setup(); draw();
    const [first, second] = screen.getAllByRole("button");
    first!.focus(); await user.keyboard("{Enter}");
    second!.focus(); await user.keyboard(" ");
    expect(first).toHaveAttribute("aria-expanded", "true"); expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Answer 0")).toBeVisible(); expect(screen.getByText("Answer 1")).toBeVisible();
    expect(first!.querySelector(".disclosure-icon-motion")).toHaveClass("rotate-180", "disclosure-icon-motion");
    first!.focus(); await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Answer 0")).toBeInTheDocument(); expect(screen.getByText("Answer 0")).not.toBeVisible();
    expect(second).toHaveAttribute("aria-expanded", "true");
  });
  it("gives duplicate instances unique ids and keeps every controls reference local", () => {
    const { container } = render(<><Items arrangement="rows" reveal="disclose" items={data()} /><Items arrangement="rows" reveal="disclose" items={data()} /></>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const trigger of container.querySelectorAll("[aria-controls]")) {
      const panels = container.querySelectorAll(`[id="${trigger.getAttribute("aria-controls")}"]`);
      expect(panels).toHaveLength(1); expect(trigger.closest("li")?.contains(panels[0]!)).toBe(true);
      expect(panels[0]!.closest("[data-items]")).toBe(trigger.closest("[data-items]"));
      expect(panels[0]).toHaveAttribute("aria-labelledby", trigger.id);
    }
  });
  it("preserves heading semantics while keeping trigger content phrasing-only", () => {
    const { container } = draw({ headingLevel: 4 });
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
    for (const trigger of container.querySelectorAll("button")) {
      expect(trigger.parentElement?.tagName).toBe("H4");
      expect(trigger.querySelector("h3, h4, article, div, p, a, button, input, details")).toBeNull();
    }
  });
  it("defaults to h3 and keeps icon, eyebrow, badge and meta alongside the heading", () => {
    draw({ items: data().map((item, i) => i === 0 ? { ...item, icon: <svg aria-hidden="true"><path /></svg>, eyebrow: "Reference", meta: "Updated", badge: { label: "Beta", tone: "info" } } : item) });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    const trigger = screen.getByRole("button", { name: /Reference.*Beta.*Updated.*Question 0/ });
    expect(trigger.querySelectorAll("svg")).toHaveLength(2);
    expect(trigger.querySelector(".disclosure-icon-motion")).not.toHaveClass("rotate-180");
    expect(trigger.querySelector(".bg-surface-base")).not.toBeNull();
  });
  it.each([4, 5, 6])("accepts %s rows", count => draw({ items: data(count) }));
  it.each([2, 3, 7, 8])("refuses %s disclosed rows", count => assertRefused({ items: data(count) }));
  it.each(["columns", "bento", "stacked"] as const)("refuses disclosure in %s", arrangement => assertRefused({ arrangement }));
  it("permits numbered disclosure and labelled groups without constraining each group to four rows", () => {
    const { container } = draw({ order: "numbered", groups: [{ id: "first", label: "First", items: ["item-2", "item-0"] }, { id: "second", label: "Second", items: ["item-3", "item-1"] }] });
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Question 2", "Question 0", "Question 3", "Question 1"]);
    expect([...container.querySelectorAll("[data-item-ordinal]")].map(node => node.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Question 2", "Question 0", "Question 3", "Question 1"]);
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(container.querySelectorAll("ol")).toHaveLength(2);
    expect(container.querySelectorAll("ol")[1]).toHaveAttribute("start", "3");
  });
  it("refuses a missing or blank description, href, visual and supplied trigger controls", () => {
    for (const patch of [{ description: undefined }, { description: " " }, { description: <span /> }, { href: "/next" }, { visual: <span>Panel</span> }, { heading: <button>Control</button> }, { icon: <input /> }, { meta: <span tabIndex={0}>Control</span> }, { badge: { label: <button>Control</button> } }]) assertRefused({ items: data().map((item, i) => i === 0 ? { ...item, ...patch } : item) });
  });
  it("refuses authored native flow elements only in trigger-owned slots", () => {
    for (const patch of [{ heading: <div>Block heading</div> }, { icon: <p>Block icon</p> }, { eyebrow: <span><section>Block eyebrow</section></span> }, { meta: <h4>Block meta</h4> }, { badge: { label: <ul><li>Block badge</li></ul> } }]) assertRefused({ items: data().map((item, i) => i === 0 ? { ...item, ...patch } : item) });
  });
  it("refuses recursively supplied links, editable content and negative tab indexes in trigger slots", () => {
    for (const content of [<span><a href="/reference">Nested link</a></span>, <span tabIndex={-1}>Focusable</span>, <span contentEditable>Editable</span>, <span role="button">Control</span>, <span role="link">Link</span>]) {
      for (const slot of ["heading", "icon", "eyebrow", "meta"] as const) assertRefused({ items: data().map((item, i) => i === 0 ? { ...item, [slot]: content } : item) });
      assertRefused({ items: data().map((item, i) => i === 0 ? { ...item, badge: { label: content } } : item) });
    }
  });
  it("does not execute opaque components during disclosure validation", () => {
    let calls = 0;
    function Opaque() { calls++; return <button>Opaque output</button>; }
    expect(() => assertItems({ arrangement: "rows", reveal: "disclose", items: data().map((item, i) => i === 0 ? { ...item, heading: <Opaque /> } : item) })).not.toThrow();
    expect(calls).toBe(0);
  });
  it("normalizes native tag names and refuses unclassified native flow in a trigger", () => {
    for (const tag of ["search", "DIV", "BUTTON"]) expect(() => assertItems({ arrangement: "rows", reveal: "disclose", items: data().map((item, i) => i === 0 ? { ...item, heading: createElement(tag, null, "Native flow") } : item) })).toThrow();
  });
  it("keeps authored answer links outside the trigger and reachable when open", async () => {
    const user = userEvent.setup();
    draw({ items: data().map((item, i) => i === 0 ? { ...item, description: <a href="/reference">Reference</a> } : item) });
    const trigger = screen.getByRole("button", { name: "Question 0" });
    expect(trigger.querySelector("a")).toBeNull();
    await user.click(trigger);
    const link = screen.getByRole("link", { name: "Reference" });
    expect(link).toBeVisible();
    trigger.focus(); await user.tab(); expect(link).toHaveFocus();
    await user.tab(); expect(screen.getByRole("button", { name: "Question 1" })).toHaveFocus();
  });
  it("defaults to all and refuses unknown reveal axes or connected disclosure", () => {
    const { container } = render(<Items arrangement="rows" items={data()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("[data-item]")).toHaveLength(4);
    for (const value of [null, "tabs", "carousel"]) assertRefused({ reveal: value as ItemsProps["reveal"] });
    assertRefused({ order: "connected" });
  });
});
