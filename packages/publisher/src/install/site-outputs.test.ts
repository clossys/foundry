import { describe, expect, it } from "vitest";
import type { ContentMap } from "../content-map/contract.js";
import { publicationFormDefaults, type PublicationOutputs } from "../content-map/outputs.js";
import { NEXT_MISSING_ROUTE, NEXT_ROUTE_MARKER, planNextRoutes } from "./next-routes.js";
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
  it("installs the form endpoint, share images and opted-in page-meta routes per locale", async () => {
    const plan = await planSiteOutputs({ map, outputs: outputs({ forms: [publicationFormDefaults("contact")], share: true, jsonLd: true, llms: true, feed: "rss", locales: { default: "en", all: ["en", "fr"] } }), text, share });
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
    // Each locale's layout mounts its own JSON-LD, from that locale's Writer text.
    expect(Object.keys(plan.jsonLdByLocale!)).toEqual(["en", "fr"]);
    expect(JSON.parse(plan.jsonLdByLocale!.fr!)["@graph"][0].name).toBe("Exemple & Cie");
    expect(plan.jsonLdByLocale!.en).toBe(plan.jsonLd);
  });
  it("emits nothing for a publication that opted into nothing", async () => {
    expect(await planSiteOutputs({ map, outputs: {}, text })).toEqual({ files: [], findings: [] });
  });
  it("blocks on a Writer key the locale does not hold instead of falling back", async () => {
    const plan = await planSiteOutputs({ map, outputs: outputs({ llms: true, feed: "atom", locales: { default: "en", all: ["en", "de"] } }), text });
    expect(plan.files).toEqual([]);
    expect(plan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-copy-key", detail: expect.stringMatching(/de/) })]));
  });
  it("blocks share images without a Designer mark and an invalid outputs record", async () => {
    expect((await planSiteOutputs({ map, outputs: outputs({ share: true }), text })).findings).toEqual([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/assets\.mark/) })]);
    expect((await planSiteOutputs({ map, outputs: { jsonLd: true } as PublicationOutputs, text })).findings).toEqual([expect.objectContaining({ code: "site-contract" })]);
  });
  it("builds each share card at install, so Writer text the card refuses blocks instead of breaking the site build", async () => {
    const broken = (key: string, locale: string) => (locale === "fr" && key === "site.name" ? "Exemple\n& Cie" : text(key, locale));
    const plan = await planSiteOutputs({ map, outputs: outputs({ share: true, locales: { default: "en", all: ["en", "fr"] } }), text: broken, share });
    expect(plan.files).toEqual([]);
    expect(plan.findings).toEqual([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/fr share card refused: .*line break/) })]);
    expect((await planSiteOutputs({ map, outputs: outputs({ share: true, locales: { default: "en", all: ["en", "fr"] } }), text, share })).findings).toEqual([]);
  });
});

describe("planNextRoutes locales and JSON-LD", () => {
  const base = { map, assembly: "../clossys/publication.tsx", states: "../clossys/states.tsx" };
  it("installs every page once per extra locale and passes the locale to the assembly", () => {
    // No shell: the consumer's document; the default locale's pages are the root routes.
    const plan = planNextRoutes({ map, assembly: base.assembly, locales: { default: "en", all: ["en", "fr"] } });
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
  it("folds case: a locale and a page at the same folder in another case, or two spellings of one locale, are refused", () => {
    const upper: ContentMap = { ...map, entries: [...map.entries, { id: "fr-page", order: 3, title: "page.fr.title", kind: "page", path: "/FR", source: { frameId: "frames.site-shell", sectionIds: [] } }] };
    expect(planNextRoutes({ ...base, map: upper, locales: { default: "en", all: ["en", "fr"] } }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/locale fr collides/) })]));
    const region: ContentMap = { ...map, entries: [...map.entries, { id: "fr-ca-page", order: 3, title: "page.fr.title", kind: "page", path: "/fr-ca", source: { frameId: "frames.site-shell", sectionIds: [] } }] };
    expect(planNextRoutes({ ...base, map: region, locales: { default: "en", all: ["en", "fr-CA"] } }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/locale fr-CA collides/) })]));
    expect(planNextRoutes({ ...base, locales: { default: "en", all: ["en", "en-US", "en-us"] } }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/case-insensitively/) })]));
    const about: ContentMap = { ...map, entries: [...map.entries, { id: "about-upper", order: 3, title: "page.about.title", kind: "page", path: "/About", source: { frameId: "frames.site-shell", sectionIds: [] } }] };
    expect(planNextRoutes({ ...base, map: about }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-route-duplicate" })]));
  });
  it("installs one document per locale: each layout passes its locale and serves that locale's metadata and states (no default-locale fallback)", () => {
    const ld = (locale: string) => buildJsonLd({ origin: "https://example.com", name: `Example ${locale}`, summary: "S", locale });
    const plan = planNextRoutes({ ...base, locales: { default: "en", all: ["en", "fr"] }, jsonLd: ld("en"), localeJsonLd: { en: ld("en"), fr: ld("fr") } });
    expect(plan.findings).toEqual([]);
    const shell = plan.files.filter(row => row.kind === "shell").map(row => row.file).sort();
    expect(shell).toEqual(["(en)/[...missing]/page.tsx", "(en)/error.tsx", "(en)/layout.tsx", "(en)/loading.tsx", "(en)/not-found.tsx", "fr/[...missing]/page.tsx", "fr/error.tsx", "fr/layout.tsx", "fr/loading.tsx", "fr/not-found.tsx", "global-error.tsx"]);
    expect(plan.files.some(row => row.file === "layout.tsx")).toBe(false);
    expect(plan.files.filter(row => row.kind === "page").map(row => row.file).sort()).toEqual(["(en)/about/page.tsx", "(en)/legal/page.tsx", "(en)/page.tsx", "fr/about/page.tsx", "fr/legal/page.tsx", "fr/page.tsx"]);
    expect(plan.files.find(row => row.file === "(en)/about/page.tsx")!.route).toBe("/about");
    const fr = plan.files.find(row => row.file === "fr/layout.tsx")!.content;
    expect(fr).toContain(`export const metadata = publishedLocaleMetadata("fr");`);
    expect(fr).toContain(`locale: "fr", children`);
    expect(fr).toContain(JSON.stringify(ld("fr")));
    expect(fr).toContain(`from "../../clossys/publication"`);
    expect(plan.files.find(row => row.file === "(en)/layout.tsx")!.content).toContain(`publishedLocaleMetadata("en")`);
    expect(plan.files.find(row => row.file === "fr/not-found.tsx")!.content).toContain(`state: "not-found", locale: "fr"`);
    expect(plan.files.find(row => row.file === "global-error.tsx")!.content).not.toContain("locale");
    // A locale with no JSON-LD of its own is refused, never served the default's.
    expect(planNextRoutes({ ...base, locales: { default: "en", all: ["en", "fr"] }, jsonLd: ld("en"), localeJsonLd: { en: ld("en") } }).findings)
      .toEqual([expect.objectContaining({ code: "site-contract", detail: expect.stringMatching(/no fr JSON-LD/) })]);
    // A single locale keeps the one root layout.
    expect(planNextRoutes({ ...base, locales: { default: "en", all: ["en"] } }).files.some(row => row.file === "layout.tsx")).toBe(true);
  });
  it("sends an unmatched URL of each locale to that locale's own not-found state, never the framework's default 404 (B2)", () => {
    const plan = planNextRoutes({ ...base, locales: { default: "en", all: ["en", "fr"] } });
    expect(plan.findings).toEqual([]);
    const missing = plan.files.filter(row => row.file.includes(NEXT_MISSING_ROUTE));
    expect(missing.map(row => [row.file, row.route, row.kind, row.state])).toEqual([
      ["(en)/[...missing]/page.tsx", "/[...missing]", "shell", "not-found"],
      ["fr/[...missing]/page.tsx", "/fr/[...missing]", "shell", "not-found"],
    ]);
    for (const row of missing) {
      // Each sits under its locale's root layout beside that locale's not-found.tsx, and only calls notFound().
      const dir = row.file.split("/").slice(0, -2).join("/");
      expect(plan.files.map(each => each.file)).toEqual(expect.arrayContaining([`${dir}/layout.tsx`, `${dir}/not-found.tsx`]));
      expect(row.content.split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
      expect(row.content).toContain('import { notFound } from "next/navigation";');
      expect(row.content).toMatch(/export default function Missing\(\): never \{\n {2}notFound\(\);\n\}/);
    }
    // One layout catches every URL itself: no catch-all with one locale or no shell.
    expect(planNextRoutes({ ...base, locales: { default: "en", all: ["en"] } }).files.some(row => row.file.includes(NEXT_MISSING_ROUTE))).toBe(false);
    expect(planNextRoutes({ map, assembly: base.assembly, locales: { default: "en", all: ["en", "fr"] } }).files.some(row => row.file.includes(NEXT_MISSING_ROUTE))).toBe(false);
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
