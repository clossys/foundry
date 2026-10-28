import type { CandidateContent, ContentRegistry } from "../model.js";
import type { LocaleRouteOptions, PublisherLocaleManifest } from "../hreflang.js";
import { createContentRevision } from "../revisions.js";
import { at, reviewFixture } from "./review.js";

export const localeRouteOrigin = "https://locale.example";

/** Native inline Writer values and an actual approved revision, with no inferred output inventory. */
export function localeRoutesFixture(): { readonly registry: ContentRegistry; readonly options: LocaleRouteOptions } {
  const base = structuredClone(reviewFixture());
  const original = base.candidates[0]!;
  const content: CandidateContent = {
    ...original,
    name: "About our team",
    composition: {
      ...original.composition!,
      sections: original.composition!.sections.map(section => ({
        ...section,
        fields: [
          { key: "heading", locale: "en-US", value: "Meet our team", source: "writer" },
          { key: "heading", locale: "fr-CA", value: "Rencontrez notre équipe", source: "writer" },
        ],
      })),
    },
    pageMeta: [
      { key: "title", locale: "en-US", value: "About our team", source: "writer" },
      { key: "description", locale: "en-US", value: "Meet our team and learn what we do.", source: "writer" },
      { key: "title", locale: "fr-CA", value: "À propos de notre équipe", source: "writer" },
      { key: "description", locale: "fr-CA", value: "Rencontrez notre équipe et découvrez nos activités.", source: "writer" },
    ],
  };
  const snapshot = createContentRevision(content, "r1", at);
  const registry: ContentRegistry = {
    ...base,
    workspace: {
      ...base.workspace,
      defaultLocale: "en-US", locales: ["en-US", "fr-CA"],
      deployTargets: [{ id: "public", repo: "sample", app: "site", origin: localeRouteOrigin }],
    },
    slots: [{
      ...base.slots[0]!, aliases: ["websites/site/about"], name: "About", position: { order: 0, name: "about" },
      locales: ["en-US", "fr-CA"], route: "/about", deployTarget: "public",
      meta: { canonical: { "en-US": `${localeRouteOrigin}/about`, "fr-CA": `${localeRouteOrigin}/fr-ca/about` } },
    }],
    candidates: [{ ...original, ...snapshot.content, history: [snapshot], approval: { ...original.approval!, digest: snapshot.digest } }],
  };
  const manifest: PublisherLocaleManifest = {
    defaultLocale: "en-US",
    locales: [{ tag: "en-US", dir: "ltr", state: "active" }, { tag: "fr-CA", dir: "ltr", state: "active" }],
    fallback: { "fr-CA": ["en-US"] },
  };
  return {
    registry,
    options: {
      workspace: registry.workspace, manifest,
      bodyServedLocales: { "en-US": ["en-US"], "fr-CA": ["fr-CA"] },
      existingUrls: [`${localeRouteOrigin}/about`, `${localeRouteOrigin}/fr-ca/about`],
    },
  };
}
