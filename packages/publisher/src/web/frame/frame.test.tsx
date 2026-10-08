// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import { AuthView } from "../views/AuthView.js";
import { BoundaryView } from "../views/BoundaryView.js";
import { CaptureView } from "../views/CaptureView.js";
import { ErrorView } from "../views/ErrorView.js";
import { SITE_MAIN_ID, SITE_SURFACE_KINDS, SiteFrame, siteShellFor } from "./index.js";
import type { SiteFrameConfig, SiteShellInput } from "./index.js";

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

const FRONT_DOOR_SHELL = siteShellFor(CONFIG, "front-door");

const CHROME_FREE_VIEWS: ReadonlyArray<{ name: string; element: ReactElement; h1: string }> = [
  { name: "AuthView", element: <AuthView heading="Sign in" description="Welcome back." form={<p>form</p>} notes={<p>notes</p>} />, h1: "Sign in" },
  { name: "CaptureView", element: <CaptureView heading="Request access" form={<p>form</p>} />, h1: "Request access" },
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

  it("renders on the server with no browser APIs", () => {
    const html = renderToStaticMarkup(frame(FRONT_DOOR_SHELL, <p>content</p>));
    expect(html).toContain(`<main id="${SITE_MAIN_ID}" tabindex="-1"`);
    expect(html.match(/<main\b/g)).toHaveLength(1);
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

    it("refuses a protocol-relative link", () => {
      const shell = { ...FRONT_DOOR_SHELL, footer: { legal: { entity: ref("legal.entity"), links: [{ href: "//evil.example/", label: ref("legal.terms") }] } } };
      expect(render$(shell)).toThrow(/is not an allowed link/);
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

    it("refuses an origin that is not an http(s) origin", () => {
      expect(render$({ ...FRONT_DOOR_SHELL, origin: "javascript:alert(1)" })).toThrow(/SiteFrame: shell\.origin must be an http\(s\) origin/);
      expect(render$({ ...FRONT_DOOR_SHELL, origin: "https://example.com/path" })).toThrow(/shell\.origin must be an http\(s\) origin/);
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

  it("under any host main: no banner and no contentinfo of its own (a page-header <header> is scoped to main)", () => {
    const { container } = render(<main>{element}</main>);
    const found = landmarks(container);
    expect(found.mains).toHaveLength(1);
    expect(found.banners).toHaveLength(0);
    expect(found.contentinfos).toHaveLength(0);
  });

  it("inside the frame: one skip link, one main with the fixed id, one banner, one contentinfo, one h1", () => {
    const { container } = render(frame(FRONT_DOOR_SHELL, element));
    const found = landmarks(container);
    expect(found.skipLinks).toHaveLength(1);
    expect(found.mains).toHaveLength(1);
    expect(found.mains[0]).toHaveAttribute("id", SITE_MAIN_ID);
    expect(found.banners).toHaveLength(1);
    expect(found.contentinfos).toHaveLength(1);
    expect(found.h1s).toHaveLength(1);
    expect(found.mains[0]).toContainElement(found.h1s[0] as HTMLElement);
  });
});

describe.each(CHROME_FREE_VIEWS.filter((view) => view.name !== "ErrorView"))("$name content root", ({ name, element }) => {
  it("refuses a landmark role or the frame's main id on its content root", () => {
    for (const extra of [{ role: "main" }, { role: "banner" }, { role: "contentinfo" }, { role: "navigation" }, { id: SITE_MAIN_ID }]) {
      const props = { ...(element.props as object), ...extra };
      const View = element.type as (p: object) => ReactElement;
      expect(() => renderToStaticMarkup(<View {...props} />)).toThrow(new RegExp(`${name}: the content root`));
    }
  });
});

describe("deprecated view chrome props keep the legacy page", () => {
  it.each([
    ["AuthView", <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={null} />],
    ["CaptureView", <CaptureView brand="Acme" heading="Contact" form={<p>form</p>} />],
    ["BoundaryView", <BoundaryView brand="Acme" status={404} title="Not found" />],
    ["AuthView with mainId only", <AuthView brand={null} mainId="main-content" header={null} footer={null} heading="Sign in" description="x" form={null} />],
  ])("%s still renders its own main", (_name, element) => {
    const { container } = render(element);
    expect(container.querySelectorAll("main")).toHaveLength(1);
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

describe("module boundaries", () => {
  it("the skip-link island is the frame's only client module", () => {
    const island = readFileSync(join(import.meta.dirname, "SkipLink.client.tsx"), "utf8");
    expect(island.startsWith('"use client";')).toBe(true);
    const frameSource = readFileSync(join(import.meta.dirname, "SiteFrame.tsx"), "utf8");
    expect(frameSource).not.toMatch(/["']use client["']/);
    expect(frameSource).not.toMatch(/\buse[A-Z][A-Za-z]*\(/);
    for (const source of [island, frameSource]) {
      for (const [, specifier] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(specifier).toMatch(/^(react|@clossys\/designer\/[a-z-]+\/server|@clossys\/writer|\.{1,2}\/.+)$/);
      }
    }
  });
});
