// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toaster, toast as globalToast } from "../shell/Toaster.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import { useFrameNotice, type AppFrameNotice } from "./frame-notices.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { act(() => globalToast.dismissAll()); cleanup(); vi.unstubAllGlobals(); });

function props(children: AppFrameProps["children"], extra: Partial<AppFrameProps> = {}): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
    account: { signedOutLabel: "Account", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    children, ...extra,
  };
}
const notices = () => document.querySelector<HTMLElement>('[data-application-frame-region="dock"] [data-frame-notices]');

function Page({ notice }: { notice: AppFrameNotice | null }) {
  const { toast } = useFrameNotice(notice);
  return <button onClick={() => toast.success("Copied, paste into Figma")}>Copy</button>;
}

it("lands a page-submitted notice in the frame notice region and withdraws it with the page", () => {
  const view = render(<AppFrame {...props(<Page notice={{ id: "load", severity: "error", text: "Library failed to load" }} />)} />);
  expect(notices()).toContainElement(screen.getByText("Library failed to load"));
  expect(screen.getByText("Library failed to load").closest('[role="alert"]')).not.toBeNull();
  view.rerender(<AppFrame {...props(<Page notice={null} />)} />);
  expect(screen.queryByText("Library failed to load")).toBeNull();
});

it("orders page notices after host notices and keeps the frame's severity and dismissal rules", async () => {
  render(<AppFrame {...props(<Page notice={{ id: "page", severity: "info", text: "Page information" }} />, { notices: [{ id: "host", severity: "warning", text: "Host warning" }] })} />);
  expect(notices()!.textContent).toBe("Host warningPage information");
  await userEvent.click(within(screen.getByText("Page information").closest('[role="status"]') as HTMLElement).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Page information")).toBeNull();
  expect(screen.getByText("Host warning")).toBeVisible();
});

it("updates a live notice's text without remounting it", () => {
  function Counter() {
    const [count, setCount] = useState(0);
    useFrameNotice({ id: "count", severity: "info", text: <span>Pending {count}</span>, dismissible: false });
    return <button onClick={() => setCount(count + 1)}>More</button>;
  }
  render(<AppFrame {...props(<Counter />)} />);
  expect(screen.getByText("Pending 0")).toBeVisible();
  act(() => screen.getByRole("button", { name: "More" }).click());
  expect(screen.getByText("Pending 1")).toBeVisible();
  expect(screen.queryByText("Pending 0")).toBeNull();
});

it("routes a page toast to the frame's Toaster, anchored to the stage corner clear of the header and dock", async () => {
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return this.dataset.applicationFrameRegion === "stage" ? new DOMRect(240, 56, 800, 600) : bounds.call(this);
  });
  vi.stubGlobal("innerWidth", 1280); vi.stubGlobal("innerHeight", 800);
  render(<AppFrame {...props(<Page notice={null} />, { toasts: <Toaster /> })} />);
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  const message = await screen.findByText("Copied, paste into Figma");
  const region = message.closest<HTMLElement>('[data-toaster-placement]')!;
  expect(region.dataset.toasterPlacement).toBe("frame");
  expect(document.querySelector("main")).not.toContainElement(message);
  expect(region.style.bottom).toBe("calc(144px + var(--spacing-md))");
  expect(region.style.right).toBe("calc(240px + var(--spacing-md))");
});

it("keeps a Toaster outside a frame on the viewport corner", async () => {
  render(<Toaster />);
  act(() => { globalToast.info("Standalone"); });
  const region = (await screen.findByText("Standalone")).closest<HTMLElement>('[data-toaster-placement]')!;
  expect(region.dataset.toasterPlacement).toBe("viewport");
  expect(region.style.bottom).toBe("");
});

it("refuses a notice hook outside a frame", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Page notice={null} />)).toThrow(/AppFrame/);
});
