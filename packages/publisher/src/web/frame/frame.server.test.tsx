// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { AuthView } from "../views/AuthView.js";
import * as webIndex from "../index.js";
import * as webServer from "../server.js";
import * as frameIndex from "./index.js";
import { SITE_MAIN_ID, SiteFrame, siteShellFor } from "./index.js";
import type { SiteFrameConfig, SiteShellInput } from "./index.js";
import { LandingView } from "#publisher-web-views";
import { LandingView as ServerLandingView } from "../views/LandingView.server.js";
import type { LandingViewProps } from "../views/LandingViewContent.js";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "skip": "Skip to content",
  "env.app": "App",
  "icon.contact": "Contact",
  "social.label": "Profiles",
  "social.profile": "Profile",
  "footer.help": "Help",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
  "site-frame.nav.label": "Primary",
  "site-frame.nav.trigger-label": "Menu",
};

const ref = (id: string): CopyRef => ({ id });

const resolveCopy: CopyResolver = (copyRef) => {
  const text = COPY[copyRef.id];
  return text === undefined
    ? undefined
    : {
        ref: copyRef,
        text,
        recordId: `record-${copyRef.id}`,
        revision: "1",
        locale: "en-US",
        source: { kind: "consumer", reference: "fixture" },
        entryId: copyRef.id,
      };
};

const resolveAsset = (assetId: string): unknown =>
  assetId === "brand-mark" ? { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" } : undefined;

const CONFIG: SiteFrameConfig = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "mark" },
  skipLink: ref("skip"),
  origin: "https://example.com",
  site: {},
  environments: [{ surface: "front-door", href: "https://app.example.com/", label: ref("env.app"), icon: [["path", { d: "M3 12h18" }]] }],
  legal: { entity: ref("legal.entity"), links: [{ href: "/privacy", label: ref("legal.privacy") }] },
};

describe("SiteFrame on the server", () => {
  it("runs where no browser globals exist", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders the skip link, banner, one main with the fixed id and contentinfo around a chrome-free view", () => {
    const html = renderToStaticMarkup(
      <SiteFrame shell={siteShellFor(CONFIG, "front-door")} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
        <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} />
      </SiteFrame>,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain(`<main id="${SITE_MAIN_ID}" tabindex="-1"`);
    expect(html).toContain(`href="#${SITE_MAIN_ID}"`);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).toContain("https://example.com/privacy");
  });
});

describe("frame exports", () => {
  const frameNames = Object.keys(frameIndex).sort();

  it("the web entry and the server entry export every frame value, and the same ones", () => {
    expect(frameNames).toEqual(["SITE_FRAME_CONFIG_SCHEMA", "SITE_FRAME_CONTRACT", "SITE_MAIN_ID", "SITE_PAGE_LAYERS", "SITE_SURFACE_KINDS", "SiteFrame", "normalizeSiteFrameActions", "normalizeSiteFrameConfig", "siteShellFor"]);
    for (const name of frameNames) {
      expect(webIndex).toHaveProperty(name);
      expect(webServer).toHaveProperty(name);
      expect((webServer as Record<string, unknown>)[name]).toBe((webIndex as Record<string, unknown>)[name]);
      expect((webIndex as Record<string, unknown>)[name]).toBe((frameIndex as Record<string, unknown>)[name]);
    }
  });
});


it("renders identical all-slots markup through ordinary and server entries", () => {
  const icon = [["path", { d: "M3 12h18" }]] as const;
  const shell = {
    ...siteShellFor(CONFIG, "site"),
    actions: [{ href: "/contact", label: ref("icon.contact"), icon }],
    footer: {
      legal: CONFIG.legal,
      links: [{ href: "/help", label: ref("footer.help") }],
      social: { label: ref("social.label"), links: [{ href: "https://social.example/profile", label: ref("social.profile"), icon }] },
    },
  };
  const ordinary = renderToStaticMarkup(<webIndex.SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></webIndex.SiteFrame>);
  const server = renderToStaticMarkup(<webServer.SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></webServer.SiteFrame>);
  expect(ordinary).toBe(server);
  expect(server).toContain('href="/contact"');
  // Header actions are text only; the label is the link's own text, not an icon's hidden span.
  expect(server).toContain('>Contact</span>');
  expect(server).toContain('aria-hidden="true"');
  expect(server).toContain('aria-label="Profiles"');
  expect(server).toContain('aria-label="Profile"');
  expect(server).toContain('href="/help"');
});

it("renders disclosure, ActionLinks and independent footer ground without browser globals", () => {
  const shell = { ...siteShellFor(CONFIG, "site"), ground: "base" as const,
    nav: { label: ref("social.label"), triggerLabel: ref("footer.help"), links: [{ href: "/help", label: ref("footer.help") }] },
    actions: [{ href: "/help", label: ref("footer.help") }, { href: "/contact", label: ref("icon.contact") }],
    footer: { ground: "inverse" as const, legal: { entity: ref("legal.entity"), links: [] } },
  };
  const html = renderToStaticMarkup(<SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p>content</p></SiteFrame>);
  expect(html.match(/<header\b/g)).toHaveLength(1);
  expect(html.match(/<nav\b/g)).toHaveLength(1);
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html.match(/<footer\b/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Profiles"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="Help"');
  expect(html).toMatch(/<header[^>]*data-surface="solid"/);
  expect(html).toMatch(/<footer[^>]*bg-surface-inverse/);
  expect(html).toMatch(/<a href="\/contact"[^>]*rounded-control/);
});


describe("SiteFrame footer placement", () => {
  const hero: ResolvedSectionedViewDocument = {
    id: "example-home", resolutions: [resolveCopy(ref("brand.label"))!],
    sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: "Welcome" }],
  };
  const shell: SiteShellInput = {
    ...siteShellFor(CONFIG, "site"),
    header: { surface: "glass", tone: "inverse" },
    nav: { label: ref("social.label"), links: [{ href: "/help", label: ref("footer.help") }] },
    footer: { legal: { entity: ref("legal.entity"), links: [{ href: "/privacy", label: ref("legal.privacy") }] } },
  };
  const htmlFor = (placement?: unknown, document = hero, ground?: unknown) => renderToStaticMarkup(
    <SiteFrame shell={{ ...shell, footer: { ...shell.footer!, ...(placement === undefined ? {} : { placement }), ...(ground === undefined ? {} : { ground }) } } as SiteShellInput} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <LandingView document={document} header="overlay" fit="frame" landmark="none" />
    </SiteFrame>,
  );

  it("keeps the omitted and explicit flow footer markup identical and in flow", () => {
    const html = htmlFor();
    expect(htmlFor("flow")).toBe(html);
    expect(html).not.toContain("data-frame-footer-overlay");
    expect(html).not.toContain("publisher-frame-footer-overlay");
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).toMatch(/<footer[^>]*bg-surface-raised[^>]*style="position:relative;/);
  });

  it("overlays one inverse footer inside the first viewport hero container", () => {
    const html = htmlFor("overlay");
    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain(`<main id="${SITE_MAIN_ID}" tabindex="-1"`);
    expect(html).toMatch(/<header[^>]*data-placement="overlay"/);
    expect(html).toMatch(/data-landing-view="" class="[^"]*flex-1/);
    expect(html).toMatch(/data-landing-hero=""[^>]*class="[^"]*flex-1/);
    expect(html).toMatch(/<div data-frame-root="" class="flex min-h-dvh flex-col" style="position:relative"/);
    expect(html).toContain('<div data-frame-footer-overlay="" style="display:flex;flex-direction:column;flex-shrink:0;min-width:0;pointer-events:none;z-index:var(--ui-z-sticky, 10)"><footer');
    expect(html).toMatch(/<footer[^>]*bg-surface-inverse[^>]*publisher-frame-footer-overlay/);
    expect(html).toMatch(/<footer[^>]*style="[^"]*pointer-events:auto/);
    expect(html).toMatch(/<header[^>]*z-index:var\(--ui-z-shell, 20\)/);
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('tabindex="-1">Privacy');
    expect(html).not.toContain("overflow:hidden");
    expect(html.lastIndexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
  });

  it("fills the overlay viewport width instead of shrink-wrapping legal links", () => {
    const footer = htmlFor("overlay").match(/<footer\b[^>]*>/)?.[0];
    expect(footer).toBeDefined();
    expect(footer).toContain("width:100%");
    expect(footer).toContain("pointer-events:auto");
  });

  it("refuses multi-band overlay compositions rather than covering a peek or scroll cue", () => {
    const document: ResolvedSectionedViewDocument = { ...hero, sections: [...hero.sections, { id: "details", kind: "feature-grid", ground: "base", heading: "Details", items: [{ id: "one", heading: "More" }] }] };
    expect(() => htmlFor("overlay", document)).toThrow(/footer.*overlay.*hero/i);
    expect(htmlFor("flow", document)).toContain('id="details"');
  });

  it("reserves the footer's intrinsic height in the same growing hero scene", () => {
    const html = htmlFor("overlay");
    expect(html).not.toContain("safe flex-end");
    expect(html).not.toContain("height:100dvh");
    expect(html).toMatch(/data-frame-footer-overlay=""[^>]*flex-direction:column/);
    expect(html).toMatch(/<footer[^>]*margin-block-start:auto/);
    expect(html).not.toContain("data-landing-cue");
  });

  it.each([LandingView, ServerLandingView])("accepts either direct LandingView entry with one growing hero", View => {
    const html = renderToStaticMarkup(<SiteFrame shell={{ ...shell, footer: { ...shell.footer!, placement: "overlay" } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <View document={hero} fit="frame" landmark="none" />
    </SiteFrame>);
    expect(html).toContain("data-frame-footer-overlay");
    expect(html).not.toContain("data-landing-cue");
  });

  it.each([
    { fit: "viewport" },
    { header: "reserved" },
    { landmark: "main" },
    { trailing: [hero] },
    { callToAction: { heading: "More", action: <a href="/more">More</a> } },
    { afterSection: { hero: <p>More</p> } },
    { style: { height: "100dvh" } },
    { className: "h-dvh" },
    { document: { ...hero, sections: [{ ...hero.sections[0]!, size: "compact" }] } },
  ])("refuses unsupported overlay layout props before rendering a scene", extra => {
    expect(() => renderToStaticMarkup(<SiteFrame shell={{ ...shell, footer: { ...shell.footer!, placement: "overlay" } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <LandingView document={hero} fit="frame" landmark="none" {...extra as Partial<LandingViewProps>} />
    </SiteFrame>)).toThrow(/shell\.footer\.placement/);
  });

  it("refuses a wrapper that copies LandingView props without invoking it", () => {
    let called = false;
    function WrappedLandingView(props: LandingViewProps) { called = true; return <LandingView {...props} />; }
    expect(() => renderToStaticMarkup(<SiteFrame shell={{ ...shell, footer: { ...shell.footer!, placement: "overlay" } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      <WrappedLandingView document={hero} fit="frame" landmark="none" />
    </SiteFrame>)).toThrow(/shell\.footer\.placement/);
    expect(called).toBe(false);
  });

  it("refuses fragments and reserved frame headers for overlay scenes", () => {
    const view = <LandingView document={hero} fit="frame" landmark="none" />;
    expect(() => renderToStaticMarkup(<SiteFrame shell={{ ...shell, footer: { ...shell.footer!, placement: "overlay" } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><>{view}</></SiteFrame>)).toThrow(/shell\.footer\.placement/);
    expect(() => renderToStaticMarkup(<SiteFrame shell={{ ...shell, header: { surface: "solid" }, footer: { ...shell.footer!, placement: "overlay" } }} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>{view}</SiteFrame>)).toThrow(/shell\.footer\.placement/);
  });

  it.each(["base", "inverse"])("preserves an explicit opaque %s overlay ground", ground => {
    expect(htmlFor("overlay", hero, ground)).toMatch(ground === "base" ? /<footer[^>]*bg-surface-raised/ : /<footer[^>]*bg-surface-inverse/);
  });

  it("refuses transparent overlay backing and unknown placement without echoing values", () => {
    expect(() => htmlFor("overlay", hero, "transparent")).toThrow(/shell\.footer\.ground/);
    expect(() => htmlFor("PAYLOAD-SENTINEL")).toThrow(/shell\.footer\.placement/);
    expect(() => htmlFor("PAYLOAD-SENTINEL")).not.toThrow(/PAYLOAD-SENTINEL/);
    expect(() => htmlFor("flow", hero, "transparent")).not.toThrow();
  });
});
