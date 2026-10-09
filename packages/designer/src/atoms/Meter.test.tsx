import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter } from "./Meter.js";

function part(markup: string, name: string): string {
  const match = markup.match(new RegExp(`<span data-part="${name}"[^>]*>`));
  return match?.[0] ?? "";
}

describe("Meter", () => {
  it("shows the value and limit as visible text and hides the bar from assistive tech", () => {
    const { container } = render(
      <Meter value={3.4} scaleMax={5} limit={3} tone="danger" valueText="3.4x" limitText="limit 3.0x" />,
    );
    expect(screen.getByText("3.4x")).toBeVisible();
    expect(screen.getByText("limit 3.0x")).toBeVisible();
    const bar = container.querySelector("[aria-hidden='true']");
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toBe("");
    expect(container.querySelector("meter")).toBeNull();
    expect(container.querySelector("[role='meter'], [role='progressbar']")).toBeNull();
  });

  it("fills from the inline start to the value's share of the scale", () => {
    const markup = renderToStaticMarkup(<Meter value={2} scaleMax={8} tone="success" valueText="25%" />);
    const fill = part(markup, "fill");
    expect(fill).toContain("inset-inline-start:0%");
    expect(fill).toContain("inline-size:25%");
    expect(fill).toContain("bg-status-success");
    expect(markup).not.toMatch(/\b(left|right):/);
  });

  it("clamps a value beyond the scale to a full bar", () => {
    const markup = renderToStaticMarkup(<Meter value={12} scaleMax={8} tone="warning" valueText="150%" />);
    expect(part(markup, "fill")).toContain("inline-size:100%");
  });

  it("shades the side after the limit for a cap", () => {
    const markup = renderToStaticMarkup(
      <Meter value={1} scaleMax={4} limit={3} direction="max" tone="success" valueText="1.0x" />,
    );
    const zone = part(markup, "zone");
    expect(zone).toContain("inset-inline-start:75%");
    expect(zone).toContain("inline-size:25%");
    expect(markup).toContain('data-direction="max"');
  });

  it("shades the side before the limit for a floor", () => {
    const markup = renderToStaticMarkup(
      <Meter value={2} scaleMax={4} limit={1.25} direction="min" tone="success" valueText="2.0x" />,
    );
    const zone = part(markup, "zone");
    expect(zone).toContain("inset-inline-start:0%");
    expect(zone).toContain("inline-size:31.25%");
    expect(markup).toContain('data-direction="min"');
  });

  it("draws the limit tick at the rule width, read from the token, kept inside the track", () => {
    const markup = renderToStaticMarkup(
      <Meter value={1} scaleMax={2} limit={2} tone="info" valueText="50%" />,
    );
    const tick = part(markup, "limit");
    expect(tick).toContain("inline-size:var(--ui-border-rule, 2px)");
    expect(tick).toContain("inset-inline-start:calc(100% - 1 * var(--ui-border-rule, 2px))");
  });

  it("draws no zone and no tick without a limit", () => {
    const markup = renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="neutral" valueText="1 of 2" />);
    expect(part(markup, "zone")).toBe("");
    expect(part(markup, "limit")).toBe("");
    expect(part(markup, "fill")).toContain("bg-ink-secondary");
  });

  it.each([
    ["scaleMax of zero", { value: 1, scaleMax: 0 }],
    ["negative scaleMax", { value: 1, scaleMax: -2 }],
    ["non-finite scaleMax", { value: 1, scaleMax: Number.POSITIVE_INFINITY }],
    ["negative value", { value: -1, scaleMax: 2 }],
    ["NaN value", { value: Number.NaN, scaleMax: 2 }],
    ["negative limit", { value: 1, scaleMax: 2, limit: -1 }],
    ["non-finite limit", { value: 1, scaleMax: 2, limit: Number.NaN }],
  ])("throws a RangeError for a %s", (_label, props) => {
    expect(() => renderToStaticMarkup(<Meter {...props} tone="info" valueText="x" />)).toThrow(RangeError);
  });

  it("fills in the brand accent for the accent tone", () => {
    const markup = renderToStaticMarkup(<Meter value={3} scaleMax={4} tone="accent" valueText="75%" />);
    expect(part(markup, "fill")).toContain("bg-accent");
  });

  it("sets the value as a large, light focal figure with emphasis figure, body-small by default", () => {
    const { unmount } = render(<Meter value={3} scaleMax={4} limit={2} tone="info" valueText="3.0x" limitText="limit 2.0x" />);
    expect(screen.getByText("3.0x").closest("[data-emphasis]")).toHaveAttribute("data-emphasis", "default");
    expect(screen.getByText("3.0x").parentElement).toHaveClass("text-body-s");
    unmount();
    render(<Meter value={3} scaleMax={4} limit={2} tone="info" emphasis="figure" valueText="3.0x" limitText="limit 2.0x" />);
    expect(screen.getByText("3.0x").closest("[data-emphasis]")).toHaveAttribute("data-emphasis", "figure");
    expect(screen.getByText("3.0x")).toHaveClass("text-h1", "@md:text-h0", "font-normal", "tabular-nums");
    expect(screen.getByText("limit 2.0x")).toHaveClass("text-body-s", "text-ink-secondary");
  });

  it("forwards className and other div attributes", () => {
    render(<Meter id="m" className="gap-sm" value={1} scaleMax={2} tone="info" valueText="50%" />);
    const root = document.getElementById("m");
    expect(root?.className).toContain("gap-sm");
    expect(root?.className).not.toContain("gap-xs");
  });
});
