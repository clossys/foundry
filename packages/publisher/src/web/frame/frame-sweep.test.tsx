// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@clossys/designer/tokens";
import { Toaster, toast } from "@clossys/designer/shell";
import { AppFrame } from "@clossys/designer/frames";
import { SiteFrame } from "./SiteFrame.js";
import { APP_FRAME_LAYOUT, APP_FRAME_WIDE_QUERY } from "../../../../designer/src/frames/app-frame-layout.js";
import type { AppFrameProps } from "@clossys/designer/frames";
import type { SiteFrameProps } from "./types.js";

let viewport: number;
let listeners: Set<() => void>;
beforeEach(() => {
  viewport = 1280;
  listeners = new Set();
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => viewport });
  vi.stubGlobal("matchMedia", (media: string) => ({
    media, get matches() {
      if (media === "all") return true;
      const match = media.match(/^\(min-width: ([\d.]+)(px|rem)\)$/);
      return match ? viewport >= Number(match[1]) * (match[2] === "rem" ? 16 : 1) : false;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener() {}, removeListener() {},
  }));
});
afterEach(() => {
  act(() => toast.dismissAll());
  cleanup(); vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

function appProps(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Example", label: "Example home" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Workspace navigation" },
    account: { signedOutLabel: "Signed out", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    rightPanel: { label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 400, defaultValue: 200, children: <button>Inspect item</button> },
    children: <button>Route action</button>,
  };
}
function siteProps(): SiteFrameProps {
  return {
    shell: {
      brand: { variant: "mark", assetId: "mark", label: { id: "Home" }, size: "sm" },
      skipLink: { id: "Skip to content" },
      footer: { legal: { entity: { id: "Example" }, links: [] } },
    },
    resolveCopy: ref => ({ ref, text: ref.id, recordId: "copy", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id }),
    resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 24, height: 24, alt: "Example" }),
    children: <button>Route action</button>,
  };
}
function resize(width: number) {
  act(() => { viewport = width; for (const listener of listeners) listener(); window.dispatchEvent(new Event("resize")); });
}

describe("Foundry frame sweep", () => {
  it("derives structural queries from registry tokens without a raw breakpoint or CSS fallback", () => {
    expect(APP_FRAME_WIDE_QUERY).toBe(`(min-width: ${TOKENS["--breakpoint-tablet-lg"]!.value})`);
    for (const path of ["../../../../designer/src/frames/app-frame-layout.ts", "../../../../designer/src/blocks/Drawer.tsx"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/["'`]\(min-width:\s*[\d.]+(?:px|rem)\)/);
      expect(source).toContain("TOKENS[");
    }
    for (const value of Object.values(APP_FRAME_LAYOUT)) if (typeof value === "string") expect(value).not.toMatch(/var\([^,]+,/);
  });

  const widths = [320, ...["--breakpoint-mobile", "--breakpoint-mobile-lg", "--breakpoint-tablet", "--breakpoint-tablet-lg", "--breakpoint-desktop", "--breakpoint-wide"].flatMap(key => {
    const width = Number.parseFloat(TOKENS[key as keyof typeof TOKENS]!.value);
    return [width - 1, width, width + 1];
  })];
  it.each(["light", "dark"] as const)("keeps frame landmarks, skip-first order and responsive docking across the token matrix in %s", async theme => {
    const view = render(<AppFrame {...appProps()} theme={{ defaultPreference: theme }} />);
    for (const width of widths) {
      resize(width);
      const docked = width >= Number.parseFloat(TOKENS["--breakpoint-tablet-lg"]!.value);
      const stage = view.container.querySelector('[data-application-frame-region="stage"]')!;
      await waitFor(() => expect(stage).toHaveAttribute("data-stage-navigation", docked ? "docked" : "overlay"));
      expect(stage).toHaveAttribute("data-stage-panel", docked ? "docked" : "overlay");
      expect(screen.getAllByRole("main")).toHaveLength(1);
      const main = screen.getByRole("main");
      const skip = screen.getByRole("link", { name: "Skip to content" });
      expect(skip).toHaveAttribute("href", `#${main.id}`);
      expect(main).toHaveAttribute("tabindex", "-1");
      expect(view.container.querySelector("a, button, input, [tabindex='0']")).toBe(skip);
      if (docked) {
        const inspector = screen.getByRole("complementary", { name: "Inspector" });
        expect(inspector).toContainElement(screen.getByRole("region", { name: "Inspector" }));
        expect(main.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      } else expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    }
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it("hands inspector focus to its trigger at 1023px and releases the sheet to main at 1024px", async () => {
    resize(1024);
    render(<AppFrame {...appProps()} />);
    screen.getByRole("button", { name: "Inspect item" }).focus();
    resize(1023);
    const trigger = screen.getByRole("button", { name: "Open panel" });
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Inspector" });
    for (let step = 0; step < 4; step++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    resize(1024);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
  });

  it.each(["site", "app"] as const)("mounts the host toast slot last in the %s shell without owning its live semantics", async shell => {
    const toasts = <section role="region" aria-label="Host notifications"><button>Dismiss notice</button><span role="status">Saved</span></section>;
    const view = render(shell === "app" ? <AppFrame {...appProps()} toasts={toasts} /> : <SiteFrame {...siteProps()} toasts={toasts} />);
    const root = view.container.firstElementChild!;
    const notifications = screen.getByRole("region", { name: "Host notifications" });
    expect(root.lastElementChild).toBe(notifications);
    expect(screen.getByRole("main")).not.toContainElement(notifications);
    expect(within(notifications).getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getAllByRole("button", { name: "Dismiss notice" })).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it.each(["site", "app"] as const)("mounts an existing Toaster through the %s slot in both themes", shell => {
    for (const theme of ["light", "dark"] as const) {
      document.documentElement.dataset.theme = theme;
      const toasts = <Toaster aria-label="Host notifications" />;
      const view = render(shell === "app" ? <AppFrame {...appProps()} theme={{ defaultPreference: theme }} toasts={toasts} /> : <SiteFrame {...siteProps()} toasts={toasts} />);
      act(() => { toast.success("Saved", { timeout: null }); });
      expect(screen.getAllByRole("region", { name: "Host notifications" })).toHaveLength(1);
      const notifications = within(screen.getByRole("region", { name: "Host notifications" }));
      expect(notifications.getByRole("status")).toHaveTextContent("Saved");
      expect(notifications.getByRole("status")).toHaveAttribute("aria-live", "polite");
      act(() => toast.dismissAll()); view.unmount();
    }
  });
});
