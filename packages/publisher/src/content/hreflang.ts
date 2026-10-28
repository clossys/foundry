import { canonicalLocale, fallbackChain } from "@clossys/writer/locale";
import type { ContentFinding } from "./composition.js";
import type { ContentSlot, ContentWorkspace } from "./model.js";

export type PublisherLocaleManifest = Parameters<typeof fallbackChain>[1];
export interface LocaleRouteOptions {
  readonly workspace: ContentWorkspace;
  readonly manifest: PublisherLocaleManifest;
  /** Served locale for each resolved body field; [] explicitly proves a copy-free body. */
  readonly bodyServedLocales: Readonly<Record<string, readonly string[]>>;
  /** Absolute URLs actually emitted by the consumer's static-output inventory. */
  readonly existingUrls: readonly string[];
}
export interface LocaleRouteFinding extends ContentFinding { readonly severity: "error" | "warning" }
export interface HreflangAlternate { readonly hreflang: string; readonly href: string }
export interface LocalePageMetadata {
  readonly locale: string;
  readonly path: string;
  readonly url: string;
  readonly canonical: string;
  readonly outputPath: string;
  readonly hreflangEligible: boolean;
  readonly alternates: readonly HreflangAlternate[];
}
export interface LocaleRoutePlan {
  readonly ready: boolean;
  /** Diagnostic page models; publishing requires a ready plan. */
  readonly pages: readonly LocalePageMetadata[];
  readonly findings: readonly LocaleRouteFinding[];
}
export interface SitemapLocaleEntry {
  readonly url: string;
  readonly alternates: readonly HreflangAlternate[];
}

function routeSegments(route: string): string[] {
  if (typeof route !== "string" || !route.startsWith("/") || /[?#\\]/.test(route)
    || route.includes("//") || (route !== "/" && route.endsWith("/"))) {
    throw new TypeError("Output requires a canonical absolute route path");
  }
  const segments = route === "/" ? [] : route.slice(1).split("/");
  if (segments.some(segment => {
    try { return [".", ".."].includes(decodeURIComponent(segment)); }
    catch { return true; }
  })) throw new TypeError("Output route contains a noncanonical segment");
  return segments;
}

/** Localized static routes follow Writer identity; the default never gets a prefix. */
export function localePathFor(route: string, locale: string, defaultLocale: string): string {
  routeSegments(route);
  const requested = canonicalLocale(locale);
  const primary = canonicalLocale(defaultLocale);
  return requested === primary ? route : `/${requested.toLowerCase()}${route === "/" ? "" : route}`;
}

function normalizedUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim() || !/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function normalizedOrigin(value: unknown): string | undefined {
  // Check the authored form too: URL normalization must not hide a path or empty query.
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f]/.test(value)
    || !/^https?:\/\/[^/?#\\@]+\/?$/i.test(value)) return undefined;
  const normalized = normalizedUrl(value);
  if (normalized === undefined) return undefined;
  const url = new URL(normalized);
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : undefined;
}

/** Build metadata only from declared static output and explicit body-locale evidence. */
export function buildLocaleRoutePlan(slot: ContentSlot, options: LocaleRouteOptions): LocaleRoutePlan {
  const findings: LocaleRouteFinding[] = [];
  const issue = (path: string, rule: string, message: string, severity: "error" | "warning" = "error"): void => {
    findings.push({ path, rule, message, severity });
  };
  const finish = (pages: readonly LocalePageMetadata[]): LocaleRoutePlan => ({
    ready: !findings.some(finding => finding.severity === "error"), pages, findings,
  });
  const { workspace, manifest } = options;
  const defaultLocale = workspace.defaultLocale;
  try {
    if (canonicalLocale(defaultLocale) !== defaultLocale) throw new TypeError("Noncanonical default locale");
  } catch {
    issue("workspace.defaultLocale", "non-canonical-locale", "The workspace default must use Writer canonical locale identity");
    return finish([]);
  }
  try {
    // Writer owns manifest validation and all fallback semantics.
    fallbackChain(defaultLocale, manifest);
  } catch {
    issue("manifest", "writer-manifest", "A canonical Writer locale manifest is required");
    return finish([]);
  }
  if (defaultLocale !== manifest.defaultLocale) {
    issue("workspace.defaultLocale", "default-locale-mismatch", "Workspace and Writer defaults must match");
  }
  if (!slot.locales.includes(defaultLocale)) {
    issue("slot.locales", "default-locale-membership", "The default locale must be a declared slot locale");
  }

  const selected = typeof slot.deployTarget === "string" && slot.deployTarget.trim()
    ? workspace.deployTargets.filter(target => target.id === slot.deployTarget) : [];
  const target = selected.length === 1 ? selected[0] : undefined;
  if (!target) {
    issue("slot.deployTarget", "deploy-target", "A unique selected workspace deploy target is required");
    return finish([]);
  }
  const origin = normalizedOrigin(target.origin);
  if (origin === undefined) {
    issue("workspace.deployTargets.origin", "deploy-origin", "The selected deploy target requires an absolute HTTP(S) origin without credentials, path, query or fragment");
    return finish([]);
  }
  const route = slot.route;
  try { routeSegments(route as string); }
  catch {
    issue("slot.route", "route", "A canonical absolute route path is required");
    return finish([]);
  }

  const published: string[] = [];
  const seen = new Set<string>();
  for (const [index, locale] of slot.locales.entries()) {
    const path = `slot.locales[${index}]`;
    try {
      if (canonicalLocale(locale) !== locale) {
        issue(path, "non-canonical-locale", "Stored locale tags must use Writer canonical identity");
        continue;
      }
    } catch {
      issue(path, "locale", "A valid Writer locale tag is required");
      continue;
    }
    if (seen.has(locale)) {
      issue(path, "duplicate-locale", "Slot locale tags must be unique");
      continue;
    }
    seen.add(locale);
    const declaration = manifest.locales.find(entry => entry.tag === locale);
    if (declaration === undefined) {
      issue(path, "writer-locale", "Slot locales must be declared by Writer");
      continue;
    }
    if (declaration.state !== "active") {
      issue(path, "unpublished-locale", "Only active Writer locales may publish static pages");
      continue;
    }
    if (!workspace.locales.includes(locale)) {
      issue(path, "workspace-locale", "Slot locales must be declared in the workspace");
      continue;
    }
    published.push(locale);
  }

  const canonical = slot.meta?.canonical;
  const explicitCanonicals = new Map<string, unknown>();
  if (typeof canonical === "string") explicitCanonicals.set(defaultLocale, canonical);
  else if (canonical !== undefined) {
    if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
      issue("slot.meta.canonical", "canonical-url", "Canonical policy must be a URL or a locale URL map");
    } else {
      if (Object.keys(canonical).length === 0) {
        issue("slot.meta.canonical", "canonical-url", "Canonical locale URL maps must contain at least one entry");
      }
      for (const [locale, url] of Object.entries(canonical)) {
        let valid = false;
        try { valid = canonicalLocale(locale) === locale && slot.locales.includes(locale); } catch { /* Report below. */ }
        if (!valid) {
          issue(`slot.meta.canonical.${locale}`, "canonical-locale", "Canonical map keys must be canonical declared slot locales");
        } else explicitCanonicals.set(locale, url);
      }
    }
  }
  // Validate every policy entry, including entries for locales that cannot be published.
  for (const [locale, url] of explicitCanonicals) {
    const normalized = normalizedUrl(url);
    if (normalized === undefined) {
      issue(`slot.meta.canonical.${locale}`, "canonical-url", "Explicit canonicals must be absolute HTTP(S) URLs without credentials");
      continue;
    }
    const expected = new URL(localePathFor(route as string, locale, defaultLocale), origin).href;
    if (normalized !== expected) {
      issue(`slot.meta.canonical.${locale}`, "canonical-self", "An explicit canonical must equal this locale's own static target URL");
    }
  }

  const inventory = new Set((Array.isArray(options.existingUrls) ? options.existingUrls : []).flatMap(value => {
    const normalized = normalizedUrl(value);
    return normalized === undefined ? [] : [normalized];
  }));
  const pages: LocalePageMetadata[] = published.map(locale => {
    const path = localePathFor(route as string, locale, defaultLocale);
    const url = new URL(path, origin).href;
    let eligible = true;
    const evidence = options.bodyServedLocales;
    const served = evidence !== null && typeof evidence === "object" && Object.hasOwn(evidence, locale) ? evidence[locale] : undefined;
    if (!Array.isArray(served)) {
      eligible = false;
      issue(`bodyServedLocales.${locale}`, "body-locale-coverage", "Explicit served-locale evidence is required for every localized body");
    } else {
      const chain = fallbackChain(locale, manifest);
      let fallback = false;
      for (const tag of served) {
        let valid = false;
        try {
          valid = canonicalLocale(tag) === tag && chain.includes(tag)
            && manifest.locales.some(declaration => declaration.tag === tag && declaration.state === "active");
        } catch { /* Report below. */ }
        if (!valid) {
          eligible = false;
          issue(`bodyServedLocales.${locale}`, "body-locale-invalid", "Served locales must be active canonical members of the requested Writer fallback chain");
        } else if (tag !== locale) fallback = true;
      }
      if (fallback) {
        eligible = false;
        issue(`bodyServedLocales.${locale}`, "body-locale-fallback", "Fallback body copy excludes this page from hreflang alternates", "warning");
      }
    }
    if (!inventory.has(url)) {
      eligible = false;
      issue(`existingUrls.${locale}`, "hreflang-target-missing", "The declared localized target is absent from the static output inventory");
    }
    const encode = (segment: string): string => encodeURIComponent(segment).replace(/\./g, "%2E");
    const outputPath = [encode(target.id), "app", ...routeSegments(path).map(encode), "page.tsx"].join("/");
    return { locale, path, url, canonical: url, outputPath, hreflangEligible: eligible, alternates: [] };
  });
  const eligible = pages.filter(page => page.hreflangEligible);
  const alternates: HreflangAlternate[] = eligible.map(page => ({ hreflang: page.locale, href: page.url }));
  const primary = eligible.find(page => page.locale === defaultLocale);
  if (primary) alternates.push({ hreflang: "x-default", href: primary.url });
  else issue("slot.locales", "hreflang-default-missing", "x-default requires an existing native default-locale target");
  return finish(pages.map(page => ({ ...page, alternates: page.hreflangEligible ? alternates : [] })));
}

/** Sitemap entries reuse the same bounded, reciprocal eligible set as page metadata. */
export function buildSitemapAlternates(plan: LocaleRoutePlan): readonly SitemapLocaleEntry[] {
  if (!plan.ready) return [];
  return plan.pages.filter(page => page.hreflangEligible).map(page => ({ url: page.url, alternates: page.alternates }));
}
