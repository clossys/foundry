import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SiteHeader } from "../../shell/SiteHeader.js";
import { Link } from "../../components/Link.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";
import { NavLinks } from "./NavLinks.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  return <><Link href="#outside">Outside</Link><SiteHeader surface="glass" brand={<Link href="#home">Home</Link>} nav={
    <FrameNavDisclosure trigger="icon" aria-label="Primary" triggerLabel="Menu" closeLabel="Close navigation">
      <NavLinks links={[{ href: "#products", label: "Products", isCurrent: true }, { href: "#pricing", label: "Pricing" }, { href: "#help", label: "Help" }]} actions={[{ href: "#start", label: "Start now", emphasis: "primary" }]} />
    </FrameNavDisclosure>
  } /></>;
}

it("uses the registered Sheet with a named dialog, a close control and background exclusion", async () => {
  const user = userEvent.setup();
  render(fixture());
  const trigger = screen.getByRole("button", { name: "Menu" });
  const inline = document.querySelector(".nav-disclosure-panel")!;
  expect(inline).toHaveAttribute("inert");
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Primary" });
  expect(dialog).toHaveAttribute("data-slot", "sheet");
  expect(dialog).toHaveAttribute("id", trigger.getAttribute("aria-controls"));
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(inline).toHaveAttribute("inert");
  expect(within(dialog).getAllByRole("link").map(link => link.textContent)).toEqual(["Products", "Pricing", "Help", "Start now"]);
  expect(within(dialog).getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
  expect(within(dialog).getByRole("link", { name: "Start now" })).toHaveClass("bg-action");
  expect(screen.queryByRole("link", { name: "Outside" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Close navigation" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole("link", { name: "Outside" })).toBeInTheDocument();
});

it("supports Enter, contained Tab/Shift+Tab, Escape, focus return and repeated opening", async () => {
  const user = userEvent.setup();
  render(fixture());
  const trigger = screen.getByRole("button", { name: "Menu" });
  act(() => trigger.focus());
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Primary" });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  for (let step = 0; step < 7; step++) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  for (let step = 0; step < 7; step++) {
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.keyboard(" ");
  const reopened = await screen.findByRole("dialog");
  await user.click(within(reopened).getByRole("link", { name: "Help" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("inherits the registered Sheet reduced-motion overrides", async () => {
  const user = userEvent.setup();
  render(fixture());
  await user.click(screen.getByRole("button", { name: "Menu" }));
  const dialog = await screen.findByRole("dialog");
  const surface = dialog.closest('[data-slot="sheet-content"]')!;
  expect(surface).toHaveAttribute("data-side", "right");
  expect(surface).toHaveClass("data-[side=right]:end-0", "motion-reduce:transition-none", "motion-reduce:animate-none", "motion-reduce:duration-0");
  expect(dialog.closest('[data-slot="sheet-overlay"]')).toHaveClass("motion-reduce:transition-none", "motion-reduce:animate-none", "motion-reduce:duration-0");
});

it("moves focus to the matching inline link when an open drawer becomes desktop navigation", async () => {
  const user = userEvent.setup();
  let desktop = false;
  vi.stubGlobal("matchMedia", () => ({ get matches() { return desktop; }, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 60, right: this.classList.contains("site-header-row") ? 1200 : 80, width: this.classList.contains("site-header-row") ? 1200 : 80, height: 60, toJSON() {} };
  });
  render(fixture());
  const trigger = screen.getByRole("button", { name: "Menu" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog");
  act(() => within(dialog).getByRole("link", { name: "Help" }).focus());
  desktop = true;
  fireEvent.resize(window);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const inline = document.querySelector(".site-header-nav-inline") as HTMLElement;
  await waitFor(() => expect(within(inline).getByRole("link", { name: "Help" })).toHaveFocus());
  expect(inline).not.toHaveAttribute("inert");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  desktop = false;
  fireEvent.resize(window);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(inline).toHaveAttribute("inert");
});
