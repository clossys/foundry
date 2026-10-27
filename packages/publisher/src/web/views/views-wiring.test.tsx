// @vitest-environment jsdom

/**
 * WIRE-7 (E5): every view is `frames.site-shell` (SiteFrame) plus `sections.*`.
 *
 * Each view renders inside SiteFrame's `<main>` content slot, and every styled or
 * interactive element there sits inside a Section root. Two layers of proof:
 *
 * 1. Now: a structural check over the SSR markup, with Section roots found by the
 *    band marker every `SectionFrame` (`sections.band`) already renders.
 * 2. Once WIRE-3 merges: the real `provenance-scan` over the same markup gives
 *    WL1 = 0, the frame root is stamped `frames.site-shell` and the outermost
 *    stamps in `<main>` are `sections.*` only. PENDING(WIRE-3): `scanProvenance`,
 *    `dsAttrs` and the section-root stamps come from WIRE-3; until they are in
 *    `@clossys/designer/catalog`, that block reports as todo.
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
import * as catalog from "@clossys/designer/catalog";
import { checkWiring } from "@clossys/designer/catalog";
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

// PENDING(WIRE-3): scanProvenance and the stamps. The catalog entry is read by name so this file
// compiles on a base without them; once WIRE-3 merges these run and the todo disappears.
interface ScanFinding { readonly code: string; readonly selector?: string }
type Scan = (input: {
  html: string;
  route: { id: string; binding: { id: string; frame: string; frameSlots: Record<string, never[]>; sections: Record<string, never[]> } };
  selection: Record<string, string>;
}) => { readonly findings: readonly ScanFinding[] };
type Stamp = (layer: "pages", leaf: string, fill: string) => Record<string, string>;
const scanProvenance = (catalog as Record<string, unknown>).scanProvenance as Scan | undefined;
const dsAttrs = (catalog as Record<string, unknown>).dsAttrs as Stamp | undefined;

describe("views in SiteFrame: provenance-scan (WL1)", () => {
  if (!scanProvenance || !dsAttrs) {
    it.todo("PENDING(WIRE-3): WL1 = 0 for every view in SiteFrame, frame root stamped frames.site-shell");
    return;
  }
  const scan = scanProvenance, stamp = dsAttrs;
  const route = (id: string) => ({ id, binding: { id, frame: "frames.site-shell", frameSlots: {}, sections: {} } });
  const page = (id: string, children: ReactElement): string =>
    renderToStaticMarkup(<div {...stamp("pages", `pages.${id}`, `foundry/pages.${id}`)}>{children}</div>);
  const wl1 = (id: string, html: string) => scan({ html, route: route(id), selection: {} }).findings.filter((finding) => finding.code === "WL1");

  for (const { name, element } of VIEWS) {
    it(`${name} in SiteFrame: WL1 = 0 and main holds only sections.*`, () => {
      const id = name.replace(/[^A-Za-z]+/g, "-").replace(/-$/, "").toLowerCase();
      const html = page(id, <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>{element}</SiteFrame>);
      expect(wl1(id, html)).toEqual([]);
      const document = new DOMParser().parseFromString(html, "text/html");
      expect(document.querySelector("[data-frame-root]")?.getAttribute("data-ds-leaf")).toBe("frames.site-shell");
      const main = document.getElementById(SITE_MAIN_ID)!;
      const outermost = [...main.querySelectorAll("[data-ds-layer]")].filter((node) => !node.parentElement?.closest("[data-ds-layer]:not([data-ds-layer='frames']):not([data-ds-layer='pages'])"));
      expect(outermost.length).toBeGreaterThan(0);
      expect(outermost.map((node) => node.getAttribute("data-ds-layer"))).toEqual(outermost.map(() => "sections"));
    });
  }

  it("a view drawing its own chrome without SiteFrame fires WL1", () => {
    const html = page("legacy-boundary", <BoundaryView status="403" title="Not authorized" brand={<span>Example</span>} />);
    expect(wl1("legacy-boundary", html).length).toBeGreaterThan(0);
  });
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
