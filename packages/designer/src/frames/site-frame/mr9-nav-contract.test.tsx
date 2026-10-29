import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Link } from "../../components/Link.js";
import { SiteHeader } from "../../shell/SiteHeader.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";
import { SiteNavDisclosure as ClientNavigation } from "./NavDisclosure.client.js";
import { SiteNavDisclosure as ServerNavigation } from "./NavDisclosure.server.js";
import { NavLinks } from "./NavLinks.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const links = [
  { href: "/products?view=all#details", label: "Products", isCurrent: true },
  { href: "https://status.example.com/current", label: "Status" },
  { href: "#help", label: "Help" },
];
const actions = [{ href: "https://contact.example.com/start?from=site", label: "Get started", emphasis: "primary" as const }];
const nav = { label: "Primary", triggerLabel: "Menu", closeLabel: "Close navigation", links };

function fixture(label = "Products") {
  return <SiteHeader brand={<Link href="#home">Home</Link>} nav={
    <FrameNavDisclosure aria-label={nav.label} triggerLabel={nav.triggerLabel} closeLabel={nav.closeLabel} trigger="icon">
      <NavLinks links={[{ ...links[0]!, label }, ...links.slice(1)]} actions={actions} />
    </FrameNavDisclosure>
  } />;
}

it("preserves resolved destinations, current state and external relationship in both server and drawer links", async () => {
  const server = renderToString(<ServerNavigation nav={nav} actions={actions} />);
  expect(renderToString(<ClientNavigation nav={nav} actions={actions} />)).toBe(server);
  const markup = document.createElement("div");
  markup.innerHTML = server;
  const assertLinks = (container: HTMLElement) => {
    const navigation = within(container);
    expect(navigation.getByRole("link", { name: "Products" })).toHaveAttribute("href", links[0]!.href);
    expect(navigation.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
    expect(navigation.getByRole("link", { name: "Products" })).not.toHaveAttribute("rel");
    expect(navigation.getByRole("link", { name: "Help" })).toHaveAttribute("href", "#help");
    for (const [name, href] of [["Status", links[1]!.href], ["Get started", actions[0]!.href]]) {
      const link = navigation.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).not.toHaveAttribute("aria-current");
    }
  };
  assertLinks(markup);
  const user = userEvent.setup();
  render(fixture());
  await user.click(screen.getByRole("button", { name: "Menu" }));
  assertLinks(await screen.findByRole("dialog", { name: "Primary" }));
});

it("dismisses an open drawer when resolved navigation changes and returns focus to its trigger", async () => {
  const user = userEvent.setup();
  const view = render(fixture());
  const trigger = screen.getByRole("button", { name: "Menu" });
  await user.click(trigger);
  expect(await screen.findByRole("dialog", { name: "Primary" })).toBeInTheDocument();
  view.rerender(fixture("Updated products"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(document.querySelector(".site-header-nav-inline")).toHaveTextContent("Updated products");
});

it("collapses for intrinsic content width and expands only after the fit hysteresis clears", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  let available = 700;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("site-header-row") ? available
      : this.closest(".site-header-nav-links") ? 500 : 150;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 60, right: width, width, height: 60, toJSON() {} };
  });
  render(fixture());
  const header = document.querySelector("header")!;
  const inline = document.querySelector(".site-header-nav-inline")!;
  expect(header).toHaveAttribute("data-collapsed");
  expect(inline).toHaveAttribute("inert");
  available = 800;
  fireEvent.resize(window);
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(header).toHaveAttribute("data-collapsed");
  available = 1200;
  fireEvent.resize(window);
  await waitFor(() => expect(header).not.toHaveAttribute("data-collapsed"));
  expect(inline).not.toHaveAttribute("inert");
  expect(header).not.toHaveAttribute("data-measuring");
});

it("keeps native keyboard dismissal and focus restoration when reduced motion is requested", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const user = userEvent.setup();
  render(fixture());
  const trigger = screen.getByRole("button", { name: "Menu" });
  act(() => trigger.focus());
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Primary" });
  const surface = dialog.closest('[data-slot="sheet-content"]')!;
  // Sheet applies the utility to its surface root, outside the header portal.
  expect(surface.matches('.site-header-nav-sheet[data-slot="sheet-content"]')).toBe(true);
  expect(surface).toHaveClass("motion-reduce:transition-none", "motion-reduce:animate-none", "motion-reduce:duration-0");
  expect(dialog.closest('[data-slot="sheet-overlay"]')).toHaveClass("motion-reduce:transition-none", "motion-reduce:animate-none", "motion-reduce:duration-0");
  await user.tab();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
