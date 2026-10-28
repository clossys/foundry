/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { CopyResolver } from "@clossys/writer";
import type { directionFor } from "@clossys/writer/locale";
import { GlobalErrorDocument } from "../../../../publisher/src/web/views/GlobalErrorDocument.js";
import { NotFoundDocument } from "../../../../publisher/src/web/views/NotFoundDocument.js";
import { formatPageTitle } from "../../../../publisher/src/web/siteMetadata.js";

const localeManifest = { locales: [
  { tag: "en", dir: "ltr", state: "active" },
  { tag: "ar", dir: "rtl", state: "active" },
] } satisfies Parameters<typeof directionFor>[1];
const documentTitle = { page: "Unavailable", brand: "Sample" };
const icon = { href: "/icon.svg" };
const resolveCopy: CopyResolver = ref => ({
  ref, text: ref.id === "skip" ? "Skip content" : "Sample home", recordId: "sample", revision: "1", locale: "en",
  source: { kind: "consumer", reference: "fixture" }, entryId: ref.id,
});
const frame = {
  shell: { brand: { assetId: "mark", label: { id: "home" }, size: "md" as const, variant: "mark" as const }, skipLink: { id: "skip" } },
  resolveCopy,
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 32, height: 32, alt: "Sample" }),
};
const parse = (html: string) => new JSDOM(html).window.document;

describe("Publisher status adapters on Designer document frame", () => {
  it.each([{ lang: "en", dir: "ltr" }, { lang: "ar", dir: "rtl" }])("resolves $lang through Writer for the global-error document", ({ lang, dir }) => {
    const html = renderToStaticMarkup(<GlobalErrorDocument lang={lang} localeManifest={localeManifest}
      documentTitle={documentTitle} icon={icon} status={500} title="Unavailable" description="Retry later" />);
    const doc = parse(html);
    expect(doc.documentElement.lang).toBe(lang);
    expect(doc.documentElement.dir).toBe(dir);
    expect(doc.documentElement.getAttribute("data-ds-leaf")).toBe("frames.document");
    expect(doc.querySelector("title")?.textContent).toBe(formatPageTitle(documentTitle));
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.body.textContent).toContain("Unavailable");
  });
  it.each([{ lang: "en", dir: "ltr" }, { lang: "ar", dir: "rtl" }])("composes $lang not-found with one document and one site shell", ({ lang, dir }) => {
    const doc = parse(renderToStaticMarkup(<NotFoundDocument {...frame} lang={lang} localeManifest={localeManifest}
      documentTitle={{ page: "Missing", brand: "Sample" }} icon={icon} status="404" />));
    expect(doc.documentElement.lang).toBe(lang);
    expect(doc.documentElement.dir).toBe(dir);
    expect(doc.querySelectorAll("html")).toHaveLength(1);
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe("404");
    expect(doc.querySelectorAll('style[data-publisher-frame-critical]')).toHaveLength(1);
    expect(doc.querySelectorAll("script")).toHaveLength(0);
  });
  it("canonicalizes the requested tag but refuses a missing declared direction", () => {
    const props = { documentTitle, icon, status: 500, title: "Unavailable", description: "Retry later" };
    const doc = parse(renderToStaticMarkup(<GlobalErrorDocument {...props} lang="EN" localeManifest={localeManifest} />));
    expect(doc.documentElement.lang).toBe("en");
    expect(() => renderToStaticMarkup(<GlobalErrorDocument {...props} lang="ar" localeManifest={{ locales: [localeManifest.locales[0]!] }} />)).toThrow(RangeError);
  });
  it("keeps the existing page-title formatter's validation", () => {
    expect(() => renderToStaticMarkup(<GlobalErrorDocument lang="en" localeManifest={localeManifest}
      documentTitle={{ page: " Unavailable", brand: "Sample" }} icon={icon} status={500} title="Unavailable" />)).toThrow();
  });
});
