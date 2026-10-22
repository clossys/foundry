import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter } from "./Meter.js";

function part(markup: string, name: string): string {
  return [...markup.matchAll(/<span\b[^>]*>/g)].find(match => match[0].includes(` data-part="${name}"`))?.[0] ?? "";
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
    // The root is the meter, named by the visible value text. The bar stays decoration.
    const meter = screen.getByRole("meter", { name: "3.4x" });
    expect(meter).toBe(container.firstElementChild);
    expect(meter).toHaveAttribute("role", "meter progressbar");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(meter).toHaveAttribute("aria-valuenow", "3.4");
    expect(meter).toHaveAttribute("aria-valuetext", "3.4x");
    expect(bar?.closest("[role]")).toBe(meter);
    expect(meter.querySelectorAll("[role]")).toHaveLength(0);
  });

  it("is react-aria-components' Meter: the root carries its data-rac marker and wiring", () => {
    const { container } = render(<Meter value={1} scaleMax={2} tone="info" valueText="50%" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-rac");
    // The value text is react-aria-components' Label, so it is what names the meter.
    const label = screen.getByText("50%");
    expect(root.getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.id).not.toBe("");
  });

  it("clamps aria-valuenow to the scale while the visible text keeps the real value", () => {
    render(<Meter value={12} scaleMax={8} tone="warning" valueText="150%" />);
    const meter = screen.getByRole("meter", { name: "150%" });
    expect(meter).toHaveAttribute("aria-valuenow", "8");
    expect(meter).toHaveAttribute("aria-valuetext", "150%");
  });

  it("fills from the inline start to the value's share of the scale", () => {
    const markup = renderToStaticMarkup(<Meter value={2} scaleMax={8} tone="success" valueText="25%" />);
    const fill = part(markup, "fill");
    expect(fill).toContain("inset-inline-start:0%");
    expect(fill).toContain("inline-size:25%");
    expect(fill).toContain("bg-status-success");
    expect(markup).not.toMatch(/\b(left|right):/);
  });

  it("hatches a warning fill and rings an info fill, so neither depends on colour alone", () => {
    const warning = part(renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="warning" valueText="50%" />), "fill");
    expect(warning).toContain("text-status-warning");
    expect(warning).toContain("repeating-linear-gradient(-45deg, currentColor 0 var(--ui-border-rule, 2px)");
    const info = part(renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="info" valueText="50%" />), "fill");
    expect(info).toContain("bg-status-info-tint");
    expect(info).toContain("box-shadow:inset 0 0 0 var(--ui-border-rule, 2px) currentColor");
    const danger = part(renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="danger" valueText="50%" />), "fill");
    expect(danger).toContain("bg-status-danger");
    expect(danger).not.toContain("background-image");
    expect(danger).not.toContain("box-shadow");
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


describe("Meter previous measurement", () => {
  it("shows authored history text outside the decorative bar and draws the previous position", () => {
    const { container } = render(<Meter value={6} scaleMax={8} previous={2} previousText="Previously 2 units" tone="neutral" valueText="6 units" />);
    const history = screen.getByText("Previously 2 units");
    expect(history).toBeVisible();
    expect(history.closest("[aria-hidden='true']")).toBeNull();
    const prior = container.querySelector<HTMLElement>("[data-part='previous']");
    expect(prior).not.toBeNull();
    expect(prior).toHaveClass("border-s", "border-dashed", "border-ink-secondary");
    // A backing surface makes dash gaps visible even inside the identical neutral fill.
    expect(prior).toHaveClass("bg-surface-base");
    expect(prior?.style.borderInlineStartWidth).toBe("var(--ui-border-hairline, 1px)");
    expect(prior?.style.inlineSize).toBe("var(--ui-border-hairline, 1px)");
    expect(prior?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(prior?.style.insetInlineStart).toContain("25%");
    expect(prior?.textContent).toBe("");
    expect(container.querySelector("meter")).toBeNull();
    // The decorative marker sits inside the hidden bar; the meter's name is still the current value text.
    expect(screen.getByRole("meter", { name: "6 units" })).toBe(container.firstElementChild);
    expect(screen.getAllByRole("meter")).toHaveLength(1);
  });

  it.each([0, 8])("keeps a previous value of %s at its valid scale endpoint", previous => {
    const markup = renderToStaticMarkup(<Meter value={4} scaleMax={8} previous={previous} previousText={`Previous ${previous}`} tone="info" valueText="4 units" />);
    expect(part(markup, "previous")).toContain("inset-inline-start:");
    expect(part(markup, "previous")).toContain(previous === 0 ? "0%" : "100%");
    expect(markup).not.toMatch(/\b(left|right):/);
    expect(markup).toContain(`Previous ${previous}`);
  });

  it("retains both the previous marker and limit when positions coincide", () => {
    const markup = renderToStaticMarkup(<Meter value={2} scaleMax={4} limit={2} limitText="Limit 2" previous={2} previousText="Previous 2" tone="warning" valueText="Now 2" />);
    expect(part(markup, "previous")).toContain("50%");
    expect(part(markup, "limit")).toContain("50%");
    expect(part(markup, "fill")).toContain("inline-size:50%");
    expect(markup).toContain("Now 2");
    expect(markup).toContain("Limit 2");
    expect(markup).toContain("Previous 2");
  });

  it("leaves no history marker or text when history is omitted", () => {
    const markup = renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="neutral" valueText="Now 1" />);
    expect(part(markup, "previous")).toBe("");
    expect(markup).not.toContain("Previous");
  });

  it.each([
    { previous: 1 },
    { previousText: "Previous 1" },
  ])("refuses orphaned history fields %j", props => {
    expect(() => renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="info" valueText="Now 1" {...props} />)).toThrow(/previous/i);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 3])("refuses previous outside the finite scale: %s", previous => {
    expect(() => renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="info" valueText="Now 1" previous={previous} previousText="Previous value" />)).toThrow(RangeError);
  });

  it.each(["", " "])("refuses history with no visible authored text %j", previousText => {
    expect(() => renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="info" valueText="Now 1" previous={0} previousText={previousText} />)).toThrow(/previous/i);
  });
});
