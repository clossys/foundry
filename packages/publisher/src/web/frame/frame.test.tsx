// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import { CONTRAST_PAIRS } from "@clossys/designer/tokens";
import { AuthView } from "../views/AuthView.js";
import { BoundaryView } from "../views/BoundaryView.js";
import { CaptureView } from "../views/CaptureView.js";
import { DocumentView } from "../views/DocumentView.js";
import { ErrorView } from "../views/ErrorView.js";
import { StatusView } from "../views/StatusView.js";
import { LandingView } from "#publisher-web-views";
import { SITE_MAIN_ID, SITE_SURFACE_KINDS, SiteFrame, siteShellFor } from "./index.js";
import type { SiteFrameConfig, SiteShellInput } from "./index.js";
import { resolveShell } from "./internal/resolveShell.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures: generic copy, one brand asset, one icon.
// ---------------------------------------------------------------------------

const COPY: Readonly<Record<string, string>> = {
  "brand.name": "Example",
  "brand.label": "Example home",
  "skip": "Skip to content",
  "nav.label": "Primary",
  "nav.pricing": "Pricing",
  "nav.docs": "Docs",
  "cta.start": "Get started",
  "cta.signin": "Sign in",
  "env.app": "App",
  "env.admin": "Admin",
  "env.demo": "Demo",
  "footer.company": "Company",
  "footer.about": "About",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",
  "legal.label": "Legal",
  "surface.admin": "Admin",
  "icon.contact": "Contact",
  "social.label": "Profiles",
  "social.profile": "Profile",
  "footer.help": "Help",
  "blank": "   ",
  "doc.title": "Privacy notice",
  "doc.section": "Details",
  "doc.body": "Document body.",
};

function ref(id: string): CopyRef {
  return { id };
}

const resolveCopy: CopyResolver = (copyRef) => {
  const text = COPY[copyRef.id];
  if (text === undefined) return undefined;
  const resolution: CopyResolution = {
    ref: copyRef,
    text,
    recordId: `record-${copyRef.id}`,
    revision: "1",
    locale: "en-US",
    source: { kind: "consumer", reference: "fixture" },
    entryId: copyRef.id,
  };
  return resolution;
};

const BRAND_ASSET = { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" };
const resolveAsset = (assetId: string): unknown => (assetId === "brand-mark" ? BRAND_ASSET : undefined);

const ICON: IconNode = [["path", { d: "M3 12h18" }]];

const CONFIG: SiteFrameConfig = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "lockup", wordmark: ref("brand.name") },
  skipLink: ref("skip"),
  origin: "https://example.com",
  site: {
    nav: { label: ref("nav.label"), links: [{ href: "/pricing", label: ref("nav.pricing") }, { href: "/docs", label: ref("nav.docs") }] },
    actions: [{ href: "/start", label: ref("cta.start") }],
    secondaryAction: { href: "https://app.example.com/", label: ref("cta.signin") },
    columns: [{ heading: ref("footer.company"), links: [{ href: "/about", label: ref("footer.about") }] }],
  },
  environments: [
    { surface: "front-door", href: "https://app.example.com/", label: ref("env.app"), icon: ICON },
    { surface: "admin", href: "https://admin.example.com/", label: ref("env.admin"), icon: ICON },
    { surface: "demo", href: "https://demo.example.com/", label: ref("env.demo"), icon: ICON },
  ],
  legal: {
    entity: ref("legal.entity"),
    links: [{ href: "/privacy", label: ref("legal.privacy") }, { href: "/terms", label: ref("legal.terms") }],
    linksLabel: ref("legal.label"),
  },
};

function frame(shell: SiteShellInput, child: ReactElement): ReactElement {
  return (
    <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      {child}
    </SiteFrame>
  );
}

/** Landmarks as a browser computes them: header/footer count as banner/contentinfo only outside main and sectioning content. */
function landmarks(container: HTMLElement) {
  const all = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[];
  const outsideSectioning = (element: HTMLElement) => element.parentElement?.closest("main, article, aside, nav, section") === null;
  return {
    mains: all("main"),
    banners: all("header").filter(outsideSectioning),
    contentinfos: all("footer").filter(outsideSectioning),
    skipLinks: all(`a[href="#${SITE_MAIN_ID}"]`),
    h1s: all("h1"),
  };
}

const DOCUMENT = {
  id: "doc",
  title: ref("doc.title"),
  sections: [
    {
      kind: "section" as const,
      id: "details",
      level: 2 as const,
      heading: ref("doc.section"),
      blocks: [{ kind: "paragraph" as const, content: [{ kind: "text" as const, text: ref("doc.body") }] }],
    },
  ],
};

const FRONT_DOOR_SHELL = siteShellFor(CONFIG, "front-door");

const CHROME_FREE_VIEWS: ReadonlyArray<{ name: string; element: ReactElement; h1: string }> = [
  { name: "AuthView", element: <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} notes={<p>notes</p>} />, h1: "Sign in" },
  { name: "CaptureView", element: <CaptureView heading="Request access" form={<p>form</p>} />, h1: "Request access" },
  { name: "DocumentView", element: <DocumentView document={DOCUMENT} resolveCopyId={resolveCopy} action={<a href="/terms">Terms</a>} />, h1: "Privacy notice" },
  { name: "BoundaryView", element: <BoundaryView status={404} title="Not found" action={<a href="/">Home</a>} />, h1: "404" },
  { name: "ErrorView", element: <ErrorView status={500} title="Something went wrong" />, h1: "500" },
  { name: "StatusView", element: <StatusView status="Coming soon" />, h1: "Coming soon" },
  { name: "StatusView", element: <StatusView status={404} subtitle="This page does not exist." action={<a href="/">Home</a>} />, h1: "404" },
];

// ---------------------------------------------------------------------------
// The frame owns the single main.
// ---------------------------------------------------------------------------

describe("SiteFrame", () => {
  it("renders skip link, banner, the one main with the fixed id, then contentinfo, in that order", () => {
    const { container } = render(frame(FRONT_DOOR_SHELL, <p data-testid="view">content</p>));
    const root = container.firstElementChild as HTMLElement;
    expect([...root.children].map((child) => child.tagName)).toEqual(["A", "HEADER", "MAIN", "FOOTER"]);
    const main = root.querySelector("main") as HTMLElement;
    expect(main).toHaveAttribute("id", SITE_MAIN_ID);
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toContainElement(container.querySelector('[data-testid="view"]') as HTMLElement);
    const skip = root.firstElementChild as HTMLAnchorElement;
    expect(skip).toHaveAttribute("href", `#${SITE_MAIN_ID}`);
    expect(skip).toHaveTextContent("Skip to content");
  });

  it("the skip link moves focus to the main", () => {
    const { container } = render(frame(FRONT_DOOR_SHELL, <p>content</p>));
    const skip = container.querySelector(`a[href="#${SITE_MAIN_ID}"]`) as HTMLAnchorElement;
    fireEvent.click(skip);
    expect(document.activeElement).toBe(container.querySelector("main"));
  });

  it("resolves every label through the copy resolver and the brand through the asset resolver", () => {
    const { container } = render(frame(siteShellFor(CONFIG, "site"), <p>content</p>));
    const brand = container.querySelector('header a[aria-label="Example home"]') as HTMLAnchorElement;
    expect(brand).toHaveTextContent("Example");
    expect(brand.querySelector("img")).toHaveAttribute("src", "/brand/mark.svg");
    const nav = container.querySelector('header nav[aria-label="Primary"]') as HTMLElement;
    expect([...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Pricing", "/pricing"],
      ["Docs", "/docs"],
    ]);
    expect(container.querySelector('header a[href="/start"]')).toHaveTextContent("Get started");
    expect(container.querySelector('header a[href="https://app.example.com/"]')).toHaveTextContent("Sign in");
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer.querySelector("h2")).toHaveTextContent("Company");
    expect(footer.querySelector('a[href="/about"]')).toHaveTextContent("About");
    expect(footer.querySelector('nav[aria-label="Legal"]')).not.toBeNull();
    expect(footer).toHaveTextContent("Example Ltd");
  });

  describe("fails closed", () => {
    const render$ = (shell: unknown) => () => renderToStaticMarkup(frame(shell as SiteShellInput, <p>content</p>));

    it("refuses copy that does not resolve, naming the field and not the value", () => {
      const shell = { ...FRONT_DOOR_SHELL, skipLink: ref("missing.secret-id") };
      expect(render$(shell)).toThrow(/SiteFrame: shell\.skipLink did not resolve/);
      expect(render$(shell)).not.toThrow(/secret-id/);
    });

    it("refuses a brand asset that is not a renderable image", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, brand: { ...FRONT_DOOR_SHELL.brand, assetId: "nope" } })).toThrow(
        /SiteFrame: shell\.brand\.assetId did not resolve to an image asset/,
      );
    });

    it("refuses an unsafe link without echoing it", () => {
      const shell = { ...FRONT_DOOR_SHELL, footer: { legal: { entity: ref("legal.entity"), links: [{ href: "javascript:alert(1)", label: ref("legal.terms") }] } } };
      expect(render$(shell)).toThrow(/SiteFrame: shell\.footer\.legal\.links\[0\]\.href is not an allowed link/);
      expect(render$(shell)).not.toThrow(/alert/);
    });

    const withLegalHref = (href: string, shell: SiteShellInput = FRONT_DOOR_SHELL) => ({
      ...shell,
      footer: { legal: { entity: ref("legal.entity"), links: [{ href, label: ref("legal.terms") }] } },
    });

    it.each([
      ["protocol-relative", "//evil.example/"],
      ["tab after the slash", "/\t/evil.example"],
      ["newline after the slash", "/\n/evil.example"],
      ["carriage return and backslash", "/\r\\evil.example"],
      ["backslash", "/\\evil.example"],
      ["a control character in the path", "/terms\u0000"],
      ["DEL", "/terms\u007F"],
      ["a data: URL", "data:text/html,<p>x</p>"],
      ["a mixed-case javascript: URL", "JaVaScRiPt:alert(1)"],
      ["a vbscript: URL", "vbscript:msgbox(1)"],
      ["a file: URL", "file:///etc/hosts"],
      ["leading whitespace", " /terms"],
      ["trailing whitespace", "/terms "],
      ["an empty href", ""],
      ["a host-less http URL", "https:"],
    ])("refuses %s, with or without an origin, and never echoes it", (_name, href) => {
      for (const shell of [FRONT_DOOR_SHELL, siteShellFor(CONFIG, "site")]) {
        expect(render$(withLegalHref(href, shell))).toThrow(/SiteFrame: shell\.footer\.legal\.links\[0\]\.href is not an allowed link\./);
        expect(render$(withLegalHref(href, shell))).not.toThrow(/evil|alert|msgbox|hosts|data:/);
      }
    });

    it("accepts percent-encoded paths, which stay on the origin, and normalises absolute links", () => {
      const hrefs = (shell: SiteShellInput) =>
        resolveShell(shell, resolveCopy, resolveAsset).footer?.legal.links.map((link) => link.href);
      expect(hrefs(withLegalHref("/%09/evil.example"))).toEqual(["https://example.com/%09/evil.example"]);
      expect(hrefs(withLegalHref("/%2F%2Fevil.example"))).toEqual(["https://example.com/%2F%2Fevil.example"]);
      expect(hrefs(withLegalHref("HTTPS://Example.COM/Terms"))).toEqual(["https://example.com/Terms"]);
      expect(hrefs(withLegalHref("MAILTO:help@example.com"))).toEqual(["mailto:help@example.com"]);
      expect(hrefs(withLegalHref("#legal"))).toEqual(["#legal"]);
    });

    it("refuses a control character or backslash in a fragment or query link", () => {
      expect(render$(withLegalHref("#a\tb"))).toThrow(/is not an allowed link/);
      expect(render$(withLegalHref("?a\\b"))).toThrow(/is not an allowed link/);
    });

    it("refuses a node-shaped header, footer or mark slipped past the types", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, header: <header /> })).toThrow(/SiteFrame: shell\.header has an unsupported field/);
      expect(render$({ ...FRONT_DOOR_SHELL, footer: { legal: FRONT_DOOR_SHELL.footer?.legal, secondary: <p /> } })).toThrow(
        /shell\.footer has an unsupported field "secondary"/,
      );
      expect(render$({ ...FRONT_DOOR_SHELL, brand: { ...FRONT_DOOR_SHELL.brand, mark: <svg /> } })).toThrow(/shell\.brand has an unsupported field "mark"/);
    });

    it("refuses a brand with an unknown variant or size", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, brand: { ...FRONT_DOOR_SHELL.brand, size: "xl" } })).toThrow(/shell\.brand\.size/);
      expect(render$({ ...FRONT_DOOR_SHELL, brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "badge" } })).toThrow(
        /shell\.brand\.variant/,
      );
    });

    it("refuses an icon that is not plain SVG shape data", () => {
      const evil: IconNode = [["script", { src: "x" }]];
      const shell = { ...FRONT_DOOR_SHELL, environments: [{ href: "https://app.example.com/", label: ref("env.app"), icon: evil }] };
      expect(render$(shell)).toThrow(/SiteFrame: shell\.environments\[0\]\.icon is not plain SVG shape data/);
      const handler: IconNode = [["path", { d: "M0 0", onload: "x" }]];
      expect(render$({ ...shell, environments: [{ href: "https://app.example.com/", label: ref("env.app"), icon: handler }] })).toThrow(
        /icon is not plain SVG shape data/,
      );
    });

    const withIcon = (icon: unknown) => ({ ...FRONT_DOOR_SHELL, environments: [{ href: "https://app.example.com/", label: ref("env.app"), icon }] });

    it.each([
      ["an href attribute", [["path", { d: "M0 0", href: "javascript:alert(1)" }]]],
      ["an xlink:href attribute", [["path", { d: "M0 0", "xlink:href": "#x" }]]],
      ["a style attribute", [["path", { d: "M0 0", style: "fill:red" }]]],
      ["a non-string attribute", [["path", { d: 1 }]]],
      ["a url() value", [["path", { d: "M0 0", fill: "url(https://evil.example/x)" }]]],
      ["a spaced url () value", [["path", { d: "M0 0", stroke: "URL (#x)" }]]],
      ["a CSS-escaped url value", [["path", { d: "M0 0", fill: "u\\72l(https://x/y.svg#p)" }]]],
      ["a backslash in a transform", [["path", { d: "M0 0", transform: "u\\72l(#x)" }]]],
      ["an open parenthesis outside transform", [["path", { d: "M0 0", stroke: "rgb(0 0 0)" }]]],
      ["dangerouslySetInnerHTML", [["g", { dangerouslySetInnerHTML: { __html: "<script></script>" } }]]],
      ["children", [["g", { children: "x" }]]],
      ["ref", [["path", { d: "M0 0", ref: "x" }]]],
      ["a non-string key", [["path", { d: "M0 0", key: 1 }]]],
      ["an unlisted attribute", [["path", { d: "M0 0", filter: "x" }]]],
      ["an unlisted tag", [["use", { href: "#x" }]]],
      ["an empty icon", []],
      ["a node with extra entries", [["path", { d: "M0 0" }, "extra"]]],
      ["array attributes", [["path", ["d", "M0 0"]]]],
    ])("refuses icon data with %s", (_name, icon) => {
      expect(render$(withIcon(icon))).toThrow(/SiteFrame: shell\.environments\[0\]\.icon is not plain SVG shape data\./);
      expect(render$(withIcon(icon))).not.toThrow(/evil|script/);
    });

    it("accepts a transform value, the one icon attribute whose value may hold a parenthesis", () => {
      const resolved = resolveShell(withIcon([["g", { transform: "rotate(45 12 12)" }]]) as SiteShellInput, resolveCopy, resolveAsset).environments[0]?.icon;
      expect(resolved).toEqual([["g", { transform: "rotate(45 12 12)" }]]);
    });

    it("accepts Designer's generated icon shape, strips its list key and renders a frozen copy, not the caller's object", () => {
      const caller = [
        ["path", { d: "M3 12h18", key: "a1" }],
        ["circle", { cx: "12", cy: "12", r: "3", "stroke-width": "2", key: "b2" }],
      ];
      const resolved = resolveShell(withIcon(caller) as SiteShellInput, resolveCopy, resolveAsset).environments[0]?.icon;
      expect(resolved).toEqual([
        ["path", { d: "M3 12h18" }],
        ["circle", { cx: "12", cy: "12", r: "3", "stroke-width": "2" }],
      ]);
      expect(resolved).not.toBe(caller);
      expect(resolved?.[0]?.[1]).not.toBe(caller[0]?.[1]);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.isFrozen(resolved?.[0])).toBe(true);
      expect(Object.isFrozen(resolved?.[0]?.[1])).toBe(true);
      (caller[0]?.[1] as Record<string, string>).d = "M0 0 changed";
      expect(resolved?.[0]?.[1]).toEqual({ d: "M3 12h18" });
    });

    it.each([
      ["javascript:alert(1)"],
      ["https://example.com/path"],
      ["https://example.com?x=1"],
      ["https://user@example.com"],
      ["http://example.com"],
      ["http://10.0.0.1"],
      ["ftp://example.com"],
      ["data:text/plain,x"],
      ["https://example.com\n"],
      ["https://exa\tmple.com"],
      ["https:\\\\example.com"],
      [" https://example.com"],
      ["not a url"],
    ])("refuses the origin %j", (origin) => {
      expect(render$({ ...FRONT_DOOR_SHELL, origin })).toThrow(/SiteFrame: shell\.origin must be an https origin, or an http origin on a loopback host\./);
      expect(render$({ ...FRONT_DOOR_SHELL, origin })).not.toThrow(/alert|10\.0|user@/);
    });

    it.each([
      ["https://example.com", "https://example.com/privacy"],
      ["https://example.com/", "https://example.com/privacy"],
      ["HTTPS://EXAMPLE.com", "https://example.com/privacy"],
      ["http://localhost:3000", "http://localhost:3000/privacy"],
      ["http://127.0.0.1:8080", "http://127.0.0.1:8080/privacy"],
      ["http://[::1]:4000", "http://[::1]:4000/privacy"],
    ])("accepts the origin %j", (origin, privacy) => {
      const resolved = resolveShell({ ...FRONT_DOOR_SHELL, origin }, resolveCopy, resolveAsset);
      expect(resolved.footer?.legal.links[0]?.href).toBe(privacy);
    });

    it("resolves root-relative nav, action, secondary action and column links against the origin too, not only legal links", () => {
      const site = siteShellFor(CONFIG, "site");
      const resolved = resolveShell({ ...site, origin: "https://example.com" }, resolveCopy, resolveAsset);
      expect(resolved.nav?.links.map((link) => link.href)).toEqual(["https://example.com/pricing", "https://example.com/docs"]);
      expect(resolved.actions.map((link) => link.href)).toEqual(["https://example.com/start"]);
      expect(resolved.secondaryAction?.href).toBe("https://app.example.com/");
      expect(resolved.footer?.columns[0]?.links.map((link) => link.href)).toEqual(["https://example.com/about"]);
    });

    it("refuses two current environments and a non-boolean isCurrent", () => {
      const env = (isCurrent: unknown) => ({ href: "https://app.example.com/", label: ref("env.app"), icon: ICON, isCurrent });
      expect(render$({ ...FRONT_DOOR_SHELL, environments: [env(true), env(true)] })).toThrow(
        /SiteFrame: shell\.environments marks more than one environment current\./,
      );
      expect(render$({ ...FRONT_DOOR_SHELL, environments: [env("true")] })).toThrow(/SiteFrame: shell\.environments\[0\]\.isCurrent must be a boolean\./);
    });

    it("refuses a wordmark on a mark brand", () => {
      expect(
        render$({ ...FRONT_DOOR_SHELL, brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "mark", wordmark: ref("brand.name") } }),
      ).toThrow(/SiteFrame: shell\.brand\.wordmark is only for the lockup variant\./);
    });

    it("refuses the inverse-page chrome ground", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, ground: "transparent-inverse" })).toThrow(/SiteFrame: shell\.ground must be one of base, inverse, transparent\./);
    });

    it("refuses copy that resolves blank", () => {
      const blankResolver: CopyResolver = (copyRef) => {
        const resolution = resolveCopy(copyRef);
        return resolution && copyRef.id === "skip" ? { ...resolution, text: "   " } : resolution;
      };
      expect(() => renderToStaticMarkup(<SiteFrame shell={FRONT_DOOR_SHELL} resolveCopy={blankResolver} resolveAsset={resolveAsset}><p /></SiteFrame>)).toThrow(
        /SiteFrame: shell\.skipLink did not resolve to copy\./,
      );
    });

    it.each([
      ["shell", (extra: object) => ({ ...FRONT_DOOR_SHELL, ...extra }), /shell has an unsupported field "extra"/],
      ["brand", (extra: object) => ({ ...FRONT_DOOR_SHELL, brand: { ...FRONT_DOOR_SHELL.brand, ...extra } }), /shell\.brand has an unsupported field "extra"/],
      ["nav", (extra: object) => ({ ...FRONT_DOOR_SHELL, nav: { label: ref("nav.label"), links: [], ...extra } }), /shell\.nav has an unsupported field "extra"/],
      [
        "a link",
        (extra: object) => ({ ...FRONT_DOOR_SHELL, actions: [{ href: "/start", label: ref("cta.start"), ...extra }] }),
        /shell\.actions\[0\] has an unsupported field "extra"/,
      ],
      [
        "an environment",
        (extra: object) => ({ ...FRONT_DOOR_SHELL, environments: [{ href: "/", label: ref("env.app"), icon: ICON, ...extra }] }),
        /shell\.environments\[0\] has an unsupported field "extra"/,
      ],
      ["the footer", (extra: object) => ({ ...FRONT_DOOR_SHELL, footer: { legal: CONFIG.legal, ...extra } }), /shell\.footer has an unsupported field "extra"/],
      [
        "a footer column",
        (extra: object) => ({ ...FRONT_DOOR_SHELL, footer: { legal: CONFIG.legal, columns: [{ heading: ref("footer.company"), links: [], ...extra }] } }),
        /shell\.footer\.columns\[0\] has an unsupported field "extra"/,
      ],
      ["the legal row", (extra: object) => ({ ...FRONT_DOOR_SHELL, footer: { legal: { ...CONFIG.legal, ...extra } } }), /shell\.footer\.legal has an unsupported field "extra"/],
    ] as const)("refuses an unknown field on %s", (_name, build, message) => {
      expect(render$(build({ extra: true }))).toThrow(message);
    });

    it("echoes an unknown key only as identifier characters, truncated", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, ["<img src=x onerror=alert(1)>"]: true })).toThrow(/shell has an unsupported field "imgsrcxonerroralert1"\./);
      expect(render$({ ...FRONT_DOOR_SHELL, ["<img src=x onerror=alert(1)>"]: true })).not.toThrow(/[<>=()]/);
      expect(render$({ ...FRONT_DOOR_SHELL, ["k".repeat(500)]: true })).toThrow(new RegExp(`unsupported field "${"k".repeat(40)}"\\.`));
      expect(render$({ ...FRONT_DOOR_SHELL, ["<>"]: true })).toThrow(/SiteFrame: shell has an unsupported field\.$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Views render chrome-free by default and compose to one main inside the frame.
// ---------------------------------------------------------------------------

describe.each(CHROME_FREE_VIEWS)("$name chrome-free", ({ element, h1 }) => {
  it("alone: no main, no footer, no landmark role, one h1", () => {
    const { container } = render(element);
    const found = landmarks(container);
    expect(found.mains).toHaveLength(0);
    expect(container.querySelectorAll("footer, nav")).toHaveLength(0);
    expect(container.querySelectorAll('[role="main"], [role="banner"], [role="contentinfo"], [role="navigation"]')).toHaveLength(0);
    expect(found.h1s).toHaveLength(1);
    expect(found.h1s[0]).toHaveTextContent(h1);
  });

  it("alone: renders no <header> and no site chrome of its own", () => {
    const { container } = render(element);
    expect(container.querySelectorAll("header, header a, header nav, header img")).toHaveLength(0);
  });

  it("inside the frame: one skip link, one main with the fixed id, the frame's banner and contentinfo, one h1", () => {
    const { container } = render(frame(FRONT_DOOR_SHELL, element));
    const found = landmarks(container);
    const root = container.firstElementChild as HTMLElement;
    expect(found.skipLinks).toHaveLength(1);
    expect(found.mains).toHaveLength(1);
    expect(found.mains[0]).toHaveAttribute("id", SITE_MAIN_ID);
    expect(found.banners).toEqual([root.children[1]]);
    expect(found.contentinfos).toEqual([root.children[3]]);
    expect(found.mains[0]?.querySelectorAll("footer, nav, [role]:is([role='banner'], [role='contentinfo'], [role='main'], [role='navigation'])")).toHaveLength(0);
    expect(found.h1s).toHaveLength(1);
    expect(found.mains[0]).toContainElement(found.h1s[0] as HTMLElement);
  });
});

describe.each(CHROME_FREE_VIEWS)("$name content root", ({ name, element }) => {
  it("refuses a landmark role (any case, any token) or the frame's main id on its content root", () => {
    for (const extra of [
      { role: "main" },
      { role: "MAIN" },
      { role: "Banner" },
      { role: "region contentinfo" },
      { role: "navigation" },
      { id: SITE_MAIN_ID },
    ]) {
      const props = { ...(element.props as object), ...extra };
      const View = element.type as (p: object) => ReactElement;
      expect(() => renderToStaticMarkup(<View {...props} />)).toThrow(new RegExp(`${name}: the content root`));
    }
  });
});

const CHROME_VALUES: Readonly<Record<string, unknown>> = {
  brand: "Acme",
  header: <header>Own header</header>,
  footer: <footer>Own footer</footer>,
  mainId: "main-content",
  nav: <a href="/docs">Docs</a>,
  headerAction: <a href="/start">Start</a>,
  headerSecondaryAction: <a href="/signin">Sign in</a>,
  secondaryAction: <a href="/signin">Sign in</a>,
  ground: "base",
  footerSecondary: <p>Legal</p>,
  surfaceLabel: "Admin",
};

const LEGACY_KEYS: ReadonlyArray<readonly [string, (chrome: Record<string, unknown>) => ReactElement, readonly string[]]> = [
  [
    "AuthView",
    (chrome) => <AuthView heading="Sign in" description="Welcome back." form={null} {...chrome} />,
    ["brand", "header", "footer", "mainId", "nav", "headerAction", "headerSecondaryAction", "ground", "footerSecondary", "surfaceLabel"],
  ],
  [
    "CaptureView",
    (chrome) => <CaptureView heading="Contact" form={<p>form</p>} {...chrome} />,
    ["brand", "header", "footer", "mainId", "nav", "headerAction", "headerSecondaryAction", "ground", "footerSecondary"],
  ],
  [
    "DocumentView",
    (chrome) => <DocumentView document={DOCUMENT} resolveCopyId={resolveCopy} {...chrome} />,
    ["brand", "footerSecondary"],
  ],
  [
    "BoundaryView",
    (chrome) => <BoundaryView status={404} title="Not found" {...chrome} />,
    ["brand", "header", "footer", "mainId", "nav", "headerAction", "secondaryAction", "ground", "footerSecondary"],
  ],
];

describe.each(LEGACY_KEYS)("%s: each deprecated chrome prop alone selects the legacy page", (_view, build, keys) => {
  it.each(keys)("%s", (key) => {
    const { container } = render(build({ [key]: CHROME_VALUES[key] }));
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-h-dvh");
  });

  it("no chrome prop: the chrome-free content", () => {
    const { container } = render(build({}));
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// One configuration, one frame per surface kind (#2014).
// ---------------------------------------------------------------------------

describe("siteShellFor", () => {
  it("lists the four surface kinds", () => {
    expect(SITE_SURFACE_KINDS).toEqual(["site", "front-door", "admin", "demo"]);
    expect(Object.isFrozen(SITE_SURFACE_KINDS)).toBe(true);
  });

  it("site: navigation, calls to action and footer columns, links relative to its own host", () => {
    const shell = siteShellFor(CONFIG, "site");
    expect(shell.nav?.links).toHaveLength(2);
    expect(shell.actions).toHaveLength(1);
    expect(shell.footer?.columns).toHaveLength(1);
    expect(shell.environments).toBeUndefined();
    expect(shell.origin).toBeUndefined();
  });

  it.each([
    ["front-door", "App"],
    ["admin", "Admin"],
    ["demo", "Demo"],
  ] as const)("%s: no navigation, environment links with the current one marked, legal links absolute to the public origin", (kind, current) => {
    const shell = siteShellFor(CONFIG, kind);
    expect(shell.nav).toBeUndefined();
    expect(shell.actions).toBeUndefined();
    expect(shell.footer?.columns).toBeUndefined();
    expect(shell.origin).toBe("https://example.com");

    const { container } = render(frame(shell, <p>content</p>));
    expect(container.querySelector("header nav")).toBeNull();
    const currents = [...container.querySelectorAll('header a[aria-current="true"]')];
    expect(currents).toHaveLength(1);
    expect(currents[0]).toHaveTextContent(current);
    const legal = [...container.querySelectorAll("footer a")].map((a) => a.getAttribute("href"));
    expect(legal).toEqual(["https://example.com/privacy", "https://example.com/terms"]);
  });

  it("refuses an unknown surface kind", () => {
    expect(() => siteShellFor(CONFIG, "intranet" as never)).toThrow(/siteShellFor: unknown surface kind/);
  });

  it("a public page and a front-door page from one configuration each have one skip link, main, banner and contentinfo", () => {
    for (const [kind, page] of [
      ["site", <p>home</p>],
      ["front-door", <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} />],
      ["admin", <BoundaryView status={403} title="Not authorized" />],
    ] as const) {
      const { container, unmount } = render(frame(siteShellFor(CONFIG, kind), page));
      const found = landmarks(container);
      expect([found.skipLinks.length, found.mains.length, found.banners.length, found.contentinfos.length]).toEqual([1, 1, 1, 1]);
      unmount();
    }
  });
});

/** Every module a source names: `from "x"`, a side-effect `import "x"`, a dynamic `import("x")` and `require("x")`. */
function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g)].map((match) => match[1] as string);
}

const FRAME_ALLOWED_IMPORT = /^(react|@clossys\/designer\/[a-z-]+\/server|@clossys\/writer|\.{1,2}\/[A-Za-z./-]+\.js)$/;

function frameSources(): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const directory of [import.meta.dirname, join(import.meta.dirname, "internal")]) {
    for (const name of readdirSync(directory)) {
      if (!/\.tsx?$/.test(name) || /\.(test|check)\.tsx?$/.test(name)) continue;
      files.push([name, readFileSync(join(directory, name), "utf8")]);
    }
  }
  return files;
}

describe("module boundaries", () => {
  it("only the skip-link, navigation implementation and navigation bridge are client modules, and the frame uses no hooks", () => {
    const sources = frameSources();
    expect(sources.map(([name]) => name)).toContain("SiteFrame.tsx");
    expect(sources.filter(([, source]) => source.startsWith('"use client";')).map(([name]) => name).sort()).toEqual(["NavDisclosure.boundary.client.tsx", "NavDisclosure.client.tsx", "SkipLink.client.tsx"]);
    for (const [name, source] of sources) {
      if (name === "SkipLink.client.tsx" || name === "NavDisclosure.client.tsx" || name === "NavDisclosure.boundary.client.tsx") expect(source.startsWith('"use client";')).toBe(true);
      else expect(source).not.toMatch(/["']use client["']/);
    }
    const frameSource = readFileSync(join(import.meta.dirname, "SiteFrame.tsx"), "utf8");
    expect(frameSource).not.toMatch(/\buse[A-Z][A-Za-z]*\(/);
  });

  it("frame modules retain server imports except the navigation island's Designer disclosure import, with no dynamic import or require", () => {
    for (const [name, source] of frameSources()) {
      for (const specifier of moduleSpecifiers(source)) {
        if (name === "NavDisclosure.client.tsx" && specifier === "@clossys/designer/shell") continue;
        if (name === "NavDisclosure.boundary.client.tsx" && specifier === "#publisher-frame-navigation") continue;
        if (name === "SiteFrame.tsx" && specifier === "#publisher-web-views") continue;
        expect(specifier).toMatch(FRAME_ALLOWED_IMPORT);
      }
      expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    }
  });

  it("the import scan catches side-effect imports, dynamic imports and require", () => {
    const sample = ['import "side-effect";', 'const a = import("dynamic");', 'const b = require("required");', 'export * from "reexport";', 'import { c } from "react";'].join("\n");
    expect(moduleSpecifiers(sample)).toEqual(["side-effect", "dynamic", "required", "reexport", "react"]);
    expect(moduleSpecifiers(sample).filter((specifier) => !FRAME_ALLOWED_IMPORT.test(specifier))).toEqual(["side-effect", "dynamic", "required", "reexport"]);
  });
});

describe("SiteFrame list keys", () => {
  it("renders repeated headings and links in full, with no duplicate-key warning", () => {
    const repeated = { href: "/about", label: ref("footer.about") };
    const shell: SiteShellInput = {
      ...siteShellFor(CONFIG, "site"),
      nav: { label: ref("nav.label"), links: [repeated, repeated] },
      actions: [repeated, repeated],
      footer: {
        columns: [
          { heading: ref("footer.company"), links: [repeated, repeated] },
          { heading: ref("footer.company"), links: [repeated] },
        ],
        // The legal row is keyed inside Designer's SiteFooter.Legal, so it keeps distinct links here.
        legal: CONFIG.legal,
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(frame(shell, <p>content</p>));
      const keyWarnings = consoleError.mock.calls.filter((call) => call.some((part) => typeof part === "string" && /same key/i.test(part)));
      expect(keyWarnings).toEqual([]);
      expect(container.querySelectorAll("header nav li")).toHaveLength(2);
      const footer = container.querySelector("footer") as HTMLElement;
      expect([...footer.querySelectorAll("h2, h3, h4, p")].filter((node) => node.textContent === "Company")).toHaveLength(2);
      expect([...container.querySelectorAll("a")].filter((link) => link.textContent === "About")).toHaveLength(2 + 2 + 2 + 1);
    } finally {
      consoleError.mockRestore();
    }
  });
});


// Icon actions, ungrouped links and social profiles are closed shell data.
const ICON_LINK = { href: "/contact", label: ref("icon.contact"), icon: ICON };
const ALL_SLOTS: SiteShellInput = {
  ...siteShellFor(CONFIG, "site"),
  iconActions: [ICON_LINK],
  environments: [{ href: "/app", label: ref("env.app"), icon: ICON }],
  footer: {
    ...siteShellFor(CONFIG, "site").footer!,
    links: [{ href: "/help", label: ref("footer.help") }],
    social: { label: ref("social.label"), links: [{ href: "/profile", label: ref("social.profile"), icon: ICON }] },
  },
};

describe("SiteFrame icon slots", () => {
  it("renders all slots with semantic landmarks, resolved accessible names and decorative icons", () => {
    const { getByRole } = render(frame(ALL_SLOTS, <p>content</p>));
    const banner = getByRole("banner");
    const contact = within(banner).getByRole("link", { name: "Contact" });
    expect(contact).toHaveAttribute("href", "/contact");
    expect(contact.textContent).toBe("");
    expect(contact.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const footer = getByRole("contentinfo");
    const social = within(footer).getByRole("navigation", { name: "Profiles" });
    const profile = within(social).getByRole("link", { name: "Profile" });
    expect(profile).toHaveAttribute("href", "/profile");
    expect(profile.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(social).getByRole("list")).toContainElement(profile);
    const ungrouped = within(footer).getByRole("link", { name: "Help" }).closest("ul")!;
    expect(ungrouped).toHaveAttribute("role", "list");
    expect(ungrouped.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(within(footer).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Company"]);
  });

  it("keeps all slots in document tab order", () => {
    const { container } = render(frame(ALL_SLOTS, <p>content</p>));
    const focusable = [...container.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]
      .filter((element) => element.tabIndex >= 0);
    expect(focusable.map((element) => element.getAttribute("aria-label") ?? element.textContent)).toEqual([
      "Skip to content", "Example home", "Primary", "Pricing", "Docs", "Sign in", "Get started", "Contact", "App",
      "About", "Help", "Profile", "Privacy", "Terms",
    ]);
  });

  it("omits empty slots byte for byte", () => {
    const shell = siteShellFor(CONFIG, "site");
    const omitted = renderToStaticMarkup(frame(shell, <p>content</p>));
    for (const social of [{ links: [] }, { label: ref("social.label"), links: [] }]) {
      expect(renderToStaticMarkup(frame({ ...shell, iconActions: [], footer: { ...shell.footer!, links: [], social } }, <p>content</p>))).toBe(omitted);
    }
  });

  it("emits no wrapper, list, navigation or divider for empty slots on a shell without columns or actions", () => {
    const bare: SiteShellInput = { brand: CONFIG.brand, skipLink: CONFIG.skipLink, footer: { legal: CONFIG.legal } };
    const baseline = renderToStaticMarkup(frame(bare, <p>content</p>));
    for (const social of [{ links: [] }, { label: ref("social.label"), links: [] }]) {
      const shell: SiteShellInput = { ...bare, iconActions: [], footer: { ...bare.footer!, links: [], social } };
      expect(renderToStaticMarkup(frame(shell, <p>content</p>))).toBe(baseline);
      const { container, unmount } = render(frame(shell, <p>content</p>));
      // Banner: the brand group only, no empty trailing actions wrapper.
      expect(container.querySelector("header > div")!.children).toHaveLength(1);
      // Footer: the secondary row only, no empty column grid, and no divider above it.
      const footer = container.querySelector("footer")!;
      expect(footer.querySelector(".grid")).toBeNull();
      expect(footer.firstElementChild!.children).toHaveLength(1);
      const secondary = footer.firstElementChild!.firstElementChild!;
      expect(secondary.className).not.toContain("border-t");
      // The secondary row holds the legal row alone: no empty social list or navigation.
      expect(secondary.children).toHaveLength(1);
      expect(within(footer).getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual(["Legal"]);
      for (const list of container.querySelectorAll("ul")) expect(list.children.length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("keeps the social list from shrinking beside the legal row and gives icon links a square tap target", () => {
    const named = render(frame(ALL_SLOTS, <p>content</p>));
    expect(named.getByRole("navigation", { name: "Profiles" })).toHaveClass("shrink-0");
    for (const name of ["Contact", "Profile"]) {
      const link = named.getByRole("link", { name });
      expect(link.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
      expect(link.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
      expect(link).toHaveClass("justify-center");
    }
    named.unmount();
    const unnamed = render(frame({ ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer!, social: { links: ALL_SLOTS.footer!.social!.links } } }, <p>content</p>));
    expect(unnamed.getByRole("link", { name: "Profile" }).closest("ul")).toHaveClass("shrink-0");
  });

  it("renders ungrouped links alone and unnamed social without a navigation wrapper", () => {
    const { getByRole } = render(frame({ ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer!, columns: [], social: { links: ALL_SLOTS.footer!.social!.links } } }, <p>content</p>));
    const footer = getByRole("contentinfo");
    expect(within(footer).queryByRole("heading")).toBeNull();
    expect(within(footer).getByRole("link", { name: "Help" }).closest("ul")).not.toBeNull();
    expect(within(footer).getByRole("link", { name: "Profile" }).closest("nav")).toBeNull();
  });

  it("resolves root-relative hrefs in all three slots against origin", () => {
    const { getByRole } = render(frame({ ...ALL_SLOTS, origin: "https://example.com" }, <p>content</p>));
    for (const [name, path] of [["Contact", "/contact"], ["Help", "/help"], ["Profile", "/profile"]]) {
      expect(getByRole("link", { name })).toHaveAttribute("href", `https://example.com${path}`);
    }
  });

  describe("fails closed", () => {
    const resolve = (shell: unknown) => () => resolveShell(shell as SiteShellInput, resolveCopy, resolveAsset);
    const assertRefusal = (shell: unknown, path: string, hidden: string) => {
      const call = resolve(shell);
      expect(call).toThrow(`SiteFrame: ${path}`);
      try { call(); } catch (error) { expect((error as Error).message).not.toContain(hidden); }
    };
    const withIconLink = (entry: unknown, social = false) => social
      ? { ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer, social: { links: [entry] } } }
      : { ...ALL_SLOTS, iconActions: [entry] };

    it("refuses unknown icon-link and social keys without echoing values", () => {
      for (const social of [false, true]) {
        assertRefusal(withIconLink({ ...ICON_LINK, extra: "private-value" }, social), social ? "shell.footer.social.links[0]" : "shell.iconActions[0]", "private-value");
      }
      assertRefusal({ ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer, social: { links: [], extra: "private-value" } } }, "shell.footer.social", "private-value");
    });

    it.each(["javascript:alert(1)", "//unsafe.example/path", "/unsafe\u0000path"])("refuses unsafe href %j in each new slot", (value) => {
      assertRefusal(withIconLink({ ...ICON_LINK, href: value }), "shell.iconActions[0].href", value);
      assertRefusal(withIconLink({ ...ICON_LINK, href: value }, true), "shell.footer.social.links[0].href", value);
      assertRefusal({ ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer, links: [{ href: value, label: ref("footer.help") }] } }, "shell.footer.links[0].href", value);
    });

    it.each([undefined, ref("unresolved-label"), ref("blank"), "literal-label"])("refuses missing unresolved blank or literal label %j", (label) => {
      for (const social of [false, true]) {
        assertRefusal(withIconLink({ ...ICON_LINK, label }, social), social ? "shell.footer.social.links[0].label" : "shell.iconActions[0].label", typeof label === "string" ? label : label?.id ?? "missing-label");
      }
    });

    it.each([ref("unresolved-label"), ref("blank"), "literal-label"])("refuses invalid social navigation label %j", (label) => {
      assertRefusal({ ...ALL_SLOTS, footer: { ...ALL_SLOTS.footer, social: { label, links: [ICON_LINK] } } }, "shell.footer.social.label", typeof label === "string" ? label : label.id);
    });

    it.each([
      [["script", { src: "forbidden-value" }]],
      [["path", { href: "forbidden-value" }]],
      [["path", { fill: "url(forbidden-value)" }]],
    ])("refuses non-shape icon data %j", (node) => {
      // Wrap parameterised tuples so each case remains an IconNode array.
      for (const social of [false, true]) {
        assertRefusal(withIconLink({ ...ICON_LINK, icon: [node] }, social), social ? "shell.footer.social.links[0].icon" : "shell.iconActions[0].icon", "forbidden-value");
      }
    });
  });
});

describe("siteShellFor icon slots", () => {
  const config: SiteFrameConfig = { ...CONFIG, site: { ...CONFIG.site, iconActions: ALL_SLOTS.iconActions, footerLinks: ALL_SLOTS.footer!.links, social: ALL_SLOTS.footer!.social } };
  it("passes all three slots only to the site", () => {
    const site = siteShellFor(config, "site");
    expect(site.iconActions).toEqual(ALL_SLOTS.iconActions);
    expect(site.footer?.links).toEqual(ALL_SLOTS.footer!.links);
    expect(site.footer?.social).toEqual(ALL_SLOTS.footer!.social);
    for (const kind of ["front-door", "admin", "demo"] as const) {
      const shell = siteShellFor(config, kind);
      expect(shell).not.toHaveProperty("iconActions");
      expect(shell.footer).not.toHaveProperty("links");
      expect(shell.footer).not.toHaveProperty("social");
    }
  });
});


describe("frame header placement", () => {
  it.each([undefined, "base", "inverse"] as const)("mounts Designer's overlay placement with tone %s and keeps one skip link and one main", (tone) => {
    const shell: SiteShellInput = { ...FRONT_DOOR_SHELL, header: { placement: "overlay", ...(tone === undefined ? {} : { tone }) } };
    const { container } = render(frame(shell, <p>content</p>));
    const header = container.querySelector("header")!;
    expect(header).toHaveAttribute("data-placement", "overlay");
    expect(header).toHaveAttribute("data-tone", tone ?? "base");
    expect(header).toHaveStyle({ position: "fixed" });
    expect(header).toHaveClass(tone === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
    expect(landmarks(container).skipLinks).toHaveLength(1);
    expect(landmarks(container).mains).toHaveLength(1);
    expect(container.querySelector("main")).toHaveAttribute("id", SITE_MAIN_ID);
  });

  it.each(["inverse", "transparent"] as const)("header ground %s paints only the reserved header while the footer keeps shell ground", (ground) => {
    const { container } = render(frame({ ...FRONT_DOOR_SHELL, ground: "base", header: { placement: "reserved", ground } }, <p>content</p>));
    if (ground === "inverse") expect(container.querySelector("header")).toHaveClass("bg-surface-inverse");
    else expect(container.querySelector("header")).not.toHaveClass("bg-surface-raised");
    expect(container.querySelector("footer")).toHaveClass("bg-surface-raised");
    expect(container.querySelector("header")).not.toHaveAttribute("data-placement");
  });

  it("defaults reserved header ground to the shell ground", () => {
    const omitted = renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, ground: "inverse" }, <p>content</p>));
    expect(renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, ground: "inverse", header: {} }, <p>content</p>))).toBe(omitted);
    expect(renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, ground: "inverse", header: { placement: "reserved" } }, <p>content</p>))).toBe(omitted);
  });

  it.each([
    [{ unknown: "PAYLOAD-SENTINEL" }, /shell\.header has an unsupported field/],
    [{ placement: "PAYLOAD-SENTINEL" }, /shell\.header\.placement/],
    [{ ground: "PAYLOAD-SENTINEL" }, /shell\.header\.ground/],
    [{ placement: "overlay", tone: "PAYLOAD-SENTINEL" }, /shell\.header\.tone/],
    [{ placement: "overlay", ground: "inverse" }, /shell\.header\.ground/],
    [{ placement: "overlay", ground: "PAYLOAD-SENTINEL" }, /shell\.header\.ground/],
    [{ placement: "overlay", ground: undefined }, /shell\.header\.ground/],
    [{ placement: "reserved", tone: "inverse" }, /shell\.header\.tone/],
    [{ placement: "reserved", tone: "PAYLOAD-SENTINEL" }, /shell\.header\.tone/],
    [{ placement: "reserved", tone: undefined }, /shell\.header\.tone/],
    [{ tone: "base" }, /shell\.header\.tone/],
    [null, /shell\.header must be a plain object/],
    [[], /shell\.header must be a plain object/],
    ["PAYLOAD-SENTINEL", /shell\.header must be a plain object/],
  ])("refuses invalid header data without echoing its value: %j", (header, pattern) => {
    const attempt = () => renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, header } as SiteShellInput, <p>content</p>));
    expect(attempt).toThrow(pattern);
    expect(attempt).not.toThrow(/PAYLOAD-SENTINEL/);
  });

  it("siteShellFor passes header to the site surface only", () => {
    const header = { placement: "overlay", tone: "inverse" } as const;
    const config: SiteFrameConfig = { ...CONFIG, site: { ...CONFIG.site, header } };
    expect(siteShellFor(config, "site").header).toEqual(header);
    for (const kind of ["front-door", "admin", "demo"] as const) {
      expect(siteShellFor(config, kind)).not.toHaveProperty("header");
    }
  });

  it.each([
    ["base", "--color-ink-primary", "--color-surface-base"],
    ["base", "--color-ink-primary", "--color-surface-sunken"],
    ["inverse", "--color-ink-on-inverse", "--color-surface-inverse"],
  ])("overlay tone %s uses a gated contrast pair over %s / %s", (_tone, foreground, background) => {
    expect(CONTRAST_PAIRS.some(pair => pair.foreground === foreground && pair.background === background && pair.minimumRatio >= 4.5)).toBe(true);
  });

  it("keeps overlay links fail-closed", () => {
    const shell = { ...FRONT_DOOR_SHELL, header: { placement: "overlay" }, actions: [{ href: "javascript:PAYLOAD-SENTINEL", label: ref("cta.start") }] };
    const attempt = () => renderToStaticMarkup(frame(shell as SiteShellInput, <p>content</p>));
    expect(attempt).toThrow(/shell\.actions\[0\]\.href is not an allowed link/);
    expect(attempt).not.toThrow(/PAYLOAD-SENTINEL/);
  });
});


// Literal captured from the existing shell on main (6ee625e3), before the header change.
const MAIN_FRAME_MARKUP = "<link rel=\"preload\" as=\"image\" href=\"/brand/mark.svg\"/><div class=\"flex min-h-dvh flex-col\"><a href=\"#publisher-main-content\" class=\"sr-only focus:not-sr-only focus:fixed focus:start-sm focus:top-sm focus:rounded-control focus:bg-accent focus:px-md focus:py-sm focus:text-body focus:text-ink-on-accent focus:outline-none\" style=\"z-index:var(--ui-z-tooltip, 80)\">Skip to content</a><header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/brand/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"/><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div><div class=\"flex items-center gap-sm\"><a href=\"https://app.example.com/\" aria-current=\"true\" class=\"inline-flex items-center justify-center gap-sm rounded-control font-body transition-colors motion-reduce:transition-none px-sm py-xs text-body-s bg-surface-raised text-ink-primary border border-line-base hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px);box-shadow:inset 0 calc(-2 * var(--ui-border-hairline, 1px)) 0 currentColor\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:var(--ui-icon-sm, var(--spacing-lg, 16px));height:var(--ui-icon-sm, var(--spacing-lg, 16px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)\" aria-hidden=\"true\"><path d=\"M3 12h18\"></path></svg><span class=\"sr-only tablet:not-sr-only\">App</span></a><a href=\"https://admin.example.com/\" class=\"inline-flex items-center justify-center gap-sm rounded-control font-body transition-colors motion-reduce:transition-none px-sm py-xs text-body-s bg-surface-raised text-ink-primary border border-line-base hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:var(--ui-icon-sm, var(--spacing-lg, 16px));height:var(--ui-icon-sm, var(--spacing-lg, 16px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)\" aria-hidden=\"true\"><path d=\"M3 12h18\"></path></svg><span class=\"sr-only tablet:not-sr-only\">Admin</span></a><a href=\"https://demo.example.com/\" class=\"inline-flex items-center justify-center gap-sm rounded-control font-body transition-colors motion-reduce:transition-none px-sm py-xs text-body-s bg-surface-raised text-ink-primary border border-line-base hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:var(--ui-icon-sm, var(--spacing-lg, 16px));height:var(--ui-icon-sm, var(--spacing-lg, 16px));flex-shrink:0;stroke-width:var(--ui-icon-stroke, 2)\" aria-hidden=\"true\"><path d=\"M3 12h18\"></path></svg><span class=\"sr-only tablet:not-sr-only\">Demo</span></a></div></div></header><main id=\"publisher-main-content\" tabindex=\"-1\" class=\"flex w-full flex-1 flex-col\"><p>content</p></main><footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\"><div class=\"flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start\"><nav aria-label=\"Legal\"><ul role=\"list\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end\"><li><a href=\"https://example.com/privacy\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Privacy</a></li><li><a href=\"https://example.com/terms\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Terms</a></li></ul></nav><p class=\"m-0 desktop:whitespace-nowrap\">© 2026 Example Ltd</p></div></div></div></footer></div>";

it("a shell with no header key renders byte-identical to main", () => {
  const year = vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
  try {
    expect(renderToStaticMarkup(frame(FRONT_DOOR_SHELL, <p>content</p>))).toBe(MAIN_FRAME_MARKUP);
  } finally {
    year.mockRestore();
  }
});

describe("SiteFrame chrome parity", () => {
  const navigation = { label: ref("nav.label"), triggerLabel: ref("cta.start"), links: [{ href: "/docs", label: ref("nav.docs") }] };
  it("renders one named navigation disclosure and operates its mobile toggle", () => {
    const { container } = render(frame({ ...FRONT_DOOR_SHELL, nav: navigation, footer: { legal: { entity: ref("legal.entity"), links: [] } } } as SiteShellInput, <p>content</p>));
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    const nav = within(container).getByRole("navigation", { name: "Primary" });
    const toggle = within(nav).getByRole("button", { name: "Get started" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(nav.querySelectorAll('a[href="https://example.com/docs"]')).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(nav, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
  it("uses resolved navigation copy as the toggle label when no separate reference is supplied", () => {
    const { container } = render(frame({ ...FRONT_DOOR_SHELL, nav: { label: ref("nav.label"), links: [] } }, <p>content</p>));
    expect(within(container.querySelector("header")!).getByRole("button", { name: "Primary" })).toHaveAttribute("aria-expanded", "false");
  });
  it.each([ref("PAYLOAD-SENTINEL"), ref("blank"), "PAYLOAD-SENTINEL"])("refuses unresolved, blank or literal toggle copy without echoing it", triggerLabel => {
    const run = () => renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, nav: { ...navigation, triggerLabel } } as SiteShellInput, <p>content</p>));
    expect(run).toThrow(/shell\.nav\.triggerLabel/);
    expect(run).not.toThrow(/PAYLOAD-SENTINEL/);
  });
  it("renders primary and secondary actions with Designer ActionLink styling and no icons", () => {
    const { container } = render(frame(siteShellFor(CONFIG, "site"), <p>content</p>));
    for (const href of ["/start", "https://app.example.com/"]) {
      const action = container.querySelector(`header a[href="${href}"]`)!;
      expect(action).toHaveClass("rounded-control", "justify-center");
      expect(action.querySelector("svg")).toBeNull();
      expect(action.querySelector(".sr-only")).toBeNull();
    }
  });
  it("paints an inverse footer independently of a base header", () => {
    const { container } = render(frame({ ...FRONT_DOOR_SHELL, ground: "base", footer: { ...FRONT_DOOR_SHELL.footer!, ground: "inverse" } } as SiteShellInput, <p>content</p>));
    expect(container.querySelector("header")).toHaveClass("bg-surface-raised");
    expect(container.querySelector("footer")).toHaveClass("bg-surface-inverse");
  });
  it("defaults footer ground to shell ground even with a different reserved header ground", () => {
    const { container } = render(frame({ ...FRONT_DOOR_SHELL, ground: "inverse", header: { ground: "base" } }, <p>content</p>));
    expect(container.querySelector("header")).toHaveClass("bg-surface-raised");
    expect(container.querySelector("footer")).toHaveClass("bg-surface-inverse");
  });
  it("refuses an invalid footer ground without echoing it", () => {
    const run = () => renderToStaticMarkup(frame({ ...FRONT_DOOR_SHELL, footer: { ...FRONT_DOOR_SHELL.footer!, ground: "PAYLOAD-SENTINEL" } } as SiteShellInput, <p>content</p>));
    expect(run).toThrow(/shell\.footer\.ground/);
    expect(run).not.toThrow(/PAYLOAD-SENTINEL/);
  });
});


function overlayHero() {
  return <LandingView document={{ id: "home", resolutions: [resolveCopy(ref("brand.label"))!], sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: "Welcome" }] }} fit="frame" landmark="none" />;
}

it("keeps overlay legal links keyboard reachable and pointer operable", async () => {
  const shell = { ...FRONT_DOOR_SHELL, header: { placement: "overlay", tone: "inverse" }, environments: [], footer: { placement: "overlay", legal: { ...CONFIG.legal, linksLabel: undefined } } } as SiteShellInput;
  const user = userEvent.setup();
  const { container } = render(frame(shell, overlayHero()));
  const footer = within(container).getByRole("contentinfo");
  const privacy = within(footer).getByRole("link", { name: "Privacy" });
  const terms = within(footer).getByRole("link", { name: "Terms" });
  expect(footer.parentElement).toHaveStyle({ pointerEvents: "none" });
  expect(footer).toHaveStyle({ pointerEvents: "auto" });
  await user.tab(); // skip link
  await user.tab(); // brand
  await user.tab();
  expect(privacy).toHaveFocus();
  await user.tab();
  expect(terms).toHaveFocus();
  await user.tab();
  expect(footer.contains(document.activeElement)).toBe(false);
  const activate = vi.fn((event: Event) => event.preventDefault());
  privacy.addEventListener("click", activate);
  await user.click(privacy);
  expect(activate).toHaveBeenCalledTimes(1);
  expect(privacy).toHaveFocus();
});


it.each(["--color-ink-on-inverse", "--color-ink-on-inverse-muted"])("backs overlay footer %s with a gated opaque inverse pair", foreground => {
  expect(CONTRAST_PAIRS.some(pair => pair.foreground === foreground && pair.background === "--color-surface-inverse" && pair.minimumRatio >= 4.5)).toBe(true);
});


it("keeps a tall overlay footer safely aligned without clipping its tab stops", async () => {
  const links = Array.from({ length: 30 }, (_, index) => ({ href: `/legal-${index}`, label: ref("legal.privacy") }));
  const shell: SiteShellInput = { ...FRONT_DOOR_SHELL, header: { placement: "overlay", tone: "inverse" }, environments: [], footer: { placement: "overlay", legal: { entity: ref("legal.entity"), links } } };
  const user = userEvent.setup();
  const { container } = render(frame(shell, overlayHero()));
  const footer = within(container).getByRole("contentinfo");
  const legalLinks = within(footer).getAllByRole("link", { name: "Privacy" });
  expect(legalLinks).toHaveLength(30);
  expect(footer.parentElement?.style.flexDirection).toBe("column");
  expect(footer.style.marginBlockStart).toBe("auto");
  expect(footer.style.minWidth).toBe("0");
  expect(footer.parentElement?.style.overflow).toBe("");
  expect(footer.style.overflow).toBe("");
  await user.tab(); // skip link
  await user.tab(); // brand
  for (const link of legalLinks) {
    await user.tab();
    expect(link).toHaveFocus();
  }
  await user.tab();
  expect(footer.contains(document.activeElement)).toBe(false);
});
