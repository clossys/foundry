import { describe, expect, it } from "vitest";
import type { ContentMap } from "../content-map/contract.js";
import { publicationFormDefaults, type PublicationOutputs } from "../content-map/outputs.js";
import { NEXT_ROUTE_MARKER, planNextRoutes } from "./next-routes.js";
import { buildFeed, buildJsonLd, buildLlmsTxt, checkFeed, checkJsonLd, checkLlmsTxt, planSiteOutputs } from "./site-outputs.js";

const map: ContentMap = { version: 1, publicationId: "site", format: "web.page.responsive", entries: [
  { id: "home", order: 0, title: "page.home.title", kind: "page", path: "/", source: { frameId: "frames.site-shell", sectionIds: [] }, lastModified: "2026-11-01" },
  { id: "about", order: 1, title: "page.about.title", kind: "page", path: "/about", source: { frameId: "frames.site-shell", sectionIds: [] }, description: "page.about.description", lastModified: "2026-11-10" },
  { id: "legal", order: 2, title: "page.legal.title", kind: "page", path: "/legal", source: { frameId: "frames.site-shell", sectionIds: [] }, indexing: { mode: "noindex" } },
] };
const copy: Record<string, Record<string, string>> = {
  en: { "site.name": "Example & Co", "site.summary": "We make <things>.", "page.home.title": "Home", "page.about.title": "About us", "page.about.description": "Who we are", "page.legal.title": "Legal" },
  fr: { "site.name": "Exemple & Cie", "site.summary": "Nous faisons des choses.", "page.home.title": "Accueil", "page.about.title": "À propos", "page.legal.title": "Mentions" },
};
const text = (key: string, locale: string) => copy[locale]?.[key];
const outputs = (extra: Partial<PublicationOutputs> = {}): PublicationOutputs => ({ origin: "https://example.com", identity: { name: "site.name", summary: "site.summary" }, ...extra });
const share = { markSrc: "data:image/svg+xml;base64,PHN2Zy8+", wordmark: "Example" };
const files = (plan: { files: readonly { file: string }[] }) => plan.files.map(row => row.file).sort();

describe("page-meta builders fail closed", () => {
  it("JSON-LD projects Organization and WebSite with absolute URLs and no raw markup", () => {
    const ld = buildJsonLd({ origin: "https://example.com", name: "Example & Co", summary: "We make <things>.", locale: "en" });
    expect(ld).not.toContain("<");
    expect(JSON.parse(ld)["@graph"].map((node: any) => node["@type"])).toEqual(["Organization", "WebSite"]);
    expect(checkJsonLd(ld)).toEqual([]);
    expect(checkJsonLd("{not json")).toEqual([expect.stringMatching(/JSON/)]);
    expect(checkJsonLd(JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "x", url: "/relative" }] }))).toEqual(expect.arrayContaining([expect.stringMatching(/url/)]));
    expect(checkJsonLd(`{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"</script>","url":"https://example.com/"}]}`)).toEqual(expect.arrayContaining([expect.stringMatching(/</)]));
  });
  it("llms.txt is a title, a summary and absolute links", () => {
    const body = buildLlmsTxt({ name: "Example", summary: "We make things.", pages: [{ title: "About [us]", url: "https://example.com/about", description: "Who" }] });
    expect(body.split("\n").slice(0, 3)).toEqual(["# Example", "", "> We make things."]);
    expect(checkLlmsTxt(body)).toEqual([]);
    expect(checkLlmsTxt("Example\n")).toEqual(expect.arrayContaining([expect.stringMatching(/title/)]));
    expect(checkLlmsTxt("# Example\n\n> ok\n\n- [x](/relative)\n")).toEqual([expect.stringMatching(/absolute/)]);
  });
  it("RSS and Atom are escaped, well-formed and carry their required elements", () => {
    for (const format of ["rss", "atom"] as const) {
      const xml = buildFeed({ format, origin: "https://example.com", title: "A & B <c>", summary: "S", locale: "en", items: [{ title: "T & U", url: "https://example.com/about", updated: "2026-11-10" }] });
      expect(xml).toContain("A &amp; B &lt;c&gt;");
      expect(checkFeed(xml, format)).toEqual([]);
      expect(checkFeed(xml.replace("</title>", ""), format)).not.toEqual([]);
    }
    expect(checkFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`, "atom")).toEqual(expect.arrayContaining([expect.stringMatching(/updated|title|id/)]));
  });
});

describe("planSiteOutputs", () => {
  it("installs the form endpoint, share images and opted-in page-meta routes per locale", () => {
    const plan = planSiteOutputs({ map, outputs: outputs({ forms: [publicationFormDefaults("contact")], share: true, jsonLd: true, llms: true, feed: "rss", locales: { default: "en", all: ["en", "fr"] } }), text, share });
    expect(plan.findings).toEqual([]);
    expect(files(plan)).toEqual(["api/forms/contact/route.ts", "feed.xml/route.ts", "fr/feed.xml/route.ts", "fr/opengraph-image.tsx", "fr/twitter-image.tsx", "llms.txt/route.ts", "opengraph-image.tsx", "twitter-image.tsx"]);
    for (const row of plan.files) expect(row.content.split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
    const form = plan.files.find(row => row.file === "api/forms/contact/route.ts")!.content;
    expect(form).toContain("createFormEndpoint");
    expect(form).toContain("\"CONTACT_FORM_TARGET\"");
    expect(form).not.toMatch(/https?:\/\//);
    expect(plan.files.find(row => row.file === "fr/opengraph-image.tsx")!.content).toContain("Exemple & Cie");
    const feed = plan.files.find(row => row.file === "fr/feed.xml/route.ts")!.content;
    expect(feed).toContain("https://example.com/fr/about");
    expect(feed).not.toContain("Mentions");
    expect(JSON.parse(plan.jsonLd!)["@graph"][0].name).toBe("Example & Co");
  });
  it("emits nothing for a publication that opted into nothing", () => {
    expect(planSiteOutputs({ map, outputs: {}, text })).toEqual({ files: [], findings: [] });
  });
  it("blocks on a Writer key the locale does not hold instead of falling back", () => {
    const plan = planSiteOutputs({ map, outputs: outputs({ llms: true, feed: "atom", locales: { default: "en", all: ["en", "de"] } }), text });
    expect(plan.files).toEqual([]);
    expect(plan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-copy-key", detail: expect.stringMatching(/de/) })]));
  });
  it("blocks share images without a Designer mark and an invalid outputs record", () => {
    expect(planSiteOutputs({ map, outputs: outputs({ share: true }), text }).findings).toEqual([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/assets\.mark/) })]);
    expect(planSiteOutputs({ map, outputs: { jsonLd: true } as PublicationOutputs, text }).findings).toEqual([expect.objectContaining({ code: "site-contract" })]);
  });
});

describe("planNextRoutes locales and JSON-LD", () => {
  const base = { map, assembly: "../clossys/publication.tsx", states: "../clossys/states.tsx" };
  it("installs every page once per extra locale and passes the locale to the assembly", () => {
    const plan = planNextRoutes({ ...base, locales: { default: "en", all: ["en", "fr"] } });
    expect(plan.findings).toEqual([]);
    expect(plan.files.filter(row => row.kind === "page").map(row => row.file).sort()).toEqual(["about/page.tsx", "fr/about/page.tsx", "fr/legal/page.tsx", "fr/page.tsx", "legal/page.tsx", "page.tsx"]);
    expect(plan.files.find(row => row.file === "fr/about/page.tsx")!.content).toContain(`locale: "fr"`);
    expect(plan.files.find(row => row.file === "fr/about/page.tsx")!.route).toBe("/fr/about");
    expect(plan.files.find(row => row.file === "about/page.tsx")!.content).toContain(`locale: "en"`);
  });
  it("refuses a locale segment that collides with a page path", () => {
    const plan = planNextRoutes({ ...base, locales: { default: "en", all: ["en", "about"] } });
    expect(plan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/about/) })]));
  });
  it("mounts checked JSON-LD in the installed layout and refuses it without the shell or when malformed", () => {
    const ld = buildJsonLd({ origin: "https://example.com", name: "Example", summary: "S", locale: "en" });
    const layout = planNextRoutes({ ...base, jsonLd: ld }).files.find(row => row.file === "layout.tsx")!.content;
    expect(layout).toContain("application/ld+json");
    expect(layout).toContain(JSON.stringify(ld));
    expect(planNextRoutes({ map, assembly: base.assembly, jsonLd: ld }).findings).toEqual([expect.objectContaining({ code: "site-contract" })]);
    expect(planNextRoutes({ ...base, jsonLd: "{broken" }).findings).toEqual([expect.objectContaining({ code: "site-contract" })]);
  });
});
