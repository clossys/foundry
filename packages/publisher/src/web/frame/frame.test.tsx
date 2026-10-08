// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import { AuthView } from "../views/AuthView.js";
import { BoundaryView } from "../views/BoundaryView.js";
import { CaptureView } from "../views/CaptureView.js";
import { DocumentView } from "../views/DocumentView.js";
import { ErrorView } from "../views/ErrorView.js";
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
      expect(render$({ ...FRONT_DOOR_SHELL, header: <header /> })).toThrow(/SiteFrame: shell has an unsupported field "header"/);
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
  it("the skip-link island is the frame's only client module, and the frame uses no hooks", () => {
    const sources = frameSources();
    expect(sources.map(([name]) => name)).toContain("SiteFrame.tsx");
    for (const [name, source] of sources) {
      if (name === "SkipLink.client.tsx") expect(source.startsWith('"use client";')).toBe(true);
      else expect(source).not.toMatch(/["']use client["']/);
    }
    const frameSource = readFileSync(join(import.meta.dirname, "SiteFrame.tsx"), "utf8");
    expect(frameSource).not.toMatch(/\buse[A-Z][A-Za-z]*\(/);
  });

  it("every frame module imports only react, Designer server entries, Writer and its own relative modules, with no dynamic import or require", () => {
    for (const [, source] of frameSources()) {
      for (const specifier of moduleSpecifiers(source)) expect(specifier).toMatch(FRAME_ALLOWED_IMPORT);
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
