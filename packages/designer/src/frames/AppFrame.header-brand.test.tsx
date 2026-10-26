// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// A host still sending the retired wordmark/label/href fields must not get a header brand back.
const legacyBrand = { markSrc: "/example-mark.svg", wordmark: "Example", label: "Example console", href: "/tools/example" } as unknown as AppFrameProps["brand"];
function fixture(actor: boolean): AppFrameProps {
  return {
    brand: legacyBrand,
    navigation: { tree: [{ id: "nav.example", label: "Tools", href: "/tools/example" }], label: "Tools" },
    account: { ...(actor ? { actor: { name: "Sam River" } } : {}), signedOutLabel: "Signed out", sections: [{ id: "account", entries: [{ kind: "link", id: "profile", label: "Profile", href: "#profile" }] }] },
    commands: { heading: "Commands", triggerLabel: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "Empty", groups: [] },
    header: { title: "Overview", nav: { label: "Sections", activeId: "a", items: [{ id: "a", label: "First", href: "#a" }, { id: "b", label: "Second", href: "#b" }] } },
    children: <p>Content</p>,
  };
}

describe("AppFrame header carries no brand", () => {
  it.each([true, false])("renders no wordmark or brand link in the header; the profile shows initials, the signed-out row the plate mark (actor %s)", actor => {
    render(<AppFrame {...fixture(actor)} />);
    const header = document.querySelector('[data-application-frame-region="header"]');
    expect(header).not.toBeNull();
    expect(header!.textContent).not.toContain("Example");
    expect(header!.querySelector('a[href="/tools/example"]')).toBeNull();
    expect(header!.querySelector('a[aria-label="Example console"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Example console" })).toBeNull();
    expect(header!.querySelector("img")).toBeNull();
    const profile = screen.getByRole("button", { name: actor ? "Sam River" : "Signed out" });
    if (actor) expect(profile.querySelector("img")).toBeNull();
    else expect(profile.querySelector("img")).toHaveAttribute("src", "/example-mark.svg");
    expect(profile.closest('[data-application-navigation-region="footer"]')).not.toBeNull();
  });
});
