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
    expect(normalizeSiteFrameConfig()).toEqual({ footerGround: "base", footerPlacement: "flow",
      footerRule: "none", headerSurface: "solid", headerTone: "base" });
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

  it("keeps the global ground solely as the unchanged footer fallback", () => {
    for (const ground of ["base", "inverse", "transparent"] as const) {
      for (const surface of ["solid", "transparent", "glass"] as const) {
        const resolved = resolveShell({ ...base, ground, header: { surface, tone: "base" } }, copy, asset);
        expect(resolved.footer?.ground).toBe(ground);
        expect(resolved.header).toEqual({ surface, tone: "base" });
      }
    }
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
