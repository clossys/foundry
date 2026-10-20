import type { IconNode } from "@clossys/designer/atoms/server";
import { SITE_CHROME_GROUNDS } from "../internal/viewChromeGround.js";
/** Finite, serializable presentation vocabulary shared by SiteFrame and its metadata. */
export const HEADER_LINK_LIMIT = 5;
export const HEADER_ACTION_LIMIT = 3;
export const HEADER_ACTION_VARIANTS = Object.freeze(["secondary", "ghost", "primary"] as const);
export const SITE_FRAME_CONFIG_SCHEMA = Object.freeze({
  headerGround: Object.freeze({ values: SITE_CHROME_GROUNDS, default: "base" as const }),
  headerPlacement: Object.freeze({ values: Object.freeze(["reserved", "overlay"] as const), default: "reserved" as const }),
  headerTone: Object.freeze({ values: Object.freeze(["base", "inverse"] as const), default: "base" as const }),
});
export interface SiteFramePresentationConfig {
  readonly headerGround?: typeof SITE_FRAME_CONFIG_SCHEMA.headerGround.values[number];
  readonly headerPlacement?: typeof SITE_FRAME_CONFIG_SCHEMA.headerPlacement.values[number];
  readonly headerTone?: typeof SITE_FRAME_CONFIG_SCHEMA.headerTone.values[number];
}
/** Reject unknown fields and incompatible dependent inputs; output keys remain flat primitive values. */
export function normalizeSiteFrameConfig(input: unknown = {}): Required<SiteFramePresentationConfig> {
  const fail = (): never => { throw new Error("SiteFrame: invalid presentation config or dependent field."); };
  try {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input as object).some(key => typeof key !== "string")) fail();
  const fields: Record<string, string> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(SITE_FRAME_CONFIG_SCHEMA, key) || !descriptor.enumerable || !("value" in descriptor)) fail();
    const values: readonly string[] = SITE_FRAME_CONFIG_SCHEMA[key as keyof typeof SITE_FRAME_CONFIG_SCHEMA].values;
    if (typeof descriptor.value !== "string" || !values.includes(descriptor.value)) fail();
    fields[key] = descriptor.value;
  }
  const result = Object.fromEntries(Object.entries(SITE_FRAME_CONFIG_SCHEMA).map(([key, field]) => [key, fields[key] ?? field.default])) as Required<SiteFramePresentationConfig>;
  if (result.headerPlacement === "overlay" ? result.headerGround !== "base" : result.headerTone !== "base") fail();
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
  trigger: "label" as const,
});
/** Composition references identify exports; they confer no qualification. Pack owns route placement and Instance pairs Frame with View. */
export const SITE_FRAME_CONTRACT = freeze({
  identity: "site-frame", role: "frame", revision: 2, medium: "web",
  use: ["persistent public-site chrome surrounding one chrome-free View"],
  avoid: ["route placement", "document bootstrap", "content sections", "application navigation focus bridge"],
  config: SITE_FRAME_CONFIG_SCHEMA,
  content: { brand: "SiteBrandInput", links: "SiteShellInput.nav.links", actions: "SiteShellInput.actions" },
  constraints: { implicitVariants: "assign unoccupied supported variants; explicit duplicates rejected", headerLinks: HEADER_LINK_LIMIT, headerActions: HEADER_ACTION_LIMIT, actionVariants: HEADER_ACTION_VARIANTS, primary: "supplied icon and nonempty label", variants: "distinct" },
  normalization: "normalizeSiteFrameConfig",
  actionsNormalization: "normalizeSiteFrameActions",
  defaults: SITE_FRAME_NAV_DEFAULTS,
  required: ["sticky-header", "dark-footer", "accessible-navigation", "document-scroll", "sole-main"],
  constituents: {
    Header: { owner: "@clossys/designer", subpath: "shell/server", export: "SiteHeader", config: ["headerGround", "headerPlacement", "headerTone"] },
    Footer: { owner: "@clossys/designer", subpath: "shell/server", export: "SiteFooter", config: [], status: "awaiting-footer-composition" },
  },
} as const);

type HeaderVariant = typeof HEADER_ACTION_VARIANTS[number];
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
  }));
}
