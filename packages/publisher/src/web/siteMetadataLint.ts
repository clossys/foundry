/**
 * Checks a rendered HTML document's `<head>` for the declared set of site
 * metadata tags (`SITE_METADATA_REQUIRED_TAGS`) and reports EVERY problem in
 * one pass: each tag that is missing, each tag whose value is empty, and each
 * tag present more than once. It pairs with `buildSiteMetadata`: that
 * function produces the values, this one checks that a page that was actually
 * rendered carries a usable, single copy of each tag.
 *
 * SOUNDNESS BOUNDARY. This checks the PRESENCE, UNIQUENESS and
 * NON-EMPTINESS of the declared set and nothing else. It does NOT check that
 * a value is true, correct for the page, an absolute URL, a valid image, or
 * that any two tags agree with each other (a `<title>` that differs from
 * `og:title` passes). It reads only the `<head>` element, and only the
 * attribute forms below:
 *
 *   - `<title>` text;
 *   - `<meta name="…" content="…">` for `description`, `robots`,
 *     `theme-color` and `twitter:*` (read only from `name`);
 *   - `<meta property="…" content="…">` for `og:*` (read only from
 *     `property`);
 *   - `<link rel="canonical" href="…">` (`canonical` may be one token of a
 *     space-separated `rel`).
 *
 * Tag and attribute names are matched case-insensitively; values may be
 * double-quoted, single-quoted, or unquoted. A value's HTML entities
 * (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&#x27;`, and numeric
 * references) are decoded ONLY to decide whether it is empty — never to
 * change which tag an element is. Anything outside `<head>` (including
 * everything in `<body>`) is never counted, and neither is anything inside a
 * comment, a `<script>`, `<style>`, `<textarea>`, `<template>` or
 * `<noscript>`.
 *
 * UNREADABLE INPUT. When the head cannot be read, the result is a single
 * `unreadable` finding with `complete: false` and no claim about which tags
 * are missing: a non-string or blank input, no `<head>` element, a `<head>`
 * with no `</head>`, more than one `<head>` open tag, a `<body>` opened
 * before `</head>`, or an unterminated comment, tag, attribute quote,
 * `<title>`, `<script>`, `<style>` or `<textarea>` before the head closes.
 * An unterminated construct AFTER `</head>` is not reported, because the
 * head has already been read in full by then.
 *
 * The parser is a small dependency-free tolerant tokenizer, not a regular
 * expression over the whole document and not a full HTML parser: it does not
 * apply HTML's implied-element or error-recovery rules, so markup a browser
 * would repair may be reported `unreadable` here instead. The function does
 * not throw for any input.
 */

export type SiteMetadataTagSelector = "title" | "meta-name" | "meta-property" | "link-rel";

export interface SiteMetadataRequiredTag {
  /** The `name`, `property`, or `rel` value matched, and the tag identifier reported in findings (`"title"` for `<title>`). */
  key: string;
  selector: SiteMetadataTagSelector;
  /** The attribute that carries the value: `content` for meta, `href` for link; absent for `<title>` (its text is the value). */
  attr?: string;
}

/** The declared set of head tags a complete site page carries, in the order findings are reported. */
export const SITE_METADATA_REQUIRED_TAGS: readonly SiteMetadataRequiredTag[] = [
  { key: "title", selector: "title" },
  { key: "description", selector: "meta-name", attr: "content" },
  { key: "robots", selector: "meta-name", attr: "content" },
  { key: "theme-color", selector: "meta-name", attr: "content" },
  { key: "canonical", selector: "link-rel", attr: "href" },
  { key: "og:title", selector: "meta-property", attr: "content" },
  { key: "og:description", selector: "meta-property", attr: "content" },
  { key: "og:url", selector: "meta-property", attr: "content" },
  { key: "og:site_name", selector: "meta-property", attr: "content" },
  { key: "og:type", selector: "meta-property", attr: "content" },
  { key: "og:locale", selector: "meta-property", attr: "content" },
  { key: "og:image", selector: "meta-property", attr: "content" },
  { key: "og:image:alt", selector: "meta-property", attr: "content" },
  { key: "og:image:width", selector: "meta-property", attr: "content" },
  { key: "og:image:height", selector: "meta-property", attr: "content" },
  { key: "twitter:card", selector: "meta-name", attr: "content" },
  { key: "twitter:title", selector: "meta-name", attr: "content" },
  { key: "twitter:description", selector: "meta-name", attr: "content" },
  { key: "twitter:image", selector: "meta-name", attr: "content" },
  { key: "twitter:image:alt", selector: "meta-name", attr: "content" },
];

export type SiteMetadataLintRule = "missing" | "empty" | "duplicate" | "unreadable";

export interface SiteMetadataLintFinding {
  rule: SiteMetadataLintRule;
  /** The required tag's `key`, or for `unreadable` the construct that could not be read (`"head"`, `"comment"`, `"tag"`, ...). */
  tag: string;
  message: string;
}

export interface SiteMetadataLintResult {
  /** True only when `findings` is empty. */
  complete: boolean;
  findings: SiteMetadataLintFinding[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface StartTag {
  name: string;
  attrs: Map<string, string>;
  end: number;
}

interface TagError {
  error: "tag" | "quote";
}

interface HeadContents {
  titles: string[];
  metas: Array<Map<string, string>>;
  links: Array<Map<string, string>>;
}

interface Unreadable {
  tag: string;
  message: string;
}

const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["title", "script", "style", "textarea"]);

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

/** ASCII-only lower-casing, so a non-ASCII character can never fold into a tag or attribute name. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Reads a tag whose name starts at `nameStart` (just past `<` or `</`). Returns the tag, or why it is unterminated. */
function readTag(html: string, nameStart: number): StartTag | TagError {
  const length = html.length;
  let p = nameStart;
  while (p < length) {
    const char = html.charAt(p);
    if (isWhitespace(char) || char === "/" || char === ">") break;
    p += 1;
  }
  const name = asciiLower(html.slice(nameStart, p));
  const attrs = new Map<string, string>();

  for (;;) {
    while (p < length && (isWhitespace(html.charAt(p)) || html.charAt(p) === "/")) p += 1;
    if (p >= length) return { error: "tag" };
    if (html.charAt(p) === ">") return { name, attrs, end: p + 1 };

    const attrStart = p;
    p += 1;
    while (p < length) {
      const char = html.charAt(p);
      if (isWhitespace(char) || char === "=" || char === "/" || char === ">") break;
      p += 1;
    }
    const attrName = asciiLower(html.slice(attrStart, p));
    while (p < length && isWhitespace(html.charAt(p))) p += 1;

    let value = "";
    if (html.charAt(p) === "=") {
      p += 1;
      while (p < length && isWhitespace(html.charAt(p))) p += 1;
      if (p >= length) return { error: "tag" };
      const quote = html.charAt(p);
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, p + 1);
        if (close === -1) return { error: "quote" };
        value = html.slice(p + 1, close);
        p = close + 1;
      } else {
        const valueStart = p;
        while (p < length && !isWhitespace(html.charAt(p)) && html.charAt(p) !== ">") p += 1;
        value = html.slice(valueStart, p);
      }
    }
    if (!attrs.has(attrName)) attrs.set(attrName, value);
  }
}

/** Index of the `</name` that closes a raw-text element (followed by whitespace, `/` or `>`), or -1 if there is none. */
function findRawTextClose(html: string, from: number, name: string): number {
  let p = from;
  for (;;) {
    const at = html.indexOf("</", p);
    if (at === -1) return -1;
    const candidate = asciiLower(html.slice(at + 2, at + 2 + name.length));
    if (candidate === name) {
      const after = html.charAt(at + 2 + name.length);
      if (after !== "" && (isWhitespace(after) || after === "/" || after === ">")) return at;
    }
    p = at + 2;
  }
}

/**
 * Scans the document for its single `<head>` and collects the title text and
 * the `<meta>` / `<link>` attributes found directly in it. Tokenizing starts at
 * the top of the document only so a `<head>` inside a comment or raw-text
 * element is never mistaken for the real one.
 */
function scanHead(html: string): HeadContents | Unreadable {
  const contents: HeadContents = { titles: [], metas: [], links: [] };
  const length = html.length;
  let state: "before" | "in" | "after" = "before";
  let headOpens = 0;
  let hiddenDepth = 0;
  let i = 0;

  /** After the head has closed, an unreadable remainder is not this scan's concern: stop, do not fail. */
  const fail = (tag: string, message: string): Unreadable | null => (state === "after" ? null : { tag, message });

  while (i < length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    i = lt;

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 2);
      if (end === -1) {
        const failure = fail("comment", "An HTML comment is not terminated.");
        if (failure) return failure;
        break;
      }
      i = end + 3;
      continue;
    }

    const next = html.charAt(i + 1);
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", i + 2);
      if (end === -1) {
        const failure = fail("tag", "A declaration or processing instruction is not terminated.");
        if (failure) return failure;
        break;
      }
      i = end + 1;
      continue;
    }

    const closing = next === "/";
    const nameStart = i + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charAt(nameStart))) {
      i += 1;
      continue;
    }

    const tag = readTag(html, nameStart);
    if ("error" in tag) {
      const failure =
        tag.error === "quote"
          ? fail("attribute", "A tag has an attribute value whose quote is not terminated.")
          : fail("tag", "A tag is not terminated.");
      if (failure) return failure;
      break;
    }
    i = tag.end;

    if (closing) {
      if (tag.name === "head" && state === "in") {
        state = "after";
        hiddenDepth = 0;
      } else if ((tag.name === "template" || tag.name === "noscript") && hiddenDepth > 0) {
        hiddenDepth -= 1;
      }
      continue;
    }

    if (tag.name === "head") {
      headOpens += 1;
      if (headOpens > 1) return { tag: "head", message: "The document has more than one <head> open tag." };
      state = "in";
      continue;
    }

    if (state === "in" && tag.name === "body") {
      return { tag: "head", message: "A <body> opens before the <head> is closed." };
    }

    if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      const close = findRawTextClose(html, i, tag.name);
      if (close === -1) {
        const failure = fail(tag.name, `A <${tag.name}> element is not terminated.`);
        if (failure) return failure;
        break;
      }
      if (tag.name === "title" && state === "in" && hiddenDepth === 0) contents.titles.push(html.slice(i, close));
      i = close;
      continue;
    }

    if (state !== "in") continue;

    if (tag.name === "template" || tag.name === "noscript") {
      hiddenDepth += 1;
    } else if (hiddenDepth === 0) {
      if (tag.name === "meta") contents.metas.push(tag.attrs);
      else if (tag.name === "link") contents.links.push(tag.attrs);
    }
  }

  if (headOpens === 0) return { tag: "head", message: "The document has no <head> element." };
  if (state === "in") return { tag: "head", message: "The <head> element is not closed by a </head>." };
  return contents;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Decodes the minimal entity set, only so the caller can tell whether a value is empty. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot));/g, (_match, hex?: string, dec?: string, named?: string) => {
    if (named !== undefined) return { amp: "&", lt: "<", gt: ">", quot: '"' }[named] ?? "";
    const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? "", 10);
    if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "�";
    }
    return String.fromCodePoint(codePoint);
  });
}

function isBlank(value: string): boolean {
  return decodeEntities(value).trim() === "";
}

function valuesFor(entry: SiteMetadataRequiredTag, contents: HeadContents): string[] {
  switch (entry.selector) {
    case "title":
      return contents.titles;
    case "meta-name":
    case "meta-property": {
      const identity = entry.selector === "meta-name" ? "name" : "property";
      return contents.metas
        .filter((attrs) => asciiLower(attrs.get(identity) ?? "") === entry.key)
        .map((attrs) => attrs.get(entry.attr ?? "content") ?? "");
    }
    case "link-rel":
      return contents.links
        .filter((attrs) =>
          asciiLower(attrs.get("rel") ?? "")
            .split(/[ \t\n\r\f]+/)
            .includes(entry.key),
        )
        .map((attrs) => attrs.get(entry.attr ?? "href") ?? "");
  }
}

function describeTag(entry: SiteMetadataRequiredTag): string {
  switch (entry.selector) {
    case "title":
      return "<title>";
    case "meta-name":
      return `<meta name="${entry.key}">`;
    case "meta-property":
      return `<meta property="${entry.key}">`;
    case "link-rel":
      return `<link rel="${entry.key}">`;
  }
}

function unreadableResult(tag: string, message: string): SiteMetadataLintResult {
  return { complete: false, findings: [{ rule: "unreadable", tag, message }] };
}

export function lintSiteMetadataHtml(html: unknown): SiteMetadataLintResult {
  try {
    if (typeof html !== "string") return unreadableResult("input", "The input is not a string.");
    if (html.trim() === "") return unreadableResult("input", "The input is empty or blank.");

    const contents = scanHead(html);
    if ("message" in contents) return unreadableResult(contents.tag, contents.message);

    const findings: SiteMetadataLintFinding[] = [];
    for (const entry of SITE_METADATA_REQUIRED_TAGS) {
      const values = valuesFor(entry, contents);
      const label = describeTag(entry);
      if (values.length === 0) {
        findings.push({ rule: "missing", tag: entry.key, message: `${label} is missing from the head.` });
        continue;
      }
      if (values.some(isBlank)) {
        findings.push({ rule: "empty", tag: entry.key, message: `${label} has an empty value.` });
      }
      if (values.length > 1) {
        findings.push({ rule: "duplicate", tag: entry.key, message: `${label} appears ${values.length} times in the head.` });
      }
    }
    return { complete: findings.length === 0, findings };
  } catch {
    return unreadableResult("input", "The input could not be read.");
  }
}
