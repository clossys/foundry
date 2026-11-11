import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconNode } from "../icons/types.js";
import { Button } from "./preview-runtime/components/button/button.js";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { Switch } from "./preview-runtime/components/switch/switch.js";
import { StockSelect as Select } from "../blocks/stock-select.js";
import { SearchField } from "./SearchField.js";
import { StatusMark } from "./StatusMark.js";
import { Icon } from "./preview-runtime/components/icon/icon.js";
import { AlertTriangle, CheckCircle, Info, XCircle } from "../icons/index.js";
import { Minus } from "../icons/Minus.js";
import { X } from "../icons/X.js";
import { hostedRender } from "../frames/__fixtures__/shell-copy.js";
const render = hostedRender(renderBare);

const consumers = ["Select", "ComboBox", "SearchField", "Checkbox", "StatusMark", "Switch", "Button"];
const stock: Record<string, string> = { Checkbox: "preview-runtime/components/checkbox/checkbox", Select: "../blocks/stock-select", ComboBox: "../blocks/stock-combobox", Switch: "preview-runtime/components/switch/switch" };
const source = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), `${stock[name] ?? name}.tsx`), "utf8");
// Consumer files may render Icon, but glyph artwork belongs in data bindings.
function inlineGlyphs(text: string) {
  return /<(?:svg|path|circle|rect|polygon)\b|[✓▾▸×]/.test(text);
}
const replacement: IconNode = [["path", { d: "M1 2h3", "data-test-glyph": "consumer" }]];

describe("control glyph bindings", () => {
  it.each(consumers)("keeps %s free of inline SVG and text artwork", name => {
    expect(inlineGlyphs(source(name))).toBe(false);
  });
  it("rejects a restored inline glyph mutant", () => {
    expect(inlineGlyphs(source("Select") + '<span aria-hidden="true">✓</span>')).toBe(true);
    expect(inlineGlyphs(source("Checkbox") + '<svg><path d="M0 0" /></svg>')).toBe(true);
  });
  // Retargeted (planner:C5-DREC, owner LAD-3 2026-11-11): GlyphProvider is removed because icons are lucide.
  // before: a GlyphProvider binding replaced the search clear glyph, and nested providers inherited bindings.
  // after: the built-in control draws its lucide glyph, no provider is exported, and explicit overrides still win.
  it("draws each built-in affordance from its lucide glyph; no glyph provider is exported", async () => {
    const { container } = render(<><Button variant="quiet">Continue</Button><SearchField label="Query" defaultValue="Find" /></>);
    const lucideClose = renderToStaticMarkup(<Icon glyph={X} decorative />).replace(/^<svg[^>]*>|<\/svg>$/g, "");
    expect(lucideClose.length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain(lucideClose);
    for (const svg of document.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    const api: Record<string, unknown> = await import("./index.js");
    expect(api.GlyphProvider).toBeUndefined();
    expect(source("SearchField")).not.toContain("GlyphProvider");
  });
  it("preserves explicit quiet-button overrides and null", () => {
    const explicit: IconNode = [["path", { d: "M9 9h1", "data-test-glyph": "explicit" }]];
    const { container } = render(<>
      <Button variant="quiet" trailingIcon={explicit}>Explicit</Button>
      <Button variant="quiet" trailingIcon={null}>None</Button>
    </>);
    expect(container.querySelectorAll('[data-test-glyph="explicit"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "None" }).querySelector("svg")).toBeNull();
  });
  it("moves the stock switch thumb with its selection; the stock checkbox toggles", async () => {
    const user = userEvent.setup();
    const { container } = render(<><Checkbox>Check</Checkbox><Switch aria-label="Toggle" /></>);
    const track = container.querySelector('[data-slot="switch"]') as HTMLElement;
    const thumb = container.querySelector('[data-slot="switch-thumb"]') as HTMLElement;
    expect(track).toHaveAttribute("data-size", "default");
    expect(thumb).not.toHaveAttribute("data-selected");
    await user.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(screen.getByRole("switch")).toBeChecked();
    expect(thumb).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("preserves exact default status artwork and accepts server-safe asset bindings", () => {
    // Retargeted (R2F-53, planner:r2f-53): the default artwork is now each tone's Lucide glyph on the 24-unit grid
    // (Kibo status ships a colour-only dot), pinned exactly by rendering the same Lucide node on its own.
    const tones = [["success", CheckCircle], ["warning", AlertTriangle], ["danger", XCircle], ["info", Info], ["neutral", Minus]] as const;
    const artwork = (glyph: IconNode) => renderToStaticMarkup(<Icon glyph={glyph} decorative />).replace(/^<svg[^>]*>|<\/svg>$/g, "");
    expect(new Set(tones.map(([, glyph]) => artwork(glyph))).size).toBe(tones.length);
    for (const [tone, glyph] of tones) {
      const html = renderToStaticMarkup(<StatusMark tone={tone}>Label</StatusMark>);
      expect(artwork(glyph).length).toBeGreaterThan(0);
      expect(html).toContain(artwork(glyph));
      expect(html).toContain('viewBox="0 0 24 24"');
    }
    const html = renderToStaticMarkup(<StatusMark tone="warning" glyphs={{ "assets.icon-warning": replacement }}>Careful</StatusMark>);
    expect(html).toContain('data-test-glyph="consumer"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('aria-hidden="true"');
    // Retargeted (R2F-53, planner:r2f-53): every mark is a Lucide stroke glyph now, so the replacement stays unfilled
    // through the icon's own fill="none" (no inline style), and no mark class paints a fill over it.
    expect(html).not.toContain('stroke:none');
    expect(html).toContain('fill="none"');
    expect(html).not.toMatch(/class="[^"]*\bfill-/);
    const neutral = renderToStaticMarkup(<StatusMark tone="neutral" neutralGlyph={replacement}>Idle</StatusMark>);
    expect(neutral).toContain('data-test-glyph="consumer"');
    expect(neutral).toContain('viewBox="0 0 24 24"');
    expect(source("StatusMark")).not.toMatch(/\b(?:useContext|createContext|useState|useEffect)\b/);
  });
});
