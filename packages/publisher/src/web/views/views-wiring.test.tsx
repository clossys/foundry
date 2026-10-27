// @vitest-environment jsdom

/**
 * WIRE-7 (E5): every view is `frames.site-shell` (SiteFrame) plus `sections.*`.
 *
 * Each view renders inside SiteFrame's `<main>` content slot, and every styled or
 * interactive element there sits inside a Section root. Two layers of proof:
 *
 * 1. A structural check over the SSR markup, with Section roots found by the band marker every
 *    `SectionFrame` (`sections.band`) renders.
 * 2. WIRE-3's `provenance-scan` over the same markup: WL1 = 0 for each view on its own and inside the
 *    frame, and the outermost stamps in `<main>` are `sections.*` only.
 *
 * WL10 is static and in base (WIRE-2): the view modules the documents mount import
 * no `@clossys/designer/components` surface and only the frame and the sections.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { checkWiring, dsAttrs, scanProvenance } from "@clossys/designer/catalog";
import { SiteFrame } from "../frame/SiteFrame.js";
import { SITE_MAIN_ID } from "../frame/types.js";
import type { SiteShellInput } from "../frame/types.js";
import { AuthView } from "./AuthView.js";
import { BoundaryView } from "./BoundaryView.js";
import { CaptureView } from "./CaptureView.js";
import { ErrorView } from "./ErrorView.js";
import { StatusView } from "./StatusView.js";

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  skip: "Skip to content",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
};
const ref = (id: string): CopyRef => ({ id });
const resolveCopy: CopyResolver = (copyRef) => {
  const text = COPY[copyRef.id];
  return text === undefined
    ? undefined
    : { ref: copyRef, text, recordId: `record-${copyRef.id}`, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: copyRef.id };
};
const resolveAsset = (assetId: string): unknown =>
  assetId === "brand-mark" ? { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" } : undefined;
const shell: SiteShellInput = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "mark" },
  skipLink: ref("skip"),
  footer: { legal: { entity: ref("legal.entity"), links: [{ href: "/privacy", label: ref("legal.privacy") }] } },
};

const action = <a href="/">Go home</a>;
const form = (
  <form aria-label="Sign in">
    <input name="email" aria-label="Email" />
    <button type="submit">Continue</button>
  </form>
);

/** The six E5 views. Loading ships no publisher view; a product `loading` route is WIRE-10's. */
const VIEWS: readonly { readonly name: string; readonly element: ReactElement }[] = [
  { name: "AuthView", element: <AuthView heading="Sign in" description="Use your work email." form={form} notes={<a href="/help">Need help?</a>} footnote="Staff only." /> },
  { name: "BoundaryView", element: <BoundaryView status="403" title="Not authorized" description="Ask an owner." action={action} notes="Reference 8f2a." /> },
  { name: "CaptureView", element: <CaptureView heading="Request access" description="Tell us who you are." form={form} notes="We reply in a day." secondaryAction={<a href="/sign-in">Sign in</a>} /> },
  { name: "ErrorView", element: <ErrorView status="500" title="Something went wrong" description="Try again." action={action} /> },
  { name: "NotFound (StatusView)", element: <StatusView status="404" subtitle="That page does not exist." action={action} routes={{ label: "Next destinations", items: [{ id: "home", heading: "Home", href: "/" }] }} /> },
  { name: "Error (StatusView)", element: <StatusView status="500" subtitle="Something went wrong." reference={{ label: "Reference", value: "8f2a91c0" }} action={action} /> },
];

const framed = (view: ReactElement): string =>
  renderToStaticMarkup(
    <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
      {view}
    </SiteFrame>,
  );

const SECTION_ROOT = "[data-designer-section-frame], [data-ds-layer='sections']";
const isStyled = (element: Element): boolean => element.hasAttribute("class") || element.hasAttribute("style");
const isInteractive = (element: Element): boolean => {
  if (element.hasAttribute("role") || element.hasAttribute("tabindex") || element.hasAttribute("contenteditable")) return true;
  const tag = element.tagName.toLowerCase();
  if (tag === "a") return element.hasAttribute("href");
  if (tag === "input") return element.getAttribute("type")?.toLowerCase() !== "hidden";
  return ["button", "select", "textarea", "summary", "iframe"].includes(tag);
};

/** Styled or interactive elements in the frame's content slot with no Section root at or above them. */
function outsideSections(html: string): string[] {
  const main = new DOMParser().parseFromString(html, "text/html").getElementById(SITE_MAIN_ID);
  if (!main) throw new Error("SiteFrame rendered no main content slot");
  return [...main.querySelectorAll("*")]
    .filter((element) => (isStyled(element) || isInteractive(element)) && !element.closest(SECTION_ROOT))
    .map((element) => `<${element.tagName.toLowerCase()}${element.getAttribute("class") ? ` class="${element.getAttribute("class")}"` : ""}>`);
}

describe("views in SiteFrame: structural (sections only in the content slot)", () => {
  for (const { name, element } of VIEWS) {
    it(`${name} places only Sections in SiteFrame's main`, () => {
      expect(outsideSections(framed(element))).toEqual([]);
    });
  }

  it("a view drawing its own deprecated chrome renders outside the frame (the legacy path stays non-conformant)", () => {
    const html = renderToStaticMarkup(<BoundaryView status="403" title="Not authorized" brand={<span>Example</span>} />);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("header")?.closest(SECTION_ROOT)).toBeNull();
  });
});

// WIRE-3's provenance-scan over the same markup. Section roots carry their stamp (`sections.band` from
// SectionFrame, `sections.empty-state`, ...); the page root stamp is the route runtime's.
const route = (id: string) => ({ id, binding: { id, frame: "frames.site-shell", frameSlots: {}, sections: {} } });
const page = (id: string, children: ReactElement): string =>
  renderToStaticMarkup(<div {...dsAttrs("pages", `pages.${id}`, `foundry/pages.${id}`)}>{children}</div>);
const wl1 = (id: string, html: string) =>
  scanProvenance({ html, route: route(id), selection: {} }).findings.filter((finding) => finding.code === "WL1").map((finding) => finding.message);
const routeId = (name: string) => name.replace(/[^A-Za-z]+/g, "-").replace(/-$/, "").toLowerCase();

/**
 * SiteFrame's root as `frames.site-shell` stamps it. SiteFrame cannot spread the stamp itself yet: its
 * import allowlist (frame.test.tsx, owner-held) does not admit `@clossys/designer/catalog`. Until it does,
 * the stamp is applied to the rendered root here, from the same `dsAttrs`, so the scan sees the frame.
 */
const FRAME_STAMP = dsAttrs("frames", "frames.site-shell", "foundry/frames.site-shell");
const stampFrame = (html: string): string => {
  const attrs = Object.entries(FRAME_STAMP).map(([name, value]) => ` ${name}="${value}"`).join("");
  expect(html.split('<div data-frame-root=""').length).toBe(2);
  return html.replace('<div data-frame-root=""', `<div data-frame-root=""${attrs}`);
};

describe("views: provenance-scan (WL1)", () => {
  for (const { name, element } of VIEWS) {
    const id = routeId(name);

    it(`${name} on its own: WL1 = 0, every styled or interactive element is inside a sections.* stamp`, () => {
      const html = page(id, element);
      expect(wl1(id, html)).toEqual([]);
      const document = new DOMParser().parseFromString(html, "text/html");
      const outermost = [...document.querySelectorAll("[data-ds-layer]:not([data-ds-layer='pages'])")].filter(
        (node) => !node.parentElement?.closest("[data-ds-layer]:not([data-ds-layer='pages'])"),
      );
      expect(outermost.length).toBeGreaterThan(0);
      expect(outermost.map((node) => node.getAttribute("data-ds-layer"))).toEqual(outermost.map(() => "sections"));
    });

    it(`${name} in frames.site-shell: WL1 = 0 and main holds only sections.* roots`, () => {
      const html = page(id, <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>{element}</SiteFrame>);
      expect(wl1(id, stampFrame(html))).toEqual([]);
      const main = new DOMParser().parseFromString(html, "text/html").getElementById(SITE_MAIN_ID)!;
      expect(main.children.length).toBeGreaterThan(0);
      expect([...main.children].map((child) => child.getAttribute("data-ds-layer"))).toEqual([...main.children].map(() => "sections"));
    });
  }

  it("the scan sees the content slot: a styled element straight in SiteFrame's main fires WL1", () => {
    const html = page("bare", <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}><p className="text-ink-primary">Bare</p></SiteFrame>);
    expect(wl1("bare", stampFrame(html))).toEqual(["<p> in the frame content slot has no Section ancestor"]);
  });

  it("a view drawing its own deprecated chrome fires WL1 (the legacy path stays non-conformant)", () => {
    const html = page("legacy-boundary", <BoundaryView status="403" title="Not authorized" brand={<span>Example</span>} />);
    expect(wl1("legacy-boundary", html).length).toBeGreaterThan(0);
  });

  it.todo("SiteFrame stamps its own root frames.site-shell (owner landing item: admit @clossys/designer/catalog for SiteFrame.tsx in frame.test.tsx's import allowlist)");
});

describe("views: WL10 (the documents mount only the frame and section-composed views)", () => {
  const source = (file: string) => ({ path: `src/web/views/${file}`, content: readFileSync(join(import.meta.dirname, file), "utf8") });

  const wl10 = (file: string) =>
    checkWiring({
      sources: [],
      routes: {
        modules: [source(file)],
        // The runtime assembly a status document may mount: the document shell, the frame and the framed view.
        assembly: [
          { module: "../frame/SiteFrame.js", export: "SiteFrame" },
          { module: "./statusDocument.js", export: "StatusDocument" },
          { module: "./StatusView.js", export: "StatusView" },
        ],
      },
    }).findings.filter((finding) => finding.code === "WL10").map((finding) => finding.evidence);

  it("NotFoundDocument imports and renders only the document shell, SiteFrame and StatusView", () => {
    expect(wl10("NotFoundDocument.tsx")).toEqual([]);
  });

  it("GlobalErrorDocument's only finding is its deprecated unframed ErrorView shape", () => {
    // Owner landing item: the unframed shape renders the error body with no SiteFrame. Retiring it
    // changes the public GlobalErrorDocument props, which this unit does not do.
    expect(wl10("GlobalErrorDocument.tsx")).toEqual(["Route module renders <ErrorViewBody> outside the runtime assembly"]);
  });
});
