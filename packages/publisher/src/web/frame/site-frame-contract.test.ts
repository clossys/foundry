import { describe, expect, it } from "vitest";
import * as shell from "@clossys/designer/shell/server";
import * as frame from "./index.js";
import * as web from "../index.js";
import { FOOTER_ICON_LIMIT, FOOTER_LINK_LIMIT, SITE_FRAME_CONTRACT, SITE_FRAME_CONFIG_SCHEMA, SiteFooterContractError, normalizeSiteFrameConfig, normalizeSiteFrameActions, SITE_FRAME_NAV_DEFAULTS } from "./site-frame-contract.js";

describe("data-readable SiteFrame contract", () => {
  it("names real exported constituents without claiming measurement or qualification", () => {
    expect(frame.SITE_FRAME_CONTRACT).toBe(SITE_FRAME_CONTRACT);
    expect(web.SITE_FRAME_CONFIG_SCHEMA).toBe(SITE_FRAME_CONFIG_SCHEMA);
    expect(frame.normalizeSiteFrameActions).toBe(normalizeSiteFrameActions);
    expect(SITE_FRAME_CONTRACT.constituents.Footer.required).toContain("dark-in-both-themes");
    expect(SITE_FRAME_CONTRACT.identity).toBe("site-frame");
    expect(SITE_FRAME_CONTRACT.role).toBe("frame");
    expect(SITE_FRAME_CONTRACT.medium).toBe("web");
    for (const part of Object.values(SITE_FRAME_CONTRACT.constituents)) {
      expect(shell[part.export]).toBeDefined();
      expect(part.owner).toBe("@clossys/designer");
      expect(part.subpath).toBe("shell/server");
    }
    expect(SITE_FRAME_CONTRACT.constituents.Header.export).toBe("SiteHeader");
    expect(SITE_FRAME_CONTRACT.constituents.Footer.export).toBe("SiteFooter");
    expect(JSON.stringify(SITE_FRAME_CONTRACT)).not.toMatch(/qualified|measured|FrameID|ViewID/);
    expect(Object.isFrozen(SITE_FRAME_CONTRACT.constituents.Header)).toBe(true);
  });
  it("normalizes alphabetic flat primitive keys and rejects unknown or dependent inputs", () => {
    expect(Object.keys(SITE_FRAME_CONFIG_SCHEMA)).toEqual([...Object.keys(SITE_FRAME_CONFIG_SCHEMA)].sort());
    expect(normalizeSiteFrameConfig()).toEqual({ footerGround: "base", footerPlacement: "flow", footerRule: "none", headerSurface: "solid", headerTone: "base" });
    expect(normalizeSiteFrameConfig({ headerTone: "inverse" })).toEqual({ footerGround: "base", footerPlacement: "flow", footerRule: "none", headerSurface: "solid", headerTone: "inverse" });
    expect(normalizeSiteFrameConfig({ headerSurface: "glass", headerTone: "inverse" })).toEqual({ footerGround: "base", footerPlacement: "flow", footerRule: "none", headerSurface: "glass", headerTone: "inverse" });
    for (const invalid of [{ headerGround: "inverse" }, { headerPlacement: "overlay" }, { headerSurface: "fixed" }, { headerTone: {} }, { sticky: false }, { Header: "{}" }, null, [], new Proxy({}, { ownKeys() { throw new Error("private-shape"); } })]) {
      expect(() => normalizeSiteFrameConfig(invalid)).toThrow(/SiteFrame/);
    }
    expect(Object.values(normalizeSiteFrameConfig()).every(value => typeof value === "string")).toBe(true);
    expect(Object.isFrozen(normalizeSiteFrameConfig())).toBe(true);
    for (const input of [{}, { headerSurface: "glass", headerTone: "inverse" }]) {
      const normalized = normalizeSiteFrameConfig(input);
      expect(normalizeSiteFrameConfig(normalized)).toEqual(normalized);
    }
    let reads = 0;
    for (const input of [{ get headerGround() { reads++; return "base"; } }, { constructor: "base" }, { [Symbol("field")]: "base" }, Object.defineProperty({}, "headerGround", { value: "base" })]) {
      expect(() => normalizeSiteFrameConfig(input)).toThrow("SiteFrame:");
    }
    expect(reads).toBe(0);
    expect(SITE_FRAME_CONTRACT.required).toEqual(expect.arrayContaining(["sticky-header", "dark-footer", "accessible-navigation", "document-scroll", "sole-main"]));
    expect(SITE_FRAME_CONFIG_SCHEMA).not.toHaveProperty("sticky");
    expect(SITE_FRAME_CONFIG_SCHEMA).not.toHaveProperty("footerDark");
  });
});

it("publishes navigation defaults as copy references, not audience text", () => {
  // Revision 4 replaces header placement/ground and nested navigation presentation with one surface contract.
  expect(SITE_FRAME_CONTRACT.revision).toBe(4);
  expect(SITE_FRAME_CONTRACT.defaults).toEqual({
    label: { id: "site-frame.nav.label" },
    triggerLabel: { id: "site-frame.nav.trigger-label" },
    trigger: "icon",
  });
  expect(Object.isFrozen(SITE_FRAME_CONTRACT.defaults.label)).toBe(true);
  expect(Object.isFrozen(SITE_FRAME_CONTRACT.defaults.triggerLabel)).toBe(true);
  for (const [key, value] of Object.entries(SITE_FRAME_CONTRACT.defaults)) {
    if (key === "trigger") continue;
    expect(typeof value, key).toBe("object");
  }
  expect(JSON.stringify(SITE_FRAME_CONTRACT.defaults)).not.toMatch(/"Primary"|"Menu"/);
});

it("enforces primary content dependencies through the real exported normalizer", () => {
  const icon = [["path", { d: "M0 0h12" }]] as const;
  expect(SITE_FRAME_CONTRACT.defaults).toBe(SITE_FRAME_NAV_DEFAULTS);
  expect(normalizeSiteFrameActions([{ href: "/start", label: "Start", icon, emphasis: "primary" }])[0]).toMatchObject({ emphasis: "primary", label: "Start", icon });
  expect(() => normalizeSiteFrameActions([{ href: "/start", label: "Start" }], ["danger"] as never)).toThrow(/SiteFrame:/);
  for (const invalid of [{ icon }, { label: "", icon }, { label: "  ", icon }, { label: "Start" }, { label: "Start", icon: 123 }, { label: "Start", icon: [] }]) {
    expect(() => normalizeSiteFrameActions([{ href: "/start", emphasis: "primary", ...invalid }] as never)).toThrow(/SiteFrame:/);
  }
});

it("normalizes footer configuration without losing inherited header presentation", () => {
  expect(normalizeSiteFrameConfig({ footerRule: "top" }, { headerSurface: "glass", headerTone: "inverse" })).toMatchObject({ footerRule: "top", headerSurface: "glass", headerTone: "inverse" });
  expect(() => normalizeSiteFrameConfig({ footerPlacement: "overlay", footerGround: "transparent" })).toThrow(/SiteFrame/);
  let reads = 0;
  expect(() => normalizeSiteFrameConfig({ get footerRule() { reads++; return "top"; } })).toThrow(/SiteFrame/);
  expect(reads).toBe(0);
  expect(SITE_FRAME_CONTRACT.constituents.Footer.required).toEqual(expect.arrayContaining(["home-inline-end", "named-icons", "external-rel", "privacy-link-only"]));
});

it("preserves independent explicit header overrides while inheriting footer-only settings", () => {
  expect(normalizeSiteFrameConfig({ headerSurface: "glass", headerTone: "inverse" }, { headerSurface: "solid" })).toMatchObject({ headerSurface: "glass", headerTone: "inverse" });
  expect(normalizeSiteFrameConfig({ headerSurface: "solid" }, { headerSurface: "glass", headerTone: "inverse" })).toMatchObject({ headerSurface: "solid", headerTone: "base" });
});

it("FOOTER-2 publishes the footer caps, brand-last slot, grouping and exclusions as contract data", () => {
  expect(FOOTER_LINK_LIMIT).toBe(5);
  expect(FOOTER_ICON_LIMIT).toBe(5);
  const footer = SITE_FRAME_CONTRACT.constituents.Footer;
  expect(footer.content).toEqual(["columns", "links", "social", "legal"]);
  expect(footer.constraints).toEqual({
    links: FOOTER_LINK_LIMIT,
    linksLayout: "one flat row of shell.footer.links then shell.footer.legal.links",
    grouping: "shell.footer.columns: labelled columns for links beyond the flat row",
    icons: FOOTER_ICON_LIMIT,
    brandMark: "shell.brand, always the last icon slot",
    excludes: ["home", "header-navigation", "privacy-choices"],
    error: "SiteFooterContractError",
    accessibility: "mandatory",
  });
  expect(Object.isFrozen(footer.constraints.excludes)).toBe(true);
  const error = new SiteFooterContractError("footer-link-limit", "shell.footer.links");
  expect(error).toBeInstanceOf(TypeError);
  expect(error).toMatchObject({ name: "SiteFooterContractError", code: "footer-link-limit" });
  expect(error.message).toMatch(/^SiteFrame: shell\.footer\.links /);
});
