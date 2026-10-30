// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { shellCopyFixtureResolver } from "./__fixtures__/shell-copy.js";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(): AppFrameProps {
  return {
    copyResolver: shellCopyFixtureResolver,
    brand: { markSrc: "/mark.svg" },
    navigation: { label: "Workspace", tree: [{ id: "home", label: "Home", href: "#home" }] },
    account: { actor: { name: "Example Co.", secondaryText: "Workbench" }, signedOutLabel: "Account", sections: [{ id: "links", entries: [{ id: "site", kind: "link", label: "Website", href: "https://example.com", target: "_blank" }] }] },
    commands: { triggerLabel: "Find commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    theme: { defaultPreference: "light" },
    pageManifest: { id: "home", breadcrumbs: [{ id: "home", label: "Home" }], actions: [] },
    children: <p>Page body</p>,
  };
}
it("omits every disabled panel affordance and keeps one page-owned main", () => {
  const { container } = render(<AppFrame {...fixture()} />);
  expect(container.querySelector('[data-application-frame-panel="trigger"]')).toBeNull();
  expect(container.querySelector('[data-application-frame-region="panel"]')).toBeNull();
  expect(container.querySelector('.frame-docked-panel')).toBeNull();
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("main")).toHaveTextContent("Page body");
  const header = container.querySelector<HTMLElement>('[data-page-frame-header]')!;
  expect(within(header).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  expect(within(header).queryByRole("button")).toBeNull();
});
it("configures the account title/subtitle, consumer mark and protected link independently from binary theme", async () => {
  const user = userEvent.setup();
  render(<AppFrame {...fixture()} />);
  const tile = screen.getByRole("button", { name: "Example Co." });
  expect(tile).toHaveTextContent("Workbench");
  expect(tile.querySelector("img")).toHaveAttribute("src", "/mark.svg");
  await user.click(screen.getByRole("button", { name: "Dark" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  await user.click(screen.getByRole("button", { name: "Light" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  await user.click(tile);
  const link = screen.getByRole("menuitem", { name: "Website" });
  expect(link).toHaveAttribute("href", "https://example.com");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
