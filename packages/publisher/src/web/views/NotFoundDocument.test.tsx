// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { expectFrontDoorConformance, PRIMARY_ACTION_CLASS } from "../../testing/index.js";
import { SITE_MAIN_ID } from "@clossys/designer/frames";
import type { SiteShellInput } from "@clossys/designer/frames";
import { SiteMetadataError } from "../siteMetadata.js";
import { NotFoundDocument } from "./NotFoundDocument.js";
import type { NotFoundDocumentProps } from "./NotFoundDocument.js";
import * as ordinary from "../../../dist/web/index.js";
import * as server from "../../../dist/web/server.js";
import * as client from "../../../dist/web/client.js";

const ALLOWED_IMPORTS = ["react", "../frame/SiteFrame.js", "../frame/types.js", "./GlobalErrorDocument.js", "./StatusView.js", "./statusDocument.js"];

/** Every module specifier named by an `import` statement or an `export ... from` re-export. */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "skip": "Skip to content",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",
};

const ref = (id: string): CopyRef => ({ id });

// A resolver that answers from a fixed map and ignores any locale: the document
// must not need a locale, a request or a provider to render.
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
  footer: {
    legal: {
      entity: ref("legal.entity"),
      links: [
        { href: "/privacy", label: ref("legal.privacy") },
        { href: "/terms", label: ref("legal.terms") },
      ],
    },
  },
};

const props: NotFoundDocumentProps = {
  lang: "de-CH",
  documentTitle: { page: "Page not found", brand: "Example Studio" },
  icon: { href: "/icon.svg", type: "image/svg+xml" },
  shell,
  resolveCopy,
  resolveAsset,
  status: "404",
  subtitle: "This page does not exist.",
  action: <a href="/" className={PRIMARY_ACTION_CLASS}>Back to home</a>,
};

function render(overrides: Partial<NotFoundDocumentProps> = {}): string {
  return renderToStaticMarkup(<NotFoundDocument {...props} {...overrides} />);
}

function parse(overrides: Partial<NotFoundDocumentProps> = {}): Document {
  return new DOMParser().parseFromString(render(overrides), "text/html");
}

describe("NotFoundDocument", () => {
  it("renders a whole document with the configured lang and exactly a head and a body", () => {
    const markup = render();
    expect(markup.match(/<html\b/g)).toHaveLength(1);
    expect(markup.match(/<body\b/g)).toHaveLength(1);
    const root = parse().documentElement;
    expect(root.getAttribute("lang")).toBe("de-CH");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.hasAttribute("data-brand-bound")).toBe(true);
    expect([...root.children].map((child) => child.tagName)).toEqual(["HEAD", "BODY"]);
  });

  it("renders one frame: one skip link, one banner, one main with the frame's id, one contentinfo and one h1 inside main", () => {
    const doc = parse();
    expect(doc.querySelectorAll(`a[href="#${SITE_MAIN_ID}"]`)).toHaveLength(1);
    expect(doc.querySelectorAll("header")).toHaveLength(1);
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    expect(doc.querySelector("main")?.id).toBe(SITE_MAIN_ID);
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
    const headings = doc.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("404");
    expect(doc.querySelector("main")?.contains(headings[0] as Node)).toBe(true);
    expect(doc.querySelector("main")?.textContent).toContain("This page does not exist.");
    expect(doc.querySelectorAll('[role="main"], [role="banner"], [role="contentinfo"]')).toHaveLength(0);
  });

  it("carries one title, a noindex robots meta and one icon link", () => {
    const doc = parse();
    expect([...doc.head.querySelectorAll("title")].map((title) => title.textContent)).toEqual(["Page not found · Example Studio"]);
    expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it("renders with no provider, request or locale context, and the same markup on every call", () => {
    expect(render()).toBe(render());
  });

  it("passes the front-door conformance kit as the not-found surface", () => {
    expect(() =>
      expectFrontDoorConformance({
        surfaces: [{ surface: "not-found", title: { page: "Page not found", brand: "Example Studio", actual: "Page not found · Example Studio" }, render: () => <NotFoundDocument {...props} /> }],
      }),
    ).not.toThrow();
  });

  it("forwards notes and routes to StatusView", () => {
    const main = parse({
      notes: <a href="/contact">Contact us</a>,
      routes: { label: "Popular pages", items: [{ id: "about", heading: "About", description: "Who we are", href: "/about" }] },
    }).querySelector("main") as HTMLElement;
    expect(main.querySelector('a[href="/contact"]')?.textContent).toBe("Contact us");
    expect(main.querySelector('a[href="/about"]')?.textContent).toContain("About");
  });

  it("refuses an error reference: an unmatched address has no diagnostic", () => {
    const withReference = { ...props, reference: { label: "Error", value: "x" } } as unknown as NotFoundDocumentProps;
    expect(() => renderToStaticMarkup(<NotFoundDocument {...withReference} />)).toThrow(/NotFoundDocument: reference/);
  });

  it("refuses the deprecated ErrorView props", () => {
    for (const key of ["title", "description"]) {
      const legacy = { ...props, [key]: "x" } as unknown as NotFoundDocumentProps;
      expect(() => renderToStaticMarkup(<NotFoundDocument {...legacy} />)).toThrow(/NotFoundDocument: `title` and `description`/);
    }
  });

  it("fails closed on a shell the frame refuses, and on a bad title", () => {
    expect(() => render({ shell: { ...shell, skipLink: ref("missing") } })).toThrow(/SiteFrame/);
    expect(() => render({ documentTitle: { page: "Page not found ", brand: "Example Studio" } })).toThrow(SiteMetadataError);
  });

  it("renders equivalent markup through the ordinary and react-server entries, and is not on the client entry", () => {
    expect(renderToStaticMarkup(<ordinary.NotFoundDocument {...props} />)).toBe(renderToStaticMarkup(<server.NotFoundDocument {...props} />));
    expect("NotFoundDocument" in client).toBe(false);
  });

  describe("import boundary", () => {
    const source = readFileSync(join(import.meta.dirname, "NotFoundDocument.tsx"), "utf8");

    it("imports only react, the frame, the status view and the shared status document head", () => {
      const specifiers = [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
      expect(specifiers).toEqual(expect.arrayContaining(["../frame/SiteFrame.js", "./StatusView.js", "./statusDocument.js"]));
      for (const specifier of specifiers) expect(ALLOWED_IMPORTS).toContain(specifier);
      expect(source).not.toMatch(/\brequire\(|import\(/);
    });

    it("is not a client module and reads no hook, header, cookie or locale context", () => {
      expect(source).not.toMatch(/^\s*["']use client["']/m);
      expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
      expect(source).not.toMatch(/next\/|headers\(|cookies\(/);
    });
  });
});

describe("README unmatched-address example", () => {
  const readme = readFileSync(join(import.meta.dirname, "../../../README.md"), "utf8");
  const example = [...readme.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
    .map((match) => match[1]!)
    .find((code) => code.includes("export default function GlobalNotFound("))!;
  const compiled = ts.transpileModule(example, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports: { default?: () => ReactElement } = {};
  const requireExample = (specifier: string) => {
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    if (specifier === "@clossys/publisher/web") return { NotFoundDocument };
    throw new Error(`Unexpected README example import: ${specifier}`);
  };
  // Run the documented component with the shared frame fixture, so the example is tested rather than restated.
  new Function("require", "exports", "frame", compiled.outputText)(requireExample, exports, { shell, resolveCopy, resolveAsset });

  it("renders one frame, one h1, the linked stylesheet and a conformant primary action", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(exports.default!()), "text/html");
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect([...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute("href"))).toEqual(["/site.css"]);
    expect(() =>
      expectFrontDoorConformance({ surfaces: [{ surface: "not-found", title: { page: "Page not found", brand: "Example Studio" }, render: () => exports.default!() }] }),
    ).not.toThrow();
  });
});
