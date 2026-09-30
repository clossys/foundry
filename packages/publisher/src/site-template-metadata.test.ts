/**
 * Metadata routes and the `/about` default for the site template (#1516, #1718).
 *
 * The template is scaffolded into a consumer repository and built there by
 * Next.js; nothing here builds or renders it. What can be checked from this
 * package is the two pure modules `templates/site/app/site-wiring.ts` and
 * `templates/site/app/site-copy.ts` (neither imports a `next` module or a
 * record), and the shape of the route files that call them.
 *
 * Every value is fictional: no real origin, address or registry is read, and
 * no network call is made.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OG_SHARE_CARD_SPEC } from "./templates/channelSpecs.js";
import type { WebRouteManifest } from "./web/checkWebRoutes.js";
import { buildShareCard } from "./web/shareCard.js";
import { buildSiteMetadata } from "./web/siteMetadata.js";
import { resolveCanonicalSiteOrigin, resolveCrawlTarget, resolveSiteOrigin, siteRobots, siteSitemap } from "../templates/site/app/site-wiring.js";
import type { SiteLegalState } from "../templates/site/app/site-wiring.js";
import {
  ABOUT_COPY_IDS,
  LANDING_COPY_IDS,
  SHARE_CARD_ALT_ID,
  aboutCopyIds,
  allContactPageCopyIds,
  landingCopyIds,
  siteShareCardCopyIds,
  siteShareCardText,
} from "../templates/site/app/site-copy.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(PACKAGE_DIR, "templates", "site");

function readTemplate(path: string): string {
  return readFileSync(join(TEMPLATE_DIR, path), "utf8");
}

/** The exact trimmed body of one `export function` in a template source file; a thrown error fails the calling test. */
function templateFunctionBody(file: string, name: string): string {
  const depthOne = "(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*";
  const match = new RegExp(`export function ${name}\\([^)]*\\)[^{]*\\{(${depthOne})\\}`).exec(readTemplate(file));
  const body = match?.[1];
  if (body === undefined) throw new Error(`export function ${name} is absent or not extractable in ${file}`);
  return body.trim();
}

const ORIGIN = "https://marker.example";
const manifest = JSON.parse(readTemplate("web-route-manifest.json")) as WebRouteManifest;

// --------------------------------------------------------- resolveSiteOrigin

describe("resolveSiteOrigin", () => {
  it("returns an origin buildSiteMetadata accepts, exactly as set", () => {
    const origin = resolveSiteOrigin({ NEXT_PUBLIC_SITE_URL: ORIGIN });
    expect(origin).toBe(ORIGIN);
    const shareCard = buildShareCard({ name: "Marker", tagline: "Marker line", alt: "Marker alt" }).shareCard;
    const meta = buildSiteMetadata({
      site: { name: "Marker", tagline: "Marker line", origin, themeColor: "#112233", locale: "en_US", shareCard },
      page: { kind: "home", label: "Home", description: "Marker description.", path: "/" },
    });
    expect(meta.metadataBase).toBe(ORIGIN);
  });

  const REFUSED: ReadonlyArray<[string, Record<string, string | undefined>]> = [
    ["absent", {}],
    ["undefined", { NEXT_PUBLIC_SITE_URL: undefined }],
    ["empty", { NEXT_PUBLIC_SITE_URL: "" }],
    ["blank", { NEXT_PUBLIC_SITE_URL: "   " }],
    ["with a path", { NEXT_PUBLIC_SITE_URL: `${ORIGIN}/docs` }],
    ["with a trailing slash", { NEXT_PUBLIC_SITE_URL: `${ORIGIN}/` }],
    ["with a query", { NEXT_PUBLIC_SITE_URL: `${ORIGIN}?a=b` }],
    ["with credentials", { NEXT_PUBLIC_SITE_URL: "https://user@marker.example" }],
    ["not http or https", { NEXT_PUBLIC_SITE_URL: "ftp://marker.example" }],
    ["not a URL", { NEXT_PUBLIC_SITE_URL: "marker.example" }],
  ];

  for (const [label, env] of REFUSED) {
    it(`throws when the value is ${label}, naming the variable and never the value`, () => {
      let thrown: unknown;
      try {
        resolveSiteOrigin(env);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain("NEXT_PUBLIC_SITE_URL");
      const value = env["NEXT_PUBLIC_SITE_URL"];
      if (value !== undefined && value.trim() !== "") expect(message).not.toContain(value);
    });
  }

  it("has no fallback origin anywhere in the metadata route files", () => {
    for (const file of ["app/robots.ts", "app/sitemap.ts", "app/opengraph-image.tsx", "app/layout.tsx", "app/site-wiring.ts"]) {
      const source = readTemplate(file);
      expect(source, file).not.toMatch(/example\.(com|org|net)/);
      expect(source, file).not.toMatch(/NEXT_PUBLIC_SITE_URL\s*(\?\?|\|\|)/);
    }
  });
});

// ------------------------------------------------------- resolveCrawlTarget

describe("resolveCrawlTarget (crawling fails closed)", () => {
  const NOT_CRAWLABLE: ReadonlyArray<[string, Record<string, string | undefined>]> = [
    ["absent", {}],
    ["undefined", { SITE_TARGET: undefined }],
    ["preview", { SITE_TARGET: "preview" }],
    ["development", { SITE_TARGET: "development" }],
    ["test", { SITE_TARGET: "test" }],
  ];

  for (const [label, env] of NOT_CRAWLABLE) {
    it(`SITE_TARGET ${label}: robots disallows, names no sitemap, and the sitemap is empty`, () => {
      const target = resolveCrawlTarget(env);
      expect(target).not.toBe("production");
      const robots = siteRobots(target, ORIGIN);
      expect(robots).toEqual({ rules: { userAgent: "*", disallow: "/" } });
      expect(JSON.stringify(robots)).not.toContain("sitemap");
      expect(JSON.stringify(robots)).not.toContain(ORIGIN);
      expect(siteSitemap({ target, origin: ORIGIN, routes: manifest.routes, legal: {} })).toEqual([]);
    });
  }

  it("SITE_TARGET=production allows crawling and lists the routes", () => {
    const target = resolveCrawlTarget({ SITE_TARGET: "production" });
    expect(target).toBe("production");
    expect(siteRobots(target, ORIGIN).sitemap).toBe(`${ORIGIN}/sitemap.xml`);
    expect(siteSitemap({ target, origin: ORIGIN, routes: manifest.routes, legal: {} }).length).toBeGreaterThan(0);
  });

  it("still throws for a value that is set but unknown", () => {
    expect(() => resolveCrawlTarget({ SITE_TARGET: "staging" })).toThrow(/SITE_TARGET/);
    expect(() => resolveCrawlTarget({ SITE_TARGET: "" })).toThrow(/SITE_TARGET/);
  });

  it("siteCrawlTarget calls resolveCrawlTarget and nothing else", () => {
    expect(templateFunctionBody("app/site-records.ts", "siteCrawlTarget")).toBe("return resolveCrawlTarget(process.env);");
    expect(resolveCrawlTarget({})).toBe("preview");
  });
});

// ---------------------------------------------------------------- siteRobots

describe("siteRobots", () => {
  it("allows everything on production and names the sitemap under the origin", () => {
    expect(siteRobots("production", ORIGIN)).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${ORIGIN}/sitemap.xml`,
    });
  });

  for (const target of ["preview", "development", "test"] as const) {
    it(`disallows everything on ${target} and names no sitemap`, () => {
      const robots = siteRobots(target, ORIGIN);
      expect(robots).toEqual({ rules: { userAgent: "*", disallow: "/" } });
      expect(JSON.stringify(robots)).not.toContain('"allow"');
      expect(JSON.stringify(robots)).not.toContain("sitemap");
    });
  }

  it("refuses a target it does not know rather than allowing crawling", () => {
    expect(siteRobots("staging" as never, ORIGIN)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

// --------------------------------------------------------------- siteSitemap

describe("siteSitemap", () => {
  const routes = manifest.routes;
  const reviewed = (lastUpdated: string): SiteLegalState => ({ status: "counsel-reviewed", lastUpdated });
  const draft = (lastUpdated: string): SiteLegalState => ({ status: "draft", lastUpdated });
  const legalRoutes = routes.filter((route) => route.template === "LegalView").map((route) => route.id);

  it("lists every manifest route and a reviewed legal route with its own last-updated date", () => {
    const entries = siteSitemap({
      target: "production",
      origin: ORIGIN,
      routes,
      legal: { "/terms": reviewed("2026-01-02"), "/privacy": reviewed("2026-01-03") },
    });
    expect(entries.map((entry) => entry.url)).toEqual(routes.map((route) => `${ORIGIN}${route.id}`));
    const modified: Record<string, unknown> = {};
    for (const entry of entries) modified[entry.url] = entry.lastModified;
    expect(modified[`${ORIGIN}/terms`]).toBe("2026-01-02");
    expect(modified[`${ORIGIN}/privacy`]).toBe("2026-01-03");
  });

  it("gives a route that has no last-updated date no lastModified key at all", () => {
    const entries = siteSitemap({
      target: "production",
      origin: ORIGIN,
      routes,
      legal: { "/terms": reviewed("2026-01-02"), "/privacy": reviewed("2026-01-03") },
    });
    for (const entry of entries) {
      const legal = legalRoutes.some((id) => entry.url === `${ORIGIN}${id}`);
      expect(Object.keys(entry).sort(), entry.url).toEqual(legal ? ["lastModified", "url"] : ["url"]);
    }
  });

  it("omits a legal route that is a draft, and one with no entry", () => {
    const entries = siteSitemap({ target: "production", origin: ORIGIN, routes, legal: { "/terms": draft("2026-01-02") } });
    const urls = entries.map((entry) => entry.url);
    expect(urls).not.toContain(`${ORIGIN}/terms`);
    expect(urls).not.toContain(`${ORIGIN}/privacy`);
    expect(urls).toEqual(routes.filter((route) => route.template !== "LegalView").map((route) => `${ORIGIN}${route.id}`));
  });

  it("does not treat an unknown status as reviewed", () => {
    const entries = siteSitemap({
      target: "production",
      origin: ORIGIN,
      routes,
      legal: { "/terms": { status: "reviewed" as never, lastUpdated: "2026-01-02" } },
    });
    expect(entries.map((entry) => entry.url)).not.toContain(`${ORIGIN}/terms`);
  });

  it("lists only routes it was given", () => {
    const entries = siteSitemap({ target: "production", origin: ORIGIN, routes: [{ id: "/", template: "LandingView" }], legal: {} });
    expect(entries).toEqual([{ url: `${ORIGIN}/` }]);
  });

  for (const target of ["preview", "development", "test"] as const) {
    it(`lists nothing on ${target}`, () => {
      expect(
        siteSitemap({ target, origin: ORIGIN, routes, legal: { "/terms": reviewed("2026-01-02"), "/privacy": reviewed("2026-01-03") } }),
      ).toEqual([]);
    });
  }

  it("is a thin wrapper: robots and sitemap read the manifest, the origin, the target and the records, and stamp no date", () => {
    const sitemap = readTemplate("app/sitemap.ts");
    expect(sitemap).toMatch(/from\s+["']\.\.\/web-route-manifest\.json["']/);
    expect(sitemap).toMatch(/siteSitemap\(/);
    expect(sitemap).toMatch(/target:\s*siteCrawlTarget\(\)/);
    expect(sitemap).not.toMatch(/new Date/);
    expect(sitemap).not.toMatch(/["'`]\/(about|contact|privacy|terms)["'`]/);
    const robots = readTemplate("app/robots.ts");
    expect(robots).toMatch(/siteRobots\(siteCrawlTarget\(\), siteOrigin\(\)\)/);
    expect(robots).not.toMatch(/allow/);
  });

  it("loadLegalSitemapStates validates each document and reports its own status", () => {
    const body = templateFunctionBody("app/site-records.ts", "loadLegalSitemapStates");
    expect(body).toContain("requireLegalDocument(record, \"preview\").legal");
    expect(body).toContain("return { status, lastUpdated };");
    expect(body).not.toMatch(/counsel-reviewed|\b as /);
    expect(body).toContain('"/terms": state(termsRecord)');
    expect(body).toContain('"/privacy": state(privacyRecord)');
    const keyed = [...body.matchAll(/(\/[a-z]+)": state\(/g)].map((match) => match[1]);
    expect(keyed.sort()).toEqual(manifest.routes.filter((route) => route.template === "LegalView").map((route) => route.id).sort());
  });

  it("the sitemap lists exactly the template routes, from the manifest only", () => {
    expect(manifest.routes.map((route) => route.id)).toEqual(["/", "/about", "/contact", "/privacy", "/terms"]);
    const sitemap = readTemplate("app/sitemap.ts");
    expect(sitemap).toMatch(/routes:\s*manifest\.routes\s*,/);
    expect(sitemap).not.toMatch(/["'`]\/[^"'`]*["'`]/);
    const entries = siteSitemap({
      target: "production",
      origin: ORIGIN,
      routes: manifest.routes,
      legal: { "/terms": reviewed("2026-01-02"), "/privacy": reviewed("2026-01-03") },
    });
    expect(entries.map((entry) => entry.url)).toEqual(["/", "/about", "/contact", "/privacy", "/terms"].map((id) => `${ORIGIN}${id}`));
  });
});

// ------------------------------------------------------------- the share card

describe("siteShareCardText", () => {
  const copy = { "brand.tagline.marker": "Marker tagline", [LANDING_COPY_IDS.heading]: "Marker landing heading", "site.share-card.alt": "Marker card alt" };

  it("takes the name from the brand label, the tagline from the tagline id and the alt from the share-card id", () => {
    const text = siteShareCardText({ brandLabel: "Marker Brand", taglineCopyId: "brand.tagline.marker" }, copy);
    expect(text).toEqual({ name: "Marker Brand", tagline: "Marker tagline", alt: "Marker card alt" });
  });

  it("falls back to the landing heading id when the record lists no tagline", () => {
    const text = siteShareCardText({ brandLabel: "Marker Brand", taglineCopyId: undefined }, copy);
    expect(text.tagline).toBe("Marker landing heading");
  });

  it("gives buildShareCard text it accepts, at the declared size", () => {
    const card = buildShareCard(siteShareCardText({ brandLabel: "Marker Brand", taglineCopyId: "brand.tagline.marker" }, copy));
    expect(card.width).toBe(OG_SHARE_CARD_SPEC.widthPx);
    expect(card.height).toBe(OG_SHARE_CARD_SPEC.heightPx);
    expect(card.shareCard.alt).toBe("Marker card alt");
  });

  it("lists the ids the card reads, so the page resolves exactly those", () => {
    expect(siteShareCardCopyIds({ brandLabel: "Marker Brand", taglineCopyId: "brand.tagline.marker" })).toEqual([
      "brand.tagline.marker",
      "site.share-card.alt",
    ]);
    expect(siteShareCardCopyIds({ brandLabel: "Marker Brand", taglineCopyId: undefined })).toEqual([
      LANDING_COPY_IDS.heading,
      "site.share-card.alt",
    ]);
  });

  for (const missing of ["brand.tagline.marker", "site.share-card.alt"]) {
    it(`throws naming ${missing} when it is absent, and never any text`, () => {
      const partial: Record<string, string> = { ...copy };
      delete partial[missing];
      let thrown: unknown;
      try {
        siteShareCardText({ brandLabel: "Marker Brand", taglineCopyId: "brand.tagline.marker" }, partial);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(missing);
      expect((thrown as Error).message).not.toContain("Marker tagline");
    });
  }

  it("the opengraph-image route builds the card from that text and carries no colour, length or text literal", () => {
    const source = readTemplate("app/opengraph-image.tsx");
    expect(source).toMatch(/from\s+["']next\/og["']/);
    expect(source).toMatch(/buildShareCard\(siteShareCardText\(/);
    expect(source).toMatch(/new ImageResponse\(/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/tokenOverrides|roles\s*:/);
    expect(source).not.toMatch(/\b\d{3,4}\b/);
    expect(source).not.toMatch(/["'`](image\/png)["'`]/);
    expect(source).toMatch(/export const size\s*=/);
    expect(source).toMatch(/export const contentType\s*=/);
    expect(source).toMatch(/export const alt\s*=\s*card\.shareCard\.alt;/);
    // No text literal: once the import lines and comments are removed, no string or template literal is left.
    const code = source
      .replace(/^import .*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/["'`]/);
  });

  it("the root layout takes metadataBase from the origin variable through siteOrigin", () => {
    const layout = readTemplate("app/layout.tsx");
    expect(layout).toMatch(/metadataBase:\s*new URL\(siteOrigin\(\)\)/);
  });
});

// ------------------------------------------------- resolveCanonicalSiteOrigin

describe("resolveCanonicalSiteOrigin", () => {
  const facts = { canonicalOrigin: ORIGIN };

  it("production accepts the canonical origin", () => {
    expect(resolveCanonicalSiteOrigin({ SITE_TARGET: "production", NEXT_PUBLIC_SITE_URL: ORIGIN }, facts)).toBe(ORIGIN);
  });

  // The variable must already be a valid origin (the origin rules run first), so the
  // slash and case mismatches are on the record's side.
  const DIFFERENT: ReadonlyArray<[string, string, string]> = [
    ["a canonicalOrigin with a trailing slash", ORIGIN, `${ORIGIN}/`],
    ["a canonicalOrigin with an uppercase host", ORIGIN, "https://MARKER.example"],
    ["another host", "https://other.example", ORIGIN],
  ];

  for (const [label, value, canonicalOrigin] of DIFFERENT) {
    it(`production refuses a different origin: ${label}, naming both names and neither value`, () => {
      let thrown: unknown;
      try {
        resolveCanonicalSiteOrigin({ SITE_TARGET: "production", NEXT_PUBLIC_SITE_URL: value }, { canonicalOrigin });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain("NEXT_PUBLIC_SITE_URL");
      expect(message).toContain("canonicalOrigin");
      for (const leaked of [value, canonicalOrigin, ORIGIN, "marker", "MARKER", "other.example"]) expect(message).not.toContain(leaked);
    });
  }

  const OTHER_TARGETS: ReadonlyArray<[string, Record<string, string | undefined>]> = [
    ["absent", {}],
    ["preview", { SITE_TARGET: "preview" }],
    ["development", { SITE_TARGET: "development" }],
    ["test", { SITE_TARGET: "test" }],
  ];

  for (const [label, target] of OTHER_TARGETS) {
    it(`other targets do not compare: SITE_TARGET ${label} returns the variable's origin`, () => {
      const preview = "https://preview.example";
      expect(resolveCanonicalSiteOrigin({ ...target, NEXT_PUBLIC_SITE_URL: preview }, facts)).toBe(preview);
    });
  }

  it("the origin rules still apply first: production with an absent or malformed variable", () => {
    for (const env of [{}, { NEXT_PUBLIC_SITE_URL: "" }, { NEXT_PUBLIC_SITE_URL: `${ORIGIN}/docs` }, { NEXT_PUBLIC_SITE_URL: "marker.example" }]) {
      let thrown: unknown;
      try {
        resolveCanonicalSiteOrigin({ SITE_TARGET: "production", ...env }, facts);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain("NEXT_PUBLIC_SITE_URL");
      expect(message).not.toContain("canonicalOrigin");
    }
  });

  it("the origin rules still apply first: a malformed variable on a canonical-matching facts value", () => {
    expect(() => resolveCanonicalSiteOrigin({ SITE_TARGET: "preview", NEXT_PUBLIC_SITE_URL: `${ORIGIN}/` }, facts)).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("an unknown SITE_TARGET throws naming SITE_TARGET", () => {
    expect(() => resolveCanonicalSiteOrigin({ SITE_TARGET: "staging", NEXT_PUBLIC_SITE_URL: ORIGIN }, facts)).toThrow(/SITE_TARGET/);
    expect(() => resolveCanonicalSiteOrigin({ SITE_TARGET: "", NEXT_PUBLIC_SITE_URL: ORIGIN }, facts)).toThrow(/SITE_TARGET/);
  });

  it("siteOrigin goes through the canonical check", () => {
    expect(templateFunctionBody("app/site-records.ts", "siteOrigin")).toBe("return resolveCanonicalSiteOrigin(process.env, loadBrandFacts());");
  });
});

// ------------------------------------------------------------------- README

describe("the template README", () => {
  it("names the five upgrade copy ids", () => {
    const readme = readTemplate("README.md");
    for (const id of [...Object.values(ABOUT_COPY_IDS), SHARE_CARD_ALT_ID]) expect(readme, id).toContain(id);
  });
});

// --------------------------------------------------------------------- /about

describe("the /about page", () => {
  const source = readTemplate("app/about/page.tsx");

  it("is the manifest's MarketingView route and imports that view", () => {
    const route = manifest.routes.find((entry) => entry.id === "/about");
    expect(route?.template).toBe("MarketingView");
    expect(route?.file).toBe("app/about/page.tsx");
    expect(source).toMatch(/import\s*\{[^}]*\bMarketingView\b[^}]*\}\s*from\s*["']@clossys\/publisher\/web["']/);
    expect(source).toMatch(/<MarketingView\b/);
  });

  it("reads no surface record and renders no document", () => {
    expect(source).not.toMatch(/publisher\/surfaces\//);
    expect(source).not.toMatch(/about\.json/);
    expect(source).not.toMatch(/renderWebDocument|buildWebHeadMetadata/);
  });

  it("resolves only aboutCopyIds() and carries no copy id or word of its own", () => {
    expect(source).toMatch(/requireCopy\(.*aboutCopyIds\(\)\)/);
    expect(source).not.toMatch(/["'`]site\./);
  });

  it("passes no string literal to MarketingView: every prop is a resolved value", () => {
    expect(source).not.toMatch(/\b(?:brand|hero[A-Za-z]*|features[A-Za-z]*|faq[A-Za-z]*|cta[A-Za-z]*|footer[A-Za-z]*)(?:=["']|=\{\s*["'`])/);
  });

  it("aboutCopyIds lists the four about ids, the contact action and the footer ids, once each", () => {
    const ids = aboutCopyIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("site.about."))).toEqual([
      "site.about.heading",
      "site.about.description",
      "site.about.cta-heading",
      "site.about.cta-description",
    ]);
    expect(ids).toContain(LANDING_COPY_IDS.contactAction);
    for (const footerId of allContactPageCopyIds().filter((id) => id.startsWith("site.footer."))) expect(ids).toContain(footerId);
    expect(ids).toEqual(expect.arrayContaining(landingCopyIds(LANDING_COPY_IDS.heading).filter((id) => id.startsWith("site.footer."))));
  });
});
