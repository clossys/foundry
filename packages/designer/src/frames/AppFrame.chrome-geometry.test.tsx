// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SlotModule } from "../shell/index.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props: Omit<AppFrameProps, "children"> = {
  brand: { markSrc: "/mark.svg" },
  navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
  account: { actor: { name: "Sam River" }, signedOutLabel: "Account", sections: [{ id: "account", entries: [{ kind: "link", id: "profile", label: "Profile", href: "#profile" }] }] },
  commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
  dock: { label: "Page modules", handleLabel: "Resize page modules" },
  rightPanel: { children: <p>Inspector body</p>, label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 500, defaultValue: 300, step: 10 },
};
const bar = () => document.querySelector<HTMLElement>('[data-application-frame-region="bar"]')!;

it("draws the frame header unboxed and flush on the raised surface, not the inset glass box", () => {
  render(<AppFrame {...props}><p>Page</p></AppFrame>);
  // Unboxed: no control radius, no all-side border, no inset margins; one hairline under the bar.
  expect(bar()).not.toHaveClass("rounded-control");
  expect(bar().className.split(/\s+/)).not.toContain("border");
  expect(bar()).toHaveClass("border-b");
  expect(bar().style.marginInline).toBe("");
  expect(bar().style.marginBlockStart).toBe("");
  // Raised step (never sunken or glass), so dark mode is not darker than the canvas.
  expect(bar()).toHaveClass("bg-surface-raised");
  expect(bar()).not.toHaveClass("bg-surface-glass");
});

it("keeps a host-chosen header surface", () => {
  render(<AppFrame {...props} headerSurface="transparent"><p>Page</p></AppFrame>);
  expect(bar()).not.toHaveClass("bg-surface-raised");
});

it("binds every chrome control to the md control height, with the hit area from tap-target instead of a 44px box", () => {
  // The signed-out account row is the frame's own trigger; the signed-in AccountMenu trigger belongs to the block.
  render(<AppFrame {...props} account={{ signedOutLabel: "Local workbench", sections: props.account.sections }}><p>Page</p></AppFrame>);
  const controls = [
    screen.getByRole("button", { name: "Find commands" }),
    screen.getByRole("button", { name: "Local workbench" }),
    document.querySelector<HTMLElement>('[data-application-frame-navigation="trigger"]')!,
    document.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]')!,
  ];
  for (const control of controls) {
    expect(control).toHaveClass("control-h-md");
    expect(control.style.minBlockSize).toBe("");
  }
});

it("turns the dock chevron on the named fast chrome motion, with no arbitrary duration or easing class", () => {
  render(<AppFrame {...props}><SlotModule id="map" slot="dock-tab" label="Map"><button>Map action</button></SlotModule></AppFrame>);
  const chevron = screen.getByRole("button", { name: "Expand page modules" }).querySelector("svg")!;
  expect(chevron).toHaveClass("frame-chevron-motion");
  expect(chevron.getAttribute("class")).not.toMatch(/duration-\(|ease-\(|transition-all/);
});

it("binds frame controls and main to the one focus-ring token, never the raw accent", () => {
  render(<AppFrame {...props}><p>Page</p></AppFrame>);
  for (const element of [screen.getByRole("button", { name: "Find commands" }), screen.getByRole("main")]) {
    expect(element).toHaveClass("focus-visible:outline-focus-ring");
    expect(element).not.toHaveClass("focus-visible:outline-accent");
  }
});

it("sizes the header row from its own content, with no inline measured block size", () => {
  render(<AppFrame {...props}><p>Page</p></AppFrame>);
  expect(document.querySelector<HTMLElement>('[data-application-frame-region="header"]')!.style.minBlockSize).toBe("");
});

it("stacks main content children on the lg spacing token so a banner never touches the content below it", () => {
  render(<AppFrame {...props}><div role="status">Banner</div><section aria-label="Cards">Cards</section></AppFrame>);
  const main = screen.getByRole("main");
  expect(main).toHaveClass("flex", "flex-col", "frame-main-gap");
  expect(main.style.gap).toBe("");
  // The frame names its gap; the named utility carries the lg spacing token.
  expect(readFileSync(resolve(import.meta.dirname, "../../styles/theme-keys.css"), "utf8")).toContain("@utility frame-main-gap { gap: var(--spacing-lg, 16px); }");
});
