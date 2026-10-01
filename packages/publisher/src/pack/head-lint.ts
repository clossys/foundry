/**
 * Rendered-head lint (#1524, slice 2): checks the `<head>` of already
 * rendered HTML pages for complete metadata and a well-formed title, so a
 * page that would ship without a description, a share card or a canonical
 * address is refused before it is sealed. The rules mirror what
 * `web/siteMetadata.ts` emits; this module only reads HTML and never builds
 * any.
 *
 * Pure: no I/O, no clock, no network, no dependency. It never throws; input
 * it cannot use produces a finding, not an exception. A finding is a rule and
 * a route or tag only (`/about#og:image`) and never repeats a title, URL or
 * description taken from the HTML, so a refusal can be logged or posted.
 *
 * Scanning is deliberately tolerant. Attribute order and quote style do not
 * matter, comments and `<script>`/`<style>` bodies are skipped, a few common
 * character references are decoded, and a value that is blank after trimming
 * counts as missing. Scanning stops at `</head>` or `<body`, so a `<title>`
 * inside an inline graphic further down is never mistaken for the page title.
 */

import type { SealFinding } from "./seal.js";

export interface RenderedHeadPage {
  /** The route the page is served at: `/` or `/about`. Findings are keyed on it. */
  path: string;
  /** The rendered HTML document. */
  html: string;
}

export interface LintRenderedHeadInput {
  /** The site name every title carries. */
  siteName: string;
  pages: readonly RenderedHeadPage[];
}

const SEPARATOR = "·";

interface HeadScan {
  titles: string[];
  /** Lower-cased `name` or `property` value to the non-blank decoded `content` values, in document order. */
  metas: Map<string, string[]>;
  canonicals: string[];
}

/** The meta tags every page needs, in report order. Each is matched on `name` or `property`. */
const REQUIRED_METAS = ["description", "robots", "theme-color"] as const;
const REQUIRED_OG = ["og:title", "og:description", "og:url", "og:image", "og:site_name"] as const;
const REQUIRED_TWITTER = ["twitter:card", "twitter:title", "twitter:image"] as const;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: SEPARATOR,
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Decodes, collapses every whitespace run to one space and trims: the text a browser would show. */
function readable(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function isNameStart(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z]/.test(char);
}

interface ParsedTag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  /** Index just past the closing `>`. */
  end: number;
}

/** Parses one tag starting at `html[start] === "<"`; undefined when it is not a tag or never closes. */
function parseTag(html: string, start: number): ParsedTag | undefined {
  let index = start + 1;
  const closing = html[index] === "/";
  if (closing) index += 1;
  if (!isNameStart(html[index])) return undefined;
  const nameStart = index;
  while (index < html.length && !/[\s/>]/.test(html[index] as string)) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();
  const attrs = new Map<string, string>();
  while (index < html.length) {
    while (index < html.length && /[\s/]/.test(html[index] as string)) index += 1;
    if (index >= html.length) return undefined;
    if (html[index] === ">") return { name, closing, attrs, end: index + 1 };
    const attrStart = index;
    while (index < html.length && !/[\s=/>]/.test(html[index] as string)) index += 1;
    if (index === attrStart) {
      // a stray "=" or similar: step over it so the loop always advances
      index += 1;
      continue;
    }
    const attrName = html.slice(attrStart, index).toLowerCase();
    while (index < html.length && /\s/.test(html[index] as string)) index += 1;
    let value = "";
    if (html[index] === "=") {
      index += 1;
      while (index < html.length && /\s/.test(html[index] as string)) index += 1;
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        if (close === -1) return undefined;
        value = html.slice(index + 1, close);
        index = close + 1;
      } else {
        const valueStart = index;
        while (index < html.length && !/[\s>]/.test(html[index] as string)) index += 1;
        value = html.slice(valueStart, index);
      }
    }
    if (!attrs.has(attrName)) attrs.set(attrName, value);
  }
  return undefined;
}

function scanHead(html: string): HeadScan {
  const scan: HeadScan = { titles: [], metas: new Map(), canonicals: [] };
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) break;
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      if (close === -1) break;
      index = close + 3;
      continue;
    }
    const tag = parseTag(html, open);
    if (tag === undefined) {
      index = open + 1;
      continue;
    }
    index = tag.end;
    if (tag.closing) {
      if (tag.name === "head") break;
      continue;
    }
    if (tag.name === "body") break;
    if (tag.name === "script" || tag.name === "style") {
      const closer = new RegExp(`</${tag.name}\\s*>`, "gi");
      closer.lastIndex = index;
      const found = closer.exec(html);
      if (found === null) break;
      index = found.index + found[0].length;
    } else if (tag.name === "title") {
      const closer = /<\/title\s*>/gi;
      closer.lastIndex = index;
      const found = closer.exec(html);
      if (found === null) break;
      scan.titles.push(readable(html.slice(index, found.index)));
      index = found.index + found[0].length;
    } else if (tag.name === "meta") {
      const content = readable(tag.attrs.get("content") ?? "");
      if (content === "") continue;
      for (const attribute of ["name", "property"]) {
        const key = tag.attrs.get(attribute)?.trim().toLowerCase();
        if (key === undefined || key === "") continue;
        const values = scan.metas.get(key);
        if (values === undefined) scan.metas.set(key, [content]);
        else values.push(content);
      }
    } else if (tag.name === "link") {
      const rel = (tag.attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
      const href = readable(tag.attrs.get("href") ?? "");
      if (rel.includes("canonical") && href !== "") scan.canonicals.push(href);
    }
  }
  return scan;
}

/** A route safe to put in a finding: the caller's own route when it looks like one, else an index path. */
function reportRoute(route: unknown, index: number): string {
  return typeof route === "string" && /^\/[A-Za-z0-9._~%/-]*$/.test(route) && route.length <= 512 ? route : `pages[${index}]`;
}

function routePathname(route: string): string | undefined {
  try {
    return new URL(route, "https://route.invalid").pathname;
  } catch {
    return undefined;
  }
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

/** `title-format` or `title-separator` for a title that is not in the site's form; undefined when it is. */
function titleRule(title: string, siteName: string, isHome: boolean): string | undefined {
  const withoutSeparator = (rest: string): boolean => rest !== "" && !rest.includes(SEPARATOR);
  if (isHome) {
    const prefix = `${siteName} ${SEPARATOR} `;
    if (title.startsWith(prefix) && withoutSeparator(title.slice(prefix.length))) return undefined;
  } else {
    const suffix = ` ${SEPARATOR} ${siteName}`;
    if (title.endsWith(suffix) && withoutSeparator(title.slice(0, title.length - suffix.length))) return undefined;
  }
  // Mask the site name first, so a hyphen inside the name is not read as a separator.
  const masked = title.split(siteName).join("\u0000");
  if (!masked.includes(SEPARATOR) && /[|–—]|\s-\s/.test(masked)) return "title-separator";
  return "title-format";
}

/** Lints the rendered head of every page. Returns findings in page order; an empty array means every page is clean. */
export function lintRenderedHead(input: LintRenderedHeadInput): SealFinding[] {
  try {
    return lint(input);
  } catch {
    return [{ rule: "input-invalid", path: "input" }];
  }
}

function lint(input: LintRenderedHeadInput): SealFinding[] {
  const siteName = typeof input?.siteName === "string" ? input.siteName.trim() : "";
  if (siteName === "" || !Array.isArray(input.pages)) return [{ rule: "input-invalid", path: "input" }];

  const findings: SealFinding[] = [];
  let canonicalOrigin: string | undefined;

  input.pages.forEach((entry: unknown, index) => {
    const record = (typeof entry === "object" && entry !== null ? entry : {}) as Partial<RenderedHeadPage>;
    const route = reportRoute(record.path, index);
    const html = typeof record.html === "string" ? record.html : "";
    const scan = scanHead(html);
    const at = (tag: string): string => `${route}#${tag}`;
    const first = (key: string): string | undefined => scan.metas.get(key)?.[0];

    // completeness (L3)
    const title = scan.titles.find((candidate) => candidate !== "");
    if (title === undefined) findings.push({ rule: "head-missing", path: at("title") });
    for (const tag of REQUIRED_METAS) if (first(tag) === undefined) findings.push({ rule: "head-missing", path: at(tag) });
    if (scan.canonicals.length === 0) findings.push({ rule: "head-missing", path: at("canonical") });
    for (const tag of [...REQUIRED_OG, ...REQUIRED_TWITTER]) if (first(tag) === undefined) findings.push({ rule: "head-missing", path: at(tag) });

    // title shape (L4)
    if (scan.titles.length > 1) findings.push({ rule: "title-duplicate", path: route });
    if (title !== undefined) {
      const rule = titleRule(title, siteName, record.path === "/");
      if (rule !== undefined) findings.push({ rule, path: route });
      // consistency (L5)
      for (const tag of ["og:title", "twitter:title"]) {
        const value = first(tag);
        if (value !== undefined && value !== title) findings.push({ rule: "head-title-mismatch", path: at(tag) });
      }
    }

    // canonical address (L5)
    const canonical = scan.canonicals[0];
    if (canonical !== undefined) {
      let url: URL | undefined;
      try {
        url = new URL(canonical);
      } catch {
        url = undefined;
      }
      if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:")) {
        findings.push({ rule: "canonical-origin", path: at("canonical") });
      } else {
        const expected = routePathname(typeof record.path === "string" ? record.path : "");
        if (expected === undefined || withoutTrailingSlash(url.pathname) !== withoutTrailingSlash(expected)) findings.push({ rule: "canonical-path", path: at("canonical") });
        if (canonicalOrigin === undefined) canonicalOrigin = url.origin;
        else if (url.origin !== canonicalOrigin) findings.push({ rule: "canonical-origin", path: at("canonical") });
      }
    }
  });

  return findings;
}
