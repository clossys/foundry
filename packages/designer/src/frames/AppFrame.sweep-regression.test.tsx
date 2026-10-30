// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShadcnAppShell } from "./shadcn-aria/AppShell.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { shellCopyFixtureResolver } from "./__fixtures__/shell-copy.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.setProperty("--breakpoint-mobile-lg", "768px");
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media === "(min-width: 768px)",
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--breakpoint-mobile-lg");
});

function fixture(): AppFrameProps {
  return {
    copyResolver: shellCopyFixtureResolver,
    brand: { markSrc: "/mark.svg", navigationMark: { label: "Example Co." } },
    navigation: { label: "Workspace", collapsed: false,
      tree: [{ id: "home", label: "Home", href: "/home" }] },
    account: { signedOutLabel: "Sign in", sections: [] },
    commands: { triggerLabel: "Find command", heading: "Commands", searchLabel: "Search",
      closeLabel: "Close commands", emptyMessage: "No matches", groups: [] },
    theme: { defaultPreference: "light" }, themeControl: null,
    rightPanel: { label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 500,
      defaultValue: 300, collapsed: false, children: <button>Inspector action</button> },
    children: <button>Host opener</button>,
  };
}

const regions = ["navigation", "panel"] as const;
function collapse(props: AppFrameProps, region: typeof regions[number]): AppFrameProps {
  return region === "navigation"
    ? { ...props, navigation: { ...props.navigation, collapsed: true } }
    : { ...props, rightPanel: { ...props.rightPanel!, collapsed: true } };
}
function inside(region: typeof regions[number]) {
  return region === "navigation" ? screen.getByRole("link", { name: "Home" })
    : screen.getByRole("button", { name: "Inspector action" });
}

it.each(regions)("returns focus to the surviving %s toggle after a controlled collapse", region => {
  const props = fixture(), view = render(<ShadcnAppShell {...props} />);
  const focused = inside(region);
  act(() => focused.focus());
  expect(focused).toHaveFocus();
  view.rerender(<ShadcnAppShell {...collapse(props, region)} />);
  expect(screen.getByRole("button", { name: region === "navigation" ? "Open navigation" : "Open panel" })).toHaveFocus();
  expect(focused).not.toHaveFocus();
});

it.each(regions)("preserves outside focus through controlled %s collapse and expansion", region => {
  const props = fixture(), view = render(<ShadcnAppShell {...props} />);
  act(() => inside(region).focus());
  const outside = screen.getByRole("button", { name: "Host opener" });
  act(() => outside.focus());
  view.rerender(<ShadcnAppShell {...collapse(props, region)} />);
  expect(outside).toHaveFocus();
  view.rerender(<ShadcnAppShell {...props} />);
  expect(outside).toHaveFocus();
});

it.each(["ltr", "rtl"] as const)("grows the native end panel toward the page in %s", dir => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options); this.pointerId = options.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const props = fixture(), change = vi.fn();
  props.rightPanel = { ...props.rightPanel!, onChange: change };
  render(<ShadcnAppShell {...props} dir={dir} locale={dir === "rtl" ? "ar" : "en"} />);
  const handle = screen.getByRole("separator", { name: "Resize inspector" });
  Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 400 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: dir === "rtl" ? 440 : 360 });
  fireEvent.pointerUp(handle, { pointerId: 7 });
  expect(change).toHaveBeenLastCalledWith(340);
  expect(handle).toHaveAttribute("aria-valuenow", "340");
  expect(screen.getByRole("region", { name: "Inspector" })).toHaveStyle({ inlineSize: "340px" });
});
