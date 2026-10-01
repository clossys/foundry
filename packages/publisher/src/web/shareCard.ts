/**
 * Builds the site share card: a React element sized exactly to
 * `OG_SHARE_CARD_SPEC`, ready for an image-response API, plus the
 * `SiteShareCard` record `buildSiteMetadata` takes for the same card. It is
 * framework-neutral and server-safe: it renders nothing, rasterises nothing,
 * loads no font, and fetches nothing.
 *
 * TEXT. `name` and `tagline` are the same plain values `buildSiteMetadata`
 * takes and follow its title-text rule; `alt` is supplied by the caller. No
 * text comes from a copy registry and none is built in: the caller owns the
 * approval of every word on the card. Text is emitted verbatim, never trimmed
 * or collapsed, and a value that would need repair is refused.
 *
 * COLOUR. Every colour is a Designer role token resolved through
 * `buildFlatTokenMap(tokenOverrides)`. A role that does not resolve to a
 * concrete `#rrggbb[aa]` colour is refused; nothing falls back to a literal.
 *
 * MARK. An optional mark is accepted only as an inline `data:image/svg+xml`
 * or `data:image/png;base64` URL with an explicit integer size. Any other
 * source (remote, protocol-relative, relative, `javascript:`, another data
 * type) is refused, so the card can never trigger a fetch. The content of an
 * accepted mark is not inspected.
 *
 * STRUCTURE. Inline styles only: no class names, no CSS custom properties,
 * and `display: flex` on every element that has more than one child (the
 * layout subset image-response renderers support). The output is a pure
 * function of the input, so equal input renders equal markup.
 *
 * FAIL CLOSED. Every input problem throws a `ShareCardError` with a closed
 * `reason`. The error text is fixed per reason and never echoes input.
 */

import { createElement, type CSSProperties, type ReactElement } from "react";
import { BADGE_INSET_SHARE, BADGE_RADIUS_SHARE } from "@clossys/designer/shell/server";
import { LOCKUP_GAP_RATIO, LOCKUP_WORDMARK_SIZE_RATIO } from "@clossys/designer/tokens";
import { RenderError } from "../internal/errors.js";
import { buildFlatTokenMap, resolveColorRole } from "../image/engine.js";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import type { SiteShareCard } from "./siteMetadata.js";

export type ShareCardErrorReason =
  | "invalid-input"
  | "blank-text"
  | "surrounding-whitespace"
  | "control-character"
  | "invalid-path"
  | "invalid-token-override"
  | "unresolvable-role"
  | "invalid-mark-source"
  | "invalid-mark-size";

const REASON_MESSAGES: Record<ShareCardErrorReason, string> = {
  "invalid-input": "The share card input is not shaped as documented.",
  "blank-text": "A text field must be a non-blank string.",
  "surrounding-whitespace": "A text field must not start or end with whitespace.",
  "control-character": "A text field must not contain a tab, line break or other control character.",
  "invalid-path": "path must be a root-relative path in normal URL form with no query, fragment, or dot segment.",
  "invalid-token-override": "tokenOverrides names a token the Designer registry does not allow to be overridden.",
  "unresolvable-role": "a colour role does not resolve to a concrete #rrggbb colour.",
  "invalid-mark-source": "The mark source must be an inline data:image/svg+xml or data:image/png;base64 URL.",
  "invalid-mark-size": "The mark width and height must be positive integers no larger than the card height.",
};

export class ShareCardError extends Error {
  readonly reason: ShareCardErrorReason;

  constructor(reason: ShareCardErrorReason) {
    super(REASON_MESSAGES[reason]);
    this.name = "ShareCardError";
    this.reason = reason;
  }
}

/** The Designer colour roles the card reads, by use. */
export interface ShareCardRoles {
  /** The card background. Default `--color-surface-base`. */
  background?: string;
  /** The `name` text. Default `--color-ink-primary`. */
  name?: string;
  /** The `tagline` text. Default `--color-ink-secondary`. */
  tagline?: string;
  /** The rule between mark and text. Default `--color-accent`. */
  accent?: string;
}

export interface ShareCardMark {
  /** An inline `data:image/svg+xml` or `data:image/png;base64` URL. */
  src: string;
  /** Integer pixels, at most the card height. */
  width: number;
  /** Integer pixels, at most the card height. */
  height: number;
}

export interface ShareCardInput {
  /** Same text rule as `buildSiteMetadata`'s `site.name`. */
  name: string;
  /** Same text rule as `buildSiteMetadata`'s `site.tagline`. */
  tagline: string;
  /** The image's alternative text, supplied by the caller. */
  alt: string;
  /** The card's root-relative route. Default `/opengraph-image`. */
  path?: string;
  /** Brand overrides for `buildFlatTokenMap`. */
  tokenOverrides?: Record<string, string>;
  /** Colour roles to read; each defaults as documented on `ShareCardRoles`. */
  roles?: ShareCardRoles;
  mark?: ShareCardMark;
}

export interface ShareCard {
  /** A React element of exactly `OG_SHARE_CARD_SPEC` size, for an image-response API. */
  element: ReactElement;
  width: number;
  height: number;
  contentType: "image/png";
  /** The record to pass as `site.shareCard` to `buildSiteMetadata`. */
  shareCard: SiteShareCard;
}

export const SHARE_CARD_DEFAULT_PATH = "/opengraph-image";

export const SHARE_CARD_DEFAULT_ROLES: Readonly<Required<ShareCardRoles>> = Object.freeze({
  background: "--color-surface-base",
  name: "--color-ink-primary",
  tagline: "--color-ink-secondary",
  accent: "--color-accent",
});

const ROLE_NAME_RE = /^--[a-z][a-z0-9-]*$/;
const CONCRETE_COLOUR_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const SVG_BASE64_DATA_URL_RE = /^data:image\/svg\+xml(?:;charset=utf-8)?;base64,[A-Za-z0-9+/]+={0,2}$/i;
const SVG_ENCODED_DATA_URL_RE = /^data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,[A-Za-z0-9%._~!*'()\-:@,;$&+/=?]+$/i;
const MAX_MARK_SRC_LENGTH = 262_144;
/** A stand-in origin, used only to check that a path is in normal URL form. */
const NORMAL_FORM_ORIGIN = "https://card.invalid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown): string {
  if (typeof value !== "string") throw new ShareCardError("invalid-input");
  if (value.trim() === "") throw new ShareCardError("blank-text");
  if (CONTROL_RE.test(value)) throw new ShareCardError("control-character");
  if (value !== value.trim()) throw new ShareCardError("surrounding-whitespace");
  return value;
}

function requirePath(value: unknown): string {
  if (value === undefined) return SHARE_CARD_DEFAULT_PATH;
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[?#\s\\\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").includes("..") ||
    value.split("/").slice(1, -1).includes("")
  ) {
    throw new ShareCardError("invalid-path");
  }
  let normal: boolean;
  try {
    normal = new URL(`${NORMAL_FORM_ORIGIN}${value}`).href === `${NORMAL_FORM_ORIGIN}${value}`;
  } catch {
    normal = false;
  }
  if (!normal) throw new ShareCardError("invalid-path");
  return value;
}

function requireTokenOverrides(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new ShareCardError("invalid-input");
  }
  return value as Record<string, string>;
}

function requireRoles(value: unknown): Required<ShareCardRoles> {
  if (value === undefined) return { ...SHARE_CARD_DEFAULT_ROLES };
  if (!isRecord(value)) throw new ShareCardError("invalid-input");
  const roles: Required<ShareCardRoles> = { ...SHARE_CARD_DEFAULT_ROLES };
  for (const key of Object.keys(SHARE_CARD_DEFAULT_ROLES) as Array<keyof ShareCardRoles>) {
    const given = value[key];
    if (given === undefined) continue;
    if (typeof given !== "string") throw new ShareCardError("invalid-input");
    roles[key] = given;
  }
  return roles;
}

function resolveRole(role: string, flat: ReadonlyMap<string, string>): string {
  if (!ROLE_NAME_RE.test(role)) throw new ShareCardError("unresolvable-role");
  let resolved: string;
  try {
    resolved = resolveColorRole(role, flat, "");
  } catch (error) {
    if (error instanceof RenderError) throw new ShareCardError("unresolvable-role");
    throw error;
  }
  if (!CONCRETE_COLOUR_RE.test(resolved)) throw new ShareCardError("unresolvable-role");
  return resolved;
}

function requireMarkSrc(src: unknown): string {
  if (
    typeof src !== "string" ||
    src.length > MAX_MARK_SRC_LENGTH ||
    !(PNG_DATA_URL_RE.test(src) || SVG_BASE64_DATA_URL_RE.test(src) || SVG_ENCODED_DATA_URL_RE.test(src))
  ) {
    throw new ShareCardError("invalid-mark-source");
  }
  return src;
}

function requireMark(value: unknown): ShareCardMark | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ShareCardError("invalid-input");
  const src = requireMarkSrc(value["src"]);
  const width = value["width"];
  const height = value["height"];
  const max = OG_SHARE_CARD_SPEC.heightPx;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > max ||
    height > max
  ) {
    throw new ShareCardError("invalid-mark-size");
  }
  return { src, width, height };
}

const PADDING_PX = 96;
const ACCENT_RULE: CSSProperties = { display: "flex", width: 96, height: 8, marginTop: 40, marginBottom: 40 };

export function buildShareCard(input: ShareCardInput): ShareCard {
  if (!isRecord(input)) throw new ShareCardError("invalid-input");

  const name = requireText(input["name"]);
  const tagline = requireText(input["tagline"]);
  const alt = requireText(input["alt"]);
  const path = requirePath(input["path"]);
  const overrides = requireTokenOverrides(input["tokenOverrides"]);
  const roles = requireRoles(input["roles"]);
  const mark = requireMark(input["mark"]);

  let flat: Map<string, string>;
  try {
    flat = buildFlatTokenMap(overrides);
  } catch (error) {
    if (error instanceof RenderError) throw new ShareCardError("invalid-token-override");
    throw error;
  }

  const background = resolveRole(roles.background, flat);
  const nameColour = resolveRole(roles.name, flat);
  const taglineColour = resolveRole(roles.tagline, flat);
  const accent = resolveRole(roles.accent, flat);

  const { widthPx, heightPx } = OG_SHARE_CARD_SPEC;

  const children: ReactElement[] = [];
  if (mark !== undefined) {
    children.push(
      createElement("img", {
        key: "mark",
        src: mark.src,
        width: mark.width,
        height: mark.height,
        alt: "",
        style: { display: "flex", width: mark.width, height: mark.height, marginBottom: 40 },
      }),
    );
  }
  children.push(
    createElement("div", { key: "name", style: { display: "flex", fontSize: 88, lineHeight: 1.1, fontWeight: 700, color: nameColour } }, name),
    createElement("div", { key: "rule", style: { ...ACCENT_RULE, backgroundColor: accent } }),
    createElement("div", { key: "tagline", style: { display: "flex", fontSize: 40, lineHeight: 1.3, color: taglineColour } }, tagline),
  );

  const element = createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: widthPx,
        height: heightPx,
        padding: PADDING_PX,
        boxSizing: "border-box",
        backgroundColor: background,
      } satisfies CSSProperties,
    },
    ...children,
  );

  return {
    element,
    width: widthPx,
    height: heightPx,
    contentType: "image/png",
    shareCard: { url: path, alt, width: widthPx, height: heightPx },
  };
}

/** The Designer colour roles the brand share card reads, by use. */
export interface BrandShareCardRoles {
  /** The card background. Default `--color-surface-base`. */
  background?: string;
  /** The plate behind the mark. Default `--color-ink-primary`. */
  plate?: string;
  /** The `wordmark` text. Default `--color-ink-primary`. */
  wordmark?: string;
  /** The `kicker` text and the rule before it. Default `--color-ink-secondary`. */
  kicker?: string;
  /** The `headline` text. Default `--color-ink-primary`. */
  headline?: string;
  /** The `supporting` text. Default `--color-ink-secondary`. */
  supporting?: string;
}

export interface BrandShareCardInput {
  /** An inline `data:image/svg+xml` or `data:image/png;base64` URL, under `ShareCardMark.src`'s rule. */
  markSrc: string;
  /** The brand name beside the plate. Omit to draw the plate alone. */
  wordmark?: string;
  /** A short line after the lockup, behind a rule. */
  kicker?: string;
  /** The card's main line. */
  headline: string;
  /** A second line under the headline. */
  supporting?: string;
  /** The image's alternative text, supplied by the caller. */
  alt: string;
  /** The card's root-relative route. Default `/opengraph-image`. */
  path?: string;
  /** Brand overrides for `buildFlatTokenMap`. */
  tokenOverrides?: Record<string, string>;
  /** Colour roles to read; each defaults as documented on `BrandShareCardRoles`. */
  roles?: BrandShareCardRoles;
  /** A font family for the wordmark and headline: letters, digits, spaces and hyphens. */
  displayFontFamily?: string;
}

export const BRAND_SHARE_CARD_PLATE_PX = 96;

export const BRAND_SHARE_CARD_DEFAULT_ROLES: Readonly<Required<BrandShareCardRoles>> = Object.freeze({
  background: "--color-surface-base",
  plate: "--color-ink-primary",
  wordmark: "--color-ink-primary",
  kicker: "--color-ink-secondary",
  headline: "--color-ink-primary",
  supporting: "--color-ink-secondary",
});

const FONT_FAMILY_RE = /^[\p{L}\p{N} -]+$/u;

function requireOptionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : requireText(value);
}

function requireFontFamily(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !FONT_FAMILY_RE.test(value)) throw new ShareCardError("invalid-input");
  return value;
}

function requireBrandRoles(value: unknown): Required<BrandShareCardRoles> {
  if (value === undefined) return { ...BRAND_SHARE_CARD_DEFAULT_ROLES };
  if (!isRecord(value)) throw new ShareCardError("invalid-input");
  const roles: Required<BrandShareCardRoles> = { ...BRAND_SHARE_CARD_DEFAULT_ROLES };
  for (const key of Object.keys(BRAND_SHARE_CARD_DEFAULT_ROLES) as Array<keyof BrandShareCardRoles>) {
    const given = value[key];
    if (given === undefined) continue;
    if (typeof given !== "string") throw new ShareCardError("invalid-input");
    roles[key] = given;
  }
  return roles;
}

const KICKER_RULE_PX = 2;

/**
 * Builds the brand share card: the site-header lockup (a plated mark beside
 * the wordmark, or the plate alone) top left, then the kicker after a rule,
 * with the headline and supporting line at the bottom. The plate, wordmark
 * size and gap are computed from Designer's published geometry; the output
 * rules (size, inline styles, flex, deterministic, no fonts loaded) and the
 * refusals are those of `buildShareCard`, with no new reason.
 */
export function buildBrandShareCard(input: BrandShareCardInput): ShareCard {
  if (!isRecord(input)) throw new ShareCardError("invalid-input");

  const markSrc = requireMarkSrc(input["markSrc"]);
  const wordmark = requireOptionalText(input["wordmark"]);
  const kicker = requireOptionalText(input["kicker"]);
  const headline = requireText(input["headline"]);
  const supporting = requireOptionalText(input["supporting"]);
  const alt = requireText(input["alt"]);
  const path = requirePath(input["path"]);
  const overrides = requireTokenOverrides(input["tokenOverrides"]);
  const roles = requireBrandRoles(input["roles"]);
  const fontFamily = requireFontFamily(input["displayFontFamily"]);

  let flat: Map<string, string>;
  try {
    flat = buildFlatTokenMap(overrides);
  } catch (error) {
    if (error instanceof RenderError) throw new ShareCardError("invalid-token-override");
    throw error;
  }

  const background = resolveRole(roles.background, flat);
  const plateColour = resolveRole(roles.plate, flat);
  const wordmarkColour = resolveRole(roles.wordmark, flat);
  const kickerColour = resolveRole(roles.kicker, flat);
  const headlineColour = resolveRole(roles.headline, flat);
  const supportingColour = resolveRole(roles.supporting, flat);

  const { widthPx, heightPx } = OG_SHARE_CARD_SPEC;
  const plate = BRAND_SHARE_CARD_PLATE_PX;
  const imageSide = plate * (1 - 2 * BADGE_INSET_SHARE);
  const gap = plate * LOCKUP_GAP_RATIO;
  const family: CSSProperties = fontFamily === undefined ? {} : { fontFamily };

  const lockup: ReactElement[] = [
    createElement(
      "div",
      {
        key: "plate",
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: plate,
          height: plate,
          flexShrink: 0,
          borderRadius: plate * BADGE_RADIUS_SHARE,
          backgroundColor: plateColour,
        } satisfies CSSProperties,
      },
      createElement("img", {
        src: markSrc,
        width: imageSide,
        height: imageSide,
        alt: "",
        style: { display: "flex", width: imageSide, height: imageSide, objectFit: "contain" },
      }),
    ),
  ];
  if (wordmark !== undefined) {
    lockup.push(
      createElement(
        "div",
        {
          key: "wordmark",
          style: {
            display: "flex",
            marginLeft: gap,
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            fontSize: plate * LOCKUP_WORDMARK_SIZE_RATIO,
            lineHeight: 1,
            fontWeight: 700,
            color: wordmarkColour,
            ...family,
          } satisfies CSSProperties,
        },
        wordmark,
      ),
    );
  }

  const top: ReactElement[] = [
    createElement("div", { key: "lockup", style: { display: "flex", alignItems: "center", flexShrink: 1, minWidth: 0, maxWidth: "100%" } satisfies CSSProperties }, ...lockup),
  ];
  if (kicker !== undefined) {
    top.push(
      createElement("div", {
        key: "rule",
        style: { display: "flex", width: KICKER_RULE_PX, height: plate, marginLeft: gap, flexShrink: 0, backgroundColor: kickerColour } satisfies CSSProperties,
      }),
      createElement(
        "div",
        {
          key: "kicker",
          style: {
            display: "flex",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            marginLeft: gap,
            fontSize: 32,
            lineHeight: 1.2,
            color: kickerColour,
          } satisfies CSSProperties,
        },
        kicker,
      ),
    );
  }

  const bottom: ReactElement[] = [
    createElement(
      "div",
      {
        key: "headline",
        style: { display: "block", lineClamp: 2, overflow: "hidden", fontSize: 88, lineHeight: 1.1, fontWeight: 700, color: headlineColour, ...family } satisfies CSSProperties,
      },
      headline,
    ),
  ];
  if (supporting !== undefined) {
    bottom.push(
      createElement(
        "div",
        {
          key: "supporting",
          style: { display: "block", lineClamp: 2, overflow: "hidden", marginTop: 24, fontSize: 40, lineHeight: 1.3, color: supportingColour } satisfies CSSProperties,
        },
        supporting,
      ),
    );
  }

  const element = createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: widthPx,
        height: heightPx,
        padding: PADDING_PX,
        boxSizing: "border-box",
        backgroundColor: background,
      } satisfies CSSProperties,
    },
    createElement("div", { key: "top", style: { display: "flex", alignItems: "center" } satisfies CSSProperties }, ...top),
    createElement("div", { key: "bottom", style: { display: "flex", flexDirection: "column" } satisfies CSSProperties }, ...bottom),
  );

  return {
    element,
    width: widthPx,
    height: heightPx,
    contentType: "image/png",
    shareCard: { url: path, alt, width: widthPx, height: heightPx },
  };
}
