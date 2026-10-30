// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SlotModule } from "../shell/index.js";
import { TOKENS } from "../tokens/index.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



let viewport = 1440;
const listeners = new Set<() => void>();
beforeEach(() => {
  viewport = 1440; listeners.clear(); sessionStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => viewport });
  vi.stubGlobal("matchMedia", (media: string) => ({ media, get matches() {
    if (media === APP_FRAME_WIDE_QUERY) return viewport >= Number.parseFloat(TOKENS["--breakpoint-tablet-lg"]!.value);
    return media === "all";
  }, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props: Omit<AppFrameProps, "children"> = {
  brand: { markSrc: "/mark.svg" },
  navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
  account: { signedOutLabel: "Account", sections: [] },
  commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
  dock: { label: "Page modules", handleLabel: "Resize page modules" },
};
const page = <><SlotModule id="map" slot="dock-tab" label="Map"><button>Map action</button></SlotModule><SlotModule id="explorer" slot="dock-tab" label="Explorer"><button>Explorer action</button></SlotModule></>;
const dock = () => document.querySelector<HTMLElement>('[data-application-frame-region="dock"]')!;
const tabNames = (root: HTMLElement) => within(root).getAllByRole("tab").map(tab => tab.textContent);

it("keeps the dock tabs inline at the wide breakpoint", () => {
  render(<AppFrame {...props}>{page}</AppFrame>);
  expect(tabNames(dock())).toEqual(["Explorer", "Map"]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("renders the dock as a bottom-sheet Drawer with the same tabs below the sidebar overlay breakpoint", async () => {
  viewport = 390;
  render(<AppFrame {...props}>{page}</AppFrame>);
  expect(within(dock()).queryByRole("tab")).toBeNull();
  const trigger = within(dock()).getByRole("button", { name: "Page modules" });
  // Narrow sheet trigger is icon-only: the accessible name is the label, no truncating visible text.
  expect(trigger).toHaveAttribute("aria-label", "Page modules");
  expect(trigger.querySelector(".truncate")).toBeNull();
  await userEvent.click(trigger);
  const sheet = await screen.findByRole("dialog", { name: "Page modules" });
  expect(sheet.closest("[data-drawer-placement]") ?? sheet.querySelector("[data-drawer-placement]")).toHaveAttribute("data-drawer-placement", "bottom");
  expect(tabNames(sheet)).toEqual(["Explorer", "Map"]);
  await userEvent.click(within(sheet).getByRole("tab", { name: "Map" }));
  expect(within(sheet).getByRole("button", { name: "Map action" })).toBeVisible();
  await userEvent.click(within(sheet).getByRole("button", { name: "Collapse page modules" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("returns to the inline dock without opening a sheet when the viewport widens", async () => {
  viewport = 390;
  render(<AppFrame {...props}>{page}</AppFrame>);
  act(() => { viewport = 1440; for (const listener of listeners) listener(); window.dispatchEvent(new Event("resize")); });
  expect(tabNames(dock())).toEqual(["Explorer", "Map"]);
  expect(screen.queryByRole("dialog")).toBeNull();
});
