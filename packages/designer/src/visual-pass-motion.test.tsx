import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./components/Button.js";
import { Menu } from "./components/Menu.js";
import { Popover } from "./components/Popover.js";
import { Tooltip } from "./components/Tooltip.js";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { ThemeToggle } from "./theme/ThemeToggle.js";
import { suppressThemeTransitions } from "./theme/internal/theme-core.js";

/*
 * Visual pass (VF-1) motion pins: overlays enter and exit on the overlay
 * keyframes and duration tier (cross-12), a theme switch drops transitions
 * for that frame and the theme toggle's selected state is a surface step,
 * not the full action fill (cross-14, cross-19).
 */
const themeKeys = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "theme-keys.css"), "utf8");

function utility(name: string): string {
  const start = themeKeys.indexOf(`@utility ${name} {`);
  if (start < 0) throw new Error(`${name} is not defined`);
  return themeKeys.slice(start, themeKeys.indexOf("\n}\n", start));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, media: "(prefers-color-scheme: dark)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-switching");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("overlay motion (cross-12)", () => {
  it.each([["overlay-motion-pop", "overlay-pop"], ["overlay-motion-fade", "overlay-fade"]])("%s binds %s to entering and a reversed fade to exiting on the overlay tier", (name, enter) => {
    const css = utility(name);
    expect(css).toMatch(new RegExp(`&\\[data-entering\\] \\{ animation: ${enter} var\\(--ui-duration-overlay, 120ms\\) var\\(--ease-enter`));
    expect(css).toMatch(/&\[data-exiting\] \{ animation: overlay-fade var\(--ui-duration-overlay, 120ms\) var\(--ease-exit[^;]*reverse both; \}/);
  });

  it("puts the pop recipe on Popover and Menu panels and the fade on Tooltip", async () => {
    const view = render(<Popover defaultOpen aria-label="Details" trigger={<Button>Open</Button>}>Body</Popover>);
    expect(screen.getByRole("dialog", { name: "Details" }).parentElement).toHaveClass("overlay-motion-pop");
    view.unmount();
    const menu = render(<Menu defaultOpen aria-label="Actions" trigger={<Button>More</Button>}><Menu.Item id="a">A</Menu.Item></Menu>);
    expect(screen.getByRole("menu").parentElement).toHaveClass("overlay-motion-pop");
    menu.unmount();
    render(<Tooltip defaultOpen trigger={<Button>Hint</Button>}>Tip</Tooltip>);
    expect(await screen.findByRole("tooltip")).toHaveClass("overlay-motion-fade");
  });
});

describe("theme switch (cross-14)", () => {
  it("drops every transition while data-theme-switching is set", () => {
    expect(themeKeys).toContain(":root[data-theme-switching] *, :root[data-theme-switching] *::before, :root[data-theme-switching] *::after { transition: none !important; }");
  });

  it("marks the root for the frame after next, then clears it", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const root = document.documentElement;
    suppressThemeTransitions(root);
    expect(root).toHaveAttribute("data-theme-switching");
    frames.shift()!(0);
    expect(root).toHaveAttribute("data-theme-switching");
    frames.shift()!(0);
    expect(root).not.toHaveAttribute("data-theme-switching");
  });

  it("suppresses transitions when the preference changes, not on the first sync", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme-switching");
    act(() => { while (frames.length) frames.shift()!(0); });
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
  });
});

describe("theme toggle selected state (cross-19)", () => {
  it("is a surface step with the primary ink and an ink ring, not the action fill, with colour-only fast motion", () => {
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    const option = screen.getByRole("radio", { name: "System" });
    expect(option).toHaveClass("data-selected:bg-surface-selected", "data-selected:text-ink-primary", "data-selected:ring-current", "transition-colors", "motion-tier-fast");
    expect(option.className).not.toMatch(/data-selected:bg-\(--color-action\)|data-selected:text-\(--color-ink-on-action\)|\btransition-all\b|duration-\(--ui-duration-default\)/);
  });
});
