import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Item } from "./Item.js";
import { Items } from "./Items.js";
import { Items as ServerItems } from "./Items.server.js";
import type { ItemData, ItemProps, ItemsProps } from "./types.js";

const single = { id: "one", heading: "Requests", treatment: "plain", size: "standard", ground: "base" } as const;
const data = (count = 3): ItemData[] => Array.from({ length: count }, (_, index) => ({
  id: `metric-${index}`, heading: `Metric ${index}`, figure: { value: `${index + 1},200`, delta: "+12%", trend: "up" },
}));
const attempt = (props: Partial<ItemsProps>) => renderToStaticMarkup(<ServerItems arrangement="columns" items={data()} {...props} />);

describe("Item figure", () => {
  it.each([["up", "+12%", "text-status-success-text"], ["down", "-3%", "text-status-danger-text"], ["neutral", "0%", "text-ink-secondary"]] as const)("renders value then signed delta with the trend classes (%s)", (trend, delta, cls) => {
    const { container } = render(<Item {...single} figure={{ value: "2,481", delta, trend }} />);
    const figure = container.querySelector("[data-item-figure]")!;
    const value = screen.getByText("2,481");
    const change = screen.getByText(delta);
    expect(figure).toContainElement(value);
    expect(figure).toContainElement(change);
    expect(value).toHaveClass("text-h2", "font-display", "tabular-nums");
    expect(change).toHaveClass(cls, "text-body-s", "font-body");
    expect(value.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(change).toHaveTextContent(delta);
  });

  it("uses the display figure scale without changing the heading scale", () => {
    render(<Item {...single} size="display" figure={{ value: "2,481" }} />);
    expect(screen.getByText("2,481")).toHaveClass("text-h1", "font-display", "tabular-nums");
    expect(screen.getByText("Requests")).toHaveClass("text-h3");
  });

  it("keeps authored zero and defaults the delta to neutral", () => {
    const { container } = render(<Item {...single} figure={{ value: 0, delta: 0 }} />);
    expect(container.querySelector("[data-item-figure]")).toHaveTextContent("00");
    expect(container.querySelector("[data-item-delta]")).toHaveClass("text-ink-secondary");
  });

  it.each(["base", "sunken", "inverse"] as const)("keeps the down delta on its checked backing on %s", ground => {
    const { container } = render(<Item {...single} ground={ground} figure={{ value: 12, delta: "-3", trend: "down" }} />);
    const delta = container.querySelector("[data-item-delta]");
    expect(delta).toHaveClass("text-status-danger-text");
    if (ground === "inverse") expect(delta).toHaveClass("bg-surface-raised");
    else expect(delta).not.toHaveClass("bg-surface-raised");
  });

  it("throws when only some items carry a figure or a figure meets a visual", () => {
    const partial = data(); delete partial[1]!.figure;
    expect(() => attempt({ items: partial })).toThrow(/every.*figure|all.*figure/i);
    expect(() => renderToStaticMarkup(<Item {...single} figure={{ value: 12 }} visual={<svg />} />)).toThrow(/figure.*visual/i);
    expect(() => attempt({ items: data().map(item => ({ ...item, visual: <svg /> })) })).toThrow(/figure.*visual/i);
  });

  it.each(["columns", "rows", "stacked"] as const)("supports figures in %s without changing source order", arrangement => {
    const html = attempt({ arrangement });
    const root = document.createElement("div"); root.innerHTML = html;
    expect(root.querySelectorAll("[data-item-figure]")).toHaveLength(3);
    expect([...root.querySelectorAll("[data-item-heading]")].map(node => node.textContent)).toEqual(["Metric 0", "Metric 1", "Metric 2"]);
  });

  it.each([["client", Items], ["server", ServerItems]] as const)("supports connected figures through the %s entry", (_entry, Component) => {
    const html = renderToStaticMarkup(<Component arrangement="columns" order="connected" items={data()} />);
    expect(html.match(/data-item-figure=/g)).toHaveLength(3);
    expect(html).toContain("data-item-ordinal");
  });

  it.each([{ arrangement: "bento", items: data(2) }, { scale: "statement" }, { arrangement: "rows", reveal: "disclose", items: data(4).map(item => ({ ...item, description: "Details" })) }] as Partial<ItemsProps>[])("refuses an incompatible collection axis %j", props => {
    expect(() => attempt(props)).toThrow(/figure/i);
  });

  it.each([{ value: 1, trend: "up" }, { value: 1, delta: " ", trend: "down" }, { value: " " }, { value: 1, delta: "+1", trend: "sideways" }, null])("rejects incomplete figure data %j", figure => {
    expect(() => renderToStaticMarkup(<Item {...({ ...single, figure } as unknown as ItemProps)} />)).toThrow(/figure/i);
  });

  it.each(["value", "delta"] as const)("rejects nested controls in linked figure %s", slot => {
    const figure = { value: 1, delta: "+1", [slot]: <button>Other</button> };
    expect(() => renderToStaticMarkup(<Item {...single} href="/metric" figure={figure} />)).toThrow(/interactive/i);
  });

  it("keeps figure slots outside the only linked title", () => {
    render(<Item {...single} href="/metric" figure={{ value: "2,481", delta: "+12%", trend: "up" }} />);
    const anchor = screen.getByRole("link", { name: "Requests" });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(anchor).not.toContainElement(screen.getByText("2,481"));
    expect(anchor).not.toContainElement(screen.getByText("+12%"));
  });
});
