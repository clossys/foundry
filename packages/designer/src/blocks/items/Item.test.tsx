import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Item } from "./Item.js";
import type { ItemProps } from "./types.js";

const base = { id: "one", heading: "Title", treatment: "plain" as const, size: "standard" as const, ground: "base" as const };

describe("Item", () => {
  it.each(["standard", "display"] as const)("uses the %s heading scale", (size) => {
    render(<Item {...base} size={size} icon={<svg />} />);
    expect(screen.getByText("Title")).toHaveClass(size === "standard" ? "text-body-l" : "text-h3");
    if (size === "standard") expect(screen.getByText("Title")).toHaveClass("font-semibold");
    expect(document.querySelector('[aria-hidden="true"]')).toHaveClass("text-ink-secondary");
  });
  it.each(["base", "sunken", "inverse"] as const)("uses a hairline on %s", (ground) => {
    const { container } = render(<Item {...base} ground={ground} treatment="rule" />);
    expect(container.querySelector("[data-item]")).toHaveStyle({ borderBlockStartWidth: "var(--ui-border-hairline, 1px)" });
    expect(container.innerHTML).not.toContain("--ui-border-rule");
  });
  it.each(["plain", "rule", "plate"] as const)("keeps eyebrow, badge and meta together in %s", (treatment) => {
    const { container } = render(<Item {...base} treatment={treatment} eyebrow="Area" meta="Actor" badge={{ label: "Beta" }} />);
    const row = container.querySelector("[data-item-meta]");
    expect(row).toHaveTextContent("AreaBetaActor");
    expect(screen.getByText("Beta")).toHaveClass("rounded-pill", "bg-surface-sunken", "text-ink-secondary");
  });
  it.each([
    ["neutral", "bg-surface-sunken"], ["success", "bg-status-success-tint"], ["warning", "bg-status-warning-tint"],
    ["danger", "bg-status-danger-tint"], ["info", "bg-status-info-tint"],
  ] as const)("maps badge tone %s to the existing component", (tone, cls) => {
    render(<Item {...base} badge={{ label: "State", tone }} />);
    expect(screen.getByText("State")).toHaveClass(cls);
  });
  it.each(["success", "warning", "danger", "info"] as const)("backs status badge %s with the checked opaque surface", (tone) => {
    const { container } = render(<Item {...base} ground="inverse" treatment="plate" href="/one" meta={0} badge={{ label: 0, tone }} />);
    const row = container.querySelector("[data-item-meta]")!;
    const badge = row.querySelector(`.bg-status-${tone}-tint`)!;
    expect(badge).toHaveTextContent("0");
    expect(badge.parentElement).toHaveClass("inline-flex", "rounded-pill", "bg-surface-base");
    expect(row).toHaveTextContent("00");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Title" })).not.toContainElement(badge);
    expect(badge.parentElement!.querySelector("a,button,input,[tabindex]")).toBeNull();
  });
  it.each([undefined, "neutral"] as const)("keeps the already opaque neutral badge directly in its meta row (%s)", (tone) => {
    const { container } = render(<Item {...base} ground="inverse" badge={{ label: "Neutral", tone }} />);
    expect(screen.getByText("Neutral").parentElement).toBe(container.querySelector("[data-item-meta]"));
  });
  it.each([true, false])("refuses retired featured=%s on standalone items", featured => {
    expect(() => render(<Item {...({ ...base, featured } as unknown as ItemProps)} />)).toThrow(/featured.*retired/);
  });
  it.each(["plain", "rule"] as const)("keeps heading-only linked %s items at the tap-target minimum", (treatment) => {
    const { container } = render(<Item {...base} href="/one" treatment={treatment} />);
    expect(container.querySelector("[data-item]")).toHaveStyle({ minBlockSize: "var(--ui-layout-tap-target, 44px)" });
  });
  it("keeps a transparent hairline edge on linked plates", () => {
    const { container } = render(<Item {...base} href="/one" treatment="plate" />);
    const plate = container.querySelector("[data-item]");
    expect(plate).toHaveClass("border", "border-transparent");
    expect(plate).not.toHaveClass("border-accent", "border-t-accent");
    expect(plate).toHaveStyle({ borderWidth: "var(--ui-border-hairline, 1px)" });
  });
  it("names its only link from the title and leaves other slots outside it", () => {
    render(<Item {...base} size="display" href="/one" description="Support" meta="Actor" visual={<div>Visual</div>} badge={{ label: "Beta" }} />);
    const anchor = screen.getByRole("link", { name: "Title" });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(anchor).toHaveAttribute("href", "/one");
    expect(anchor.parentElement).toHaveClass("transform-none");
    for (const label of ["Support", "Actor", "Visual", "Beta"]) expect(anchor).not.toContainElement(screen.getByText(label));
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
  it("keeps the default paragraph", () => { render(<Item {...base} />); expect(screen.getByText("Title").tagName).toBe("P"); });
  it.each([3, 4] as const)("accepts explicit h%s without changing its visual scale", (headingLevel) => {
    render(<Item {...base} {...{ headingLevel }} />);
    expect(screen.getByRole("heading", { level: headingLevel })).toHaveClass("text-body-l");
  });
  it.each([null, 2, 5, "3"])("refuses unsupported heading level %s", (headingLevel) => {
    expect(() => render(<Item {...({ ...base, headingLevel } as unknown as ItemProps)} />)).toThrow(RangeError);
  });
});
