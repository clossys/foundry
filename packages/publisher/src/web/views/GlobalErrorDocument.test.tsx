// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { SITE_MAIN_ID } from "../frame/types.js";
import type { SiteShellInput } from "../frame/types.js";
import { SiteMetadataError } from "../siteMetadata.js";
import { GlobalErrorDocument } from "./GlobalErrorDocument.js";
import { StatusView } from "./StatusView.js";
import * as ordinary from "../../../dist/web/index.js";
import * as server from "../../../dist/web/server.js";
import type { StatusViewProps } from "./StatusView.js";
import type { GlobalErrorDocumentErrorViewProps, GlobalErrorDocumentFramedProps, GlobalErrorDocumentProps } from "./GlobalErrorDocument.js";

const ALLOWED_IMPORTS = ["react", "../frame/SiteFrame.js", "../frame/types.js", "./ErrorView.js", "./StatusView.js", "./statusDocument.js"];

/** Every module specifier named by an `import` statement or an `export ... from` re-export. */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
}

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "skip": "Skip to content",
  "surface": "Sign in",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
  "legal.terms": "Terms",
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

const head = {
  lang: "en",
  documentTitle: { page: "Something went wrong", brand: "Example Studio" },
  icon: { href: "/icon.svg", type: "image/svg+xml" },
};

const framedProps: GlobalErrorDocumentFramedProps = {
  ...head,
  shell,
  resolveCopy,
  resolveAsset,
  status: "500",
  subtitle: "Something went wrong. Error: 8f2a91c0.",
  action: <button type="button">Try again</button>,
};

const errorViewProps: GlobalErrorDocumentErrorViewProps = {
  ...head,
  status: 500,
  title: "Something went wrong",
  description: "Something went wrong. Error: 8f2a91c0.",
  action: <button type="button">Try again</button>,
};

function parse(props: GlobalErrorDocumentProps = framedProps): Document {
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

    it("renders one html element", () => {
      const markup = renderToStaticMarkup(<GlobalErrorDocument {...framedProps} />);
      expect(markup.match(/<html\b/g)).toHaveLength(1);
      expect(markup.match(/<body\b/g)).toHaveLength(1);
    });

    it("puts htmlClassName on the root html as its class", () => {
      const root = parse({ ...framedProps, htmlClassName: "font-sans font-display" }).documentElement;
      expect(root.getAttribute("class")).toBe("font-sans font-display");
      expect(root.classList.contains("font-display")).toBe(true);
    });

    it("renders no class on the root html when htmlClassName is omitted or empty", () => {
      expect(parse().documentElement.hasAttribute("class")).toBe(false);
      expect(parse({ ...framedProps, htmlClassName: "" }).documentElement.hasAttribute("class")).toBe(false);
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
      const doc = parse({ ...framedProps, icon: { href: "/favicon.ico" } });
      const icon = doc.head.querySelector('link[rel="icon"]');
      expect(icon?.getAttribute("href")).toBe("/favicon.ico");
      expect(icon?.hasAttribute("type")).toBe(false);
    });
  });

  describe("title rule", () => {
    it("throws SiteMetadataError for a brand with a leading space", () => {
      expect(() => parse({ ...framedProps, documentTitle: { page: "Something went wrong", brand: " Example Studio" } })).toThrow(
        SiteMetadataError,
      );
    });
  });

  describe("framed body", () => {
    it("renders the frame once: one skip link, one banner, one main with the frame's id, one contentinfo", () => {
      const body = parse().body;
      expect(body.querySelectorAll(`a[href="#${SITE_MAIN_ID}"]`)).toHaveLength(1);
      expect(body.querySelectorAll("header")).toHaveLength(1);
      expect(body.querySelectorAll("main")).toHaveLength(1);
      expect(body.querySelector("main")?.id).toBe(SITE_MAIN_ID);
      expect(body.querySelectorAll("footer")).toHaveLength(1);
      expect(body.querySelectorAll('[role="main"], [role="banner"], [role="contentinfo"]')).toHaveLength(0);
    });

    it("places the status view inside the one main: one h1, the subtitle with its digest, one action, no card", () => {
      const main = parse().body.querySelector("main") as HTMLElement;
      const headings = main.ownerDocument.querySelectorAll("h1");
      expect(headings).toHaveLength(1);
      expect(main.contains(headings[0] as Node)).toBe(true);
      expect(headings[0]?.textContent).toBe("500");
      expect(main.textContent).toContain("Error: 8f2a91c0.");
      expect(main.querySelectorAll("button")).toHaveLength(1);
      expect(main.querySelector("button")?.textContent).toBe("Try again");
      expect(main.querySelector(".rounded-control")).toBeNull();
    });

    it("puts the banner before the main and the contentinfo after it, with the shell's resolved brand and legal row", () => {
      const markup = renderToStaticMarkup(<GlobalErrorDocument {...framedProps} />);
      expect(markup.indexOf("<header")).toBeLessThan(markup.indexOf("<main"));
      expect(markup.lastIndexOf("<footer")).toBeGreaterThan(markup.indexOf("</main>"));
      const body = parse().body;
      expect(body.querySelector('header a[aria-label="Example home"]')).not.toBeNull();
      expect(body.querySelector("header")?.textContent).not.toContain("Sign in");
      expect(body.querySelector("footer")?.textContent).toContain("Example Ltd");
      expect(body.querySelector('footer a[href="/terms"]')).not.toBeNull();
    });

    it("renders notes under the action when given, and no notes element when omitted", () => {
      const withNotes = parse({ ...framedProps, notes: <a href="/contact">Contact us</a> }).body.querySelector("main") as HTMLElement;
      expect(withNotes.querySelector('a[href="/contact"]')?.textContent).toBe("Contact us");
      const without = parse().body.querySelector("main") as HTMLElement;
      expect(without.querySelector('a[href="/contact"]')).toBeNull();
    });

    it("fails closed on a shell the frame refuses", () => {
      expect(() => parse({ ...framedProps, shell: { ...shell, skipLink: ref("missing") } })).toThrow(/SiteFrame/);
    });

    it("throws when the deprecated title or description is passed with shell", () => {
      const mixed = { ...framedProps, title: "Something went wrong" } as unknown as GlobalErrorDocumentProps;
      expect(() => parse(mixed)).toThrow(/deprecated ErrorView shape/);
      const mixedDescription = { ...framedProps, description: "x" } as unknown as GlobalErrorDocumentProps;
      expect(() => parse(mixedDescription)).toThrow(/deprecated ErrorView shape/);
    });
  });

  describe("deprecated ErrorView shape", () => {
    it("still renders the status heading, the description with its digest and one action, with no frame", () => {
      const doc = parse(errorViewProps);
      const headings = doc.body.querySelectorAll("h1");
      expect(headings).toHaveLength(1);
      expect(headings[0]?.textContent).toBe("500");
      expect(doc.body.textContent).toContain("Error: 8f2a91c0.");
      expect(doc.body.querySelectorAll("button")).toHaveLength(1);
      expect(doc.body.querySelectorAll("main, header, footer")).toHaveLength(0);
      expect(doc.head.querySelector("title")?.textContent).toBe("Something went wrong · Example Studio");
    });

    it("still accepts a landmark role on the content root, since that shape has no frame and no <main>", () => {
      const body = parse({ ...errorViewProps, role: "main" }).body;
      expect(body.querySelectorAll('[role="main"]')).toHaveLength(1);
    });

    it("does not leak the document props onto the content root", () => {
      const root = parse({ ...errorViewProps, htmlClassName: "font-sans" }).body.firstElementChild as HTMLElement;
      expect(root.hasAttribute("lang")).toBe(false);
      expect(root.hasAttribute("icon")).toBe(false);
      expect(root.hasAttribute("documenttitle")).toBe(false);
      expect(root.className).not.toContain("font-sans");
    });
  });

  describe("import boundary", () => {
    const source = readFileSync(join(import.meta.dirname, "GlobalErrorDocument.tsx"), "utf8");

    it("imports only react, the frame, the status view, the deprecated error view and the shared status document head", () => {
      expect(moduleSpecifiers(source)).toEqual(
        expect.arrayContaining(["../frame/SiteFrame.js", "./StatusView.js", "./ErrorView.js", "./statusDocument.js"]),
      );
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

const referenceFixture = {
  label: "Error",
  value: '<em data-reference="unsafe">&\'diagnostic</em>',
};
const referenceInputs = { status: "500", subtitle: "Something went wrong.", reference: referenceFixture, action: <button type="button">Try again</button> };

function referenceDocument(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const referenceSurfaces = [
  { name: "StatusView", render: (reference: StatusViewProps["reference"] = referenceFixture) => renderToStaticMarkup(<StatusView {...{ ...referenceInputs, reference }} />) },
  { name: "GlobalErrorDocument", render: (reference: StatusViewProps["reference"] = referenceFixture) => renderToStaticMarkup(<GlobalErrorDocument {...framedProps} {...{ ...referenceInputs, reference }} />) },
];

describe("shared diagnostic reference fixture", () => {
  for (const surface of referenceSurfaces) {
    it(`${surface.name} renders the escaped reference once after the description and before the action`, () => {
      const doc = referenceDocument(surface.render());
      const codes = doc.body.querySelectorAll("code");
      expect(codes).toHaveLength(1);
      const code = codes[0]!;
      expect(code.textContent).toBe(referenceFixture.value);
      expect(code.children).toHaveLength(0);
      expect(code.classList.contains("select-all")).toBe(true);
      expect(code.parentElement?.classList.contains("block")).toBe(true);
      expect(doc.body.textContent?.split(referenceFixture.value)).toHaveLength(2);
      expect(code.parentElement?.textContent).toBe(`Error: ${referenceFixture.value}.`);
      expect(doc.body.querySelector("[data-reference]")).toBeNull();
      const markup = surface.render();
      expect(markup.indexOf("Something went wrong.")).toBeLessThan(markup.indexOf("<code"));
      expect(markup.indexOf("<code")).toBeLessThan(markup.indexOf("<button"));
      expect(doc.body.querySelectorAll("button")).toHaveLength(1);
      if (surface.name === "GlobalErrorDocument") {
        expect(doc.body.querySelectorAll("main")).toHaveLength(1);
      } else {
        expect(doc.body.querySelectorAll("main")).toHaveLength(0);
      }
    });

    for (const field of ["label", "value"] as const) {
      it.each(["", " \t\n", "\u00a0"])(`${surface.name} refuses a blank reference ${field}: %j`, (blank) => {
        expect(() => surface.render({ ...referenceFixture, [field]: blank })).toThrow(
          new TypeError(`StatusView: reference needs a nonblank ${field}.`),
        );
      });
      it.each([undefined, null, 7])(`${surface.name} refuses a non-text reference ${field}: %j`, (invalid) => {
        const reference = { ...referenceFixture, [field]: invalid } as unknown as StatusViewProps["reference"];
        expect(() => surface.render(reference)).toThrow(
          new TypeError(`StatusView: reference needs a nonblank ${field}.`),
        );
      });
    }

    it(`${surface.name} treats a plain JavaScript null reference as absent`, () => {
      const absent = { ...referenceInputs, reference: undefined };
      const expected = surface.name === "StatusView"
        ? renderToStaticMarkup(<StatusView {...absent} />)
        : renderToStaticMarkup(<GlobalErrorDocument {...framedProps} {...absent} />);
      expect(surface.render(null as unknown as StatusViewProps["reference"])).toBe(expected);
      const doc = referenceDocument(surface.render(null as unknown as StatusViewProps["reference"]));
      expect(doc.querySelector("code")).toBeNull();
      const description = [...doc.querySelectorAll("p")].find((p) => p.textContent === referenceInputs.subtitle)!;
      expect(description.children).toHaveLength(0);
    });

    it(`${surface.name} uses caller labels without a default`, () => {
      const doc = referenceDocument(surface.render({ label: "Incident", value: "xyz" }));
      expect(doc.querySelector("code")?.parentElement?.textContent).toBe("Incident: xyz.");
      expect(doc.body.textContent).not.toContain("Error:");
    });
  }

  it("renders byte-identical lines on both surfaces from the shared fixture", () => {
    const lines = referenceSurfaces.map((surface) => referenceDocument(surface.render()).querySelector("code")?.parentElement?.outerHTML);
    expect(lines[0]).toBeDefined();
    expect(lines[0]).toBe(lines[1]);
  });

  it("omits the entire reference line when absent, with no empty element", () => {
    const status = referenceDocument(renderToStaticMarkup(<StatusView status="500" subtitle="Something went wrong." />));
    const global = parse({ ...framedProps, subtitle: "Something went wrong." });
    const emptyStatus = referenceDocument(renderToStaticMarkup(<StatusView status="500" />));
    expect(emptyStatus.body.querySelector("p, code")).toBeNull();
    for (const doc of [status, global]) {
      expect(doc.querySelector("code")).toBeNull();
      const description = [...doc.querySelectorAll("p")].find((p) => p.textContent === "Something went wrong.")!;
      expect(description.children).toHaveLength(0);
    }
  });

  it("renders the reference even without a description", () => {
    const doc = referenceDocument(renderToStaticMarkup(<StatusView {...{ status: "500", reference: referenceFixture }} />));
    expect(doc.querySelector("code")?.textContent).toBe(referenceFixture.value);
  });

  it("treats a plain JavaScript null reference on the deprecated document as absent", () => {
    const props = { ...errorViewProps, reference: null } as unknown as GlobalErrorDocumentProps;
    expect(renderToStaticMarkup(<GlobalErrorDocument {...props} />)).toBe(renderToStaticMarkup(<GlobalErrorDocument {...errorViewProps} />));
  });

  it("refuses reference on the deprecated unframed document shape", () => {
    const legacy = { ...errorViewProps, reference: referenceFixture } as unknown as GlobalErrorDocumentProps;
    expect(() => parse(legacy)).toThrow(/reference.*framed StatusView shape/);
  });

  it("renders equivalent markup through ordinary and react-server entries", () => {
    expect(renderToStaticMarkup(<ordinary.StatusView {...referenceInputs} />)).toBe(renderToStaticMarkup(<server.StatusView {...referenceInputs} />));
    const props = { ...framedProps, ...referenceInputs };
    expect(renderToStaticMarkup(<ordinary.GlobalErrorDocument {...props} />)).toBe(renderToStaticMarkup(<server.GlobalErrorDocument {...props} />));
  });
});


describe("README global-error example", () => {
  const readme = readFileSync(join(import.meta.dirname, "../../../README.md"), "utf8");
  const example = [...readme.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
    .map((match) => match[1]!)
    .find((code) => code.includes("export default function GlobalError("))!;
  const compiled = ts.transpileModule(example, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports: { default?: (props: { error: Error & { digest?: string }; reset: () => void }) => ReactElement } = {};
  const requireExample = (specifier: string) => {
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    if (specifier === "@clossys/publisher/web") return { GlobalErrorDocument };
    throw new Error(`Unexpected README example import: ${specifier}`);
  };
  // Run the actual documented component with the shared frame fixture, so its guard is tested rather than duplicated.
  new Function("require", "exports", "frame", compiled.outputText)(requireExample, exports, { shell, resolveCopy, resolveAsset });

  it("renders an empty digest without a reference or an exception", () => {
    const error = Object.assign(new Error("fixture"), { digest: "" });
    const markup = renderToStaticMarkup(exports.default!({ error, reset: () => {} }));
    const doc = referenceDocument(markup);
    expect(doc.querySelector("code")).toBeNull();
    expect(doc.querySelector("main")?.textContent).toBe("500Something went wrong.Try again");
    expect(doc.querySelectorAll("button")).toHaveLength(1);
  });

  it("renders a nonempty digest with the caller-labelled reference", () => {
    const error = Object.assign(new Error("fixture"), { digest: referenceFixture.value });
    const doc = referenceDocument(renderToStaticMarkup(exports.default!({ error, reset: () => {} })));
    expect(doc.querySelector("code")?.textContent).toBe(referenceFixture.value);
    expect(doc.querySelector("code")?.parentElement?.textContent).toBe(`Error: ${referenceFixture.value}.`);
  });
});
