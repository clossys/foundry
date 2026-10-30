import { createHash } from "node:crypto";
import { posix } from "node:path";
import { checkedContentMap, contentMapOrigin, contentMapPath } from "../content-map/check.js";
import { projectRedirects, projectSitemap } from "../content-map/projections.js";
import { projectRobots } from "../content-map/robots.js";
import { buildSecurityTxt } from "../content-map/security.js";
import type { ContentMap } from "../content-map/contract.js";
import { generatedText, parseGeneratedText, type AppLocalEmission } from "./emitter.js";
import type { SiteSyncOptions, SiteSyncPort } from "./contract.js";

export const siteSyncHash = (source: string): string => createHash("sha256").update(source).digest("hex");
export const siteSyncJson = (value: unknown): string => JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
export function siteSyncPath(path: string): string {
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || /[\\\u0000-\u001f\u007f]/.test(path)
    || path.split("/").some(part => !part || part === "." || part === "..")) throw new TypeError("A contained relative source path is required");
  return path;
}
const specifier = (from: string, to: string): string => {
  const value = posix.relative(posix.dirname(from), to).replace(/\.[cm]?[jt]sx?$/, "");
  return value.startsWith(".") ? value : `./${value}`;
};
function port(value: SiteSyncPort, emission: AppLocalEmission): void {
  if (!value || !/^[A-Za-z_$][\w$]*$/.test(value.export) || value.export === "default") throw new TypeError("An explicit named host export is required");
  siteSyncPath(value.file);
  if (!Object.hasOwn(emission.files, value.file)) throw new TypeError(`Host source is absent from the selected app-local closure: ${value.file}`);
  // Reject values JSON would silently drop or change before emitting source.
  const finite = (input: unknown): boolean => input === null || typeof input === "string" || typeof input === "boolean"
    || typeof input === "number" && Number.isFinite(input)
    || Array.isArray(input) && input.every(finite)
    || !!input && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype && Object.values(input).every(finite);
  if (value.props !== undefined && !finite(value.props)) throw new TypeError("Host props must be finite JSON data");
}
/** Parse only the emitter's inert publication literal; never evaluate generated code. */
export function siteSyncPublication(emission: AppLocalEmission): ContentMap {
  const source = emission.files["routes.ts"];
  if (!source) throw new TypeError("App-local emission did not include routes.ts");
  const body = parseGeneratedText(source).body;
  const match = /^export const publication = ([\s\S]*?) as const;\s*export const routes = publication.entries;\s*$/.exec(body);
  if (!match) throw new TypeError("Unrecognized app-local publication literal");
  return checkedContentMap(JSON.parse(match[1]!));
}
/** Both planning and the emitted handler enforce the same-origin destination. */
export function siteSyncSubmitEndpoint(value: string, origin: string): string {
  const base = contentMapOrigin(origin);
  if (typeof value !== "string" || /[\\\s\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) throw new TypeError("Form submission requires a same-origin HTTP(S) endpoint");
  const url = new URL(value, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash) throw new TypeError("Form submission requires a same-origin HTTP(S) endpoint");
  return `${url.pathname}${url.search}`;
}
export interface SiteSyncPlan {
  readonly emission: AppLocalEmission;
  /** Paths relative to the selected application. */
  readonly files: Readonly<Record<string, string>>;
}
export function createSiteSyncPlan(options: SiteSyncOptions, source: AppLocalEmission): SiteSyncPlan {
  const origin = contentMapOrigin(options.origin).origin, map = siteSyncPublication(source);
  if (map.publicationId !== options.target.publication || map.format !== "web.page.responsive") throw new TypeError("Target and emitted publication differ");
  if (!options.host || typeof options.host.locale !== "string" || Intl.getCanonicalLocales(options.host.locale).length !== 1) throw new TypeError("An explicit host locale is required");
  for (const value of [options.host.frame, options.host.consent, options.host.notFound]) port(value, source);
  const endpoint = options.host.formSubmit === undefined ? undefined : siteSyncSubmitEndpoint(options.host.formSubmit, origin);
  const files: Record<string, string> = {}, generated: Record<string, string> = { ...source.files };
  const add = (path: string, body: string) => {
    siteSyncPath(path);
    if (Object.hasOwn(files, path)) throw new TypeError(`Generated route collision: ${path}`);
    files[path] = generatedText(body);
  };
  const pages = map.entries.filter(entry => entry.kind === "page" && entry.indexing?.mode !== "noindex");
  const native = new Map<string, string>();
  for (const [path, text] of Object.entries(source.files)) {
    if (!path.endsWith("/page.tsx")) continue;
    const match = /const route: ContentRouteRegistration = ([\s\S]*?);\s*export default/.exec(parseGeneratedText(text).body);
    if (!match) continue;
    const route = JSON.parse(match[1]!);
    if (typeof route.path !== "string" || native.has(route.path)) throw new TypeError("App-local page routes require unique paths");
    native.set(route.path, path);
  }
  const served = new Set(pages.map(contentMapPath));
  for (const [path, file] of native) if (!served.has(path)) delete generated[file];
  for (const page of pages) {
    const path = contentMapPath(page), entry = native.get(path);
    if (!entry) throw new TypeError(`Active indexable page has no emitted serving source: ${page.id}`);
    const segments = path === "/" ? [] : path.slice(1).split("/");
    if (segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) throw new TypeError("Site sync requires literal App Router page segments");
    const output = ["app", ...segments, "page.tsx"].join("/");
    add(output, `export { default } from ${JSON.stringify(specifier(output, `src/clossys/${entry}`))};\n`);
  }
  const { frame, consent, notFound } = options.host;
  add("app/layout.tsx", [
    `import type { ReactNode } from "react";`,
    `import { ${frame.export} as SiteFrame } from ${JSON.stringify(specifier("app/layout.tsx", `src/clossys/${frame.file}`))};`,
    `import { ${consent.export} as ConsentHost } from ${JSON.stringify(specifier("app/layout.tsx", `src/clossys/${consent.file}`))};`,
    'import "../src/clossys/theme.css";',
    `export default function RootLayout({ children }: { children: ReactNode }) {`,
    `  return <html lang=${JSON.stringify(options.host.locale)} data-brand-bound><body><SiteFrame {...${siteSyncJson(frame.props ?? {})}}><ConsentHost {...${siteSyncJson(consent.props ?? {})}}>{children}</ConsentHost></SiteFrame></body></html>;`,
    `}`, "",
  ].join("\n"));
  add("app/not-found.tsx", `import { ${notFound.export} as NotFound } from ${JSON.stringify(specifier("app/not-found.tsx", `src/clossys/${notFound.file}`))};\nexport default function SiteNotFound() { return <NotFound {...${siteSyncJson(notFound.props ?? {})}} />; }\n`);
  const visible: ContentMap = { ...map, entries: map.entries.filter(entry => entry.kind !== "external" && (entry.kind !== "page" || entry.indexing?.mode !== "noindex")) };
  // Retain grouping parents: the projections validate hierarchy before serializing.
  add("app/robots.ts", `export default function robots() { return ${siteSyncJson(projectRobots(visible, { origin, crawl: options.crawl }))}; }\n`);
  add("app/sitemap.ts", `export default function sitemap() { return ${siteSyncJson(projectSitemap(map, { origin, channel: "site" }))}; }\n`);
  const security = buildSecurityTxt(options.host.security);
  add("app/.well-known/security.txt/route.ts", `export function GET() { return new Response(${siteSyncJson(security)}, { headers: { "content-type": "text/plain; charset=utf-8" } }); }\n`);
  add("redirects.generated.mjs", `export default ${siteSyncJson(projectRedirects(map))};\n`);
  if (endpoint !== undefined) generated["site-sync/form-submit.ts"] = generatedText([
    '"use client";',
    `export async function submitForm(event: { preventDefault(): void; currentTarget: HTMLFormElement }) {`,
    `  event.preventDefault();`,
    `  const destination = new URL(${JSON.stringify(endpoint)}, window.location.origin);`,
    `  if (destination.origin !== window.location.origin) throw new TypeError("Form submission must stay on the site origin");`,
    `  const response = await fetch(destination.href, { method: "POST", body: new FormData(event.currentTarget), credentials: "same-origin", mode: "same-origin", redirect: "error" });`,
    `  if (!response.ok) throw new Error("Form submission failed");`,
    `}`, "",
  ].join("\n"));
  generated[".manifest.json"] = generatedText(`${siteSyncJson(Object.fromEntries(Object.entries(generated).filter(([path]) => path !== ".manifest.json").sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => [path, siteSyncHash(text)])))}\n`);
  for (const path of Object.keys(generated)) siteSyncPath(path);
  return { emission: { ...source, files: generated }, files };
}
