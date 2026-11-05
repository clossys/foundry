import { adminPageForRoute } from "./admin-copy.js";
import { PAGE_META_FIELDS, PAGE_META_KEY, resolveCopy, validateCopyFields } from "./composition.js";
import type { ContentFinding, ResolveCopyOptions } from "./composition.js";
import { buildLocaleRoutePlan, localePathFor } from "./hreflang.js";
import type { LocaleRouteOptions } from "./hreflang.js";
import type { CandidateContent, ContentSlot } from "./model.js";
import { CONTENT_TREE } from "./taxonomy.js";
import type { ContentTree } from "./taxonomy.js";

/** Canonical URLs are slot workflow metadata, outside candidate revision content. */
export function isCanonicalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim() || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

/** Console routes stay private to search; explicit policy governs other slots. */
export function robotsFor(slot: ContentSlot, tree: ContentTree = CONTENT_TREE): "index" | "noindex" {
  if (adminPageForRoute(slot.route) !== undefined) return "noindex";
  if (slot.meta?.robots !== undefined) return slot.meta.robots;
  const child = tree.nodes.find(node => node.id === slot.l1)?.children.find(node => node.id === slot.l2);
  return slot.kind !== "content" || slot.l2 === "auth" || child?.frame === "frames.auth-shell" ? "noindex" : "index";
}

export type OutputPathInput = Pick<ContentSlot, "route" | "deployTarget"> & {
  readonly locale?: string;
  readonly defaultLocale?: string;
};

/** Logical output only; encode every user-selected segment before filesystem use. */
export function outputPathFor(slot: OutputPathInput): string {
  const { deployTarget, locale, defaultLocale } = slot;
  let { route } = slot;
  if (typeof deployTarget !== "string" || !deployTarget.trim()) throw new TypeError("Output requires a deploy target");
  if ((locale === undefined) !== (defaultLocale === undefined)) throw new TypeError("Output locale and default locale must be provided together");
  if (typeof route !== "string" || !route.startsWith("/") || /[?#\\]/.test(route)
    || route.includes("//") || (route !== "/" && route.endsWith("/"))) throw new TypeError("Output requires a canonical absolute route path");
  if (locale !== undefined && defaultLocale !== undefined) route = localePathFor(route, locale, defaultLocale);
  const segments = route === "/" ? [] : route.slice(1).split("/");
  if (segments.some(segment => {
    try { return [".", ".."].includes(decodeURIComponent(segment)); }
    catch { return true; }
  })) throw new TypeError("Output route contains a noncanonical segment");
  const encode = (segment: string) => encodeURIComponent(segment).replace(/\./g, "%2E");
  return [encode(deployTarget), "app", ...segments.map(encode), "page.tsx"].join("/");
}

/** Readiness checks stay separate so legacy snapshots and incomplete drafts remain readable. */
type PageMetadataOptions = ResolveCopyOptions & (LocaleRouteOptions | { readonly [K in keyof LocaleRouteOptions]?: never });

/** Any supplied route field retains the existing full route validation. */
function hasLocaleOptions(options: PageMetadataOptions): options is ResolveCopyOptions & LocaleRouteOptions {
  return ["workspace", "manifest", "bodyServedLocales", "existingUrls"].some(key => key in options);
}

export function checkPageMetadata(slot: ContentSlot, candidate: CandidateContent, tree: ContentTree = CONTENT_TREE, options: PageMetadataOptions = {}): ContentFinding[] {
  const findings: ContentFinding[] = [...validateCopyFields(candidate.pageMeta ?? [], "content.pageMeta", PAGE_META_FIELDS)];
  const appendLocaleFindings = (): ContentFinding[] => {
    if (hasLocaleOptions(options)) findings.push(...buildLocaleRoutePlan(slot, options).findings);
    return findings;
  };
  if (findings.length) return appendLocaleFindings();
  const add = (path: string, rule: string) => findings.push({ path, rule, message: `Invalid ${rule}` });
  const fields = candidate.pageMeta ?? [];
  const keys = new Set(["title"]);
  if (robotsFor(slot, tree) === "index") keys.add("description");
  for (const [index, field] of fields.entries()) {
    if (!slot.locales.includes(field.locale)) add(`content.pageMeta[${index}].locale`, "slot-locale");
  }
  for (const locale of slot.locales) {
    const result = resolveCopy(candidate.pageMeta === undefined ? {} : { pageMeta: candidate.pageMeta }, locale, options);
    for (const finding of result.findings) {
      if (finding.severity !== "error") continue;
      // Preserve the established readiness path and avoid a second title finding.
      if (finding.rule === "required-page-metadata") continue;
      findings.push({ path: `content.${finding.path}`, rule: finding.rule, message: finding.message });
    }
    for (const key of keys) {
      const value = result.copy[PAGE_META_KEY]?.[key];
      if (!value?.trim()) add(`content.pageMeta.${locale}.${key}`, "required-page-metadata");
    }
  }
  return appendLocaleFindings();
}
