/** @vitest-environment node */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentRouteNeedsError, ContentRoutePage, prepareContentRoute, requireContentRoutePublishing } from "./content-route.js";
import type { ContentRouteInput } from "./content-route-types.js";
import { contentRouteContent, contentRouteFixture, withRouteContent, writerField, withApprovedRouteCopy } from "./__fixtures__/content-route.js";

const locales = ["en", "fr", "ar"] as const;
const copy = {
  en: { title: "Administration", description: "Manage your workspace.", body: "Workspace administration", skip: "Skip to administration", brand: "Example" },
  fr: { title: "Administration", description: "Gérez votre espace.", body: "Administration de l’espace", skip: "Aller à l’administration", brand: "Exemple" },
  ar: { title: "الإدارة", description: "إدارة مساحة العمل.", body: "إدارة مساحة العمل", skip: "انتقل إلى الإدارة", brand: "مثال" },
};
const urls = ["https://example.test/admin", "https://example.test/fr/admin", "https://example.test/ar/admin"];

/** Synthetic admin copy through the existing closed AuthFrame adapter. */
function publishingFixture(locale: typeof locales[number] = "en"): ContentRouteInput {
  const content = contentRouteContent();
  const input = contentRouteFixture({
    name: "Administration",
    pageMeta: locales.flatMap(tag => [writerField("title", copy[tag].title, tag), writerField("description", copy[tag].description, tag)]),
    composition: { ...content.composition!, sections: [{ ...content.composition!.sections[0]!, fields: locales.map(tag => writerField("title", copy[tag].body, tag)) }] },
  });
  return withApprovedRouteCopy({
    ...input, locale,
    registry: {
      ...input.registry,
      workspace: { ...input.registry.workspace, locales, deployTargets: [{ id: "site", repo: "example", app: "site", origin: "https://example.test" }] },
      slots: input.registry.slots.map(slot => ({ ...slot, name: "Administration", l2: "admin", aliases: [], locales, route: "/admin", meta: { robots: "noindex" } })),
    },
    frameCopy: locales.map(tag => writerField("skipLabel", copy[tag].skip, tag)),
    publishing: {
      brand: copy[locale].brand,
      manifest: { defaultLocale: "en", locales: locales.map(tag => ({ tag, state: "active", dir: tag === "ar" ? "rtl" : "ltr" })), fallback: {} },
      bodyServedLocales: { en: ["en"], fr: ["fr"], ar: ["ar"] },
      existingUrls: urls,
    },
  });
}
const render = (input: ContentRouteInput) => renderToStaticMarkup(<ContentRoutePage input={requireContentRoutePublishing(input)} />);

describe("content route publishing document", () => {
  it.each(locales)("publishes complete native %s metadata through frames.document", locale => {
    const input = publishingFixture(locale);
    const before = JSON.stringify(input);
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("ready");
    expect(prepared.needs).toEqual([]);
    const html = render(input);
    const title = `${copy[locale].title} · ${copy[locale].brand}`;
    expect(html).toContain('data-ds-leaf="frames.document"');
    expect(html).toContain(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`name="description" content="${copy[locale].description}"`);
    expect(html).toContain(`rel="canonical" href="${urls[locales.indexOf(locale)]}"`);
    expect(html).toContain(`property="og:title" content="${title}"`);
    expect(html).toContain(`property="og:description" content="${copy[locale].description}"`);
    expect(html).toContain(`property="og:locale" content="${locale}"`);
    expect(html.slice(0, html.indexOf("</head>"))).toContain(`property="og:locale" content="${locale}"`);
    expect(html).toContain(copy[locale].body);
    expect(html).toContain(copy[locale].skip);
    for (const [index, tag] of locales.entries()) {
      expect(html).toContain(`rel="alternate" href="${urls[index]}" hrefLang="${tag}"`);
    }
    expect(html).toContain(`rel="alternate" href="${urls[0]}" hrefLang="x-default"`);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses native Writer sharing copy when supplied", () => {
    const input = publishingFixture("fr");
    const content = input.registry.candidates[0]!.history.at(-1)!.content;
    const shared = withApprovedRouteCopy(withRouteContent(input, { ...content, pageMeta: [...content.pageMeta!, writerField("share-title", "Espace partagé", "fr"), writerField("share-text", "Description de partage.", "fr")] }));
    const html = render(shared);
    expect(html).toContain('property="og:title" content="Espace partagé"');
    expect(html).toContain('property="og:description" content="Description de partage."');
    expect(html).toContain('<title>Administration · Exemple</title>');
  });

  it("keeps unavailable admin chrome as a named Designer Need", () => {
    const input = publishingFixture();
    const content = input.registry.candidates[0]!.history.at(-1)!.content;
    const unsupported = withRouteContent(input, { ...content, composition: { ...content.composition!, frame: { frameId: "frames.app-shell", configId: "default" } } });
    const prepared = prepareContentRoute(unsupported);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "config", target: "designer", ref: "default" }));
  });

  it("requires publishing context on the serving path while preserving direct preview", () => {
    const input = contentRouteFixture();
    expect(prepareContentRoute(input).status).toBe("ready");
    expect(() => requireContentRoutePublishing(input)).toThrow(ContentRouteNeedsError);
    try { requireContentRoutePublishing(input); } catch (error) {
      expect((error as ContentRouteNeedsError).needs).toContainEqual(expect.objectContaining({ ref: "publishing", kind: "config" }));
    }
  });

  it("requires a description even for a noindex admin route", () => {
    const input = publishingFixture();
    const candidate = input.registry.candidates[0]!;
    const missing = contentRouteFixture({ ...candidate.history.at(-1)!.content, pageMeta: candidate.pageMeta!.filter(field => field.key !== "description") });
    const prepared = prepareContentRoute({ ...input, registry: { ...input.registry, candidates: missing.registry.candidates } });
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "pageMeta.en.description" }));
  });

  it("refuses missing native metadata in another locale before advertising its alternate", () => {
    const input = publishingFixture("en");
    const content = input.registry.candidates[0]!.history.at(-1)!.content;
    const missingFrench = withRouteContent(input, { ...content, pageMeta: content.pageMeta!.filter(field => field.locale !== "fr") });
    const prepared = prepareContentRoute(missingFrench);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "pageMeta.fr.title" }));
    expect(prepared.needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "pageMeta.fr.description" }));
    expect(prepared.metadata.alternates).toEqual([]);
    expect(() => render(missingFrench)).toThrow(ContentRouteNeedsError);
  });

  it.each([null, "invalid", [], {}, { manifest: null }, { manifest: { locales: null } }])("returns named Needs for malformed publishing context %j", publishing => {
    const input = { ...publishingFixture(), publishing } as unknown as ContentRouteInput;
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "config" }));
    expect(() => render(input)).toThrow(ContentRouteNeedsError);
  });

  it("refuses incomplete static inventory and cross-locale canonicals with named Needs", () => {
    const input = publishingFixture();
    const incomplete = { ...input, publishing: { ...input.publishing!, existingUrls: urls.slice(0, 2) } };
    const wrongCanonical = { ...input, registry: { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, meta: { ...slot.meta, canonical: { fr: urls[0]! } } })) } };
    for (const invalid of [incomplete, wrongCanonical]) {
      const prepared = prepareContentRoute(invalid);
      expect(prepared.status).toBe("needs-input");
      expect(prepared.node).toBeUndefined();
      expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "config", target: "designer" }));
      expect(() => render(invalid)).toThrow(ContentRouteNeedsError);
    }
  });

  it("takes direction from the Writer manifest rather than inferring it from the locale", () => {
    const input = publishingFixture("ar");
    const declared = { ...input, publishing: { ...input.publishing!, manifest: { ...input.publishing!.manifest, locales: input.publishing!.manifest.locales.map(locale => ({ ...locale, dir: "ltr" as const })) } } };
    expect(render(declared)).toContain('lang="ar" dir="ltr"');
    const missing = { ...input, publishing: { ...input.publishing!, manifest: { ...input.publishing!.manifest, locales: input.publishing!.manifest.locales.map(locale => ({ ...locale, dir: undefined })) } } };
    expect(prepareContentRoute(missing as unknown as ContentRouteInput).status).toBe("needs-input");
  });

  it("keeps fallback bodies out of the reciprocal alternate set", () => {
    const input = publishingFixture("fr");
    const fallback = { ...input, publishing: { ...input.publishing!, bodyServedLocales: { ...input.publishing!.bodyServedLocales, fr: ["en"] } } };
    const html = render(fallback);
    expect(html).toContain(`rel="canonical" href="${urls[1]}"`);
    expect(html).not.toContain('rel="alternate"');
    const native = render({ ...fallback, locale: "en" });
    expect(native).not.toContain('hrefLang="fr"');
    expect(native).toContain('hrefLang="en"');
    expect(native).toContain('hrefLang="ar"');
    expect(native).toContain('hrefLang="x-default"');
  });
});
