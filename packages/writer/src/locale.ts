import type { WriterManifest } from "./model/types.js";

type Direction = "ltr" | "rtl";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Accept one locale tag, without coercing arrays or other runtime values. */
export function canonicalLocale(tag: unknown): string {
  if (typeof tag !== "string") throw new TypeError("Expected a locale tag string");
  const canonical = Intl.getCanonicalLocales(tag);
  if (canonical.length !== 1 || typeof canonical[0] !== "string") throw new RangeError("Expected exactly one valid locale tag");
  return canonical[0];
}

function storedLocale(tag: unknown): string {
  const canonical = canonicalLocale(tag);
  if (canonical !== tag) throw new RangeError("Manifest locale tags must be canonical");
  return canonical;
}

function declaredLocales(locales: unknown): Set<string> {
  if (!Array.isArray(locales)) throw new TypeError("Expected manifest locales to be an array");
  const declared = new Set<string>();
  for (const locale of locales) {
    if (!object(locale)) throw new TypeError("Expected a manifest locale declaration");
    const tag = storedLocale(locale.tag);
    if (declared.has(tag)) throw new RangeError("Manifest locale declarations must be unique");
    declared.add(tag);
  }
  return declared;
}

/** Explicit fallback order replaces automatic truncation, including an empty list. */
export function fallbackChain(
  requested: string,
  manifest: Pick<WriterManifest, "defaultLocale" | "locales" | "fallback">,
): string[] {
  const target = canonicalLocale(requested);
  if (!object(manifest)) throw new TypeError("Expected a Writer manifest");
  const declared = declaredLocales(manifest.locales);
  const defaultLocale = storedLocale(manifest.defaultLocale);
  if (!object(manifest.fallback)) throw new TypeError("Expected a manifest fallback map");

  let explicit: string[] | undefined;
  // Read own entries only: an inherited entry cannot authorize a fallback.
  for (const key of Object.getOwnPropertyNames(manifest.fallback)) {
    storedLocale(key);
    const values: unknown = manifest.fallback[key];
    if (!Array.isArray(values)) throw new TypeError("Expected a manifest fallback array");
    const canonical: string[] = [];
    for (const value of values) canonical.push(storedLocale(value));
    if (key === target) explicit = canonical;
  }

  const chain: string[] = [];
  const seen = new Set<string>();
  const append = (tag: string): void => {
    if (declared.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      chain.push(tag);
    }
  };
  append(target);
  if (explicit !== undefined) {
    for (const tag of explicit) append(tag);
  } else {
    const script = new Intl.Locale(target).maximize().script;
    const subtags = target.split("-");
    while (subtags.length > 1) {
      subtags.pop();
      // RFC 4647 removes an extension singleton with its last following subtag.
      while (subtags[subtags.length - 1]?.length === 1) subtags.pop();
      const candidate = subtags.join("-");
      if (script !== undefined && new Intl.Locale(candidate).maximize().script === script) append(candidate);
    }
  }
  append(defaultLocale);
  return chain;
}

/** Rendering direction comes only from the declared manifest value. */
export function directionFor(locale: string, manifest: Pick<WriterManifest, "locales">): Direction {
  const target = canonicalLocale(locale);
  if (!object(manifest) || !Array.isArray(manifest.locales)) throw new TypeError("Expected manifest locales to be an array");
  let direction: Direction | undefined;
  let matches = 0;
  for (const declaration of manifest.locales) {
    if (!object(declaration)) throw new TypeError("Expected a manifest locale declaration");
    if (storedLocale(declaration.tag) !== target) continue;
    matches += 1;
    if (declaration.dir !== "ltr" && declaration.dir !== "rtl") throw new TypeError("Expected a manifest direction of ltr or rtl");
    direction = declaration.dir;
  }
  if (matches !== 1 || direction === undefined) throw new RangeError("Expected exactly one declared locale direction");
  return direction;
}

/** Validation aid only; runtime rendering must use directionFor instead. */
export function intlDirectionFor(tag: string): Direction | undefined {
  const canonical = canonicalLocale(tag);
  type DirectionLocale = Intl.Locale & {
    getTextInfo?: () => { direction?: unknown };
    textInfo?: { direction?: unknown };
  };
  try {
    const locale = new Intl.Locale(canonical) as DirectionLocale;
    const info = typeof locale.getTextInfo === "function" ? locale.getTextInfo() : locale.textInfo;
    return info?.direction === "ltr" || info?.direction === "rtl" ? info.direction : undefined;
  } catch {
    return undefined;
  }
}
