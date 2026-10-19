// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import { resolveShell } from "./internal/resolveShell.js";
import { siteShellFor } from "./surface.js";
import { SiteNavDisclosure as ServerNavigation } from "./NavDisclosure.server.js";
import type { SiteFrameConfig, SiteShellInput } from "./types.js";

const ref = (id: string) => ({ id });
const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 96, height: 36, alt: "Example mark" });
const icon = [["path", { d: "M4 12h16", key: "arrow" }]] as const;
const base: SiteShellInput = {
  brand: { assetId: "mark", label: ref("Example home"), size: "md", variant: "mark", plate: "self" },
  skipLink: ref("Skip to content"),
  nav: { label: ref("Primary"), triggerLabel: ref("Menu"), links: [{ href: "#help", label: ref("Help") }] },
  actions: [{ href: "/start", label: ref("Start now"), emphasis: "primary", icon }, { href: "/contact", label: ref("Contact") }],
  secondaryAction: { href: "/sign-in", label: ref("Sign in") },
  footer: { legal: { entity: ref("Example"), links: [{ href: "/privacy", label: ref("Privacy") }] } },
};

// Exercise the real private boundary's server and browser selections in the full frame.
vi.doMock("#publisher-frame-navigation", () => ({ SiteNavDisclosure: ServerNavigation }));
const { SiteFrame: ServerFrame } = await import("./SiteFrame.js");
vi.doUnmock("#publisher-frame-navigation");
vi.resetModules();
const { SiteFrame: ClientFrame } = await import("./SiteFrame.js");
afterEach(() => { vi.doUnmock("#publisher-frame-navigation"); vi.restoreAllMocks(); });

function tree(shell: SiteShellInput, server = false) {
  const Frame = server ? ServerFrame : ClientFrame;
  return <Frame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></Frame>;
}
function output(shell: SiteShellInput, server = false) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree(shell, server));
  return container;
}

it.each([false, true])("preserves explicit defaults and proves the new default chrome semantics (server=%s)", server => {
  const expected = renderToString(tree(base));
  expect(renderToString(tree(base, server))).toBe(expected);
  expect(renderToString(tree({ ...base, mobileLayout: "menu-brand-action", navPlacement: "centered" }, server))).toBe(expected);
  expect(renderToString(tree({ ...base, nav: { ...base.nav!, trigger: "label" } }, server))).toBe(expected);
  const container = output(base, server);
  for (const selector of ["header", "main#publisher-main-content", "footer", "header nav"]) expect(container.querySelectorAll(selector)).toHaveLength(1);
  expect(container.querySelector("main")).toHaveAttribute("tabindex", "-1");
  expect(container.querySelector('a[href="#publisher-main-content"]')).toHaveTextContent("Skip to content");
  expect(container.querySelector('header a[aria-label="Example home"] img')).toHaveAttribute("src", "/mark.svg");
  expect(container.querySelector("header")).toHaveTextContent("Start now");
  expect(container.querySelector("header")).toHaveTextContent("Contact");
  expect(container.querySelector("header")).toHaveTextContent("Sign in");
  expect(container.querySelector("footer")).toHaveTextContent("Privacy");
});

it.each([false, true])("forwards an action icon and retains its sr-only mobile label (server=%s)", server => {
  const shell = { ...base, actions: [{ ...base.actions![0]!, icon }] };
  const container = output(shell, server);
  const action = within(container.querySelector(".site-header-actions") as HTMLElement).getByRole("link", { name: "Start now" });
  expect(action).toHaveClass("bg-accent");
  expect(action.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(action.querySelector("svg path")).toHaveAttribute("d", "M4 12h16");
  expect(action.querySelector("span")).toHaveClass("sr-only", "tablet:not-sr-only");
  expect(action.querySelector("span")).toHaveTextContent("Start now");
});

it("validates and freezes action icons with the environment SVG allowlist", () => {
  const supplied = [["path", { d: "M4 12h16", key: "arrow" }]];
  const shell = { ...base, actions: [{ ...base.actions![0]!, icon: supplied }] } as SiteShellInput;
  const resolved = resolveShell(shell, resolveCopy, resolveAsset).actions[0]!.icon!;
  expect(resolved).toEqual([["path", { d: "M4 12h16" }]]);
  expect(Object.isFrozen(resolved)).toBe(true);
  expect(Object.isFrozen(resolved[0])).toBe(true);
  expect(Object.isFrozen(resolved[0]![1])).toBe(true);
  supplied[0]![1].d = "changed";
  expect(resolved[0]![1]).toEqual({ d: "M4 12h16" });
  for (const invalid of [[], [["script", {}]], [["path", { onClick: "payload" }]], [["path", { href: "/payload" }]], [["path", { fill: "url(#payload)" }]], [["path", { fill: "u\\72l(#payload)" }]], [["path", { d: 7 }]]]) {
    expect(() => resolveShell({ ...base, actions: [{ ...base.actions![0]!, icon: invalid }] } as SiteShellInput, resolveCopy, resolveAsset)).toThrow("shell.actions[0].icon is not plain SVG shape data");
    expect(() => resolveShell({ ...base, environments: [{ href: "/app", label: ref("App"), icon: invalid }] } as SiteShellInput, resolveCopy, resolveAsset)).toThrow("shell.environments[0].icon is not plain SVG shape data");
  }
});

it("refuses action icon data on ordinary navigation, secondary and footer links", () => {
  const link = { href: "/help", label: ref("Help"), icon };
  const legal = base.footer!.legal;
  for (const shell of [
    { ...base, nav: { ...base.nav!, links: [link] } },
    { ...base, secondaryAction: link },
    { ...base, footer: { legal, links: [link] } },
    { ...base, footer: { legal, columns: [{ heading: ref("Help"), links: [link] }] } },
    { ...base, footer: { legal: { ...legal, links: [link] } } },
  ]) expect(() => resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset)).toThrow(/unsupported field "icon"/);
});

it.each(["auto", "inverse", undefined] as const)("renders identical initial server/client icon triggers with %s tone", tone => {
  const shell: SiteShellInput = { ...base, nav: { ...base.nav!, trigger: "icon", tone } };
  const server = renderToString(tree(shell, true));
  expect(renderToString(tree(shell))).toBe(server);
  const toggle = within(output(shell, true)).getByRole("button", { name: "Menu" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle.textContent).toBe("");
  expect(toggle.querySelector(".nav-disclosure-icon")).toHaveAttribute("aria-hidden", "true");
  expect(toggle.querySelectorAll(".nav-disclosure-icon > span")).toHaveLength(2);
});

it("passes mobile layout through direct shells and siteShellFor into SiteHeader", () => {
  const config: SiteFrameConfig = { brand: base.brand, skipLink: base.skipLink, origin: "https://example.com", legal: base.footer!.legal, site: { mobileLayout: "menu-brand-action", nav: { ...base.nav!, trigger: "icon" }, actions: [{ ...base.actions![0]!, icon }] } };
  const shell = siteShellFor(config, "site");
  expect(shell.mobileLayout).toBe("menu-brand-action");
  expect(shell.nav?.trigger).toBe("icon");
  expect(shell.actions?.[0]?.icon).toBe(icon);
  for (const input of [shell, { ...base, mobileLayout: "menu-brand-action" } as SiteShellInput]) {
    for (const server of [false, true]) {
      const header = output(input, server).querySelector("header")!;
      expect(header.firstElementChild).toHaveClass("site-header-row");
      expect(header).toHaveAttribute("data-header-root");
      expect(header.querySelector('a[aria-label="Example home"] img')).toHaveAttribute("src", "/mark.svg");
    }
  }
  for (const kind of ["front-door", "admin", "demo"] as const) expect(siteShellFor(config, kind).mobileLayout).toBeUndefined();
});

// JSDOM cannot measure geometry. Guard the responsive positioning contract here;
// the Chromium proof measures the actual logo/control rectangles in both directions.
it.each(["one", "two", "three", "six", "twenty", "secondary", "long-secondary"] as const)("centers the mobile brand independently of %s trailing controls", controls => {
  const shell: SiteShellInput = {
    ...base,
    mobileLayout: "menu-brand-action",
    nav: { ...base.nav!, trigger: "icon" },
    actions: Array.from({ length: controls === "twenty" ? 20 : controls === "six" ? 6 : controls === "three" ? 3 : controls === "two" ? 2 : 1 }, (_, index) => ({ ...base.actions![0]!, href: `/action-${index}`, emphasis: (["primary", "secondary", "ghost"] as const)[index % 3], icon })),
    secondaryAction: controls === "long-secondary" ? { href: "/sign-in", label: ref("Averylongsecondaryactionwithoutwordbreaks") } : controls === "secondary" ? base.secondaryAction : undefined,
  };
  if (controls === "six" || controls === "twenty") { expect(() => output(shell)).toThrow(/three/); return; }
  for (const server of [false, true]) for (const navPlacement of ["centered"] as const) {
    const container = output({ ...shell, navPlacement }, server);
    const brand = within(container).getByRole("link", { name: "Example home" });
    expect(container.querySelector("header")).toHaveClass("site-header-contract");
    expect(container.querySelector("header > div")).toHaveClass("site-header-row");
    expect(brand.querySelector("img")).toHaveAttribute("src", "/mark.svg");
    expect(container.querySelectorAll('a[aria-label="Example home"]')).toHaveLength(1);
    expect(container.querySelectorAll("header nav")).toHaveLength(1);
  }
  expect(output(base).querySelector("header")).not.toHaveClass("max-tablet:[&>div]:grid-cols-3!");
});

it.each([undefined, "auto", "inverse"] as const)("retains overlay brand tone %s in the centered mobile layout", tone => {
  const shell: SiteShellInput = { ...base, brand: { ...base.brand, tone }, mobileLayout: "menu-brand-action", header: { placement: "overlay", tone: "inverse" } };
  expect(renderToString(tree(shell))).toBe(renderToString(tree(shell, true)));
  const brand = within(output(shell)).getByRole("link", { name: "Example home" });
  expect(brand).toHaveClass(tone === "auto" ? "text-ink-primary" : "text-ink-on-inverse");
});

it.each([false, true])("puts every full-label action in defined panel order in every frame layout (server=%s)", server => {
  const shell: SiteShellInput = { ...base, mobileLayout: "menu-brand-action", actions: base.actions!.map(action => ({ ...action, icon })) };
  const container = output(shell, server);
  const nav = within(container).getByRole("navigation", { name: "Primary" });
  const panel = nav.querySelector(".nav-disclosure-panel")!;
  const mobileActions = panel.querySelector(".site-header-desktop-actions")!;
  expect(mobileActions).not.toBeNull();
  expect([...mobileActions.querySelectorAll("a")].map(link => [link.getAttribute("href"), link.textContent])).toEqual([["/sign-in", "Sign in"], ["/contact", "Contact"], ["/start", "Start now"]]);
  expect(mobileActions.querySelectorAll("a")[2]).toHaveClass("bg-accent");
  expect(mobileActions.querySelectorAll("a")[1]).not.toHaveClass("bg-accent");
  expect(mobileActions.querySelectorAll("a")).toHaveLength(3);
  expect(mobileActions).toHaveTextContent("Sign inContactStart now");
  expect(panel.querySelectorAll("nav")).toHaveLength(0);
  expect(container.querySelectorAll("header nav")).toHaveLength(1);
  expect(container.querySelectorAll("header")).toHaveLength(1);
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.querySelectorAll("footer")).toHaveLength(1);
  expect(output({ ...shell, actions: [], secondaryAction: undefined }, server).querySelector(".site-header-desktop-actions")).toBeNull();
  for (const mobileLayout of [undefined, "inline"] as const) {
    expect(output({ ...shell, mobileLayout }, server).querySelector('.site-header-desktop-actions')).not.toBeNull();
  }
});

it("hydrates the real icon-trigger frame without markup drift and keeps disclosure interaction", async () => {
  const shell: SiteShellInput = { ...base, mobileLayout: "menu-brand-action", nav: { ...base.nav!, trigger: "icon" }, actions: base.actions!.map(action => ({ ...action, icon })) };
  const server = renderToString(tree(shell, true));
  expect(renderToString(tree(shell))).toBe(server);
  const container = document.createElement("div");
  container.innerHTML = server;
  document.body.append(container);
  // Keep anchor navigation inside this fixture while exercising real disclosure dismissal.
  container.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
  });
  const panelId = container.querySelector("header button")!.getAttribute("aria-controls");
  const recoverable = vi.fn();
  const consoleError = vi.spyOn(console, "error");
  const root = await act(async () => hydrateRoot(container, tree(shell), { onRecoverableError: recoverable }));
  try {
    const nav = within(container).getByRole("navigation", { name: "Primary" });
    const toggle = within(nav).getByRole("button", { name: "Menu" });
    const panel = nav.querySelector(".nav-disclosure-panel")!;
    expect(toggle).toHaveAttribute("aria-controls", panelId!);
    expect(panel.id).toBe(panelId);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveAttribute("data-expanded");
    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(within(panel as HTMLElement).getByRole("link", { name: "Start now" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it.each([
  ["shell.mobileLayout", { ...base, mobileLayout: "PAYLOAD-SENTINEL" }],
  ["shell.nav.trigger", { ...base, nav: { ...base.nav!, trigger: "PAYLOAD-SENTINEL" } }],
])("refuses invalid %s without echoing values", (path, shell) => {
  expect(() => resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset)).toThrow(path);
  try { resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset); } catch (error) { expect(String(error)).not.toContain("PAYLOAD-SENTINEL"); }
});


it.each([{ navPlacement: "leading" }, { mobileLayout: "inline" }] as const)("keeps every action once in explicit legacy positioning %j", positioning => {
  for (const server of [false, true]) {
    const root = output({ ...base, ...positioning }, server);
    expect(root.querySelector('header [data-header-primary]')).toBeNull();
    for (const [href, label] of [["/start", "Start now"], ["/contact", "Contact"], ["/sign-in", "Sign in"]]) {
      const actions = root.querySelectorAll(`header a[href="${href}"]`);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toHaveTextContent(label);
    }
  }
});

const grounded = (initial: "light" | "dark" = "dark"): SiteShellInput => ({
  ...base,
  brand: { ...base.brand, artwork: { onLight: "dark-art", onDark: "light-art" } },
  header: { placement: "overlay", sectionGround: { initial, sections: [{ id: "opening", ground: "dark" }, { id: "details", ground: "light" }] } },
});
const groundAsset = (id: string) => ({ ...resolveAsset(), src: `/${id}.svg` });
function groundTree(shell: SiteShellInput, server = false) {
  const Frame = server ? ServerFrame : ClientFrame;
  return <Frame shell={shell} resolveCopy={resolveCopy} resolveAsset={groundAsset}><section id="opening">Opening</section><section id="details">Details</section></Frame>;
}

it.each(["light", "dark"] as const)("renders authored %s initial ground and artwork identically on server and client", initial => {
  const shell = grounded(initial);
  const markup = renderToString(groundTree(shell, true));
  expect(renderToString(groundTree(shell))).toBe(markup);
  const container = document.createElement("div"); container.innerHTML = markup;
  expect(container.querySelector("header")).toHaveAttribute("data-section-ground", initial);
  expect(container.querySelector("header")).toHaveAttribute("data-tone", initial === "dark" ? "inverse" : "base");
  expect(container.querySelector("header img")).toHaveAttribute("src", initial === "dark" ? "/light-art.svg" : "/dark-art.svg");
});

it("refuses absent or partial authored pairs and invalid section-ground data without echoing values", () => {
  const shell = grounded();
  for (const artwork of [undefined, { onLight: "dark-art" }, { onLight: "", onDark: "light-art" }]) {
    expect(() => resolveShell({ ...shell, brand: { ...shell.brand, artwork } } as SiteShellInput, resolveCopy, groundAsset)).toThrow(/shell.brand.artwork/);
  }
  for (const sectionGround of [
    { initial: "auto", sections: [] }, { initial: "light", sections: [{ id: "", ground: "dark" }] },
    { initial: "light", sections: [{ id: "a", ground: "auto" }] },
    { initial: "light", sections: [{ id: "a", ground: "dark" }, { id: "a", ground: "light" }] },
    { initial: "light", sections: [], extra: true },
  ]) expect(() => resolveShell({ ...shell, header: { placement: "overlay", sectionGround } } as SiteShellInput, resolveCopy, groundAsset)).toThrow(/shell.header.sectionGround/);
  expect(() => resolveShell(shell, resolveCopy, () => ({ ...resolveAsset(), src: "javascript:invalid" }))).toThrow(/image asset/);
});

it.each([false, true])("updates ink, authored artwork and glass at the header edge, reverses and cleans up (navless=%s)", async navless => {
  const shell = { ...grounded(), ...(navless ? { nav: undefined, actions: undefined, secondaryAction: undefined } : {}) };
  const container = document.createElement("div");
  container.innerHTML = renderToString(groundTree(shell, true)); document.body.append(container);
  let offset = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => offset);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const top = this.id === "details" ? 600 - offset : this.id === "opening" ? -offset : 0;
    const height = this.tagName === "HEADER" ? 64 : 600;
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 390, width: 390, height, toJSON() {} };
  });
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, groundTree(shell), { onRecoverableError: error => errors.push(error) }); });
  const header = container.querySelector("header")!;
  const cross = async (next: number) => { offset = next; await act(async () => { window.dispatchEvent(new Event("scroll")); await new Promise(resolve => window.requestAnimationFrame(resolve)); }); };
  expect(header).not.toHaveAttribute("data-scrolled");
  await cross(535);
  expect(header).toHaveAttribute("data-section-ground", "dark");
  await cross(537);
  expect(header).toHaveAttribute("data-scrolled");
  expect(header).toHaveAttribute("data-section-ground", "light");
  expect(header).toHaveAttribute("data-tone", "base");
  expect(header.querySelector("img")).toHaveAttribute("src", "/dark-art.svg");
  await cross(0);
  expect(header).not.toHaveAttribute("data-scrolled");
  expect(header).toHaveAttribute("data-section-ground", "dark");
  expect(header.querySelector("img")).toHaveAttribute("src", "/light-art.svg");
  expect(errors).toEqual([]);
  await act(async () => root!.unmount());
  await cross(700);
  expect(header).not.toHaveAttribute("data-scrolled");
  container.remove();
});
