// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import type { AppFrameAccountAvatar, AppFrameBrand, AppFrameFooterLayout, AppFrameProps } from "./index.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const MARK = "/example-mark.svg";
function fixture({ actor = true, brand = { markSrc: MARK }, avatar, footerLayout }: { actor?: boolean; brand?: AppFrameBrand; avatar?: AppFrameAccountAvatar; footerLayout?: AppFrameFooterLayout } = {}): AppFrameProps {
  return {
    brand,
    navigation: { tree: [{ id: "nav.example", label: "Tools", href: "/tools/example" }], label: "Tools" },
    account: { ...(actor ? { actor: { name: "Sam River" } } : {}), ...(avatar ? { avatar } : {}), signedOutLabel: "Signed out of every workspace on this device", sections: [{ id: "account", entries: [{ kind: "link", id: "profile", label: "Profile", href: "#profile" }] }] },
    commands: { heading: "Commands", triggerLabel: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "Empty", groups: [] },
    ...(footerLayout ? { footerLayout } : {}),
    children: <p>Content</p>,
  };
}
const navTop = () => document.querySelector<HTMLElement>('[data-application-navigation-region="header"]')!;
const navFooter = () => document.querySelector<HTMLElement>('[data-application-navigation-region="footer"]')!;

describe("AppFrame navigation brand mark", () => {
  it("renders the host mark at the navigation top by default, in the reserved corner row, at its plate radius", () => {
    render(<AppFrame {...fixture()} />);
    const slot = navTop().querySelector<HTMLElement>('[data-application-frame-slot="brand"]')!;
    expect(slot).not.toBeNull();
    const mark = slot.querySelector("img")!;
    expect(mark).toHaveAttribute("src", MARK);
    // The plate keeps its own radius: no pill-clipped Avatar wraps the mark.
    expect(mark.closest(".rounded-pill")).toBeNull();
    expect(slot.compareDocumentPosition(screen.getByRole("button", { name: "Commands" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.style.minBlockSize).toContain("--ui-layout-tap-target");
  });

  it("renders the host mark and its name at the navigation top, before search, never in the header bar", () => {
    render(<AppFrame {...fixture({ brand: { markSrc: MARK, navigationMark: { label: "Example Studio" } } })} />);
    const slot = navTop().querySelector<HTMLElement>('[data-application-frame-slot="brand"]')!;
    expect(slot).not.toBeNull();
    expect(slot.querySelector("img")).toHaveAttribute("src", MARK);
    expect(slot).toHaveTextContent("Example Studio");
    expect(slot.querySelector(".truncate")).toHaveTextContent("Example Studio");
    // The brand row takes the corner row: it precedes command search and replaces the bare padding.
    expect(slot.compareDocumentPosition(screen.getByRole("button", { name: "Commands" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.style.minBlockSize).toContain("--ui-layout-tap-target");
    expect(document.querySelector('[data-application-frame-region="header"]')!.textContent).not.toContain("Example Studio");
  });

  it("refuses an empty navigation brand name", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AppFrame {...fixture({ brand: { markSrc: MARK, navigationMark: { label: "  " } } })} />)).toThrow(/brand name/);
  });
});

describe("AppFrame account avatar", () => {
  it("shows the actor's initials in the profile Avatar by default, never the circle-clipped mark", () => {
    render(<AppFrame {...fixture()} />);
    const profile = screen.getByRole("button", { name: "Sam River" });
    expect(profile.querySelector("img")).toBeNull();
    expect(profile.querySelector('[role="img"][aria-label="Sam River"]')).toHaveTextContent("SR");
  });

  it("keeps the host mark in the profile Avatar when avatar is mark", () => {
    render(<AppFrame {...fixture({ avatar: "mark" })} />);
    expect(screen.getByRole("button", { name: "Sam River" }).querySelector("img")).toHaveAttribute("src", MARK);
  });

  it("shows the actor's initials in a Foundry Avatar when avatar is initials", () => {
    render(<AppFrame {...fixture({ avatar: "initials" })} />);
    const profile = screen.getByRole("button", { name: "Sam River" });
    expect(profile.querySelector("img")).toBeNull();
    const avatar = profile.querySelector<HTMLElement>('[role="img"][aria-label="Sam River"]')!;
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveClass("rounded-pill");
    expect(avatar).toHaveTextContent("SR");
  });

  it("keeps the mark for a signed-out row, which has no person to take initials from", () => {
    render(<AppFrame {...fixture({ actor: false, avatar: "initials" })} />);
    const mark = navFooter().querySelector("img")!;
    expect(mark).toHaveAttribute("src", MARK);
    // The signed-out mark is the plate itself, not a 999px circle crop.
    expect(mark.closest(".rounded-pill")).toBeNull();
  });
});

describe("AppFrame footer layout", () => {
  it("defaults to one inline row: account beside the theme control", () => {
    render(<AppFrame {...fixture()} />);
    const row = navFooter().firstElementChild as HTMLElement;
    expect(row).toHaveClass("flex", "items-center", "justify-between");
    expect(row).not.toHaveClass("flex-col");
    expect(row.querySelector('[data-application-frame-slot="theme-control"]')!.parentElement).toBe(row);
  });

  it("stacked gives the theme control its own row and the account row the full width", () => {
    render(<AppFrame {...fixture({ footerLayout: "stacked" })} />);
    const stack = navFooter().firstElementChild as HTMLElement;
    expect(stack).toHaveAttribute("data-application-frame-footer", "stacked");
    expect(stack).toHaveClass("flex", "flex-col");
    const [theme, account] = [...stack.children] as HTMLElement[];
    expect(theme).toHaveAttribute("data-application-frame-slot", "theme-control");
    expect(account).toHaveAttribute("data-application-frame-slot", "account");
    expect(account).toHaveClass("w-full", "min-w-0");
    expect(account).toContainElement(screen.getByRole("button", { name: "Sam River" }));
    expect(theme).not.toContainElement(screen.getByRole("button", { name: "Sam River" }));
  });

  it("stacked with themeControl null keeps only the full-width account row", () => {
    render(<AppFrame {...fixture({ footerLayout: "stacked" })} themeControl={null} />);
    const stack = navFooter().firstElementChild as HTMLElement;
    expect(stack.children).toHaveLength(1);
    expect(stack.firstElementChild).toHaveAttribute("data-application-frame-slot", "account");
  });

  it("truncates a long signed-out label instead of widening the navigation", () => {
    render(<AppFrame {...fixture({ actor: false, footerLayout: "stacked" })} />);
    const label = screen.getByText("Signed out of every workspace on this device");
    expect(label).toHaveClass("min-w-0", "truncate");
  });
});
