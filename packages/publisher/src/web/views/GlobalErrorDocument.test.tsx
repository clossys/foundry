// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteMetadataError } from "../siteMetadata.js";
import { GlobalErrorDocument } from "./GlobalErrorDocument.js";
import type { GlobalErrorDocumentProps } from "./GlobalErrorDocument.js";

const ALLOWED_IMPORTS = ["react", "./ErrorView.js", "../siteMetadata.js"];

/** Every module specifier named by an `import` statement or an `export ... from` re-export. */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
}

const baseProps: GlobalErrorDocumentProps = {
  lang: "en",
  documentTitle: { page: "Something went wrong", brand: "Example Studio" },
  icon: { href: "/icon.svg", type: "image/svg+xml" },
  status: 500,
  title: "Something went wrong",
  description: "Something went wrong. Error: 8f2a91c0.",
  action: <button type="button">Try again</button>,
};

function parse(props: GlobalErrorDocumentProps = baseProps): Document {
  // `renderToStaticMarkup` of a root `<html>` has no doctype; DOMParser accepts it as a full document.
  return new DOMParser().parseFromString(renderToStaticMarkup(<GlobalErrorDocument {...props} />), "text/html");
}

describe("GlobalErrorDocument", () => {
  describe("document shell", () => {
    it("renders a light, brand-bound root with exactly a head and a body", () => {
      const root = parse().documentElement;
      expect(root.tagName).toBe("HTML");
      expect(root.getAttribute("lang")).toBe("en");
      expect(root.getAttribute("data-theme")).toBe("light");
      expect(root.hasAttribute("data-brand-bound")).toBe(true);
      expect(root.style.colorScheme).toBe("light");
      expect([...root.children].map((child) => child.tagName)).toEqual(["HEAD", "BODY"]);
    });

    it("puts htmlClassName on the root html as its class", () => {
      const root = parse({ ...baseProps, htmlClassName: "font-sans font-display" }).documentElement;
      expect(root.getAttribute("class")).toBe("font-sans font-display");
      expect(root.classList.contains("font-display")).toBe(true);
    });

    it("renders no class on the root html when htmlClassName is omitted or empty", () => {
      expect(parse().documentElement.hasAttribute("class")).toBe(false);
      expect(parse({ ...baseProps, htmlClassName: "" }).documentElement.hasAttribute("class")).toBe(false);
    });
  });

  describe("content root", () => {
    it("accepts a landmark role on the content root, since the document has no frame and no <main>", () => {
      const body = parse({ ...baseProps, role: "main" }).body;
      expect(body.querySelectorAll('[role="main"]')).toHaveLength(1);
      expect(body.querySelectorAll("h1")).toHaveLength(1);
    });
  });

  describe("head", () => {
    it("carries one title, one noindex robots meta and one icon link", () => {
      const doc = parse();
      const titles = doc.head.querySelectorAll("title");
      expect(titles).toHaveLength(1);
      expect(titles[0]?.textContent).toBe("Something went wrong · Example Studio");

      const robots = doc.head.querySelectorAll('meta[name="robots"]');
      expect(robots).toHaveLength(1);
      expect(robots[0]?.getAttribute("content")).toBe("noindex, nofollow");

      const icons = doc.head.querySelectorAll('link[rel="icon"]');
      expect(icons).toHaveLength(1);
      expect(icons[0]?.getAttribute("href")).toBe("/icon.svg");
      expect(icons[0]?.getAttribute("type")).toBe("image/svg+xml");
    });

    it("omits the icon type when none is given", () => {
      const doc = parse({ ...baseProps, icon: { href: "/favicon.ico" } });
      const icon = doc.head.querySelector('link[rel="icon"]');
      expect(icon?.getAttribute("href")).toBe("/favicon.ico");
      expect(icon?.hasAttribute("type")).toBe(false);
    });
  });

  describe("title rule", () => {
    it("throws SiteMetadataError for a brand with a leading space", () => {
      expect(() => parse({ ...baseProps, documentTitle: { page: "Something went wrong", brand: " Example Studio" } })).toThrow(
        SiteMetadataError,
      );
    });
  });

  describe("body", () => {
    it("renders the status heading, the description with its digest and one action", () => {
      const doc = parse();
      const headings = doc.body.querySelectorAll("h1");
      expect(headings).toHaveLength(1);
      expect(headings[0]?.textContent).toBe("500");
      expect(doc.body.textContent).toContain("Error: 8f2a91c0.");
      expect(doc.body.querySelectorAll("button")).toHaveLength(1);
      expect(doc.body.querySelector("button")?.textContent).toBe("Try again");
    });
  });

  describe("import boundary", () => {
    const source = readFileSync(join(import.meta.dirname, "GlobalErrorDocument.tsx"), "utf8");

    it("imports only react, the error view and the site-metadata title rule", () => {
      expect(moduleSpecifiers(source)).toEqual(expect.arrayContaining(["./ErrorView.js", "../siteMetadata.js"]));
      for (const specifier of moduleSpecifiers(source)) {
        expect(ALLOWED_IMPORTS).toContain(specifier);
      }
      expect(source).not.toMatch(/\brequire\(|import\(/);
    });

    it("is not a client module", () => {
      expect(source).not.toMatch(/^\s*["']use client["']/m);
    });

    it("the import scan catches bare imports, re-exports and multi-line imports", () => {
      const sample = [
        'import type { A } from "react";',
        'import "next/head";',
        'export * from "another-provider";',
        "import {",
        "  C,",
        '} from "third-provider";',
      ].join("\n");
      expect(moduleSpecifiers(sample)).toEqual(["react", "next/head", "another-provider", "third-provider"]);
    });
  });
});
