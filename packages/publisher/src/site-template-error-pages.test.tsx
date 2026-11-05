// @vitest-environment jsdom

/**
 * The site template's 500 and 404 pages, rendered as they ship: the framed
 * `SiteErrorView` (SiteFrame around StatusView) built from a fictional copy map
 * and fictional brand facts. No registry, record or network is read.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as designerComponents from "@clossys/designer/components";
import { expectFrontDoorConformance } from "./testing/index.js";
import { SITE_MAIN_ID } from "@clossys/designer/frames";
import * as web from "../dist/web/index.js";
import * as siteCopy from "../templates/site/app/site-copy.js";
import { ERROR_COPY_IDS, SITE_FRAME_COPY_IDS, errorCopyIds, siteFrameCopyIds } from "../templates/site/app/site-copy.js";
import type { SiteCopyMap, SiteErrorCopyIds } from "../templates/site/app/site-copy.js";
import * as siteFrame from "../templates/site/app/site-frame.js";
import { SITE_BRAND_MARK, siteFrameInput } from "../templates/site/app/site-frame.js";
import type { SiteFrameFacts } from "../templates/site/app/site-frame.js";

const APP_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "templates", "site", "app");
const readApp = (name: string) => readFileSync(join(APP_DIR, name), "utf8");

// The template's tsconfig keeps JSX for Next (`"jsx": "preserve"`), so its .tsx
// files cannot be imported here as they are. Compile the shipped view and run
// it against the packages and template modules it names, and nothing else.
type SiteErrorViewComponent = (props: { copy: SiteCopyMap; facts: SiteFrameFacts; ids: SiteErrorCopyIds; onRetry?: () => void }) => ReactElement;
const SiteErrorView: SiteErrorViewComponent = (() => {
  const compiled = ts.transpileModule(readApp("site-error-view.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const modules: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "@clossys/designer/components": designerComponents,
    "@clossys/publisher/web": web,
    "./site-copy": siteCopy,
    "./site-frame": siteFrame,
  };
  const exports: { SiteErrorView?: SiteErrorViewComponent } = {};
  const requireModule = (specifier: string) => {
    if (!Object.hasOwn(modules, specifier)) throw new Error(`Unexpected import in site-error-view.tsx: ${specifier}`);
    return modules[specifier];
  };
  new Function("require", "exports", compiled.outputText)(requireModule, exports);
  return exports.SiteErrorView!;
})();

const FACTS = { brandLabel: "Example Studio", entity: "Example Studio Ltd" };

// Fictional text for every id the error pages resolve.
const COPY: SiteCopyMap = Object.fromEntries([...errorCopyIds(), ...siteFrameCopyIds()].map((id) => [id, `Text for ${id}`]));

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const pages = [
  { name: "404", ids: ERROR_COPY_IDS.notFound, render: () => <SiteErrorView copy={COPY} facts={FACTS} ids={ERROR_COPY_IDS.notFound} /> },
  { name: "500", ids: ERROR_COPY_IDS.failed, render: () => <SiteErrorView copy={COPY} facts={FACTS} ids={ERROR_COPY_IDS.failed} onRetry={() => {}} /> },
] as const;

describe("site template error pages", () => {
  for (const page of pages) {
    describe(`the ${page.name} page`, () => {
      const doc = () => parse(renderToStaticMarkup(page.render()));

      it("renders the frame once: one skip link, one banner, one main, one contentinfo and one h1 inside main", () => {
        const d = doc();
        expect(d.querySelectorAll(`a[href="#${SITE_MAIN_ID}"]`)).toHaveLength(1);
        expect(d.querySelectorAll("header")).toHaveLength(1);
        expect(d.querySelectorAll("main")).toHaveLength(1);
        expect(d.querySelector("main")?.id).toBe(SITE_MAIN_ID);
        expect(d.querySelectorAll("footer")).toHaveLength(1);
        const headings = d.querySelectorAll("h1");
        expect(headings).toHaveLength(1);
        expect(d.querySelector("main")?.contains(headings[0] as Node)).toBe(true);
      });

      it("reads every visible word from the copy map and the brand facts", () => {
        const d = doc();
        const main = d.querySelector("main") as HTMLElement;
        expect(d.querySelector("h1")?.textContent).toBe(COPY[page.ids.title]);
        expect(main.textContent).toContain(COPY[page.ids.description]);
        expect(main.textContent).toContain(COPY[page.ids.action]);
        expect(d.querySelector(`a[href="#${SITE_MAIN_ID}"]`)?.textContent).toBe(COPY[SITE_FRAME_COPY_IDS.skipLink]);
        expect(d.querySelector("header")?.textContent).toContain(FACTS.brandLabel);
        expect(d.querySelector("footer")?.textContent).toContain(FACTS.entity);
        for (const href of ["/terms", "/privacy", "/contact"]) expect(d.querySelector(`footer a[href="${href}"]`)).not.toBeNull();
        expect(d.querySelector(`header [data-brand-mark]`)?.getAttribute("style")).toContain(SITE_BRAND_MARK.src);
      });

      it("passes the front-door conformance kit: one h1 and one primary action", () => {
        expect(() =>
          expectFrontDoorConformance({
            surfaces: [{ surface: page.name === "404" ? "not-found" : "boundary", title: { page: "Error", brand: FACTS.brandLabel }, render: page.render }],
          }),
        ).not.toThrow();
      });
    });
  }

  it("returns home from the 404 page and retries from the 500 page", () => {
    const notFound = parse(renderToStaticMarkup(pages[0].render())).querySelector("main") as HTMLElement;
    expect(notFound.querySelector('a[href="/"]')?.textContent).toBe(COPY[ERROR_COPY_IDS.notFound.action]);
    expect(notFound.querySelector("button")).toBeNull();
    const failed = parse(renderToStaticMarkup(pages[1].render())).querySelector("main") as HTMLElement;
    expect(failed.querySelector('button[type="button"]')?.textContent).toBe(COPY[ERROR_COPY_IDS.failed.action]);
  });

  it("fails closed, naming the id, when a frame copy entry is missing", () => {
    const { [SITE_FRAME_COPY_IDS.skipLink]: _skip, ...missing } = COPY;
    expect(() => renderToStaticMarkup(<SiteErrorView copy={missing} facts={FACTS} ids={ERROR_COPY_IDS.notFound} />)).toThrow();
  });

  it("refuses a copy map that already holds a brand-fact id, so registry copy cannot replace the facts", () => {
    const frame = () => siteFrameInput({ ...COPY, "site-frame.fact.brand-label": "Other" }, FACTS);
    expect(frame).toThrow(/site-frame\.fact\.brand-label/);
  });

  it("wires the routes: a client boundary and a server not-found page share the framed view, and the layout sets the registry locale", () => {
    const error = readApp("error.tsx");
    const notFound = readApp("not-found.tsx");
    const view = readApp("site-error-view.tsx");
    const layout = readApp("layout.tsx");
    expect(error.trimStart().startsWith('"use client"')).toBe(true);
    expect(notFound.trimStart().startsWith('"use client"')).toBe(false);
    for (const source of [error, notFound]) expect(source).toMatch(/from "\.\/site-error-view"/);
    expect(view).toMatch(/import \{[^}]*\bSiteFrame\b[^}]*\bStatusView\b[^}]*\} from "@clossys\/publisher\/web"/);
    expect(view).not.toMatch(/\bErrorView\b/);
    expect(layout).toMatch(/<html lang=\{siteLocale\(\)\}/);
    // The site-frame module is pure: it imports no record reader and no Node module.
    const frame = readApp("site-frame.ts");
    expect(frame).not.toMatch(/site-records|node:|from "next/);
  });
});
