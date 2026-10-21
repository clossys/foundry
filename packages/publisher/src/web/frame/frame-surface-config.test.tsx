// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { SiteFrame } from "./SiteFrame.js";
import { resolveShell } from "./internal/resolveShell.js";
import { normalizeSiteFrameConfig } from "./site-frame-contract.js";
import { siteShellFor } from "./surface.js";
import type { SiteFrameConfig, SiteShellInput } from "./types.js";

afterEach(cleanup);
const ref = (id: string): CopyRef => ({ id });
const copy: CopyResolver = value => ({ ref: value, text: value.id, recordId: "fixture", entryId: value.id,
  revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" } });
const asset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example" });
const base: SiteShellInput = {
  brand: { assetId: "mark", label: ref("Example"), variant: "mark", size: "md" },
  skipLink: ref("Skip to content"),
  footer: { legal: { entity: ref("Example entity"), links: [] } },
};
const icon = [["path", { d: "M4 12h16" }]] as const;
const actions = [
  { href: "/start", label: ref("Start"), emphasis: "primary", icon },
  { href: "/help", label: ref("Help"), emphasis: "ghost" },
  { href: "/sign-in", label: ref("Sign in"), emphasis: "secondary" },
] satisfies NonNullable<SiteShellInput["actions"]>;

describe("the single Publisher header surface contract", () => {
  it("defaults to solid and exposes only surface/tone presentation axes for the header", () => {
    const resolved = resolveShell(base, copy, asset);
    expect(resolved.header).toEqual({ surface: "solid", tone: "base" });
    expect(normalizeSiteFrameConfig()).toEqual({ footerTone: "dark", footerPlacement: "flow", headerSurface: "solid", headerTone: "base" });
  });

  it.each(["solid", "transparent", "glass"] as const)("resolves the %s surface in either tone", surface => {
    for (const tone of ["base", "inverse"] as const) {
      expect(resolveShell({ ...base, header: { surface, tone } }, copy, asset).header)
        .toEqual({ surface, tone });
    }
  });

  it.each([
    ["iconActions", { ...base, iconActions: [] }],
    ["secondaryAction", { ...base, secondaryAction: { href: "/x", label: ref("PAYLOAD-SENTINEL") } }],
    ["surfaceLabel", { ...base, surfaceLabel: ref("PAYLOAD-SENTINEL") }],
    ["mobileLayout", { ...base, mobileLayout: "PAYLOAD-SENTINEL" }],
    ["placement", { ...base, header: { placement: "overlay" } }],
    ["trigger", { ...base, nav: { label: ref("Menu"), trigger: "label", links: [] } }],
    ["tone", { ...base, nav: { label: ref("Menu"), tone: "inverse", links: [] } }],
  ] as const)("rejects the removed %s option without echoing its value", (field, input) => {
    const attempt = () => resolveShell(input as unknown as SiteShellInput, copy, asset);
    expect(attempt).toThrow(field);
    try { attempt(); } catch (error) { expect(String(error)).not.toContain("PAYLOAD-SENTINEL"); }
  });

  it("refuses the removed global ground on shell and configuration", () => {
    for (const ground of ["base", "inverse", "transparent"]) {
      expect(() => resolveShell({ ...base, ground } as unknown as SiteShellInput, copy, asset)).toThrow(/unsupported field "ground"/);
      const config = { brand: base.brand, skipLink: base.skipLink, origin: "https://example.com", legal: base.footer!.legal, ground };
      for (const kind of ["site", "front-door", "admin", "demo"] as const) expect(() => siteShellFor(config as unknown as SiteFrameConfig, kind)).toThrow(/unsupported field "ground"/);
    }
    let reads = 0;
    const stale = { brand: base.brand, skipLink: base.skipLink, origin: "https://example.com", legal: base.footer!.legal, get ground() { reads++; return "PAYLOAD-SENTINEL"; } };
    expect(() => siteShellFor(stale as unknown as SiteFrameConfig, "site")).toThrow(/unsupported field "ground"/);
    expect(reads).toBe(0);
  });

  it.each(["dark", "light"] as const)("resolves and forwards footer tone %s independently of the header", tone => {
    const shell: SiteShellInput = { ...base, footer: { ...base.footer!, tone } };
    expect(resolveShell(shell, copy, asset).footer?.tone).toBe(tone);
    const view = render(<SiteFrame shell={shell} resolveCopy={copy} resolveAsset={asset}><h1>Page</h1></SiteFrame>);
    expect(view.container.querySelector("footer")).toHaveAttribute("data-footer-tone", tone);
    view.unmount();
  });

  it.each(["dark", "light"] as const)("forwards an explicit %s footer presentation override", tone => {
    const shell: SiteShellInput = { ...base, footer: { ...base.footer!, tone: tone === "dark" ? "light" : "dark" } };
    const view = render(<SiteFrame shell={shell} presentation={{ footerTone: tone }} resolveCopy={copy} resolveAsset={asset}><h1>Page</h1></SiteFrame>);
    expect(view.container.querySelector("footer")).toHaveAttribute("data-footer-tone", tone);
    view.unmount();
  });

  it("refuses stale footer and presentation options without interpreting their values", () => {
    for (const key of ["ground", "rule"]) {
      const attempt = () => resolveShell({ ...base, footer: { ...base.footer!, [key]: "PAYLOAD-SENTINEL" } } as unknown as SiteShellInput, copy, asset);
      expect(attempt).toThrow(`unsupported field "${key}"`);
      expect(attempt).not.toThrow(/PAYLOAD-SENTINEL/);
    }
    for (const input of [{ footerGround: "base" }, { footerRule: "top" }, { footerTone: "inverse" }]) expect(() => normalizeSiteFrameConfig(input)).toThrow(/SiteFrame/);
    expect(resolveShell(base, copy, asset).footer?.tone).toBe("dark");
  });

  it("uses the same canonical action DOM order for the row and narrow menu", () => {
    render(<SiteFrame shell={{ ...base, actions }} resolveCopy={copy} resolveAsset={asset}><h1>Page</h1></SiteFrame>);
    const header = screen.getByRole("banner");
    const menuActions = header.querySelector(".site-header-desktop-actions")!;
    expect([...menuActions.querySelectorAll("a")].map(node => node.textContent))
      .toEqual(["Help", "Sign in", "Start"]);
    const toggle = header.querySelector(".nav-disclosure-toggle")!;
    expect(toggle).toHaveAttribute("aria-label", "site-frame.nav.trigger-label");
    expect(toggle.querySelector(".nav-disclosure-icon")).not.toBeNull();
  });

  it("does not reintroduce the removed inline layout through a non-site surface", () => {
    const config: SiteFrameConfig = { brand: base.brand, skipLink: base.skipLink,
      origin: "https://example.com", legal: base.footer!.legal };
    for (const kind of ["site", "front-door", "admin", "demo"] as const) {
      const shell = siteShellFor(config, kind);
      expect(shell).not.toHaveProperty("mobileLayout");
      expect(shell).not.toHaveProperty("iconActions");
      expect(shell).not.toHaveProperty("secondaryAction");
    }
  });
});
