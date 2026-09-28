/**
 * Builds one complete, framework-agnostic head set (title, description,
 * canonical, robots, theme colour, Open Graph, Twitter card) for one page of
 * a site from two plain typed inputs: the site's identity and the page's own
 * facts. The output is plain data with no `undefined` keys, so a caller maps
 * it onto whatever head API its framework has; this module never emits HTML.
 *
 * Every page kind yields the same set of keys — a `notFound` or draft legal
 * page differs from a `home` page only in its `title` form and its `robots`
 * value, never in which fields exist.
 *
 * TITLE RULE. A `home` page is `${name} · ${tagline}`; every other kind is
 * `${label} · ${name}`. The separator is U+00B7 with one space on each side.
 *
 * ROBOTS. `notFound` is `noindex, nofollow`. `legal` is `noindex, nofollow`
 * until the page's `status` is `"counsel-reviewed"`; a legal page with no
 * `status` is treated as a draft. `home`, `contact` and `custom` are
 * `index, follow`. This module only maps the `status` it is given to a
 * robots value; it does not decide, verify, or store whether counsel
 * reviewed anything.
 *
 * FAIL CLOSED, NEVER GUESS. Every input problem throws a
 * `SiteMetadataError` carrying a closed `reason`; nothing is repaired or
 * normalized. Text values are only checked to be non-blank
 * strings and are emitted VERBATIM — nothing is trimmed, collapsed, or
 * re-cased, so a value with leading or trailing whitespace comes out with
 * it. The share card must be exactly the size `OG_SHARE_CARD_SPEC` declares
 * (any other dimensions, including swapped ones, are refused).
 *
 * This module takes no brand-facts record and does not call the Writer
 * package; a caller supplies plain values. It reads no environment, does no
 * I/O, and does not mutate its input.
 */

import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";

export type SitePageKind = "home" | "contact" | "legal" | "notFound" | "custom";

/** Whether a legal page's text has been through counsel review. Only meaningful for `kind: "legal"`. */
export type SiteLegalStatus = "draft" | "counsel-reviewed";

export interface SiteShareCard {
  /** An absolute `http(s)` URL, or a root-relative path starting with a single `/` (resolved against the site origin). */
  url: string;
  alt: string;
  /** Must be an integer equal to `OG_SHARE_CARD_SPEC.widthPx`. */
  width: number;
  /** Must be an integer equal to `OG_SHARE_CARD_SPEC.heightPx`. */
  height: number;
}

export interface SiteIdentityInput {
  name: string;
  tagline: string;
  /** An absolute `http(s)` origin: equal to `new URL(origin).origin` — no path, query, hash, trailing slash, or credentials. */
  origin: string;
  themeColor: string;
  locale: string;
  shareCard: SiteShareCard;
}

export interface SitePageInput {
  kind: SitePageKind;
  /** The page's short name, used in the title of every kind except `home`. */
  label: string;
  description: string;
  /** Starts with a single `/`; no `?`, `#`, whitespace, or `..` segment. */
  path: string;
  /** Allowed only on `kind: "legal"`; a missing status there is a draft. */
  status?: SiteLegalStatus;
}

export interface SiteOpenGraphMetadata {
  title: string;
  description: string;
  url: string;
  siteName: string;
  type: "website";
  locale: string;
  image: { url: string; alt: string; width: number; height: number };
}

export interface SiteTwitterMetadata {
  card: "summary_large_image";
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}

export interface SiteMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  themeColor: string;
  /** The site origin, for frameworks that resolve relative URLs against a base. */
  metadataBase: string;
  locale: string;
  openGraph: SiteOpenGraphMetadata;
  twitter: SiteTwitterMetadata;
}

export type SiteMetadataErrorReason =
  | "invalid-input"
  | "invalid-origin"
  | "invalid-path"
  | "invalid-share-card"
  | "share-card-size"
  | "invalid-kind"
  | "invalid-status";

export class SiteMetadataError extends Error {
  readonly reason: SiteMetadataErrorReason;

  constructor(reason: SiteMetadataErrorReason, message: string) {
    super(message);
    this.name = "SiteMetadataError";
    this.reason = reason;
  }
}

const PAGE_KINDS: readonly SitePageKind[] = ["home", "contact", "legal", "notFound", "custom"];
const TITLE_SEPARATOR = " · ";
const NOINDEX = "noindex, nofollow";
const INDEX = "index, follow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SiteMetadataError("invalid-input", `${field} must be a non-blank string.`);
  }
  return value;
}

/** True when `text` has whitespace, a control character, or a backslash — none of which a path or URL here may carry. */
function hasUnsafeCharacter(text: string): boolean {
  return /[\s\u0000-\u001f\u007f\\]/.test(text);
}

function hasDotDotSegment(pathname: string): boolean {
  return pathname.split("/").includes("..");
}

function requireOrigin(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new SiteMetadataError("invalid-origin", "site.origin must be an absolute http(s) origin string.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SiteMetadataError("invalid-origin", "site.origin must be an absolute http(s) origin.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== value) {
    throw new SiteMetadataError(
      "invalid-origin",
      "site.origin must be an http(s) origin with no path, query, hash, trailing slash, credentials, or normalizable spelling.",
    );
  }
  return value;
}

function requirePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    hasUnsafeCharacter(value) ||
    hasDotDotSegment(value)
  ) {
    throw new SiteMetadataError(
      "invalid-path",
      "page.path must start with a single '/' and contain no '?', '#', whitespace, backslash, or '..' segment.",
    );
  }
  return value;
}

function requireKind(value: unknown): SitePageKind {
  if (typeof value !== "string" || !PAGE_KINDS.includes(value as SitePageKind)) {
    throw new SiteMetadataError("invalid-kind", `page.kind must be one of ${PAGE_KINDS.join(", ")}.`);
  }
  return value as SitePageKind;
}

function requireStatus(kind: SitePageKind, value: unknown): SiteLegalStatus | undefined {
  if (value === undefined) return undefined;
  if (kind !== "legal") {
    throw new SiteMetadataError("invalid-status", `page.status is only allowed on a legal page, not on "${kind}".`);
  }
  if (value !== "draft" && value !== "counsel-reviewed") {
    throw new SiteMetadataError("invalid-status", 'page.status must be "draft" or "counsel-reviewed".');
  }
  return value;
}

/** Resolves a share card url to an absolute one: an absolute http(s) url as given, or a root-relative path joined to the origin. */
function resolveShareCardUrl(value: unknown, origin: string): string {
  const refuse = (): never => {
    throw new SiteMetadataError(
      "invalid-share-card",
      "site.shareCard.url must be an absolute http(s) URL or a root-relative path starting with a single '/'.",
    );
  };
  if (typeof value !== "string" || value === "" || hasUnsafeCharacter(value)) return refuse();
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return refuse();
    const pathname = value.split(/[?#]/, 1)[0] ?? "";
    if (hasDotDotSegment(pathname)) return refuse();
    return `${origin}${value}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return refuse();
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
    return refuse();
  }
  return value;
}

function requireShareCard(value: unknown, origin: string): SiteShareCard {
  if (!isRecord(value)) {
    throw new SiteMetadataError("invalid-share-card", "site.shareCard must be an object.");
  }
  const alt = requireText(value["alt"], "site.shareCard.alt");
  const url = resolveShareCardUrl(value["url"], origin);
  const { widthPx, heightPx } = OG_SHARE_CARD_SPEC;
  const width = value["width"];
  const height = value["height"];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width !== widthPx || height !== heightPx) {
    throw new SiteMetadataError(
      "share-card-size",
      `site.shareCard must be ${widthPx}x${heightPx} pixels (OG_SHARE_CARD_SPEC); received width ${String(width)} and height ${String(height)}.`,
    );
  }
  return { url, alt, width: widthPx, height: heightPx };
}

function robotsFor(kind: SitePageKind, status: SiteLegalStatus | undefined): string {
  if (kind === "notFound") return NOINDEX;
  if (kind === "legal") return status === "counsel-reviewed" ? INDEX : NOINDEX;
  return INDEX;
}

export function buildSiteMetadata(input: { site: SiteIdentityInput; page: SitePageInput }): SiteMetadata {
  if (!isRecord(input)) throw new SiteMetadataError("invalid-input", "buildSiteMetadata input must be an object.");
  const site: unknown = input["site"];
  const page: unknown = input["page"];
  if (!isRecord(site)) throw new SiteMetadataError("invalid-input", "input.site must be an object.");
  if (!isRecord(page)) throw new SiteMetadataError("invalid-input", "input.page must be an object.");

  const name = requireText(site["name"], "site.name");
  const tagline = requireText(site["tagline"], "site.tagline");
  const themeColor = requireText(site["themeColor"], "site.themeColor");
  const locale = requireText(site["locale"], "site.locale");
  const origin = requireOrigin(site["origin"]);
  const label = requireText(page["label"], "page.label");
  const description = requireText(page["description"], "page.description");
  const kind = requireKind(page["kind"]);
  const path = requirePath(page["path"]);
  const status = requireStatus(kind, page["status"]);
  const shareCard = requireShareCard(site["shareCard"], origin);

  const title = kind === "home" ? `${name}${TITLE_SEPARATOR}${tagline}` : `${label}${TITLE_SEPARATOR}${name}`;
  const canonical = `${origin}${path}`;

  return {
    title,
    description,
    canonical,
    robots: robotsFor(kind, status),
    themeColor,
    metadataBase: origin,
    locale,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: name,
      type: "website",
      locale,
      image: { url: shareCard.url, alt: shareCard.alt, width: shareCard.width, height: shareCard.height },
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      image: shareCard.url,
      imageAlt: shareCard.alt,
    },
  };
}
