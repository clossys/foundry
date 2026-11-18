/**
 * Optional page-meta outputs a publication opts into (`outputs.jsonLd`, `outputs.llms`,
 * `outputs.feed`): pure builders over resolved text, and checks that fail closed on malformed
 * output. Install refuses anything a check reports; no builder invents text, a clock or a URL.
 */
import { contentMapOrigin } from "../content-map/check.js";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const https = (value: unknown): boolean => {
  if (typeof value !== "string" || CONTROL.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password; } catch { return false; }
};
const line = (value: string) => value.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

export interface JsonLdInput { readonly origin: string; readonly name: string; readonly summary: string; readonly locale: string }
const JSON_LD_TYPES = new Set(["Organization", "WebSite"]);

/** Organization and WebSite for the publication, as script-safe JSON (no raw `<`, `>` or `&`). */
export function buildJsonLd(input: JsonLdInput): string {
  const home = contentMapOrigin(input.origin).toString();
  const organization = `${home}#organization`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": organization, name: line(input.name), url: home, description: line(input.summary) },
      { "@type": "WebSite", "@id": `${home}#website`, name: line(input.name), url: home, description: line(input.summary), inLanguage: input.locale, publisher: { "@id": organization } },
    ],
  };
  return JSON.stringify(graph).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Every reason a JSON-LD payload may not be mounted; empty when it may. */
export function checkJsonLd(text: string): readonly string[] {
  const issues: string[] = [];
  if (typeof text !== "string") return ["JSON-LD is not text"];
  if (/[<>]/.test(text)) issues.push("JSON-LD holds a raw < or >, which could close its script element");
  let value: any;
  try { value = JSON.parse(text); } catch { return [...issues, "JSON-LD is not valid JSON"]; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [...issues, "JSON-LD is not an object"];
  if (value["@context"] !== "https://schema.org") issues.push("JSON-LD @context must be https://schema.org");
  const graph = value["@graph"];
  if (!Array.isArray(graph) || !graph.length) return [...issues, "JSON-LD @graph must list nodes"];
  graph.forEach((node: any, index: number) => {
    if (node === null || typeof node !== "object") { issues.push(`JSON-LD @graph[${index}] is not an object`); return; }
    if (!JSON_LD_TYPES.has(node["@type"])) issues.push(`JSON-LD @graph[${index}] @type must be Organization or WebSite`);
    if (typeof node.name !== "string" || !node.name.trim()) issues.push(`JSON-LD @graph[${index}] needs a name`);
    if (!https(node.url)) issues.push(`JSON-LD @graph[${index}] url must be an absolute https URL`);
    if (node["@id"] !== undefined && !https(node["@id"])) issues.push(`JSON-LD @graph[${index}] @id must be an absolute https URL`);
  });
  return issues;
}

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

export interface LlmsTxtPage { readonly title: string; readonly url: string; readonly description?: string }
export interface LlmsTxtInput { readonly name: string; readonly summary: string; readonly pages: readonly LlmsTxtPage[] }
const LINK = /^- \[((?:\\.|[^\]\\])+)\]\(([^()\s]+)\)(?:: (.+))?$/;
const escapeLink = (value: string) => line(value).replace(/[\\[\]]/g, match => `\\${match}`);

/** The llms.txt convention: an H1 name, a quoted summary, then one link per page. */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const pages = input.pages.map(page => `- [${escapeLink(page.title)}](${page.url})${page.description ? `: ${line(page.description)}` : ""}`);
  return [`# ${line(input.name)}`, "", `> ${line(input.summary)}`, ...(pages.length ? ["", "## Pages", "", ...pages] : []), ""].join("\n");
}

export function checkLlmsTxt(text: string): readonly string[] {
  const issues: string[] = [];
  if (typeof text !== "string") return ["llms.txt is not text"];
  if (CONTROL.test(text)) issues.push("llms.txt holds a control character");
  const lines = text.split("\n");
  if (!/^# \S/.test(lines[0] ?? "")) issues.push("llms.txt must open with a '# ' title line");
  if (!/^> \S/.test(lines[2] ?? "")) issues.push("llms.txt must give a '> ' summary on its third line");
  lines.forEach((row, index) => {
    if (!row.startsWith("- ")) return;
    const match = LINK.exec(row);
    if (!match) issues.push(`llms.txt line ${index + 1} is not a '- [title](url)' link`);
    else if (!https(match[2])) issues.push(`llms.txt line ${index + 1} link is not an absolute https URL`);
  });
  return issues;
}

// ---------------------------------------------------------------------------
// RSS 2.0 and Atom
// ---------------------------------------------------------------------------

export type FeedFormat = "rss" | "atom";
export interface FeedItem { readonly title: string; readonly url: string; readonly summary?: string; readonly updated?: string }
export interface FeedInput { readonly format: FeedFormat; readonly origin: string; readonly title: string; readonly summary: string; readonly locale: string; readonly items: readonly FeedItem[] }

const xml = (value: string) => line(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** A consumer date as a timestamp; a bare calendar date is midnight UTC. No implicit clock. */
function timestamp(value: string): Date {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`feed: ${JSON.stringify(value)} is not a date`);
  return date;
}

/** An RSS 2.0 or Atom feed of the given items. Atom needs every item's `updated`; a missing one throws. */
export function buildFeed(input: FeedInput): string {
  const home = contentMapOrigin(input.origin).toString();
  for (const item of input.items) if (!https(item.url)) throw new TypeError(`feed: ${item.url} is not an absolute https URL`);
  if (input.format === "rss") {
    const dated = input.items.flatMap(item => item.updated === undefined ? [] : [timestamp(item.updated)]);
    const latest = dated.length ? new Date(Math.max(...dated.map(date => date.getTime()))) : undefined;
    const items = input.items.map(item => [
      "<item>", `<title>${xml(item.title)}</title>`, `<link>${xml(item.url)}</link>`, `<guid isPermaLink="true">${xml(item.url)}</guid>`,
      ...(item.updated === undefined ? [] : [`<pubDate>${timestamp(item.updated).toUTCString()}</pubDate>`]),
      ...(item.summary ? [`<description>${xml(item.summary)}</description>`] : []), "</item>",
    ].join(""));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xml(input.title)}</title><link>${xml(home)}</link><description>${xml(input.summary)}</description><language>${xml(input.locale)}</language>${latest ? `<lastBuildDate>${latest.toUTCString()}</lastBuildDate>` : ""}${items.join("")}</channel></rss>\n`;
  }
  const missing = input.items.find(item => item.updated === undefined);
  if (missing) throw new TypeError(`feed: Atom needs a lastModified for ${missing.url}`);
  const dates = input.items.map(item => timestamp(item.updated!));
  if (!dates.length) throw new TypeError("feed: Atom needs at least one dated item");
  const latest = new Date(Math.max(...dates.map(date => date.getTime())));
  const entries = input.items.map((item, index) => [
    "<entry>", `<title>${xml(item.title)}</title>`, `<id>${xml(item.url)}</id>`, `<link href="${xml(item.url)}"/>`, `<updated>${dates[index]!.toISOString()}</updated>`,
    ...(item.summary ? [`<summary>${xml(item.summary)}</summary>`] : []), "</entry>",
  ].join(""));
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(input.locale)}"><title>${xml(input.title)}</title><subtitle>${xml(input.summary)}</subtitle><id>${xml(home)}</id><link href="${xml(home)}"/><updated>${latest.toISOString()}</updated>${entries.join("")}</feed>\n`;
}

const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/y;
const TAG = /^<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>$/;

/** Well-formedness (balanced tags, escaped text) and the format's required elements. */
export function checkFeed(text: string, format: FeedFormat): readonly string[] {
  const issues: string[] = [];
  if (typeof text !== "string") return ["feed is not text"];
  if (CONTROL.test(text)) issues.push("feed holds a control character");
  const body = text.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const children = new Map<string, Set<string>>(); // element path -> child names
  let root: string | undefined;
  let index = 0;
  while (index < body.length) {
    const open = body.indexOf("<", index);
    const chunk = body.slice(index, open < 0 ? body.length : open);
    for (let at = chunk.indexOf("&"); at >= 0; at = chunk.indexOf("&", at + 1)) {
      ENTITY.lastIndex = at;
      if (!ENTITY.test(chunk)) { issues.push("feed holds an unescaped &"); break; }
    }
    if (chunk.trim() && !stack.length) issues.push("feed holds text outside its root element");
    if (open < 0) break;
    const close = body.indexOf(">", open);
    if (close < 0) { issues.push("feed has an unterminated tag"); break; }
    const tag = TAG.exec(body.slice(open, close + 1));
    if (!tag) { issues.push(`feed has a malformed tag at ${open}`); break; }
    const [, end, name, , self] = tag as unknown as [string, string, string, string, string];
    if (end) {
      if (stack.pop() !== name) { issues.push(`feed closes ${name} out of order`); break; }
    } else {
      if (!stack.length) { if (root !== undefined) { issues.push("feed has more than one root element"); break; } root = name; }
      const parent = stack.join("/");
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent)!.add(name);
      if (!self) stack.push(name);
    }
    index = close + 1;
  }
  if (stack.length) issues.push(`feed leaves ${stack.join(", ")} open`);
  const has = (path: string, name: string) => children.get(path)?.has(name) === true;
  if (format === "rss") {
    if (root !== "rss" || !has("rss", "channel")) issues.push("an RSS feed needs an rss root with a channel");
    for (const name of ["title", "link", "description"]) if (!has("rss/channel", name)) issues.push(`an RSS channel needs a ${name}`);
    if (has("rss/channel", "item")) for (const name of ["title", "link"]) if (!has("rss/channel/item", name)) issues.push(`an RSS item needs a ${name}`);
  } else {
    if (root !== "feed" || !/<feed\s[^>]*xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(body)) issues.push("an Atom feed needs a feed root in the Atom namespace");
    for (const name of ["title", "id", "updated"]) if (!has("feed", name)) issues.push(`an Atom feed needs an ${name}`);
    if (has("feed", "entry")) for (const name of ["title", "id", "updated"]) if (!has("feed/entry", name)) issues.push(`an Atom entry needs an ${name}`);
  }
  return issues;
}
