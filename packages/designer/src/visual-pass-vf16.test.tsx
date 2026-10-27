// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "./components/toggle-button/index.js";

/*
 * Visual pass (VF-16) binding-layer pins: the shared toggle animates colours
 * only, on the fast motion tier (cross-05..08).
 */
const themeKeys = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "theme-keys.css"), "utf8");

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

/*
 * DESIGNER-RO (rail): the studio layer tabs (StudioTopBar) were removed with the right rail, so their indicator
 * pin went with them; the explorer card's layer select is a Foundry Select with its own pins.
 */
