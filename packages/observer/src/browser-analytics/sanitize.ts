/**
 * Redaction for analytics events (C-20). Pure functions of their
 * arguments: no global is read, nothing is sent.
 *
 * - A URL keeps its origin and path and loses its query, fragment and any
 *   embedded credentials. Only `http:` and `https:` URLs are kept.
 * - A host-supplied `normalizePath` runs on the path. Its result is used only
 *   if it is a string that starts with `/` and contains no `?` or `#`;
 *   otherwise, or if it throws, the event is dropped.
 * - The referrer is reduced to its origin.
 * - Only pageviews and allowlisted conversions pass. A conversion name that
 *   begins with `$` is refused even when allowlisted, so it can never
 *   collide with a provider's reserved event names.
 * - Conversion properties are allowlisted per event name. A property name
 *   that begins with `$` is refused for the same reason. Values must be
 *   bounded primitives: a finite number, a boolean, or a string of at most
 *   `MAX_PROPERTY_STRING_LENGTH` characters. Anything else is dropped.
 */

import type { AnalyticsLocation, NormalizePath, SanitizedAnalyticsEvent } from "./types.js";

/** Longest string property value that is kept. Longer values are dropped, never truncated. */
export const MAX_PROPERTY_STRING_LENGTH = 200;

/** What a sanitizer allows through. */
export interface AnalyticsAllowlist {
  conversions: readonly string[];
  properties?: Readonly<Record<string, readonly string[]>>;
  normalizePath?: NormalizePath;
}

/** Input to `sanitizeAnalyticsEvent`. */
export interface AnalyticsEventInput {
  kind: "pageview" | "conversion";
  name?: string;
  location: AnalyticsLocation;
  properties?: Record<string, unknown>;
}

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

function parseWebUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return WEB_PROTOCOLS.has(url.protocol) ? url : null;
}

/** True for a conversion or property name the transport may send. */
export function isSendableName(name: unknown): name is string {
  return typeof name === "string" && name !== "" && !name.startsWith("$");
}

/**
 * Builds the transport's URL sanitizer: origin and normalized path only, or
 * `null` when the URL or the normalized path is not acceptable. It takes a
 * full URL, never a bare path.
 */
export function createUrlSanitizer(normalizePath?: NormalizePath): (href: string) => string | null {
  return (href: string): string | null => {
    const url = parseWebUrl(href);
    if (!url) return null;
    let path: unknown = url.pathname;
    if (normalizePath) {
      try {
        path = normalizePath(url.pathname);
      } catch {
        return null;
      }
    }
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#")) return null;
    // Concatenate onto the origin, never resolve against it, so a path such
    // as "//elsewhere" cannot change the host. Re-parse to canonical form.
    const rebuilt = parseWebUrl(`${url.origin}${path}`);
    if (!rebuilt || rebuilt.origin !== url.origin || rebuilt.search !== "" || rebuilt.hash !== "") return null;
    return `${rebuilt.origin}${rebuilt.pathname}`;
  };
}

/** The referrer's origin, or `undefined` when there is no usable referrer. */
export function referrerOrigin(referrer: unknown): string | undefined {
  const url = parseWebUrl(referrer);
  return url ? url.origin : undefined;
}

function boundedPrimitive(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_PROPERTY_STRING_LENGTH;
  return false;
}

function allowedProperties(
  names: readonly string[] | undefined,
  input: Record<string, unknown> | undefined,
): Readonly<Record<string, string | number | boolean>> {
  const out: Record<string, string | number | boolean> = {};
  if (!names || !input || typeof input !== "object") return Object.freeze(out);
  for (const name of names) {
    if (!isSendableName(name) || !Object.prototype.hasOwnProperty.call(input, name)) continue;
    const value = input[name];
    if (boundedPrimitive(value)) out[name] = value;
  }
  return Object.freeze(out);
}

/**
 * Redacts one event, or returns `null` when it must not be sent. The result
 * is frozen and is the only shape that ever reaches a provider.
 */
export function sanitizeAnalyticsEvent(input: AnalyticsEventInput, allow: AnalyticsAllowlist): SanitizedAnalyticsEvent | null {
  const url = createUrlSanitizer(allow.normalizePath)(input.location.href);
  if (url === null) return null;
  const origin = referrerOrigin(input.location.referrer);

  if (input.kind === "pageview") {
    const properties: Readonly<Record<string, never>> = Object.freeze({});
    return Object.freeze(origin === undefined ? { kind: "pageview", url, properties } : { kind: "pageview", url, referrerOrigin: origin, properties });
  }

  if (input.kind !== "conversion") return null;
  const name = input.name;
  if (!isSendableName(name) || !allow.conversions.includes(name)) return null;
  const names = allow.properties && Object.prototype.hasOwnProperty.call(allow.properties, name) ? allow.properties[name] : undefined;
  const properties = allowedProperties(Array.isArray(names) ? names : undefined, input.properties);
  return Object.freeze(
    origin === undefined
      ? { kind: "conversion", name, url, properties }
      : { kind: "conversion", name, url, referrerOrigin: origin, properties },
  );
}
