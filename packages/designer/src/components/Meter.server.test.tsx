import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter } from "./Meter.server.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("server Meter", () => {
  it("shows the value and limit as visible text, hides the bar, and exposes no meter role", () => {
    const { container } = render(
      <Meter value={3.4} scaleMax={5} limit={3} tone="danger" valueText="3.4x" limitText="limit 3.0x" />,
    );
    expect(screen.getByText("3.4x")).toBeVisible();
    expect(screen.getByText("limit 3.0x")).toBeVisible();
    const bar = container.querySelector("[aria-hidden='true']");
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toBe("");
    expect(container.querySelector("meter")).toBeNull();
    expect(container.querySelector("[role]")).toBeNull();
    expect(container.querySelector("[data-rac]")).toBeNull();
  });

  it("accepts label without rendering it: the server meter has no role to name", () => {
    const { container } = render(<Meter value={3} scaleMax={5} tone="info" valueText="3 units" label="Capacity" />);
    expect(container.innerHTML).not.toContain("Capacity");
    expect(container.querySelector("[aria-label], [role]")).toBeNull();
    expect(screen.getByText("3 units")).toBeVisible();
  });

  it.each([["empty", ""], ["whitespace-only", "   "]])("accepts an %s label without rendering it", (_name, label) => {
    const { container } = render(<Meter value={3} scaleMax={5} tone="info" valueText="3 units" label={label} />);
    expect(container.querySelector("[aria-label], [role]")).toBeNull();
    expect(screen.getByText("3 units")).toBeVisible();
  });

  it("keeps the previous marker decorative and leaves no role anywhere", () => {
    const { container } = render(<Meter value={6} scaleMax={8} previous={2} previousText="Previously 2 units" tone="neutral" valueText="6 units" />);
    expect(screen.getByText("Previously 2 units")).toBeVisible();
    expect(container.querySelector("[data-part='previous']")?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector("[role='meter'], [role='progressbar'], meter")).toBeNull();
  });

  it("fills from the inline start to the value's share of the scale", () => {
    const markup = renderToStaticMarkup(<Meter value={2} scaleMax={8} tone="success" valueText="25%" />);
    expect(markup).toContain("inline-size:25%");
    expect(markup).toContain("bg-status-success");
  });

  it.each([
    ["scaleMax of zero", { value: 1, scaleMax: 0 }],
    ["negative value", { value: -1, scaleMax: 2 }],
    ["negative limit", { value: 1, scaleMax: 2, limit: -1 }],
  ])("throws a RangeError for a %s", (_label, props) => {
    expect(() => renderToStaticMarkup(<Meter {...props} tone="info" valueText="x" />)).toThrow(RangeError);
  });

  it("refuses orphaned history fields", () => {
    expect(() => renderToStaticMarkup(<Meter value={1} scaleMax={2} tone="info" valueText="x" previous={1} />)).toThrow(/previous/i);
  });

  it("imports no react-aria-components, so it loads under the react-server condition", () => {
    const source = readFileSync(join(here, "Meter.server.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']react-aria-components["']/);
  });
});
