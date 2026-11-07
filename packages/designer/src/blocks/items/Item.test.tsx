import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StockItem as Item, type StockItemProps } from "./StockItem.js";

const base = { id: "one", heading: "Title", ground: "base" as const };

// Behaviour on the stock Item anatomy (R2F-26b): the Foundry Item block, its treatments, sizes and
// title-only hit area are retired; stock owns the look, so these assert slots, links and refusals.
describe("Item", () => {
  it("renders the stock Item anatomy with an aria-hidden icon in the ground's secondary ink", () => {
    const { container } = render(<Item {...base} icon={<svg />} description="Support" />);
    expect(container.querySelector("[data-item]")).toHaveAttribute("data-slot", "item");
    expect(screen.getByText("Title")).toHaveAttribute("data-slot", "item-title");
    expect(screen.getByText("Support")).toHaveAttribute("data-slot", "item-description");
    const media = container.querySelector('[data-slot="item-media"]')!;
    expect(media).toHaveAttribute("aria-hidden", "true");
    expect(media).toHaveClass("text-ink-secondary");
  });
  it("keeps eyebrow, badge and meta together in the stock header", () => {
    const { container } = render(<Item {...base} eyebrow="Area" meta="Actor" badge={{ label: "Beta" }} />);
    const row = container.querySelector("[data-item-meta]");
    expect(row).toHaveAttribute("data-slot", "item-header");
    expect(row).toHaveTextContent("AreaBetaActor");
  });
  it.each(["neutral", "success", "warning", "danger", "info"] as const)("renders badge tone %s through the stock badge", (tone) => {
    const { container } = render(<Item {...base} badge={{ label: "State", tone }} />);
    const row = container.querySelector("[data-item-meta]")!;
    expect(row).toContainElement(screen.getByText("State"));
    if (tone === "neutral") expect(screen.getByText("State").parentElement).toBe(row);
    else expect(screen.getByText("State").parentElement).toHaveClass("inline-flex", "rounded-pill", "bg-surface-base");
  });
  it.each(["success", "warning", "danger", "info"] as const)("backs status badge %s with the checked opaque surface inside the single link", (tone) => {
    const { container } = render(<Item {...base} ground="inverse" href="/one" meta={0} badge={{ label: 0, tone }} />);
    const row = container.querySelector("[data-item-meta]")!;
    const backing = row.querySelector(".bg-surface-base")!;
    expect(backing).toHaveTextContent("0");
    expect(backing).toHaveClass("inline-flex", "rounded-pill");
    expect(row).toHaveTextContent("00");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(backing.querySelector("a,button,input,[tabindex]")).toBeNull();
  });
  it.each([undefined, "neutral"] as const)("keeps the already opaque neutral badge directly in its meta row (%s)", (tone) => {
    const { container } = render(<Item {...base} ground="inverse" badge={{ label: "Neutral", tone }} />);
    expect(screen.getByText("Neutral").parentElement).toBe(container.querySelector("[data-item-meta]"));
  });
  it.each([true, false])("refuses retired featured=%s on standalone items", featured => {
    expect(() => render(<Item {...({ ...base, featured } as unknown as StockItemProps)} />)).toThrow(/featured.*retired/);
  });
  it("renders a linked item as the stock Item's only link around every slot", () => {
    const { container } = render(<Item {...base} href="/one" description="Support" meta="Actor" visual={<div>Visual</div>} badge={{ label: "Beta" }} />);
    const anchor = screen.getByRole("link");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(anchor).toBe(container.querySelector("[data-item]"));
    expect(anchor).toHaveAttribute("href", "/one");
    expect(anchor).toHaveAttribute("data-slot", "item");
    for (const label of ["Title", "Support", "Actor", "Visual", "Beta"]) expect(anchor).toContainElement(screen.getByText(label));
  });
  it.each(["heading", "description", "eyebrow", "icon", "meta", "visual", "badge"])("rejects nested controls in %s", (slot) => {
    const node = <><span><button>Other</button></span></>;
    const props = slot === "badge" ? { badge: { label: node } } : { [slot]: node };
    expect(() => render(<Item {...base} href="/one" {...props} />)).toThrow(TypeError);
  });
  it.each([<div tabIndex={0}>Focusable</div>, <div tabIndex={-1}>Focusable</div>, <div {...({ tabIndex: "-1" } as unknown as { tabIndex: number })}>Focusable</div>, <div {...({ tabIndex: "0" } as unknown as { tabIndex: number })}>Focusable</div>, <div contentEditable suppressContentEditableWarning>Edit</div>, <div contentEditable="" suppressContentEditableWarning>Edit</div>, <div {...({ contentEditable: "TRUE" } as unknown as { contentEditable: true })} suppressContentEditableWarning>Edit</div>, <div {...({ contentEditable: "Plaintext-Only" } as unknown as { contentEditable: true })} suppressContentEditableWarning>Edit</div>, <audio controls />, <video controls />, <object />, <embed />])("rejects a native focus/control target", (visual) => {
    expect(() => render(<Item {...base} href="/one" visual={visual} />)).toThrow(TypeError);
  });
  it("permits inert native slots and preserves labelled visuals", () => {
    render(<Item {...base} href="/one" visual={<div contentEditable={false}><video aria-label="Preview" /><img src="/example.png" alt="Example visual" /></div>} />);
    expect(screen.getByRole("img", { name: "Example visual" })).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("refuses a blank native badge label", () => {
    expect(() => render(<Item {...base} badge={{ label: <span /> }} />)).toThrow(TypeError);
  });
  it("keeps zero in every authored slot", () => {
    const { container } = render(<Item {...base} heading={0} eyebrow={0} icon={0} description={0} meta={0} visual={0} badge={{ label: 0 }} />);
    expect(container.querySelector("[data-item]")?.textContent).toBe("0000000");
    expect(container.querySelector("[data-item-visual]")).toHaveTextContent("0");
  });
  it("keeps authored zero and omits optional whitespace", () => {
    const { container } = render(<Item {...base} heading={0} description={0} meta={0} eyebrow="  " badge={{ label: 0 }} />);
    expect(container.querySelector("[data-item-heading]")).toHaveTextContent("0");
    expect(container.querySelector("[data-item-description]")).toHaveTextContent("0");
    expect(container.querySelector("[data-item-meta]")).toHaveTextContent("00");
    expect(container.querySelector("[data-item-eyebrow]")).toBeNull();
  });
  it.each(["", "   ", null, false, <span />, <><span> </span></>])("refuses blank headings", (heading) => {
    expect(() => render(<Item {...base} heading={heading} />)).toThrow(TypeError);
  });
});


describe("standalone Item heading outline", () => {
  it("keeps the stock title without a heading by default", () => { render(<Item {...base} />); expect(screen.queryByRole("heading")).toBeNull(); expect(screen.getByText("Title")).toHaveAttribute("data-slot", "item-title"); });
  it.each([3, 4] as const)("accepts explicit h%s inside the stock title", (headingLevel) => {
    render(<Item {...base} {...{ headingLevel }} />);
    expect(screen.getByRole("heading", { level: headingLevel }).parentElement).toHaveAttribute("data-slot", "item-title");
  });
  it.each([null, 2, 5, "3"])("refuses unsupported heading level %s", (headingLevel) => {
    expect(() => render(<Item {...({ ...base, headingLevel } as unknown as StockItemProps)} />)).toThrow(RangeError);
  });
});
