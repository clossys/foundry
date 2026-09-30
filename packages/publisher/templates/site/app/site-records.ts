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
 * Server-only. Writer's root reads the file system, so this module and
 * everything that imports it stay out of client bundles: a server page
 * resolves what a client module needs and passes it down as plain data.
 */
import { createCopyResolver } from "@clossys/writer";
import type { CopyResolver } from "@clossys/writer";
import type { LegalDocument } from "@clossys/publisher/document";
import brandFactsRecord from "../../../clossys/strategist/brand-facts.json" with { type: "json" };
import copyRegistryRecord from "../../../clossys/writer/copy-registry.json" with { type: "json" };
import privacyRecord from "../../../clossys/publisher/legal/privacy.json" with { type: "json" };
import termsRecord from "../../../clossys/publisher/legal/terms.json" with { type: "json" };
import { parseBrandFacts, requireLegalDocument, resolveSiteTarget } from "./site-wiring";
import type { SiteBrandFacts, SiteTarget } from "./site-wiring";

/** The deployment target for this process: `SITE_TARGET`, and `production` when it is absent. */
export function siteTarget(): SiteTarget {
  return resolveSiteTarget(process.env);
}

export function loadBrandFacts(): SiteBrandFacts {
  return parseBrandFacts(brandFactsRecord);
}

/**
 * The approved-copy resolver. On `production` an entry must carry its approval
 * record to resolve; on every other target an approved entry resolves without
 * one, so a preview can show copy that is approved but not yet signed off.
 */
export function createSiteCopyResolver(target: SiteTarget): CopyResolver {
  return createCopyResolver(copyRegistryRecord, { target: target === "production" ? "production" : "preview" });
}

/** A legal document that may be published for the target: valid everywhere, counsel-reviewed on `production`. */
export function loadLegalDocument(kind: "terms" | "privacy", target: SiteTarget): LegalDocument {
  return requireLegalDocument(kind === "terms" ? termsRecord : privacyRecord, target);
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
