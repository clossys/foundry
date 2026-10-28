// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SlotModule } from "../shell/index.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const MOTION = ["frame-chevron-motion"];
const glyph = (button: HTMLElement) => button.querySelector("svg")!;
const props: Omit<AppFrameProps, "children"> = {
  brand: { markSrc: "/mark.svg" },
  navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
  account: { signedOutLabel: "Account", sections: [] },
  commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
  dock: { label: "Page modules", handleLabel: "Resize page modules" },
  rightPanel: { children: <p>Inspector body</p>, label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 500, defaultValue: 300, step: 10 },
};

it("turns the dock chevron on the motion tokens", async () => {
  render(<AppFrame {...props}><SlotModule id="map" slot="dock-tab" label="Map"><button>Map action</button></SlotModule></AppFrame>);
  const collapsed = glyph(screen.getByRole("button", { name: "Expand page modules" }));
  expect(collapsed).toHaveClass(...MOTION, "rotate-180");
  await userEvent.click(screen.getByRole("button", { name: "Expand page modules" }));
  const open = glyph(screen.getByRole("button", { name: "Collapse page modules" }));
  expect(open).toHaveClass(...MOTION);
  expect(open).not.toHaveClass("rotate-180");
});

it("draws the right panel toggle as the mirror of the navigation toggle in either direction", () => {
  for (const dir of ["ltr", "rtl"] as const) {
    const view = render(<AppFrame {...props} dir={dir}><p>Page</p></AppFrame>);
    const left = glyph(document.querySelector<HTMLElement>('[data-application-frame-navigation="trigger"]')!);
    const right = glyph(document.querySelector<HTMLElement>('[data-application-frame-panel="trigger"]')!);
    expect(right.innerHTML).toBe(left.innerHTML);
    // Each toggle faces its own edge: the right one is flipped in ltr, the left one in rtl.
    expect(left).toHaveClass("rtl:-scale-x-100");
    expect(left).not.toHaveClass("-scale-x-100");
    expect(right).toHaveClass("-scale-x-100", "rtl:scale-x-100");
    view.unmount();
  }
});
