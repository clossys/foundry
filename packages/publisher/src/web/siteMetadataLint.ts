/**
 * Checks a rendered HTML document's `<head>` for the declared set of site
 * metadata tags (`SITE_METADATA_REQUIRED_TAGS`) and reports EVERY problem in
 * one pass: each tag that is missing, each tag whose value is empty, and each
 * tag present more than once. It pairs with `buildSiteMetadata`: that
 * function produces the values, this one checks that a page that was actually
 * rendered carries a usable, single copy of each tag.
 *
 * INVARIANT. `complete: true` only when a spec-compliant HTML parser (with
 * scripting on or off) puts exactly one non-blank copy of each declared tag
 * directly in `<head>`. The lint is COMPLETE only on the markup a framework
 * writes and SOUND on any input: it is a strict grammar, not a repairing
 * parser, so anything it does not recognise is `unreadable`. It never guesses
 * and never widens what it detects; it refuses.
 *
 * GRAMMAR. Tag and attribute names are ASCII case-insensitive.
 *
 *   - Before `<head>`: whitespace, comments, one `<!doctype …>`, and one
 *     `<html …>`, in that order. A byte order mark is refused, because a
 *     parser fed a string reads it as text and closes the head.
 *   - Inside the head: whitespace, comments, and `<meta>`, `<link>` and
 *     `<base>` elements.
 *   - Raw-text elements inside the head: `<title>`, `<style>` and `<script>`,
 *     each skipped to its own end tag. A `<script>` whose text contains
 *     `<!--` is refused, because a parser then reads the text differently.
 *   - The only end tag: `</head>`.
 *   - After `</head>`: whitespace and comments, then end of input or `<body`.
 *     A parser puts a `meta`, `link` or `title` found there into the head, so
 *     anything else between `</head>` and `<body` is `unreadable`. Nothing after
 *     `<body` is read.
 *   - A comment whose text contains `--!>` is refused, because a parser
 *     closes it there.
 *   - Everything else is `unreadable`: any other start or end tag (including
 *     `<template>` and `<noscript>`), non-whitespace text, a `<` or `</` not
 *     followed by a letter, a `<!` that is not a comment (or the one doctype
 *     before the head), and `<?`.
 *
 * VALUES. The declared tags are read from these attribute forms only:
 *
 *   - `<title>` text;
 *   - `<meta name="…" content="…">` for `description`, `robots`,
 *     `theme-color` and `twitter:*` (read only from `name`);
 *   - `<meta property="…" content="…">` for `og:*` (read only from
 *     `property`);
 *   - `<link rel="canonical" href="…">` (`canonical` may be one token of a
 *     space-separated `rel`).
 *
 * Attribute values may be double-quoted, single-quoted, or unquoted. Every
 * `&` that is followed by a letter or `#` must start one of the closed set
 * `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#N;` or `&#xH;`. A value of a
 * declared tag (or a title) with any other character reference gets an
 * `unreadable` finding for that tag; an identity attribute (`name`,
 * `property`, `rel`) with one gets an `unreadable` finding for its element,
 * because it could decode to a declared key. The closed set is decoded to read
 * an identity and to decide whether a value is empty (trimmed, so a numeric
 * reference to a no-break space is empty, exactly as a raw one is).
 *
 * WHAT IT DOES NOT CHECK. Within that grammar it checks the PRESENCE,
 * UNIQUENESS and NON-EMPTINESS of the declared set, not whether a value is
 * true, correct for the page, an absolute URL, a valid image, or whether two
 * tags agree (a `<title>` that differs from `og:title` passes). Metadata that
 * a framework streams into the body is reported missing, and is never counted.
 * Whatever follows `<body` is not read.
 *
 * UNREADABLE INPUT. When the head cannot be read, the result is a single
 * `unreadable` finding with `complete: false` and no claim about which tags
 * are missing: a non-string or blank input, no `<head>` element, a `<head>`
 * with no `</head>`, more than one `<head>` open tag, anything outside the
 * grammar above before the head closes, or anything other than whitespace and
 * comments between `</head>` and end of input or `<body`. An unterminated
 * construct after `<body` is not reported. The function does not throw for any
 * input.
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
  /** The required tag's `key`, or for `unreadable` the construct that could not be read (`"head"`, `"comment"`, `"text"`, `"meta"`, ...). */
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

/** The raw-text elements accepted inside the head; their text is read without tags. */
const HEAD_RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["title", "script", "style"]);

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

function skipWhitespace(html: string, from: number): number {
  let p = from;
  while (p < html.length && isWhitespace(html.charAt(p))) p += 1;
  return p;
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

function tagFailure(error: TagError): Unreadable {
  return error.error === "quote"
    ? { tag: "attribute", message: "A tag has an attribute value whose quote is not terminated." }
    : { tag: "tag", message: "A tag is not terminated." };
}

/** Reads a comment that starts at `at` (`<!--`). It is refused if it is unterminated or a browser would close it earlier at `--!>`. */
function readComment(html: string, at: number): { end: number } | Unreadable {
  const close = html.indexOf("-->", at + 2);
  if (close === -1) return { tag: "comment", message: "An HTML comment is not terminated." };
  if (html.slice(at + 4, close).includes("--!>")) {
    return { tag: "comment", message: "An HTML comment contains --!>, where a browser closes it early." };
  }
  return { end: close + 3 };
}

function shortName(name: string): string {
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

/**
 * Reads the document up to the end of its single `<head>` under the strict
 * grammar described at the top of this file, collecting the title text and
 * the `<meta>` / `<link>` attributes found directly in the head. Anything the
 * grammar does not name is refused. Tokenizing starts at the top of the
 * document so a `<head>` inside a comment or raw-text element is never
 * mistaken for the real one.
 */
function scanHead(html: string): HeadContents | Unreadable {
  const contents: HeadContents = { titles: [], metas: [], links: [] };
  const length = html.length;
  let i = 0;

  // Before the head: whitespace, comments, one doctype, one <html>, then <head>.
  let sawDoctype = false;
  let sawHtml = false;
  for (;;) {
    i = skipWhitespace(html, i);
    if (i >= length) return { tag: "head", message: "The document has no <head> element." };
    if (html.charAt(i) !== "<") return { tag: "text", message: "Text or a byte order mark appears before the <head>." };

    if (html.startsWith("<!--", i)) {
      const comment = readComment(html, i);
      if ("message" in comment) return comment;
      i = comment.end;
      continue;
    }

    const next = html.charAt(i + 1);
    if (next === "!") {
      const keyword = asciiLower(html.slice(i + 2, i + 9));
      const after = html.charAt(i + 9);
      if (keyword !== "doctype" || sawDoctype || sawHtml || !(after === ">" || isWhitespace(after))) {
        return { tag: "declaration", message: "Only one <!doctype> is accepted, before <html> and the <head>." };
      }
      const end = html.indexOf(">", i + 9);
      if (end === -1) return { tag: "tag", message: "A declaration is not terminated." };
      sawDoctype = true;
      i = end + 1;
      continue;
    }

    if (next === "/" || next === "?" || !isAsciiLetter(next)) {
      return { tag: "markup", message: "The document has markup other than a comment, a doctype, <html>, or <head> before the <head>." };
    }
    const tag = readTag(html, i + 1);
    if ("error" in tag) return tagFailure(tag);
    i = tag.end;
    if (tag.name === "head") break;
    if (tag.name === "html" && !sawHtml) {
      sawHtml = true;
      continue;
    }
    return { tag: "head", message: `A <${shortName(tag.name)}> appears before the <head>.` };
  }

  // Inside the head: whitespace, comments, meta, link, base, title, style, script, and </head>.
  for (;;) {
    i = skipWhitespace(html, i);
    if (i >= length) return { tag: "head", message: "The <head> element is not closed by a </head>." };
    if (html.charAt(i) !== "<") return { tag: "text", message: "Text appears inside the <head>." };

    if (html.startsWith("<!--", i)) {
      const comment = readComment(html, i);
      if ("message" in comment) return comment;
      i = comment.end;
      continue;
    }

    const next = html.charAt(i + 1);
    if (next === "!" || next === "?") {
      return { tag: "declaration", message: "A declaration or processing instruction appears inside the <head>." };
    }
    const closing = next === "/";
    const nameStart = i + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charAt(nameStart))) {
      return { tag: "markup", message: "A '<' inside the <head> is not followed by a tag name." };
    }

    const tag = readTag(html, nameStart);
    if ("error" in tag) return tagFailure(tag);

    if (closing) {
      if (tag.name !== "head") {
        return { tag: "head", message: `An end tag </${shortName(tag.name)}> appears inside the <head>.` };
      }
      i = tag.end;
      break;
    }

    if (tag.name === "meta") {
      contents.metas.push(tag.attrs);
      i = tag.end;
    } else if (tag.name === "link") {
      contents.links.push(tag.attrs);
      i = tag.end;
    } else if (tag.name === "base") {
      i = tag.end;
    } else if (HEAD_RAW_TEXT_ELEMENTS.has(tag.name)) {
      const textStart = tag.end;
      const close = findRawTextClose(html, textStart, tag.name);
      if (close === -1) return { tag: tag.name, message: `A <${tag.name}> element is not terminated.` };
      const text = html.slice(textStart, close);
      if (tag.name === "script" && text.includes("<!--")) {
        return { tag: "script", message: "A <script> contains <!--, where a browser reads its text differently." };
      }
      const end = readTag(html, close + 2);
      if ("error" in end) return tagFailure(end);
      if (tag.name === "title") contents.titles.push(text);
      i = end.end;
    } else if (tag.name === "head") {
      return { tag: "head", message: "The document has more than one <head> open tag." };
    } else if (tag.name === "body") {
      return { tag: "head", message: "A <body> opens before the <head> is closed." };
    } else {
      return { tag: "head", message: `A <${shortName(tag.name)}> appears inside the <head>.` };
    }
  }

  const afterHead = scanAfterHead(html, i);
  return afterHead ?? contents;
}

/**
 * After `</head>` a parser stays in its "after head" mode until `<body>`, and
 * in that mode a `meta`, `link`, `title`, `base`, `script`, `style`, `template`
 * or `noscript` start tag is put INTO the head. So the lint accepts only
 * whitespace and comments, then end of input or `<body` (followed by
 * whitespace, `/` or `>`); anything else is refused. What follows `<body` is
 * never read.
 */
function scanAfterHead(html: string, from: number): Unreadable | null {
  const length = html.length;
  let i = from;
  for (;;) {
    i = skipWhitespace(html, i);
    if (i >= length) return null;

    if (html.startsWith("<!--", i)) {
      const comment = readComment(html, i);
      if ("message" in comment) return comment;
      i = comment.end;
      continue;
    }

    if (asciiLower(html.slice(i, i + 5)) === "<body") {
      const after = html.charAt(i + 5);
      if (after !== "" && (isWhitespace(after) || after === "/" || after === ">")) return null;
    }
    return {
      tag: "head",
      message: "Something other than whitespace, a comment or <body> follows </head>, where a parser moves head elements into the head.",
    };
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const NUMERIC_REFERENCE = /&#(?:[xX][0-9a-fA-F]+|[0-9]+);/y;
const NAMED_REFERENCES = ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"] as const;

/** True when a `&` that starts a possible character reference is not one of the closed set. */
function hasReferenceOutsideClosedSet(text: string): boolean {
  let at = text.indexOf("&");
  while (at !== -1) {
    const next = text.charAt(at + 1);
    if (isAsciiLetter(next) || next === "#") {
      NUMERIC_REFERENCE.lastIndex = at;
      if (!NAMED_REFERENCES.some((reference) => text.startsWith(reference, at)) && !NUMERIC_REFERENCE.test(text)) return true;
    }
    at = text.indexOf("&", at + 1);
  }
  return false;
}

/** Decodes the closed reference set. Only meaningful for text that `hasReferenceOutsideClosedSet` accepted. */
function decodeReferences(text: string): string {
  return text.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g, (_match, hex?: string, dec?: string, named?: string) => {
    if (named !== undefined) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named] ?? "";
    const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? "", 10);
    if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return "\ufffd";
    }
    return String.fromCodePoint(codePoint);
  });
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

interface Reading {
  /** The decoded value, trimmed only when judged for blankness. */
  value: string;
  /** True when the raw value carries a character reference outside the closed set. */
  refused: boolean;
}

function read(raw: string): Reading {
  return { value: decodeReferences(raw), refused: hasReferenceOutsideClosedSet(raw) };
}

/** The identity attributes a declared tag is matched on, per element. */
const IDENTITY_ATTRIBUTES: Record<"meta" | "link", readonly string[]> = { meta: ["name", "property"], link: ["rel"] };

/** True when an identity attribute of the element carries a reference outside the closed set, so its decoded identity is unknown. */
function hasUnknownIdentity(element: "meta" | "link", attrs: Map<string, string>): boolean {
  return IDENTITY_ATTRIBUTES[element].some((name) => hasReferenceOutsideClosedSet(attrs.get(name) ?? ""));
}

function identityOf(attrs: Map<string, string>, name: string): string {
  return asciiLower(decodeReferences(attrs.get(name) ?? ""));
}

function valuesFor(entry: SiteMetadataRequiredTag, contents: HeadContents): Reading[] {
  switch (entry.selector) {
    case "title":
      return contents.titles.map(read);
    case "meta-name":
    case "meta-property": {
      const identity = entry.selector === "meta-name" ? "name" : "property";
      return contents.metas
        .filter((attrs) => !hasUnknownIdentity("meta", attrs) && identityOf(attrs, identity) === entry.key)
        .map((attrs) => read(attrs.get(entry.attr ?? "content") ?? ""));
    }
    case "link-rel":
      return contents.links
        .filter(
          (attrs) =>
            !hasUnknownIdentity("link", attrs) &&
            identityOf(attrs, "rel")
              .split(/[ \t\n\r\f]+/)
              .includes(entry.key),
        )
        .map((attrs) => read(attrs.get(entry.attr ?? "href") ?? ""));
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
    for (const element of ["meta", "link"] as const) {
      const attributeSets = element === "meta" ? contents.metas : contents.links;
      if (attributeSets.some((attrs) => hasUnknownIdentity(element, attrs))) {
        findings.push({
          rule: "unreadable",
          tag: element,
          message: `A <${element}> identity attribute has a character reference outside the closed set, so which tag it names is unknown.`,
        });
      }
    }
    for (const entry of SITE_METADATA_REQUIRED_TAGS) {
      const values = valuesFor(entry, contents);
      const label = describeTag(entry);
      if (values.length === 0) {
        findings.push({ rule: "missing", tag: entry.key, message: `${label} is missing from the head.` });
        continue;
      }
      if (values.some((reading) => reading.refused)) {
        findings.push({
          rule: "unreadable",
          tag: entry.key,
          message: `${label} has a character reference outside the closed set (&amp;, &lt;, &gt;, &quot;, &apos;, numeric).`,
        });
      }
      if (values.some((reading) => !reading.refused && isBlank(reading.value))) {
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
