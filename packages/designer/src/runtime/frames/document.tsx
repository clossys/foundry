import type { ReactElement, ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { SITE_MAIN_ID } from "../../frames/site-frame/types.js";
import { runtimeValue, type SurfaceRendererEntry } from "../contract.js";

export interface DocumentFrameProps {
  /** Already resolved by the host's Writer locale authority; Designer never infers direction. */
  readonly lang: string;
  readonly dir: "ltr" | "rtl";
  readonly variant: "page" | "status";
  readonly title: string;
  readonly icon?: { readonly href: string; readonly type?: string };
  readonly meta?: readonly { readonly name: string; readonly content: string }[];
  readonly links?: readonly { readonly rel: "canonical" | "alternate"; readonly href: string; readonly hrefLang?: string }[];
  readonly htmlClassName?: string;
  readonly stylesheets?: readonly string[];
  readonly criticalCss?: string;
  /** The status body's site shell needs its existing stylesheet-independent structural rules. */
  readonly framed?: boolean;
  readonly componentName?: string;
  readonly children: ReactNode;
}

/** Compatibility marker for the fixed structural rules in framed status documents. */
export const FRAME_CRITICAL_STYLE_ATTRIBUTE = "data-publisher-frame-critical";
const DOCUMENT_STAMP = dsAttrs("frames", "frames.document", "foundry/frames.document");

// Keep these structural rules ahead of linked stylesheets, in their existing cascade layer.
const FRAME_CRITICAL_CSS = [
  "@layer publisher-frame-critical{",
  "[data-frame-root]{display:flex;flex-direction:column;min-height:100dvh}",
  `#${SITE_MAIN_ID}{display:flex;flex:1;flex-direction:column;width:100%}`,
  `a[href="#${SITE_MAIN_ID}"]:not(:focus){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0}`,
  '[data-frame-root] header span.bg-accent[aria-hidden="true"]{display:inline-block;flex-shrink:0;background-color:var(--color-accent,currentColor)}',
  "}",
].join("");

function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

// This guard and its refusal messages preserve Publisher's existing stylesheet contract.
function isStylesheetHref(href: unknown): href is string {
  if (typeof href !== "string" || href === "" || href.trim() !== href || hasControlOrSpace(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}
function checkedStylesheets(component: string, stylesheets: unknown): readonly string[] {
  if (stylesheets === undefined) return [];
  if (!Array.isArray(stylesheets)) throw new TypeError(`${component}: stylesheets must be an array.`);
  stylesheets.forEach((href: unknown, index) => {
    if (!isStylesheetHref(href)) throw new TypeError(`${component}: stylesheets[${index}] must be a root-relative path or an https URL.`);
  });
  return stylesheets as readonly string[];
}

const fail = (component: string, message: string): never => { throw new TypeError(`${component}: ${message}`); };
function requiredText(component: string, value: unknown, at: string): string {
  return typeof value === "string" && value.trim() ? value : fail(component, `${at} must be non-empty text.`);
}
function optionalText(component: string, value: unknown, at: string): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : fail(component, `${at} must be text.`);
}
function direction(component: string, value: unknown): "ltr" | "rtl" {
  return value === "ltr" || value === "rtl" ? value : fail(component, "dir must be ltr or rtl.");
}
function isHeadHref(href: unknown): href is string {
  if (typeof href !== "string" || !href || href.trim() !== href || hasControlOrSpace(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");
  try { return ["http:", "https:"].includes(new URL(href).protocol); } catch { return false; }
}
type JsonObject = Readonly<Record<string, unknown>>;
function object(component: string, value: unknown, at: string, allowed: readonly string[]): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(component, `${at} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(component, `${at}.${key} has no mapped prop.`);
  return value as JsonObject;
}
function checkedIcon(component: string, value: unknown): DocumentFrameProps["icon"] {
  if (value === undefined) return undefined;
  const row = object(component, value, "icon", ["href", "type"]);
  // Icons remain a caller-provided resource URL, rendered as attributes rather than native head nodes.
  return { href: requiredText(component, row.href, "icon.href"), ...(row.type === undefined ? {} : { type: optionalText(component, row.type, "icon.type") }) };
}
function checkedMeta(component: string, value: unknown, status: boolean): NonNullable<DocumentFrameProps["meta"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(component, "meta must be an array.");
  return value.map((item: unknown, index) => {
    const at = `meta[${index}]`, row = object(component, item, at, ["name", "content"]);
    const name = requiredText(component, row.name, `${at}.name`);
    if (status && name.trim().toLowerCase() === "robots") fail(component, `${at} cannot override status robots.`);
    return { name, content: optionalText(component, row.content, `${at}.content`) ?? fail(component, `${at}.content must be text.`) };
  });
}
function checkedLinks(component: string, value: unknown): NonNullable<DocumentFrameProps["links"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(component, "links must be an array.");
  return value.map((item: unknown, index) => {
    const at = `links[${index}]`, row = object(component, item, at, ["rel", "href", "hrefLang"]);
    const rel = row.rel === "canonical" || row.rel === "alternate" ? row.rel : fail(component, `${at}.rel must be canonical or alternate.`);
    const href = isHeadHref(row.href) ? row.href : fail(component, `${at}.href must be a root-relative path or an http(s) URL.`);
    const hrefLang = optionalText(component, row.hrefLang, `${at}.hrefLang`);
    return { rel, href, ...(hrefLang === undefined ? {} : { hrefLang }) };
  });
}
function checkedCss(component: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.includes("<")) return fail(component, "criticalCss must be a string without markup.");
  return value;
}

/** A complete document: the host resolves locale and provides the body; this component owns its head. */
export function DocumentFrame(props: DocumentFrameProps): ReactElement {
  const component = props.componentName ?? "DocumentFrame";
  const lang = requiredText(component, props.lang, "lang"), dir = direction(component, props.dir);
  if (props.variant !== "page" && props.variant !== "status") fail(component, "variant must be page or status.");
  const status = props.variant === "status";
  const title = requiredText(component, props.title, "title");
  const icon = checkedIcon(component, props.icon), meta = checkedMeta(component, props.meta, status), links = checkedLinks(component, props.links);
  const stylesheets = checkedStylesheets(component, props.stylesheets), criticalCss = checkedCss(component, props.criticalCss);
  const htmlClassName = optionalText(component, props.htmlClassName, "htmlClassName");
  if (props.framed !== undefined && typeof props.framed !== "boolean") fail(component, "framed must be a boolean.");
  return (
    <html {...DOCUMENT_STAMP} lang={lang} dir={dir} className={htmlClassName || undefined} {...(status ? { "data-theme": "light", "data-brand-bound": "", style: { colorScheme: "light" } } : {})}>
      <head>
        <title>{title}</title>
        {status ? <meta name="robots" content="noindex, nofollow" /> : null}
        {icon ? <link rel="icon" href={icon.href} type={icon.type} /> : null}
        {meta.map((item, index) => <meta key={index} name={item.name} content={item.content} />)}
        {links.map((item, index) => <link key={index} rel={item.rel} href={item.href} hrefLang={item.hrefLang} />)}
        {status && props.framed ? <style data-publisher-frame-critical="">{FRAME_CRITICAL_CSS}</style> : null}
        {criticalCss === undefined ? null : <style>{criticalCss}</style>}
        {stylesheets.map((href, index) => <link key={index} rel="stylesheet" href={href} />)}
      </head>
      <body>{props.children}</body>
    </html>
  );
}

const LEAF = "frames.document";
/** Runtime JSON describes head data only; the composed body is supplied through the body node slot. */
export function renderDocument(input: RuntimeRenderInput<ReactNode>): ReactNode {
  if (input.fill.leaf !== LEAF || input.selection.leaf !== LEAF) fail(LEAF, "renderer received a different leaf.");
  for (const slot of Object.keys(input.content)) if (slot !== "head" && slot !== "critical-css") fail(LEAF, `${slot} content has no mapped prop.`);
  for (const slot of Object.keys(input.slots)) if (slot !== "body") fail(LEAF, `${slot} slot has no mapped prop.`);
  let variant: DocumentFrameProps["variant"] = "page";
  if (input.selection.members.length > 1) fail(LEAF, "only one variant member is supported.");
  for (const member of input.selection.members) {
    if (member !== "variant.page" && member !== "variant.status") fail(LEAF, `${member} member has no mapped prop.`);
    variant = member === "variant.status" ? "status" : "page";
  }
  const head = object(LEAF, runtimeValue(input, "head"), "head", ["lang", "dir", "title", "icon", "meta", "links", "stylesheets", "htmlClassName", "framed"]);
  const lang = requiredText(LEAF, head.lang, "lang"), dir = direction(LEAF, head.dir), title = requiredText(LEAF, head.title, "title");
  const icon = checkedIcon(LEAF, head.icon), meta = checkedMeta(LEAF, head.meta, variant === "status"), links = checkedLinks(LEAF, head.links);
  const stylesheets = checkedStylesheets(LEAF, head.stylesheets), htmlClassName = optionalText(LEAF, head.htmlClassName, "htmlClassName");
  const criticalCss = checkedCss(LEAF, runtimeValue(input, "critical-css"));
  if (head.framed !== undefined && typeof head.framed !== "boolean") fail(LEAF, "head.framed must be a boolean.");
  const body = input.slots.body;
  if (!body?.length) fail(LEAF, "body slot is required.");
  return <DocumentFrame lang={lang} dir={dir} variant={variant} title={title} icon={icon} meta={meta} links={links} stylesheets={stylesheets} htmlClassName={htmlClassName} criticalCss={criticalCss} framed={head.framed as boolean | undefined} componentName={LEAF}>{body}</DocumentFrame>;
}

export const documentRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  render: renderDocument,
  // This fixture's locale is explicit; production content must arrive already resolved by its host.
  sample: dataset => ({ head: dataset.frames.document } satisfies Readonly<Record<string, RuntimeJson>>),
};
