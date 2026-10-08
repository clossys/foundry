import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import { isRenderImageAsset } from "../../../internal/assets.js";
import type { AssetResolver } from "../../types.js";
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

const GROUNDS: readonly SiteChromeGround[] = ["base", "inverse", "transparent", "transparent-inverse"];
const LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
const ICON_TAGS = new Set(["path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "g"]);
const ICON_ATTRIBUTE = /^[a-z][a-z-]*$/i;

function fail(message: string): never {
  throw new Error(`SiteFrame: ${message}`);
}

function record(value: unknown, path: string, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be a plain object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path} has an unsupported field "${key}".`);
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
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) fail(`${path} is not an allowed link.`);
  if (isRootRelative(value)) return origin === undefined ? value : new URL(value, origin).href;
  if (value.startsWith("#") || value.startsWith("?")) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${path} is not an allowed link.`);
  }
  if (!LINK_PROTOCOLS.has(url.protocol)) fail(`${path} is not an allowed link.`);
  return value;
}

function origin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail("shell.origin must be an http(s) origin.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("shell.origin must be an http(s) origin.");
  }
  const bare = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !bare) fail("shell.origin must be an http(s) origin.");
  return url.origin;
}

function icon(value: unknown, path: string): IconNode {
  const ok =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (node) =>
        Array.isArray(node) &&
        node.length === 2 &&
        typeof node[0] === "string" &&
        ICON_TAGS.has(node[0]) &&
        typeof node[1] === "object" &&
        node[1] !== null &&
        Object.entries(node[1] as Record<string, unknown>).every(
          ([name, attribute]) =>
            ICON_ATTRIBUTE.test(name) && !/^on/i.test(name) && !/href$/i.test(name) && name.toLowerCase() !== "style" && typeof attribute === "string",
        ),
    );
  if (!ok) fail(`${path} is not plain SVG shape data.`);
  return value as IconNode;
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
    ground: shell.ground === undefined ? "base" : oneOf(shell.ground, "shell.ground", GROUNDS),
    ...(footer === undefined ? {} : { footer }),
  };
}
