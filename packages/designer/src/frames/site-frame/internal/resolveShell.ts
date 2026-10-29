import type { CopyRef, CopyResolver } from "../copy-contract.js";
import type { IconNode } from "@clossys/designer/components/server";
import { isRenderImageAsset } from "../landing/internal/assets.js";
import type { AssetResolver } from "../landing/web/types.js";
import type { SiteFramePresentationConfig } from "../site-frame-contract.js";
import { FOOTER_ICON_LIMIT, FOOTER_LINK_LIMIT, HEADER_LINK_LIMIT, HEADER_ACTION_VARIANTS, SITE_FRAME_NAV_DEFAULTS, SiteFooterContractError, normalizeSiteFrameActions, normalizeSiteFrameConfig } from "../site-frame-contract.js";
import { SITE_CHROME_GROUNDS } from "../types.js";
import type { SiteChromeGround, SiteShellInput } from "../types.js";

export interface ResolvedSiteLink {
  readonly href: string;
  readonly label: string;
  readonly isCurrent?: boolean;
}

export interface ResolvedSiteIconLink extends ResolvedSiteLink {
  readonly icon: IconNode;
}

export interface ResolvedSiteShell {
  readonly brand: {
    readonly markSrc: string;
    readonly label: string;
    readonly size: "sm" | "md" | "lg";
    readonly plate?: "self" | "shared";
    readonly tone?: "auto" | "inverse";
    readonly markInk?: "image" | "accent";
    readonly wordmark?: string;
  };
  readonly skipLink: string;
  readonly nav?: { readonly label: string; readonly triggerLabel: string; readonly closeLabel?: string; readonly links: readonly ResolvedSiteLink[] };
  readonly actions: readonly (ResolvedSiteLink & { readonly emphasis: "primary" | "secondary" | "ghost"; readonly icon?: IconNode })[];
  readonly headerActions: readonly (ResolvedSiteLink & { readonly emphasis: "primary" | "secondary" | "ghost"; readonly icon?: IconNode })[];
  readonly environments: readonly (ResolvedSiteLink & { readonly icon: IconNode; readonly isCurrent: boolean })[];
  readonly navPlacement: "leading" | "centered";
  readonly ground: SiteChromeGround;
  readonly header: { readonly position?: "sticky" | "static"; readonly surface: "solid" | "transparent" | "glass"; readonly tone: "base" | "inverse" };
  readonly footer?: {
    /** The brand's own mark, as resolved for `shell.brand`, linking home in the last icon slot. */
    readonly brandBand?: boolean;
    readonly home: { readonly label: string; readonly href: string; readonly markSrc: string };
    readonly rule?: "none" | "top";
    readonly placement: "flow" | "overlay";
    readonly ground: SiteChromeGround;
    readonly columns: readonly { readonly heading: string; readonly links: readonly ResolvedSiteLink[] }[];
    readonly links: readonly ResolvedSiteLink[];
    readonly social?: { readonly label?: string; readonly links: readonly ResolvedSiteIconLink[] };
    readonly legal: { readonly entity: string; readonly links: readonly ResolvedSiteLink[]; readonly linksLabel?: string };
  };
}

const SHELL_KEYS = new Set([
  "brand",
  "skipLink",
  "nav",
  "actions",
  "environments",
  "navPlacement",
  "ground",
  "header",
  "footer",
  "origin",
]);
const HEADER_KEYS = new Set(["surface", "tone", "position"]);
const BRAND_KEYS = new Set(["assetId", "label", "size", "plate", "variant", "wordmark", "tone", "markInk"]);
const NAV_KEYS = new Set(["label", "triggerLabel", "closeLabel", "links"]);
const LINK_KEYS = new Set(["href", "label"]);
const NAV_LINK_KEYS = new Set(["href", "label", "isCurrent"]);
const ACTION_KEYS = new Set(["href", "label", "emphasis", "icon"]);
const ENVIRONMENT_KEYS = new Set(["href", "label", "icon", "isCurrent"]);
const ICON_LINK_KEYS = new Set(["href", "label", "icon"]);
const SOCIAL_KEYS = new Set(["label", "links"]);
const FOOTER_KEYS = new Set(["brandBand", "placement", "ground", "columns", "links", "social", "legal", "rule"]);
/** The consent reopen fragment; the footer never carries that control, only the policy link. */
const PRIVACY_CHOICES_FRAGMENT = "privacy-choices";
const COLUMN_KEYS = new Set(["heading", "links"]);
const LEGAL_KEYS = new Set(["entity", "links", "linksLabel"]);

const LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
/** C0 controls, DEL and backslash: a URL parser strips or rewrites them, so a link that holds one is refused before it is classified. */
const UNSAFE_URL_CHARACTER = /[\u0000-\u001F\u007F\\]/;
/** Hosts an `http:` origin may name: loopback only, for local development. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ICON_TAGS = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "g"]);
/** The SVG presentation and geometry attributes icon data may carry. Anything else is refused. */
const ICON_ATTRIBUTES = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
  "pathLength",
  "transform",
  "fill",
  "fillRule",
  "fill-rule",
  "fillOpacity",
  "fill-opacity",
  "clipRule",
  "clip-rule",
  "stroke",
  "strokeWidth",
  "stroke-width",
  "strokeLinecap",
  "stroke-linecap",
  "strokeLinejoin",
  "stroke-linejoin",
  "strokeOpacity",
  "stroke-opacity",
  "opacity",
]);
/**
 * Designer's generated icons carry a React list `key` per node. It is stripped
 * from the copy rather than refused, so Designer's own icons are accepted, and
 * never reaches the rendered element.
 */
const ICON_STRIPPED_ATTRIBUTES = new Set(["key"]);
const SAFE_KEY_CHARACTER = /[^A-Za-z0-9_$]/g;
const MAX_ECHOED_KEY_LENGTH = 40;

function fail(message: string): never {
  throw new Error(`SiteFrame: ${message}`);
}

/** A caller-supplied key, reduced to identifier characters and truncated, so an error message cannot carry markup or a long payload. */
function echoKey(key: string): string {
  const safe = key.replace(SAFE_KEY_CHARACTER, "").slice(0, MAX_ECHOED_KEY_LENGTH);
  return safe === "" ? "" : ` "${safe}"`;
}

function record(value: unknown, path: string, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be a plain object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path} has an unsupported field${echoKey(key)}.`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(`${path} must be one of ${allowed.join(", ")}.`);
  return value as T;
}

function copy(value: unknown, path: string, resolveCopy: CopyResolver): string {
  if (typeof value !== "object" || value === null || typeof (value as CopyRef).id !== "string") fail(`${path} must be a copy reference.`);
  const resolution = resolveCopy(value as CopyRef);
  if (!resolution || typeof resolution.text !== "string" || resolution.text.trim() === "") fail(`${path} did not resolve to copy.`);
  return resolution.text;
}

function fragment(href: string): string {
  const index = href.indexOf("#");
  if (index < 0) return "";
  const raw = href.slice(index + 1);
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isRootRelative(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

function href(value: unknown, path: string, origin: string | undefined): string {
  const refuse = (): never => fail(`${path} is not an allowed link.`);
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || UNSAFE_URL_CHARACTER.test(value)) refuse();
  const link = value as string;
  if (isRootRelative(link)) {
    if (origin === undefined) return link;
    const resolved = new URL(link, origin);
    if (resolved.origin !== origin) refuse();
    return resolved.href;
  }
  if (link.startsWith("#") || link.startsWith("?")) return link;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    refuse();
  }
  if (!LINK_PROTOCOLS.has(url!.protocol)) refuse();
  if ((url!.protocol === "https:" || url!.protocol === "http:") && url!.hostname === "") refuse();
  return url!.href;
}

function origin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const refuse = (): never => fail("shell.origin must be an https origin, or an http origin on a loopback host.");
  if (typeof value !== "string" || UNSAFE_URL_CHARACTER.test(value) || value !== value.trim()
    || !/^https?:\/\/[^/?#@]+\/?$/i.test(value)) refuse();
  let url: URL;
  try {
    url = new URL(value as string);
  } catch {
    refuse();
  }
  const parsed = url!;
  const bare = parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && parsed.username === "" && parsed.password === "";
  const allowedProtocol = parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname));
  if (!allowedProtocol || !bare) refuse();
  return parsed.origin;
}

/**
 * Validates icon data against an allowlist of SVG shape tags and attributes
 * and returns a frozen deep copy, so the caller's object is never rendered
 * and cannot change after validation.
 */
function icon(value: unknown, path: string): IconNode {
  const refuse = (): never => fail(`${path} is not plain SVG shape data.`);
  if (!Array.isArray(value) || value.length === 0) refuse();
  const nodes = (value as unknown[]).map((node) => {
    if (!Array.isArray(node) || node.length !== 2) refuse();
    const [tag, attributes] = node as [unknown, unknown];
    if (typeof tag !== "string" || !ICON_TAGS.has(tag)) refuse();
    if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) refuse();
    const copy: Record<string, string> = {};
    for (const [name, attribute] of Object.entries(attributes as Record<string, unknown>)) {
      if (ICON_STRIPPED_ATTRIBUTES.has(name) && typeof attribute === "string") continue;
      if (!ICON_ATTRIBUTES.has(name) || typeof attribute !== "string" || /url\s*\(/i.test(attribute)) refuse();
      // A CSS escape (`u\72l(`) can spell `url(` past the check above, so a backslash is never valid
      // in icon data, and an open parenthesis is valid only in `transform` (`rotate(45)`).
      if ((attribute as string).includes("\\") || (name !== "transform" && (attribute as string).includes("("))) refuse();
      copy[name] = attribute as string;
    }
    return Object.freeze([tag, Object.freeze(copy)] as const);
  });
  return Object.freeze(nodes) as unknown as IconNode;
}

/**
 * The footer configuration contract: one flat row of at most five links,
 * labelled columns beyond it, at most four icons before the brand mark, and
 * no home, header navigation or privacy-choices destination. Refuses rather
 * than truncates, naming the field path and never the value.
 */
function assertFooterContract(footer: NonNullable<ResolvedSiteShell["footer"]>, navLinks: readonly ResolvedSiteLink[]): void {
  if (footer.links.length + footer.legal.links.length > FOOTER_LINK_LIMIT) throw new SiteFooterContractError("footer-link-limit", "shell.footer.links");
  if ((footer.social?.links.length ?? 0) + 1 > FOOTER_ICON_LIMIT) throw new SiteFooterContractError("footer-icon-limit", "shell.footer.social.links");
  const reserved = new Set([footer.home.href, ...navLinks.map(link => link.href)]);
  const slots: readonly (readonly [string, readonly { readonly href: string }[]])[] = [
    ["shell.footer.links", footer.links],
    ...footer.columns.map((column, index) => [`shell.footer.columns[${index}].links`, column.links] as const),
    ["shell.footer.social.links", footer.social?.links ?? []],
    ["shell.footer.legal.links", footer.legal.links],
  ];
  for (const [path, entries] of slots) {
    entries.forEach((entry, index) => {
      if (fragment(entry.href) === PRIVACY_CHOICES_FRAGMENT) throw new SiteFooterContractError("footer-privacy-choices", `${path}[${index}].href`);
      if (reserved.has(entry.href)) throw new SiteFooterContractError("footer-duplicate-link", `${path}[${index}].href`);
    });
  }
}

/**
 * Validates the shell as closed data and resolves every label, link and the
 * brand asset. Fails closed: an unknown field, unresolved copy, a disallowed
 * link or a non-image brand asset throws, naming the field and never echoing
 * the value.
 */
export function resolveShell(input: SiteShellInput, resolveCopy: CopyResolver, resolveAsset: AssetResolver, presentation?: SiteFramePresentationConfig): ResolvedSiteShell {
  if (typeof resolveCopy !== "function") fail("resolveCopy must be a function.");
  if (typeof resolveAsset !== "function") fail("resolveAsset must be a function.");
  const shell = record(input, "shell", SHELL_KEYS);
  const base = origin(shell.origin);

  const link = (value: unknown, path: string): ResolvedSiteLink => {
    const fields = record(value, path, LINK_KEYS);
    return { href: href(fields.href, `${path}.href`, base), label: copy(fields.label, `${path}.label`, resolveCopy) };
  };
  const links = (value: unknown, path: string) => list(value, path).map((entry, index) => link(entry, `${path}[${index}]`));

  const iconLink = (value: unknown, path: string): ResolvedSiteIconLink => {
    const fields = record(value, path, ICON_LINK_KEYS);
    return {
      href: href(fields.href, `${path}.href`, base),
      label: copy(fields.label, `${path}.label`, resolveCopy),
      icon: icon(fields.icon, `${path}.icon`),
    };
  };
  const iconLinks = (value: unknown, path: string) => list(value, path).map((entry, index) => iconLink(entry, `${path}[${index}]`));

  const brandFields = record(shell.brand, "shell.brand", BRAND_KEYS);
  const variant = oneOf(brandFields.variant, "shell.brand.variant", ["mark", "lockup"] as const);
  const size = oneOf(brandFields.size, "shell.brand.size", ["sm", "md", "lg"] as const);
  const plate = brandFields.plate === undefined ? undefined : oneOf(brandFields.plate, "shell.brand.plate", ["self", "shared"] as const);
  if (typeof brandFields.assetId !== "string" || brandFields.assetId.trim() === "") fail("shell.brand.assetId must be a non-empty string.");
  const asset = resolveAsset(brandFields.assetId);
  if (!isRenderImageAsset(asset)) fail("shell.brand.assetId did not resolve to an image asset.");
  if (variant === "mark" && brandFields.wordmark !== undefined) fail("shell.brand.wordmark is only for the lockup variant.");
  const brand = {
    markSrc: asset.src,
    label: copy(brandFields.label, "shell.brand.label", resolveCopy),
    size,
    ...(plate === undefined ? {} : { plate }),
    ...(brandFields.tone === undefined ? {} : { tone: oneOf(brandFields.tone, "shell.brand.tone", ["auto", "inverse"] as const) }),
    ...(brandFields.markInk === undefined ? {} : { markInk: oneOf(brandFields.markInk, "shell.brand.markInk", ["image", "accent"] as const) }),
    ...(variant === "lockup" ? { wordmark: copy(brandFields.wordmark, "shell.brand.wordmark", resolveCopy) } : {}),
  };

  let nav: ResolvedSiteShell["nav"];
  if (shell.nav !== undefined) {
    const navFields = record(shell.nav, "shell.nav", NAV_KEYS);
    const label = copy(navFields.label, "shell.nav.label", resolveCopy);
    nav = {
      label,
      triggerLabel: navFields.triggerLabel === undefined ? label : copy(navFields.triggerLabel, "shell.nav.triggerLabel", resolveCopy),
      ...(navFields.closeLabel === undefined ? {} : { closeLabel: copy(navFields.closeLabel, "shell.nav.closeLabel", resolveCopy) }),
      links: list(navFields.links, "shell.nav.links").map((value, index) => {
        const path = `shell.nav.links[${index}]`;
        const fields = record(value, path, NAV_LINK_KEYS);
        if (fields.isCurrent !== undefined && typeof fields.isCurrent !== "boolean") fail(`${path}.isCurrent must be a boolean.`);
        return { href: href(fields.href, `${path}.href`, base), label: copy(fields.label, `${path}.label`, resolveCopy), ...(fields.isCurrent === true ? { isCurrent: true } : {}) };
      }),
    };
  }

  if (nav && nav.links.length > HEADER_LINK_LIMIT) fail("shell.nav.links permits at most five links.");

  const environments = shell.environments === undefined
    ? []
    : list(shell.environments, "shell.environments").map((entry, index) => {
        const path = `shell.environments[${index}]`;
        const fields = record(entry, path, ENVIRONMENT_KEYS);
        if (fields.isCurrent !== undefined && typeof fields.isCurrent !== "boolean") fail(`${path}.isCurrent must be a boolean.`);
        return {
          href: href(fields.href, `${path}.href`, base),
          label: copy(fields.label, `${path}.label`, resolveCopy),
          icon: icon(fields.icon, `${path}.icon`),
          isCurrent: fields.isCurrent === true,
        };
      });
  if (environments.filter((environment) => environment.isCurrent).length > 1) fail("shell.environments marks more than one environment current.");

  const ground = shell.ground === undefined ? "base" : oneOf(shell.ground, "shell.ground", SITE_CHROME_GROUNDS);
  let footer: ResolvedSiteShell["footer"];
  if (shell.footer !== undefined) {
    const footerFields = record(shell.footer, "shell.footer", FOOTER_KEYS);
    if (footerFields.brandBand !== undefined && typeof footerFields.brandBand !== "boolean") fail("shell.footer.brandBand must be a boolean.");
    const placement = footerFields.placement === undefined ? "flow" : oneOf(footerFields.placement, "shell.footer.placement", ["flow", "overlay"] as const);
    const footerGround = footerFields.ground === undefined ? (placement === "overlay" ? "inverse" : ground) : oneOf(footerFields.ground, "shell.footer.ground", SITE_CHROME_GROUNDS);
    if (placement === "overlay" && footerGround === "transparent") fail("shell.footer.ground must be opaque for overlay placement.");
    const legalFields = record(footerFields.legal, "shell.footer.legal", LEGAL_KEYS);
    let social: NonNullable<ResolvedSiteShell["footer"]>["social"];
    if (footerFields.social !== undefined) {
      const fields = record(footerFields.social, "shell.footer.social", SOCIAL_KEYS);
      social = {
        ...(fields.label === undefined ? {} : { label: copy(fields.label, "shell.footer.social.label", resolveCopy) }),
        links: iconLinks(fields.links, "shell.footer.social.links"),
      };
    }
    if (footerFields.brandBand === true && social?.links.length && social.label === undefined) fail("shell.footer.social.label is required for a brand-band social group.");
    // One brand declaration yields the header mark and the footer mark: no footer-specific art or label.
    const home = { label: brand.label, href: href("/", "shell.brand", base), markSrc: brand.markSrc };
    footer = {
      home,
      ...(footerFields.brandBand === undefined ? {} : { brandBand: footerFields.brandBand as boolean }),
      placement,
      ground: footerGround,
      ...(footerFields.rule === undefined ? {} : { rule: oneOf(footerFields.rule, "shell.footer.rule", ["none", "top"] as const) }),
      links: footerFields.links === undefined ? [] : links(footerFields.links, "shell.footer.links"),
      ...(social === undefined ? {} : { social }),
      columns:
        footerFields.columns === undefined
          ? []
          : list(footerFields.columns, "shell.footer.columns").map((column, index) => {
              const path = `shell.footer.columns[${index}]`;
              const fields = record(column, path, COLUMN_KEYS);
              return { heading: copy(fields.heading, `${path}.heading`, resolveCopy), links: links(fields.links, `${path}.links`) };
            }),
      legal: {
        entity: copy(legalFields.entity, "shell.footer.legal.entity", resolveCopy),
        links: links(legalFields.links, "shell.footer.legal.links"),
        ...(legalFields.linksLabel === undefined ? {} : { linksLabel: copy(legalFields.linksLabel, "shell.footer.legal.linksLabel", resolveCopy) }),
      },
    };
    assertFooterContract(footer, nav?.links ?? []);
  }

  let header: ResolvedSiteShell["header"] = { surface: "solid", tone: "base" };
  if (shell.header !== undefined) {
    const fields = record(shell.header, "shell.header", HEADER_KEYS);
    header = {
      ...(fields.position === undefined ? {} : { position: oneOf(fields.position, "shell.header.position", ["sticky", "static"] as const) }),
      surface: fields.surface === undefined ? "solid" : oneOf(fields.surface, "shell.header.surface", ["solid", "transparent", "glass"] as const),
      tone: fields.tone === undefined ? "base" : oneOf(fields.tone, "shell.header.tone", ["base", "inverse"] as const),
    };
  }

  const declaredVariants: ("primary" | "secondary" | "ghost" | undefined)[] = [];
  const actions = shell.actions === undefined ? [] : list(shell.actions, "shell.actions").map((value, index) => {
      const path = `shell.actions[${index}]`;
      const fields = record(value, path, ACTION_KEYS);
      const emphasis = fields.emphasis === undefined ? undefined : oneOf(fields.emphasis, `${path}.emphasis`, HEADER_ACTION_VARIANTS);
      declaredVariants.push(emphasis);
      return {
        href: href(fields.href, `${path}.href`, base),
        label: copy(fields.label, `${path}.label`, resolveCopy),
        ...(fields.icon === undefined ? {} : { icon: icon(fields.icon, `${path}.icon`) }),
        emphasis: fields.emphasis === undefined ? "secondary" : oneOf(fields.emphasis, `${path}.emphasis`, HEADER_ACTION_VARIANTS),
      };
    });
  const headerActions = normalizeSiteFrameActions([
    ...actions.map((action, index) => ({ ...action, emphasis: declaredVariants[index] })),
    ...environments.map(action => ({ ...action, emphasis: undefined })),
  ], [
    ...actions.map(() => "secondary" as const),
    ...environments.map(() => "secondary" as const),
  ]);
  // Ordinary actions still need a named menu. Environment-only shells use direct ghost links.
  if (nav === undefined && actions.length > 0) {
    const defaults = SITE_FRAME_NAV_DEFAULTS;
    nav = {
      label: copy(defaults.label, `shell.nav default label "${defaults.label.id}"`, resolveCopy),
      triggerLabel: copy(defaults.triggerLabel, `shell.nav default triggerLabel "${defaults.triggerLabel.id}"`, resolveCopy),
      links: [],
    };
  }
  // Renderer and data contract normalize the same dependent presentation inputs.
  const normalized = normalizeSiteFrameConfig(presentation ?? {}, {
    headerSurface: header.surface, headerTone: header.tone,
    ...(header.position === undefined ? {} : { headerPosition: header.position }),
    ...(footer ? { footerGround: footer.ground, footerPlacement: footer.placement, footerRule: footer.rule ?? "none" } : {}),
  });
  if (footer) footer = { ...footer, ground: normalized.footerGround, placement: normalized.footerPlacement, rule: normalized.footerRule };
  header = { surface: normalized.headerSurface, tone: normalized.headerTone,
    ...(normalized.headerPosition === undefined ? {} : { position: normalized.headerPosition }) };

  return {
    brand,
    skipLink: copy(shell.skipLink, "shell.skipLink", resolveCopy),
    ...(nav === undefined ? {} : { nav }),
    actions,
    headerActions,
    environments,
    navPlacement: shell.navPlacement === undefined ? "centered" : oneOf(shell.navPlacement, "shell.navPlacement", ["leading", "centered"] as const),
    ground,
    header,
    ...(footer === undefined ? {} : { footer }),
  };
}
