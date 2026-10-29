import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SiteAnnouncement, SiteLocaleLinks } from "./SiteHeader.extras.js";

afterEach(cleanup);

it("renders nothing for one locale and marks the current route among actual alternates", () => {
  const links = [{ href: "/", label: "English", locale: "en", isCurrent: true }];
  const { container, rerender } = render(<SiteLocaleLinks label="Language" links={links} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<SiteLocaleLinks label="Language" links={[...links, { href: "/fr", label: "Français", locale: "fr" }]} />);
  expect(screen.getByRole("navigation", { name: "Language" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Français" })).toHaveAttribute("href", "/fr");
});

it("refuses unsafe or ambiguous alternate links", () => {
  expect(() => SiteLocaleLinks({ label: "Language", links: [
    { href: "/", label: "English", locale: "en", isCurrent: true },
    { href: "//example.test/fr", label: "Français", locale: "fr" },
  ] })).toThrow("local route");
});

it("announces content, calls host dismissal and hides only when controlled", async () => {
  const dismiss = vi.fn();
  const { rerender } = render(<SiteAnnouncement onDismiss={dismiss} dismissLabel="Dismiss announcement">An update</SiteAnnouncement>);
  await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss announcement" }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("An update");
  rerender(<SiteAnnouncement dismissed onDismiss={dismiss} dismissLabel="Dismiss announcement">An update</SiteAnnouncement>);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
