import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import { isRenderImageAsset } from "../../../internal/assets.js";
import type { AssetResolver } from "../../types.js";
import { SITE_CHROME_GROUNDS } from "../types.js";
import type { SiteChromeGround, SiteShellInput } from "../types.js";

export interface ResolvedSiteLink {
  readonly href: string;
  readonly label: string;
}

export interface ResolvedSiteShell {
  readonly brand: {
    readonly markSrc: string;
    readonly label: string;
    readonly size: "sm" | "md" | "lg";
    readonly plate?: "self" | "shared";
    readonly wordmark?: string;
  };
  readonly skipLink: string;
  readonly nav?: { readonly label: string; readonly links: readonly ResolvedSiteLink[] };
  readonly actions: readonly ResolvedSiteLink[];
  readonly secondaryAction?: ResolvedSiteLink;
  readonly environments: readonly (ResolvedSiteLink & { readonly icon: IconNode; readonly isCurrent: boolean })[];
  readonly surfaceLabel?: string;
  readonly navPlacement: "leading" | "centered";
  readonly ground: SiteChromeGround;
  readonly footer?: {
    readonly columns: readonly { readonly heading: string; readonly links: readonly ResolvedSiteLink[] }[];
    readonly legal: { readonly entity: string; readonly links: readonly ResolvedSiteLink[]; readonly linksLabel?: string };
  };
}

const SHELL_KEYS = new Set([
  "brand",
  "skipLink",
  "nav",
  "actions",
  "secondaryAction",
  "environments",
  "surfaceLabel",
  "navPlacement",
  "ground",
  "footer",
  "origin",
]);
const BRAND_KEYS = new Set(["assetId", "label", "size", "plate", "variant", "wordmark"]);
const NAV_KEYS = new Set(["label", "links"]);
const LINK_KEYS = new Set(["href", "label"]);
const ENVIRONMENT_KEYS = new Set(["href", "label", "icon", "isCurrent"]);
const FOOTER_KEYS = new Set(["columns", "legal"]);
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
  if (typeof value !== "string" || UNSAFE_URL_CHARACTER.test(value) || value !== value.trim()) refuse();
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
      copy[name] = attribute as string;
    }
    return Object.freeze([tag, Object.freeze(copy)] as const);
  });
  return Object.freeze(nodes) as unknown as IconNode;
}

/**
 * Validates the shell as closed data and resolves every label, link and the
 * brand asset. Fails closed: an unknown field, unresolved copy, a disallowed
 * link or a non-image brand asset throws, naming the field and never echoing
 * the value.
 */
export function resolveShell(input: SiteShellInput, resolveCopy: CopyResolver, resolveAsset: AssetResolver): ResolvedSiteShell {
  if (typeof resolveCopy !== "function") fail("resolveCopy must be a function.");
  if (typeof resolveAsset !== "function") fail("resolveAsset must be a function.");
  const shell = record(input, "shell", SHELL_KEYS);
  const base = origin(shell.origin);

  const link = (value: unknown, path: string): ResolvedSiteLink => {
    const fields = record(value, path, LINK_KEYS);
    return { href: href(fields.href, `${path}.href`, base), label: copy(fields.label, `${path}.label`, resolveCopy) };
  };
  const links = (value: unknown, path: string) => list(value, path).map((entry, index) => link(entry, `${path}[${index}]`));

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
    ...(variant === "lockup" ? { wordmark: copy(brandFields.wordmark, "shell.brand.wordmark", resolveCopy) } : {}),
  };

  let nav: ResolvedSiteShell["nav"];
  if (shell.nav !== undefined) {
    const navFields = record(shell.nav, "shell.nav", NAV_KEYS);
    nav = { label: copy(navFields.label, "shell.nav.label", resolveCopy), links: links(navFields.links, "shell.nav.links") };
  }

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

  let footer: ResolvedSiteShell["footer"];
  if (shell.footer !== undefined) {
    const footerFields = record(shell.footer, "shell.footer", FOOTER_KEYS);
    const legalFields = record(footerFields.legal, "shell.footer.legal", LEGAL_KEYS);
    footer = {
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
  }

  return {
    brand,
    skipLink: copy(shell.skipLink, "shell.skipLink", resolveCopy),
    ...(nav === undefined ? {} : { nav }),
    actions: shell.actions === undefined ? [] : links(shell.actions, "shell.actions"),
    ...(shell.secondaryAction === undefined ? {} : { secondaryAction: link(shell.secondaryAction, "shell.secondaryAction") }),
    environments,
    ...(shell.surfaceLabel === undefined ? {} : { surfaceLabel: copy(shell.surfaceLabel, "shell.surfaceLabel", resolveCopy) }),
    navPlacement: shell.navPlacement === undefined ? "leading" : oneOf(shell.navPlacement, "shell.navPlacement", ["leading", "centered"] as const),
    ground: shell.ground === undefined ? "base" : oneOf(shell.ground, "shell.ground", SITE_CHROME_GROUNDS),
    ...(footer === undefined ? {} : { footer }),
  };
}
