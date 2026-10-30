import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { importFoundryFrames } from "../../importers/foundry-frames.js";
import { renderSiteHeader, siteHeaderProps } from "./site-header.js";
import { renderSiteFooter, siteFooterProps } from "./site-footer.js";

afterEach(cleanup);
const locale: RuntimeJson = { label: "Language", links: [{ label: "English", locale: "en", href: "/", isCurrent: true }, { label: "Français", locale: "fr", href: "/fr" }] };
function input(leaf: string, values: Record<string, RuntimeJson>, members: string[] = []): RuntimeRenderInput<ReactNode> {
  return { content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: { kind: "region", ref: key }, value, hash: "sha256:0" }])), selection: { leaf, fill: `foundry/${leaf}`, members, config: null, content: {} }, slots: {} } as unknown as RuntimeRenderInput<ReactNode>;
}
const header = () => input("frames.site-header", {
  brand: { label: "Example Co.", markSrc: "/mark.svg" },
  nav: { label: "Navigation", triggerLabel: "Open navigation", links: [{ label: "Home", href: "/" }], mega: [{ id: "explore", label: "Explore", columns: [{ heading: "Guides", links: [{ label: "Overview", href: "/overview" }] }] }] },
  locale,
}, ["nav.mega"]);

it("executes the selected standalone mega member and locale slot through the real header renderer", async () => {
  render(renderSiteHeader(header()));
  const banner = screen.getByRole("banner");
  expect(banner).toHaveAttribute("data-nav-mode", "mega");
  expect(within(banner).getByRole("navigation", { name: "Language" })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Explore" }));
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("executes standalone footer locale and newsletter slots with the native same-origin POST binding", () => {
  render(renderSiteFooter(input("frames.site-footer", { locale, newsletter: { action: "/subscribe", emailLabel: "Email", submitLabel: "Subscribe", pendingLabel: "Sending", sentMessage: "Subscribed", failedMessage: "Try again" } })));
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "page");
  const form = within(footer).getByRole("textbox", { name: "Email" }).closest("form")!;
  expect(form).toHaveAttribute("action", "/subscribe");
  expect(form).toHaveAttribute("method", "post");
});

it("maps each new canonical member and slot without claiming inherited legacy gaps are closed", () => {
  const rows = new Map(importFoundryFrames().coverage.map(row => [row.slot, row]));
  expect(rows.get("frames.site-header")?.supported).toContain("nav.mega");
  expect(rows.get("frames.site-header")?.missingSlots).not.toContain("locale");
  expect(rows.get("frames.site-footer")?.missingSlots).not.toContain("locale");
  expect(rows.get("frames.site-footer")?.missingSlots).not.toContain("newsletter");
  expect(rows.get("frames.site-shell")?.missingSlots).not.toContain("announcement");
});

it("refuses unknown content and unsafe submissions rather than silently dropping new slot fields", () => {
  const value = header();
  expect(() => siteHeaderProps({ ...value, content: { ...value.content, unknown: value.content.nav! } })).toThrow("no mapped prop");
  expect(() => siteFooterProps(input("frames.site-footer", { newsletter: { action: "https://example.test/submit" } }))).toThrow("same-origin");
  const nav = { label: "Navigation", triggerLabel: "Open navigation", mega: [{ id: "explore", label: "Explore", columns: [{ heading: "Guides", links: [{ label: "Unsafe", href: "javascript:alert(1)" }] }] }] };
  expect(() => siteHeaderProps(input("frames.site-header", { brand: { label: "Example Co.", markSrc: "/mark.svg" }, nav }, ["nav.mega"]))).toThrow("safe destination");
});
