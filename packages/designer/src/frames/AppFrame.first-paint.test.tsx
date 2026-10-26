// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { compile } from "tailwindcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "../tokens/index.js";
import { AppFrame } from "./AppFrame.js";
import { APP_FRAME_NAVIGATION_SIZE, APP_FRAME_PANEL_SIZE, APP_FRAME_PANEL_WIDTH_VAR } from "./app-frame-layout.js";
import type { AppFrameProps } from "./app-frame-types.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const req = createRequire(import.meta.url);
const nativeBounds = HTMLElement.prototype.getBoundingClientRect;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace home", href: "#home" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
    account: { signedOutLabel: "Account", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    children: <p>Route content</p>,
  };
}
async function utilities(candidates: string[]): Promise<string> {
  const compiler = await compile('@import "tailwindcss"; @import "./styles/theme-keys.css";', {
    base: packageRoot,
    loadStylesheet: async (id, base) => {
      const path = id.startsWith("tailwindcss") ? req.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : `${id}.css`) : resolve(base, id);
      return { path, base: resolve(path, ".."), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

describe("AppFrame first paint (cross-08)", () => {
  it("server-renders docked navigation whose width and visibility come from a media rule, not inline style", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<AppFrame {...fixture()} />);
    const navigation = host.querySelector<HTMLElement>('[data-application-frame-region="navigation"]')!;
    // Server markup cannot know the viewport; the docked classes carry the narrow answer themselves.
    expect(navigation).toHaveAttribute("data-open", "true");
    expect(navigation.style.inlineSize).toBe("");
    expect(navigation).toHaveClass(...APP_FRAME_NAVIGATION_SIZE.docked.split(" "));
    const css = await utilities(APP_FRAME_NAVIGATION_SIZE.docked.split(" "));
    const wide = TOKENS["--breakpoint-tablet-lg"]!.value;
    const rem = `${Number.parseFloat(wide) / 16}rem`;
    const narrowRule = new RegExp(`@media \\(width < (${wide}|${rem})\\)\\s*\\{\\s*\\.max-tablet-lg\\\\:invisible \\{\\s*visibility: hidden;`);
    const wideRule = new RegExp(`\\.frame-nav-width \\{\\s*inline-size: 0;\\s*@media \\(width >= (${wide}|${rem})\\)\\s*\\{\\s*inline-size: var\\(--ui-layout-sidebar-w\\);`);
    expect(css).toMatch(/\.frame-nav-width \{\s*inline-size: 0;/);
    expect(css).toMatch(narrowRule);
    expect(css).toMatch(wideRule);
  });
  it("server-renders a docked right panel whose inline-size comes from a media-ruled class; only its width travels inline, as a custom property", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<AppFrame {...fixture()} rightPanel={{ label: "Inspector", handleLabel: "Resize inspector", min: 240, max: 420, defaultValue: 300, children: <p>Panel</p> }} />);
    const panel = host.querySelector<HTMLElement>(".frame-docked-panel")!;
    expect(panel.style.inlineSize).toBe("");
    expect(panel.style.width).toBe("");
    const docked = panel.dataset.open !== "false";
    expect(panel).toHaveClass(...APP_FRAME_PANEL_SIZE[docked ? "docked" : "closed"].split(" "));
    if (docked) expect(panel.style.getPropertyValue(APP_FRAME_PANEL_WIDTH_VAR)).toBe("300px");
    const css = await utilities(APP_FRAME_PANEL_SIZE.docked.split(" "));
    const wide = TOKENS["--breakpoint-tablet-lg"]!.value;
    const rem = `${Number.parseFloat(wide) / 16}rem`;
    expect(css).toMatch(new RegExp(`@media \\(width < (${wide}|${rem})\\)\\s*\\{\\s*\\.max-tablet-lg\\\\:invisible \\{\\s*visibility: hidden;`));
    expect(css).toMatch(new RegExp(`\\.frame-panel-width \\{\\s*inline-size: 0;\\s*@media \\(width >= (${wide}|${rem})\\)\\s*\\{\\s*inline-size: var\\(${APP_FRAME_PANEL_WIDTH_VAR}\\);`));
  });
  it("never animates a layout property on the docked navigation, in source or in the compiled theme keys", async () => {
    const source = readFileSync(resolve(packageRoot, "styles/theme-keys.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...source.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, selector]) => selector!.includes(".frame-docked-navigation"));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) expect(body, selector).not.toMatch(/transition|animation/);
    expect(rules.map(([, , body]) => body!.trim())).toContain("visibility: hidden;");
    const compiled = await utilities([]);
    expect(compiled).toMatch(/\.frame-docked-navigation\[data-open="false"\] \{\s*visibility: hidden;\s*\}/);
    expect(compiled).not.toMatch(/\.frame-docked-navigation[^{]*\{[^}]*transition/);
  });
});

describe("AppFrame route notices at short heights (cross-18)", () => {
  const notices: AppFrameProps["notices"] = [
    { id: "route", severity: "info", text: "Route notice with a long explanation" },
    { id: "pending", severity: "warning", text: "Changes pending" },
  ];
  function measure(height: number) {
    vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media === "all", addEventListener() {}, removeEventListener() {} }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      return this.hasAttribute("data-application-frame") ? new DOMRect(0, 0, 720, height) : nativeBounds.call(this);
    });
  }
  const region = () => document.querySelector<HTMLElement>("[data-frame-notices]")!;
  it("keeps one single-line notice, the most urgent, when the frame is shorter than the tablet breakpoint", () => {
    measure(Number.parseFloat(TOKENS["--breakpoint-tablet"]!.value) - 318);
    render(<AppFrame {...fixture()} notices={notices} />);
    expect(region()).toHaveAttribute("data-frame-notices-compact", "true");
    expect(region().children).toHaveLength(1);
    expect(region()).toHaveTextContent("Changes pending");
    expect(screen.getByText("Changes pending")).toHaveClass("min-w-0", "truncate");
    expect(region().firstElementChild).toHaveClass("py-xs", "items-center", "first-child-shrink");
  });
  it("stacks every notice at full size in a tall frame", () => {
    measure(900);
    render(<AppFrame {...fixture()} notices={notices} />);
    expect(region()).not.toHaveAttribute("data-frame-notices-compact");
    expect(region().children).toHaveLength(2);
    expect(screen.getByText("Route notice with a long explanation")).not.toHaveClass("truncate");
    expect(region().firstElementChild).not.toHaveClass("py-xs");
  });
});
