import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./components/preview-runtime/components/button/button.js";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "./components/preview-runtime/components/menu/dropdown-menu.js";
import { Popover, PopoverTrigger } from "./components/preview-runtime/components/popover/popover.js";
import { Tooltip, TooltipTrigger } from "./components/preview-runtime/components/tooltip/tooltip.js";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { ThemeToggle } from "./theme/ThemeToggle.js";
import { suppressThemeTransitions } from "./theme/internal/theme-core.js";
import { ShellCopyTestHost } from "./frames/__fixtures__/shell-copy.js";

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

  it("opens the stock Popover, Menu and Tooltip panels as their own placed overlay surfaces", async () => {
    const view = render(<PopoverTrigger defaultOpen><Button>Open</Button><Popover>Body</Popover></PopoverTrigger>);
    expect(screen.getByText("Body").closest('[data-slot="popover-content"]')).toHaveAttribute("data-placement");
    view.unmount();
    const menu = render(<DropdownMenuTrigger defaultOpen><Button>More</Button><DropdownMenu aria-label="Actions"><DropdownMenuItem id="a">A</DropdownMenuItem></DropdownMenu></DropdownMenuTrigger>);
    expect(screen.getByRole("menu").closest('[data-slot="dropdown-menu-content"]')).toHaveAttribute("data-placement");
    menu.unmount();
    render(<TooltipTrigger defaultOpen behaviorTiming={{ "tooltip-delay": { value: 0, unit: "ms" }, "tooltip-close": { value: 0, unit: "ms" } }}><Button>Hint</Button><Tooltip>Tip</Tooltip></TooltipTrigger>);
    expect(await screen.findByRole("tooltip")).toHaveAttribute("data-placement", "top");
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
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>, { wrapper: ShellCopyTestHost });
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
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>, { wrapper: ShellCopyTestHost });
    const option = screen.getByRole("radio", { name: "System" });
    expect(option).toHaveClass("data-selected:bg-surface-selected", "data-selected:text-ink-primary", "data-selected:ring-current", "transition-colors", "duration-(--ui-duration-fast)");
    expect(option.className).not.toMatch(/data-selected:bg-\(--color-action\)|data-selected:text-\(--color-ink-on-action\)|\btransition-all\b|duration-\(--ui-duration-default\)/);
  });
});
