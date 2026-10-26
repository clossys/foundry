// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "./components/toggle-button/index.js";
import { StudioTopBar } from "./studio/StudioTopBar.js";
import { labels } from "./studio/__fixtures__/studio.js";

/*
 * Visual pass (VF-16) binding-layer pins: the shared toggle animates colours
 * only, on the fast motion tier (cross-05..08), and the studio layer tabs draw
 * their selected indicator through a named class bound to the rule-thickness
 * token instead of a raw 2px border (cross-16).
 */
const themeKeys = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "theme-keys.css"), "utf8");

function utility(name: string): string {
  const start = themeKeys.indexOf(`@utility ${name} {`);
  if (start < 0) throw new Error(`${name} is not defined`);
  return themeKeys.slice(start, themeKeys.indexOf("\n}\n", start));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("toggle motion", () => {
  it("transitions colours only, on the default (fast) duration, with no arbitrary duration or easing", () => {
    render(<Toggle aria-label="Bold">B</Toggle>);
    const classes = screen.getByRole("button", { name: "Bold" }).className.split(/\s+/);
    expect(classes).not.toContain("transition-all");
    expect(classes).toContain("transition-colors");
    expect(classes).toContain("motion-reduce:transition-none");
    expect(classes.filter(name => /^(duration|ease)-\(/.test(name))).toEqual([]);
    expect(themeKeys).toMatch(/--default-transition-duration:\s*var\(--ui-duration-fast/);
  });
});

describe("studio layer tab indicator", () => {
  it("binds the indicator to the rule-thickness token through a named class, not border-b-2", () => {
    render(<StudioTopBar labels={labels} layer="assets" layers={["tokens", "assets"]} onLayer={vi.fn(async () => true)} />);
    const nav = screen.getByRole("navigation", { name: labels.layers.label });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.className.split(/\s+/)).not.toContain("border-b-2");
      expect(link.className.split(/\s+/)).toContain("layer-tab-indicator");
    }
    const rule = utility("layer-tab-indicator");
    expect(rule).toMatch(/border-block-end-width:\s*var\(--ui-border-rule/);
    expect(rule).toMatch(/border-block-end-color:\s*transparent/);
    expect(rule).toMatch(/&\[data-selected\][^}]*border-block-end-color:\s*var\(--color-accent/);
  });
});
