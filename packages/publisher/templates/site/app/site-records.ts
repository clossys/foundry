/**
 * The four records the pages read, and the only file that reads them.
 *
 * Each import below is a file in the repository's own `clossys/` directory,
 * read at build time and never copied into this template:
 *
 * - `clossys/strategist/brand-facts.json`: the brand name, the legal entity,
 *   the contact address and the taglines.
 * - `clossys/writer/copy-registry.json`: every visible word, by copy id.
 * - `clossys/publisher/legal/terms.json` and `privacy.json`: the two legal
 *   documents, whose text is copy ids into the same registry.
 *
 * Five more files are read here, and only by the dev-only pack review, each
 * at request time and never imported, so a repository without one still
 * builds: `clossys/publisher/pack.json` (`loadPackManifest`),
 * `clossys/strategist/contract.json` (`loadStrategyContract`),
 * `clossys/brief.json` (`loadEngagementBrief`), `clossys/writer/voice.json`
 * (`loadVoiceRecord`) and `clossys/designer/brand.css`
 * (`loadBrandDeclarations`). Each throws when its file is absent or
 * unreadable, and the pack review treats a throw as an absent record.
 *
 * Server-only. Writer's root reads the file system, so this module and
 * everything that imports it stay out of client bundles: a server page
 * resolves what a client module needs and passes it down as plain data.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readBrandCss } from "@clossys/designer/tokens";
import { createCopyResolver } from "@clossys/writer";
import type { CopyResolver } from "@clossys/writer";
import type { LegalDocument } from "@clossys/publisher/document";
import brandFactsRecord from "../../../clossys/strategist/brand-facts.json" with { type: "json" };
import copyRegistryRecord from "../../../clossys/writer/copy-registry.json" with { type: "json" };
import privacyRecord from "../../../clossys/publisher/legal/privacy.json" with { type: "json" };
import termsRecord from "../../../clossys/publisher/legal/terms.json" with { type: "json" };
import { parseBrandFacts, requireLegalDocument, resolveCanonicalSiteOrigin, resolveCrawlTarget, resolveSiteTarget } from "./site-wiring";
import type { SiteBrandFacts, SiteLegalState, SiteTarget } from "./site-wiring";

/** The deployment target for this process: `SITE_TARGET`, and `production` when it is absent. */
export function siteTarget(): SiteTarget {
  return resolveSiteTarget(process.env);
}

/**
 * The target `robots` and `sitemap` use: `production` only when `SITE_TARGET`
 * is explicitly `production`. An absent value does not allow crawling.
 */
export function siteCrawlTarget(): SiteTarget {
  return resolveCrawlTarget(process.env);
}

/**
 * The site's origin: `NEXT_PUBLIC_SITE_URL`, which must be a valid origin and,
 * on `production`, must equal the brand-facts `canonicalOrigin`. There is no fallback.
 */
export function siteOrigin(): string {
  return resolveCanonicalSiteOrigin(process.env, loadBrandFacts());
}

export function loadBrandFacts(): SiteBrandFacts {
  return parseBrandFacts(brandFactsRecord);
}

/**
 * The approved-copy resolver, with the Writer resolver's target policy: an
 * entry approved by its owner resolves on every target, an entry approved only
 * by a delegate is refused on `production`, and a stale or expired approval is
 * refused on every target.
 */
export function createSiteCopyResolver(target: SiteTarget): CopyResolver {
  return createCopyResolver(copyRegistryRecord, { target: target === "production" ? "production" : "preview" });
}

/** A legal document that may be published for the target: valid everywhere, counsel-reviewed on `production`. */
export function loadLegalDocument(kind: "terms" | "privacy", target: SiteTarget): LegalDocument {
  return requireLegalDocument(kind === "terms" ? termsRecord : privacyRecord, target);
}

/**
 * What the sitemap needs from the two legal documents, keyed by route id: each
 * document's status and its own `lastUpdated`. The documents are validated but
 * not gated, so a draft is reported as a draft (and left out of the sitemap)
 * instead of stopping it; the pages themselves still refuse a draft on
 * `production`.
 */
export function loadLegalSitemapStates(): Record<string, SiteLegalState> {
  const state = (record: unknown): SiteLegalState => {
    const { status, lastUpdated } = requireLegalDocument(record, "preview").legal;
    return { status, lastUpdated };
  };
  return { "/terms": state(termsRecord), "/privacy": state(privacyRecord) };
}

/** The registry's locale: a BCP 47 tag, used to format dates on the legal pages. */
export function siteLocale(): string {
  return copyRegistryRecord.locale;
}

/** The legal document's title as approved copy, for the document head. Throws, naming nothing, if it does not resolve. */
export function legalTitle(document: LegalDocument, resolver: CopyResolver): string {
  const resolution = resolver(document.title);
  if (resolution === undefined || resolution.text.trim().length === 0) throw new Error("The legal document title does not resolve.");
  return resolution.text;
}

/**
 * The pack manifest, parsed and not yet validated (the review index validates
 * it). Read at request time from the repository's own `clossys/publisher/`
 * directory, two levels above the app. Throws when the file is absent or is
 * not JSON; the caller treats any throw as "unavailable" and never shows the
 * message, which names a path.
 */
export function loadPackManifest(): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "..", "..", "clossys", "publisher", "pack.json"), "utf8"));
}

/** A file in the repository's own `clossys/` directory, two levels above the app. */
function packRecordPath(...segments: string[]): string {
  return resolve(process.cwd(), "..", "..", "clossys", ...segments);
}

/** The Strategist contract, parsed and not yet validated. Read at request time; throws when absent or not JSON. */
export function loadStrategyContract(): unknown {
  return JSON.parse(readFileSync(packRecordPath("strategist", "contract.json"), "utf8"));
}

/** The engagement brief, parsed and not yet validated. Read at request time; throws when absent or not JSON. */
export function loadEngagementBrief(): unknown {
  return JSON.parse(readFileSync(packRecordPath("brief.json"), "utf8"));
}

/** The Writer voice record, parsed and not yet validated. Read at request time; throws when absent or not JSON. */
export function loadVoiceRecord(): unknown {
  return JSON.parse(readFileSync(packRecordPath("writer", "voice.json"), "utf8"));
}

/** The brand file's declarations, read at request time through Designer's reader. Throws, naming nothing, when it cannot be read. */
export function loadBrandDeclarations(): Readonly<Record<string, string>> {
  const read = readBrandCss(packRecordPath("designer", "brand.css"));
  if (!read.complete) throw new Error("The brand file could not be read.");
  return read.declarations;
}

/**
 * The approved-copy resolver the pack review reads the repository's copy
 * with. The review is served only on `development` and `test`, which both
 * resolve with the preview policy, so it never reads `SITE_TARGET` itself.
 */
export function createPackReviewCopyResolver(): CopyResolver {
  return createSiteCopyResolver("development");
}

/** Every id in the copy registry, in registry order. */
export function siteCopyIds(): string[] {
  return copyRegistryRecord.entries.map((entry) => entry.id);
}
