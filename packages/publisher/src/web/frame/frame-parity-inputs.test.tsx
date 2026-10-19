// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "#publisher-web-views";
import { SiteFrame } from "./SiteFrame.js";
import type { SiteShellInput } from "./types.js";
import { resolveShell } from "./internal/resolveShell.js";

const ref = (id: string) => ({ id });
const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example mark" });
const brand = { assetId: "mark", label: ref("Example home"), size: "md", variant: "lockup", wordmark: ref("Example") } as const;
const legal = { entity: ref("Example"), links: [{ href: "/privacy", label: ref("Privacy") }, { href: "/terms", label: ref("Terms") }] };
const base: SiteShellInput = { brand, skipLink: ref("Skip to content"), actions: [{ href: "/start", label: ref("Start") }], footer: { ground: "transparent", legal } };
const nav = { label: ref("Primary"), triggerLabel: ref("Menu"), links: [{ href: "#help", label: ref("Help") }] };
function page(options: Record<string, unknown> = {}): ResolvedSectionedViewDocument {
  return { id: "home", resolutions: [resolveCopy(ref("Welcome"))!], sections: [{ id: "hero", kind: "hero", ground: "inverse", eyebrow: "Eyebrow", heading: "Welcome", description: "Supporting words.", ...options }] } as ResolvedSectionedViewDocument;
}
function frame(shell: SiteShellInput = base, options: Record<string, unknown> = {}): ReactElement {
  return <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><LandingView document={page(options)} landmark="none" header="overlay" fit="frame" /></SiteFrame>;
}
function output(element: ReactElement, mode: "server" | "client"): HTMLElement {
  if (mode === "client") return render(element).container;
  const host = document.createElement("div");
  host.innerHTML = renderToString(element);
  return host;
}
afterEach(cleanup);

const defaults = {
  reserved: base,
  inverse: { ...base, header: { placement: "overlay", tone: "inverse" } },
  "overlay-footer": { ...base, header: { placement: "overlay", tone: "inverse" }, footer: { placement: "overlay", ground: "inverse", legal } },
} satisfies Record<string, SiteShellInput>;

for (const mode of ["server", "client"] as const) {
  for (const [name, shell] of Object.entries(defaults)) it(`proves default frame semantics: ${mode} ${name}`, () => {
    const root = output(frame(shell), mode);
    for (const selector of ["header", "main#publisher-main-content", "footer"]) expect(root.querySelectorAll(selector)).toHaveLength(1);
    expect(root.querySelector("main")).toHaveAttribute("tabindex", "-1");
    expect(root.querySelector("h1")).toHaveTextContent("Welcome");
    expect(root.querySelector("header")).toHaveClass("site-header-contract");
    expect(root.querySelector("header")).toHaveTextContent("Start");
    expect(root.querySelector("footer")).toHaveTextContent("Privacy");
    expect(root.querySelector("footer")).toHaveTextContent("Terms");
    if (name === "reserved") expect(root.querySelector("header")).not.toHaveAttribute("data-placement");
    else expect(root.querySelector("header")).toHaveAttribute("data-placement", "overlay");
    expect(root.querySelector("[data-frame-footer-overlay]") !== null).toBe(name === "overlay-footer");
  });

  it(`forwards primary action emphasis: ${mode}`, () => {
    const shell = { ...base, actions: [{ ...base.actions![0], emphasis: "primary", icon: [["path", { d: "M4 12h16" }]] }] } as SiteShellInput;
    const action = output(frame(shell), mode).querySelector('header a[href="/start"]');
    expect(action).toHaveClass("bg-accent");
    const secondary = output(frame({ ...base, actions: [{ ...base.actions![0], emphasis: "secondary" }] } as SiteShellInput), mode);
    expect(secondary.querySelector('header a[href="/start"]')).not.toHaveClass("bg-accent");
  });

  it(`forwards authored brand tone and preserves inverse inheritance: ${mode}`, () => {
    for (const variant of ["mark", "lockup"] as const) {
      const variantBrand = variant === "mark" ? { assetId: "mark", label: ref("Example home"), size: "md", variant } : brand;
      const shell = { ...base, brand: { ...variantBrand, tone: "inverse" } } as SiteShellInput;
      expect(output(frame(shell), mode).querySelector('header a[aria-label="Example home"]')).toHaveClass("text-ink-on-inverse", "focus-visible:outline-ink-on-inverse");
      const auto = { ...defaults.inverse, brand: { ...variantBrand, tone: "auto" } } as SiteShellInput;
      expect(output(frame(auto), mode).querySelector('header a[aria-label="Example home"]')).toHaveClass("text-ink-primary", "focus-visible:outline-accent");
      expect(output(frame({ ...defaults.inverse, brand: variantBrand } as SiteShellInput), mode).querySelector('header a[aria-label="Example home"]')).toHaveClass("text-ink-on-inverse");
    }
  });

  it(`forwards only the transparent footer top rule: ${mode}`, () => {
    const shell = { ...base, footer: { ground: "transparent", rule: "top", legal } } as SiteShellInput;
    const footer = output(frame(shell), mode).querySelector("footer")!;
    expect(footer).toHaveClass("border-t", "border-line-base");
    expect(footer.querySelector(".border-t")).toBeNull();
    for (const ground of ["base", "inverse"] as const) {
      const ordinary = output(frame({ ...base, footer: { ground, legal } }), mode).querySelector("footer")!.outerHTML;
      expect(output(frame({ ...base, footer: { ground, rule: "top", legal } } as SiteShellInput), mode).querySelector("footer")!.outerHTML).toBe(ordinary);
    }
  });

  it(`forwards navigation tone and retains inherited omission: ${mode}`, () => {
    const shell = { ...base, nav: { ...nav, tone: "inverse" } } as SiteShellInput;
    const toggle = output(frame(shell), mode).querySelector("header button")!;
    expect(toggle).toHaveAttribute("data-tone", "inverse");
    expect(toggle).toHaveClass("text-ink-on-inverse", "hover:text-ink-on-inverse", "aria-expanded:text-ink-on-inverse", "focus-visible:text-ink-on-inverse", "focus-visible:outline-ink-on-inverse", "hover:bg-control-tonal-inverse-hover");
    expect(toggle).not.toHaveClass("text-ink-primary", "hover:bg-surface-sunken", "focus-visible:outline-accent");
    const explicit = output(frame({ ...defaults.inverse, nav: { ...nav, tone: "auto" } } as SiteShellInput), mode).querySelector("header button")!;
    expect(explicit).toHaveAttribute("data-tone", "auto");
    expect(explicit).toHaveClass("text-ink-primary", "focus-visible:outline-accent");
    expect(output(frame({ ...defaults.inverse, nav }), mode).querySelector("header button")).not.toHaveAttribute("data-tone");
  });

  it(`composes the exact home shape: ${mode}`, () => {
    const shell = { ...defaults.inverse, actions: [{ ...base.actions![0], emphasis: "primary", icon: [["path", { d: "M4 12h16" }]] }], footer: { ground: "transparent", rule: "top", legal } } as SiteShellInput;
    const root = output(frame(shell, { eyebrowTone: "muted", measure: "wide", headingScale: "display" }), mode);
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelectorAll("header")).toHaveLength(1);
    expect(root.querySelectorAll("footer")).toHaveLength(1);
    expect(root.querySelector("main")).toHaveAttribute("id", "publisher-main-content");
    expect(root.querySelector("main")).toHaveAttribute("tabindex", "-1");
    expect(root.querySelector("header")).toHaveClass("site-header-overlay");
    expect(root.querySelector("header")).toHaveAttribute("data-tone", "inverse");
    expect(root.querySelector("header nav")).toHaveAttribute("aria-label", "Primary");
    expect(root.querySelector(".site-header-nav-links")).toBeNull();
    expect(root.querySelector("header img")).toHaveAttribute("src", "/mark.svg");
    expect(root.querySelector('header a[aria-label="Example home"]')).toHaveTextContent("Example");
    const actions = root.querySelectorAll('header a[href="/start"]');
    expect(actions).toHaveLength(2);
    expect(actions[0]).toHaveClass("bg-accent");
    expect(root.querySelector("h1")).toHaveClass("tablet-lg:text-display-xl");
    expect(root.querySelector("h1")!.parentElement).toHaveStyle({ maxWidth: "none" });
    const eyebrow = [...root.querySelectorAll("p")].find(p => p.textContent === "Eyebrow")!;
    expect(eyebrow).toHaveClass("text-ink-on-inverse-muted");
    const description = [...root.querySelectorAll("p")].find(p => p.textContent === "Supporting words.")!;
    expect(description.style.maxWidth).toBe("var(--ui-width-hero-wide, 64rem)");
    const footer = root.querySelector("footer")!;
    expect(footer).toHaveClass("border-t", "border-line-base");
    expect(footer).not.toHaveClass("bg-surface-base", "bg-surface-inverse");
    expect([...footer.querySelectorAll("a")].map(a => a.getAttribute("aria-label") ?? a.textContent)).toEqual(["Privacy", "Terms", "Example home"]);
    expect(footer.querySelector(".border-t")).toBeNull();
    expect(root.querySelector("[data-frame-footer-overlay]")).toBeNull();
  });
}

it("pins default server navigation bytes", () => {
  const server = output(frame({ ...defaults.inverse, nav }), "server");
  const client = output(frame({ ...defaults.inverse, nav }), "client");
  for (const root of [server, client]) {
    expect(root.querySelector("header nav")).toHaveAttribute("aria-label", "Primary");
    expect(root.querySelector('header a[href="#help"]')).toHaveTextContent("Help");
    expect(root.querySelector("header button")).toHaveAttribute("aria-expanded", "false");
  }
});

it.each([
  ["shell.actions[0].emphasis", { ...base, actions: [{ ...base.actions![0], emphasis: "PAYLOAD-SENTINEL" }] }],
  ["shell.brand.tone", { ...base, brand: { ...brand, tone: "PAYLOAD-SENTINEL" } }],
  ["shell.nav.tone", { ...base, nav: { ...nav, tone: "PAYLOAD-SENTINEL" } }],
  ["shell.footer.rule", { ...base, footer: { legal, rule: "PAYLOAD-SENTINEL" } }],
])("refuses invalid %s without echoing its value", (path, shell) => {
  expect(() => resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset)).toThrow(path);
  try { resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset); } catch (error) { expect(String(error)).not.toContain("PAYLOAD-SENTINEL"); }
});

it("keeps emphasis limited to shell actions", () => {
  for (const shell of [
    { ...base, nav: { ...nav, links: [{ href: "/help", label: ref("Help"), emphasis: "primary", icon: [["path", { d: "M4 12h16" }]] }] } },
    { ...base, secondaryAction: { href: "/help", label: ref("Help"), emphasis: "primary" } },
    { ...base, footer: { legal: { ...legal, links: [{ href: "/help", label: ref("Help"), emphasis: "primary", icon: [["path", { d: "M4 12h16" }]] }] } } },
  ]) expect(() => resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset)).toThrow(/unsupported field/);
});
