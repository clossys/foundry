import type { IconNode } from "@clossys/designer/components/server";
import { SITE_CHROME_GROUNDS } from "./viewChromeGround.js";
/** Finite, serializable presentation vocabulary shared by SiteFrame and its metadata. */
export const HEADER_LINK_LIMIT = 5;
export const HEADER_ACTION_LIMIT = 3;
export const HEADER_ACTION_VARIANTS = Object.freeze(["secondary", "ghost", "primary"] as const);
/** Flat footer row: `shell.footer.links` then `shell.footer.legal.links`; more links belong in labelled `columns`. */
export const FOOTER_LINK_LIMIT = 5;
/** Footer icon slots, counting the `shell.brand` mark that always takes the last one. */
export const FOOTER_ICON_LIMIT = 5;
export type SiteFooterContractErrorCode = "footer-link-limit" | "footer-icon-limit" | "footer-duplicate-link" | "footer-privacy-choices";
const FOOTER_CONTRACT_REASONS: Readonly<Record<SiteFooterContractErrorCode, string>> = Object.freeze({
  "footer-link-limit": "permits at most five flat links across links and legal links; group further links into labelled columns.",
  "footer-icon-limit": "permits at most four icons; the brand mark takes the fifth and last slot.",
  "footer-duplicate-link": "repeats the home or a header navigation destination.",
  "footer-privacy-choices": "must not carry the privacy-choices control; it stays on the privacy policy page.",
});
/**
 * Over-cap or excluded footer input, refused at the contract boundary and never truncated.
 * The message names the field path only, never a caller value.
 */
export class SiteFooterContractError extends TypeError {
  override readonly name = "SiteFooterContractError";
  readonly code: SiteFooterContractErrorCode;
  constructor(code: SiteFooterContractErrorCode, path: string) {
    super(`SiteFrame: ${path} ${FOOTER_CONTRACT_REASONS[code]}`);
    this.code = code;
  }
}
export const SITE_FRAME_CONFIG_SCHEMA = Object.freeze({
  footerGround: Object.freeze({ values: SITE_CHROME_GROUNDS, default: "base" as const }),
  footerPlacement: Object.freeze({ values: Object.freeze(["flow", "overlay"] as const), default: "flow" as const }),
  footerRule: Object.freeze({ values: Object.freeze(["none", "top"] as const), default: "none" as const }),
  headerSurface: Object.freeze({ values: Object.freeze(["solid", "transparent", "glass"] as const), default: "solid" as const }),
  headerPosition: Object.freeze({ values: Object.freeze(["sticky", "static"] as const), default: undefined }),
  headerTone: Object.freeze({ values: Object.freeze(["base", "inverse"] as const), default: "base" as const }),
});
export interface SiteFramePresentationConfig {
  readonly footerGround?: typeof SITE_FRAME_CONFIG_SCHEMA.footerGround.values[number];
  readonly footerPlacement?: typeof SITE_FRAME_CONFIG_SCHEMA.footerPlacement.values[number];
  readonly footerRule?: typeof SITE_FRAME_CONFIG_SCHEMA.footerRule.values[number];
  readonly headerSurface?: typeof SITE_FRAME_CONFIG_SCHEMA.headerSurface.values[number];
  readonly headerPosition?: typeof SITE_FRAME_CONFIG_SCHEMA.headerPosition.values[number];
  readonly headerTone?: typeof SITE_FRAME_CONFIG_SCHEMA.headerTone.values[number];
}
type NormalizedSiteFrameConfig = Required<Omit<SiteFramePresentationConfig, "headerPosition">> & Pick<SiteFramePresentationConfig, "headerPosition">;

/** Reject unknown fields and incompatible dependent inputs; output keys remain flat primitive values. */
export function normalizeSiteFrameConfig(input: unknown = {}, inherited?: SiteFramePresentationConfig): NormalizedSiteFrameConfig {
  const fail = (): never => { throw new Error("SiteFrame: invalid presentation config or dependent field."); };
  try {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail();
  const defaults = inherited === undefined ? undefined : normalizeSiteFrameConfig(inherited);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input as object).some(key => typeof key !== "string")) fail();
  const fields: Record<string, string> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(SITE_FRAME_CONFIG_SCHEMA, key) || !descriptor.enumerable || !("value" in descriptor)) fail();
    const values: readonly string[] = SITE_FRAME_CONFIG_SCHEMA[key as keyof typeof SITE_FRAME_CONFIG_SCHEMA].values;
    if (typeof descriptor.value !== "string" || !values.includes(descriptor.value)) fail();
    fields[key] = descriptor.value;
  }
  // Surface/tone inputs retain their established defaults; position inherits independently.
  const explicitHeader = fields.headerSurface !== undefined || fields.headerTone !== undefined;
  const result = Object.fromEntries(Object.entries(SITE_FRAME_CONFIG_SCHEMA).map(([key, field]) => [key, fields[key] ?? (explicitHeader && key.startsWith("header") && key !== "headerPosition" ? undefined : defaults?.[key as keyof SiteFramePresentationConfig]) ?? field.default]).filter(([, value]) => value !== undefined)) as NormalizedSiteFrameConfig;
  if (result.headerSurface === "glass" && result.headerPosition === "static") fail();
  if (result.footerPlacement === "overlay" && result.footerGround === "transparent") fail();
  return Object.freeze(result);
  } catch { return fail(); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/**
 * Copy references for the navigation SiteFrame supplies when header actions
 * exist without `shell.nav`. They resolve through the consumer's own
 * `resolveCopy`, like every other shell label, and fail closed when unresolved.
 */
export const SITE_FRAME_NAV_DEFAULTS = Object.freeze({
  label: Object.freeze({ id: "site-frame.nav.label" }),
  triggerLabel: Object.freeze({ id: "site-frame.nav.trigger-label" }),
  trigger: "icon" as const,
});
/**
 * Composition references identify exports; they confer no qualification.
 * Revision 4 uses one header surface and one ordered actions list; environment-only headers retain direct ghost links.
 * Pack owns route placement and Instance pairs Frame with View.
 */
export const SITE_FRAME_CONTRACT = freeze({
  identity: "site-frame", role: "frame", revision: 4, medium: "web",
  use: ["persistent public-site chrome surrounding one chrome-free View"],
  avoid: ["route placement", "document bootstrap", "content sections", "application navigation focus bridge"],
  config: SITE_FRAME_CONFIG_SCHEMA,
  content: { brand: "SiteBrandInput", links: "SiteShellInput.nav.links", actions: "SiteShellInput.actions" },
  constraints: { implicitVariants: "assign unoccupied supported variants; explicit duplicates rejected", headerLinks: HEADER_LINK_LIMIT, headerActions: HEADER_ACTION_LIMIT, actionVariants: HEADER_ACTION_VARIANTS, primary: "supplied icon and nonempty label", variants: "distinct" },
  normalization: "normalizeSiteFrameConfig",
  actionsNormalization: "normalizeSiteFrameActions",
  defaults: SITE_FRAME_NAV_DEFAULTS,
  required: ["dark-footer", "accessible-navigation", "document-scroll", "sole-main"],
  constituents: {
    Header: { owner: "@clossys/designer", subpath: "shell/server", export: "SiteHeader", config: ["headerSurface", "headerTone", "headerPosition"] },
    Footer: { owner: "@clossys/designer", subpath: "shell/server", export: "SiteFooter", config: ["footerGround", "footerPlacement", "footerRule"], content: ["columns", "links", "social", "legal"], required: ["dark-in-both-themes", "centered-links", "home-inline-end", "mobile-links-icons-copyright", "named-icons", "external-rel", "safe-area", "44px-targets", "privacy-link-only"], constraints: { links: FOOTER_LINK_LIMIT, linksLayout: "one flat row of shell.footer.links then shell.footer.legal.links", grouping: "shell.footer.columns: labelled columns for links beyond the flat row", icons: FOOTER_ICON_LIMIT, brandMark: "shell.brand, always the last icon slot", excludes: ["home", "header-navigation", "privacy-choices"], error: "SiteFooterContractError", accessibility: "mandatory" } },
  },
} as const);

type HeaderVariant = typeof HEADER_ACTION_VARIANTS[number];
const actionImportance = (variant: HeaderVariant) => variant === "primary" ? 2 : variant === "ghost" ? 0 : 1;
/** Resolved content: URLs/copy and SVG allowlist validation belong to resolveShell, before variant normalization. */
export interface ResolvedSiteFrameAction { readonly label: string; readonly href: string; readonly emphasis?: HeaderVariant; readonly icon?: IconNode }
/** Normalize already validated resolved content; enforce nonblank labels and the primary icon dependency here too. */
export function normalizeSiteFrameActions<T extends ResolvedSiteFrameAction>(input: readonly T[], preferred: readonly HeaderVariant[] = []): readonly (T & { readonly emphasis: HeaderVariant })[] {
  if (!Array.isArray(input) || !Array.isArray(preferred) || preferred.some(variant => !HEADER_ACTION_VARIANTS.includes(variant))) throw new Error("SiteFrame: invalid resolved action preferences.");
  if (input.length > HEADER_ACTION_LIMIT) throw new Error("SiteFrame: header permits at most three actions.");
  const explicit = input.flatMap(action => action.emphasis === undefined ? [] : [action.emphasis]);
  if (explicit.some(variant => !HEADER_ACTION_VARIANTS.includes(variant)) || new Set(explicit).size !== explicit.length) throw new Error("SiteFrame: explicit action variants must be distinct supported variants.");
  const used = new Set(explicit);
  return Object.freeze(input.map((action, index) => {
    const preference = preferred[index] ?? "secondary";
    const emphasis = action.emphasis ?? (!used.has(preference) ? preference : HEADER_ACTION_VARIANTS.find(variant => !used.has(variant)))!;
    used.add(emphasis);
    if (typeof action.label !== "string" || !action.label.trim()) throw new Error("SiteFrame: action requires a nonempty resolved label.");
    if (emphasis === "primary" && (!Array.isArray(action.icon) || action.icon.length === 0)) throw new Error("SiteFrame: primary action requires a supplied icon and label.");
    return Object.freeze({ ...action, emphasis });
  }).sort((a, b) => actionImportance(a.emphasis) - actionImportance(b.emphasis)));
}
