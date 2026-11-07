import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { Items } from "./Items.server.js";

const items = Array.from({ length: 4 }, (_, i) => ({ id: `item-${i}`, heading: `Question ${i}`, description: `Answer ${i}` }));
const groups = [{ id: "first", label: "First", items: ["item-2", "item-0"] }, { id: "second", label: "Second", items: ["item-3", "item-1"] }];

const answerOf = (trigger: Element) => document.getElementById(trigger.getAttribute("aria-controls")!)!;

describe("server Items disclosure (stock accordion)", () => {
  it("keeps every answer reachable behind an independent collapsed trigger at the authored heading level", async () => {
    const user = userEvent.setup();
    const { container } = render(<Items arrangement="rows" reveal="disclose" treatment="rule" headingLevel={4} items={items} />);
    const triggers = items.map(item => screen.getByRole("button", { name: item.heading }));
    expect(screen.getAllByRole("heading", { level: 4 }).map(heading => heading.textContent)).toEqual(items.map(item => item.heading));
    for (const [i, trigger] of triggers.entries()) {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger.closest("h4")).not.toBeNull();
      for (const chevron of trigger.querySelectorAll("svg")) expect(chevron).toHaveAttribute("aria-hidden", "true");
      expect(answerOf(trigger)).toHaveTextContent(`Answer ${i}`);
      expect((trigger.closest('[data-slot="accordion-item"]') as HTMLElement).style.borderTopWidth).toContain("var(--ui-border-hairline");
    }
    await user.click(triggers[0]!); await user.click(triggers[1]!);
    expect(triggers.map(trigger => trigger.getAttribute("aria-expanded"))).toEqual(["true", "true", "false", "false"]);
    expect(container.querySelectorAll("li")).toHaveLength(4);
  });
  it("defaults each question to an h3", () => {
    render(<Items arrangement="rows" reveal="disclose" items={items} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    for (const heading of screen.getAllByRole("heading", { level: 3 })) expect(heading.querySelector("button")).not.toBeNull();
  });
  it("permits an authored answer control outside the trigger and keeps the trigger phrasing-only", () => {
    render(<Items arrangement="rows" reveal="disclose" items={items.map((item, i) => i === 0 ? { ...item, description: <a href="/reference">Reference</a> } : item)} />);
    const trigger = screen.getByRole("button", { name: "Question 0" });
    expect(trigger.querySelector("a, article, p, div")).toBeNull();
    expect(answerOf(trigger).querySelector("a")).toHaveTextContent("Reference");
  });
  it("keeps group IDs unique across duplicate instances and numbers rendered membership order", () => {
    const { container } = render(<><Items arrangement="rows" reveal="disclose" order="numbered" items={items} groups={groups} /><Items arrangement="rows" reveal="disclose" order="numbered" items={items} groups={groups} /></>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(ids.length).toBeGreaterThanOrEqual(groups.length * 2); expect(new Set(ids).size).toBe(ids.length);
    for (const node of container.querySelectorAll("[aria-labelledby]")) expect(container.querySelector(`[id="${node.getAttribute("aria-labelledby")}"]`)).not.toBeNull();
    expect(container.querySelectorAll('[role=group][aria-labelledby]:not([data-slot="accordion-content"])')).toHaveLength(groups.length * 2);
    for (const group of container.querySelectorAll('[role=group][aria-labelledby]:not([data-slot="accordion-content"])')) expect(group.contains(container.querySelector(`[id="${group.getAttribute("aria-labelledby")}"]`))).toBe(true);
    expect([...container.querySelectorAll("[data-item-ordinal]")].map(node => node.textContent)).toEqual(["1", "2", "3", "4", "1", "2", "3", "4"]);
  });
  it("keeps every answer in the server HTML behind a collapsed trigger", () => {
    const html = renderToStaticMarkup(<Items arrangement="rows" reveal="disclose" items={items} />);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(html.match(/<h3\b/g)).toHaveLength(4);
    for (const item of items) expect(html).toContain(item.description);
  });
});
