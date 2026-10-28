// @vitest-environment jsdom

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { SITE_MAIN_ID } from "@clossys/designer/frames";
import type { SiteShellInput } from "@clossys/designer/frames";
import { GlobalErrorDocument } from "./GlobalErrorDocument.js";
import type { GlobalErrorDocumentErrorViewProps, GlobalErrorDocumentFramedProps } from "./GlobalErrorDocument.js";
import { NotFoundDocument } from "./NotFoundDocument.js";
import type { NotFoundDocumentProps } from "./NotFoundDocument.js";
import { FRAME_CRITICAL_STYLE_ATTRIBUTE } from "./statusDocument.js";

// The two framed documents share one head. These tests pin what that head does
// for a host that cannot import the site stylesheet into the document: linked
// stylesheets, and inline critical rules for the frame's bands.

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "skip": "Skip to content",
  "legal.entity": "Example Ltd",
  "legal.terms": "Terms",
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

// An accent-ink mark: the one brand form that is invisible without a stylesheet,
// because its colour is a background utility under a mask.
const shell: SiteShellInput = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "mark", markInk: "accent" },
  skipLink: ref("skip"),
  footer: { legal: { entity: ref("legal.entity"), links: [{ href: "/terms", label: ref("legal.terms") }] } },
};

const head = {
  lang: "en",
  documentTitle: { page: "Something went wrong", brand: "Example Studio" },
  icon: { href: "/icon.svg", type: "image/svg+xml" },
};

const globalError: GlobalErrorDocumentFramedProps = { ...head, shell, resolveCopy, resolveAsset, status: "500", action: <button type="button" className="bg-accent">Try again</button> };
const notFound: NotFoundDocumentProps = { ...head, shell, resolveCopy, resolveAsset, status: "404", action: <a href="/" className="bg-accent">Back to home</a> };
const legacy: GlobalErrorDocumentErrorViewProps = { ...head, status: 500, title: "Something went wrong", description: "Try again later." };

const documents: ReadonlyArray<{ name: string; render: (stylesheets?: readonly string[]) => ReactElement }> = [
  { name: "GlobalErrorDocument", render: (stylesheets) => <GlobalErrorDocument {...globalError} {...(stylesheets === undefined ? {} : { stylesheets })} /> },
  { name: "NotFoundDocument", render: (stylesheets) => <NotFoundDocument {...notFound} {...(stylesheets === undefined ? {} : { stylesheets })} /> },
];

function parse(element: ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
}

/** The style rules inside the critical style element, as selector and declaration pairs. */
function criticalRules(doc: Document): Array<{ selector: string; declarations: string }> {
  const styles = doc.head.querySelectorAll(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`);
  expect(styles).toHaveLength(1);
  const css = styles[0]!.textContent ?? "";
  const layer = /^@layer [a-z-]+\{([\s\S]*)\}$/.exec(css.trim());
  expect(layer, "the critical rules sit in one named cascade layer").not.toBeNull();
  return [...layer![1]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), declarations: m[2]!.trim() }));
}

for (const document of documents) {
  describe(`${document.name} on a host that cannot import the site stylesheet`, () => {
    it("links each given stylesheet in order, after the critical style, and none when omitted", () => {
      const doc = parse(document.render(["/_site/site.css", "https://cdn.example.com/brand.css"]));
      const links = [...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute("href"));
      expect(links).toEqual(["/_site/site.css", "https://cdn.example.com/brand.css"]);
      const children = [...doc.head.children];
      const style = doc.head.querySelector(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`)!;
      const firstLink = doc.head.querySelector('link[rel="stylesheet"]')!;
      // The critical layer is declared first, so the linked stylesheet's layers and unlayered rules win over it.
      expect(children.indexOf(style)).toBeLessThan(children.indexOf(firstLink));
      expect(parse(document.render()).head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
    });

    it.each([
      ["a protocol-relative URL", "//cdn.example.com/site.css"],
      ["a plain-http URL", "http://cdn.example.com/site.css"],
      ["a script URL", "javascript:alert(1)"],
      ["a relative path", "site.css"],
      ["a blank string", " "],
      // The URL parser strips TAB, LF and CR, so each of these would resolve to a protocol-relative external URL.
      ["a TAB between the leading slashes", "/\t/cdn.example.com/site.css"],
      ["a LF between the leading slashes", "/\n/cdn.example.com/site.css"],
      ["a CR between the leading slashes", "/\r/cdn.example.com/site.css"],
      ["a TAB inside an https URL", "https://cdn.example.com/\tsite.css"],
      ["a space inside a path", "/site .css"],
      ["a NUL inside a path", "/site\u0000.css"],
      ["a DEL inside a path", "/site\u007f.css"],
    ])("refuses %s, naming only its index", (_label, href) => {
      expect(() => renderToStaticMarkup(document.render(["/ok.css", href]))).toThrow(
        new TypeError(`${document.name}: stylesheets[1] must be a root-relative path or an https URL.`),
      );
    });

    it("refuses a stylesheets value that is not an array", () => {
      expect(() => renderToStaticMarkup(document.render("/site.css" as unknown as readonly string[]))).toThrow(
        new TypeError(`${document.name}: stylesheets must be an array.`),
      );
    });

    it("carries inline critical rules whose selectors each reach a frame band, with no colour literal", () => {
      const doc = parse(document.render());
      const rules = criticalRules(doc);
      const reached = new Map<string, Element[]>(rules.map(({ selector }) => [selector, [...doc.body.querySelectorAll(selector)]]));
      for (const [selector, elements] of reached) expect(elements.length, selector).toBeGreaterThan(0);

      const frameRoot = doc.body.querySelector("[data-frame-root]")!;
      const main = doc.getElementById(SITE_MAIN_ID)!;
      const skip = doc.body.querySelector(`a[href="#${SITE_MAIN_ID}"]`)!;
      const mark = doc.body.querySelector("header [data-brand-mark]")!;
      const all = [...reached.values()].flat();
      for (const band of [frameRoot, main, skip, mark]) expect(all, band.outerHTML.slice(0, 60)).toContain(band);

      const css = rules.map((rule) => rule.declarations).join(";");
      expect(css).toMatch(/min-height:100dvh/);
      expect(css).toMatch(/clip-path:inset\(50%\)/);
      expect(css).toMatch(/background-color:var\(--color-accent,currentColor\)/);
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(/i);
    });

    it("hides the skip link only while it is not focused", () => {
      const skipRule = criticalRules(parse(document.render())).find((rule) => rule.selector.includes(`#${SITE_MAIN_ID}"]`));
      expect(skipRule?.selector).toMatch(/:not\(:focus\)$/);
    });
  });
}

describe("the deprecated ErrorView document shape", () => {
  it("is unchanged: no critical style and no stylesheet link", () => {
    const doc = parse(<GlobalErrorDocument {...legacy} />);
    expect(doc.head.querySelector("style")).toBeNull();
    expect(doc.head.querySelector('link[rel="stylesheet"]')).toBeNull();
  });
});
