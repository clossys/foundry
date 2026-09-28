/**
 * `checkBrandFactsDrift` — does every surface still say what
 * `brand-facts.json` says? Pure: takes already-read file contents (the same
 * `ScannedFile[]` `scanStrategyDirectory` gathers for the facts gate), an
 * already-validated `BrandFacts`, and optionally the Writer copy-registry
 * entries; does no I/O and never throws.
 *
 * THE RULE, in one sentence: a statement on a surface that names the legal
 * entity, its incorporation or jurisdiction, the brand name, a brand host or
 * origin, a brand email address, or a tagline must say exactly what the
 * record says — anything else is reported as drift, one finding per
 * (kind, file, line, found).
 *
 * The heuristics are line-based and deliberately narrow, in the same spirit
 * as `facts-gate.ts`: a check that fires on third-party company names,
 * subdomains, or hostnames that merely contain the brand gets disabled, and
 * a disabled check protects nothing. So:
 *
 *   - A company-suffixed phrase ("... LLC", "... Ltd") is the brand's only
 *     when its leading capitalized words include the brand name; any other
 *     is a third party and is left alone. The "incorporated/registered/
 *     organized in <Place>" form is likewise skipped on a line that names a
 *     third-party company and never the brand.
 *   - URLs, email addresses, and hostnames ending in a recorded domain are
 *     blanked before the brand-casing check, and a brand-name match touching
 *     `@`, `/`, `_`, `-`, a letter/digit, or a `.` that joins it to another
 *     letter/digit is not a whole word — so "brand.io", "x@brand", and
 *     "brand-ui" never read as miscasing, while a sentence-ending period
 *     does not hide one.
 *   - A subdomain of a recorded domain is neither a wrong domain nor a
 *     non-canonical origin; only the hosts the record lists are held to
 *     `canonicalOrigin`.
 *   - "registered in <Month>" is a date, not a jurisdiction.
 *   - A key/value line with an unquoted value counts only when the key opens
 *     the line (YAML/frontmatter shape), so prose like "our domain: ..." in
 *     mid-sentence is not read as a declaration; a `domain` value is compared
 *     only when it is host-shaped.
 *
 * FAILS CLOSED. Zero files scanned is "indeterminate", never "clean" — no
 * surface was checked. Taglines recorded but no copy entries supplied is
 * "indeterminate" too — the record's taglines are references into the
 * Writer registry, and without it there is no text to hold a surface to.
 * Indeterminate wins over drift; findings are still returned.
 *
 * LINEAR TIME, BOUNDED LINES. Every matcher runs in time linear in the length
 * of one line: a quantifier that could be retried from every start position
 * is bounded (company phrases read at most 8 capitalized words of at most 40
 * characters, separated by at most 4 whitespace characters) or replaced by an
 * index scan (trailing trims, the host cut). A line over `MAX_LINE_CHARS` is
 * not checked at all: it makes the result "indeterminate", naming file:line,
 * and the cap is applied before the ignore marker, so a line that was not
 * read never counts as clean or as an override. Detection is lexical: it
 * catches only the forms above, and a conflict stated any other way is not
 * detected.
 *
 * ESCAPE HATCH: a line carrying `brand-facts:ignore` inside a comment opener
 * (`<!--`, `/*`, `{/*`, `//`, or `#` as the first non-blank character of the
 * line) — the same shape as the facts gate's `facts-gate:ignore` — is recorded
 * in `ignored` and not checked. The marker silences its whole physical line,
 * so it silences a whole single-line file. Recorded, never silent.
 */

import type { BrandFacts, CopyEntryLike } from "./brand-facts.js";
import { resolveBrandTaglines } from "./brand-facts.js";
import type { ScannedFile } from "./facts-gate.js";

export type BrandFactsDriftKind =
  | "legal-name"
  | "incorporation"
  | "jurisdiction"
  | "brand-casing"
  | "domain"
  | "canonical-origin"
  | "contact-email"
  | "tagline"
  | "tagline-unresolved";

export interface BrandFactsDriftFinding {
  kind: BrandFactsDriftKind;
  file: string;
  /** 1-based; 0 for a finding about the record itself (`tagline-unresolved`). */
  line: number;
  found: string;
  expected: string;
  message: string;
}

export interface BrandFactsDriftOptions {
  /** Writer copy-registry entries (see `copyEntriesFromRegistry`). Required to check taglines. */
  copyEntries?: readonly CopyEntryLike[];
}

export type BrandFactsDriftState = "clean" | "drift" | "indeterminate";

export interface BrandFactsDriftResult {
  state: BrandFactsDriftState;
  findings: BrandFactsDriftFinding[];
  ignored: { file: string; line: number; snippet: string }[];
  filesScanned: number;
  /** Non-empty exactly when `state` is "indeterminate". */
  indeterminateReasons: string[];
}

// --------------------------------------------------------------- matchers

/**
 * A line longer than this is not checked: it makes the result "indeterminate".
 * @internal
 */
export const MAX_LINE_CHARS = 16384;

/** `#` opens the marker only as the first non-blank character; anywhere else it is a URL fragment or a heading. */
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*brand-facts:ignore\b|^\s*#\s*brand-facts:ignore\b/i;
/** How many over-cap lines are listed one by one in `indeterminateReasons`; the rest are counted. */
const MAX_LONG_LINE_REASONS = 20;

const URL_RE = /\bhttps?:\/\/[^\s"'<>()[\]{}`\\]+/gi;
const URL_PARTS_RE = /^(https?):\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::(\d+))?/i;
const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const HOST_SHAPE_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

const COMPANY_SUFFIX = String.raw`(?:Pty\s{1,4}Ltd\.?|Inc\.?|L\.L\.C\.|LLC|Ltd\.?|Limited|Corp\.?|Corporation|GmbH|PLC|LLP|B\.V\.|S\.A\.|AG)`;
const CAP_WORD = String.raw`\p{Lu}[\p{L}\p{N}&'’-]{0,39}`;
/**
 * Up to 8 capitalized words, then an optional comma, then a company suffix.
 * Group 1 is the leading words. Linear: every quantifier is bounded, and a
 * word (letters, digits, `&`, `'`, `-`) and its separator (whitespace) never
 * share a character, so a start position does at most a constant amount of
 * work and the lookbehind confines starts to word boundaries.
 * @internal
 */
export const COMPANY_PHRASE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])((?:${CAP_WORD}\s{1,4}){0,7}${CAP_WORD}),?\s{1,4}${COMPANY_SUFFIX}(?![\p{L}\p{N}])`,
  "gu",
);

const INCORPORATED_WORDS_RE = /\bincorporated\s+(?:in|under)\b/gi;
const JURISDICTION_FORMED_RE = /\b(?:incorporated|registered|organized|organised)\s+(?:in|under\s+the\s+laws\s+of)\s+/gi;
const JURISDICTION_GOVERNED_RE = /\bgoverned\s+by\s+the\s+laws\s+of\s+/gi;
const PLACE_PREFIX_RE = /^(?:the\s+)?(?:state\s+of\s+)?/i;
const PLACE_RE = /^\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:and|of)\s+)?\p{Lu}[\p{L}'’-]*)*/u;
const NOT_PLACES = new Set(
  [
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ],
);

/** `[^<>]` stops at the next `<`, so a run of `<meta` openers is not rescanned from each one. @internal */
export const META_TAG_RE = /<meta\b[^<>]*>/gi;
const OG_SITE_NAME_RE = /\b(?:property|name)\s*=\s*["']og:site_name["']/i;
const META_CONTENT_RE = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const LEGAL_NAME_KEYS = ["legalName", "legal_name", "companyName", "company_name", "legalEntityName"];
const JURISDICTION_KEYS = ["jurisdiction"];
const BRAND_NAME_KEYS = ["brandName", "brand_name", "siteName", "site_name", "applicationName"];
const DOMAIN_KEYS = ["domain", "primaryDomain"];
const EMAIL_KEYS = ["contactEmail", "contact_email", "supportEmail", "support_email"];
const TAGLINE_KEYS = ["tagline", "slogan"];

/** What may precede a key for its unquoted value to count: indentation and an optional YAML list dash or bullet. */
const KEY_AT_LINE_START_RE = /^\s*(?:[-*]\s+)?$/;

/**
 * `text` without its trailing whitespace and commas. An end-index scan, not
 * `/[\s,]+$/`, which is quadratic on a long run that does not reach the end.
 * @internal
 */
export function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s,]/.test(text[end - 1] as string)) end--;
  return text.slice(0, end);
}

/**
 * `text` without its trailing sentence punctuation (`. , ; : ! ?`). An
 * end-index scan for the same reason as `trimTrailingSeparators`.
 * @internal
 */
export function stripTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && ".,;:!?".includes(text[end - 1] as string)) end--;
  return text.slice(0, end);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

function snippetOf(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Every value declared for one of `keys` on `line`: an optionally quoted key,
 * `:` or `=`, then a quoted value ('…', "…", `…`) or — only when the key
 * opens the line — the unquoted rest of the line. Trailing commas stripped.
 */
function keyValues(line: string, keys: readonly string[]): string[] {
  const re = new RegExp(
    String.raw`(?<![\w$.:-])(["'\x60]?)(?:${keys.join("|")})\1\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|\x60([^\x60]*)\x60|([^\s=:"'\x60{[(<][^\n]*))`,
    "gi",
  );
  const out: string[] = [];
  for (const m of line.matchAll(re)) {
    const quoted = m[2] ?? m[3] ?? m[4];
    if (quoted !== undefined) {
      out.push(quoted);
      continue;
    }
    if (!KEY_AT_LINE_START_RE.test(line.slice(0, m.index ?? 0))) continue; // unquoted value mid-line: prose, not a declaration
    const value = trimTrailingSeparators(m[5] ?? "");
    if (value !== "") out.push(value);
  }
  return out;
}

interface ParsedUrl {
  host: string;
  origin: string;
}

function parseUrl(raw: string): ParsedUrl | undefined {
  const m = URL_PARTS_RE.exec(raw);
  if (m === null) return undefined;
  const host = (m[2] as string).toLowerCase().replace(/\.$/, "");
  const port = m[3] === undefined ? "" : `:${m[3]}`;
  return { host, origin: `${(m[1] as string).toLowerCase()}://${host}${port}` };
}

/**
 * Lowercase host out of a `domain`-style value: tolerates a scheme, a path,
 * and a port. The cut is a search and a slice, not `/[/?#:].*$/`, which is
 * quadratic when a line terminator stops `.` before `$`.
 * @internal
 */
export function hostOfValue(value: string): string {
  const bare = value.trim().toLowerCase().replace(/^https?:\/\//, "");
  const cut = bare.search(/[/?#:]/);
  return (cut === -1 ? bare : bare.slice(0, cut)).replace(/\.$/, "");
}

// ------------------------------------------------------------------- check

export function checkBrandFactsDrift(
  files: readonly ScannedFile[],
  facts: BrandFacts,
  options: BrandFactsDriftOptions = {},
): BrandFactsDriftResult {
  const findings: BrandFactsDriftFinding[] = [];
  const ignored: BrandFactsDriftResult["ignored"] = [];
  const longLineReasons: string[] = [];
  let longLines = 0;
  const seen = new Set<string>();

  const legalName = facts.legalEntity.name;
  const jurisdiction = facts.legalEntity.jurisdiction;
  const brandName = facts.brand.name;
  const wordmark = facts.brand.wordmark;
  const brandExpected = wordmark === undefined ? `"${brandName}"` : `"${brandName}" (wordmark "${wordmark}")`;
  const slug = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domains = facts.domains.map((d) => d.toLowerCase());
  const ownedEmails = new Set([facts.contactEmail, ...(facts.additionalEmails ?? [])].map((e) => e.toLowerCase()));
  const domainsExpected = facts.domains.join(", ");

  const brandWordRe = new RegExp(escapeRegExp(brandName).replace(/\s+/g, String.raw`\s+`), "giu");
  const brandInPhraseRe = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${escapeRegExp(brandName).replace(/\s+/g, String.raw`\s+`)}(?![\p{L}\p{N}])`,
    "iu",
  );
  const recordedHostRe = new RegExp(
    String.raw`(?<![\w.-])(?:[a-z0-9-]+\.)*(?:${domains.map(escapeRegExp).join("|")})(?![\w-])`,
    "gi",
  );
  const wordChar = /[\p{L}\p{N}]/u;
  /**
   * Whether the character at `index` (the neighbour of a brand-name match, on
   * the side `direction` points away from it) makes the match part of a
   * larger token. `@`, `/`, `_`, `-`, and letters/digits always do; `.` does
   * only when a letter or digit follows it outward ("brand.io"), so a
   * sentence-ending period does not hide a miscased brand name.
   */
  const joinsWord = (text: string, index: number, direction: 1 | -1): boolean => {
    const ch = text[index];
    if (ch === undefined) return false;
    if (ch === ".") {
      const next = text[index + direction];
      return next !== undefined && wordChar.test(next);
    }
    return ch === "@" || ch === "/" || ch === "_" || ch === "-" || wordChar.test(ch);
  };

  const isOwnedHost = (host: string): boolean => domains.includes(host) || domains.some((d) => host.endsWith(`.${d}`));
  const hasBrandLabel = (host: string): boolean => slug !== "" && host.split(".").includes(slug);
  const normalizePlace = (place: string): string => place.replace(PLACE_PREFIX_RE, "").replace(/\s+/g, " ").trim().toLowerCase();

  const copyEntries = options.copyEntries;
  const taglineResolution = copyEntries === undefined ? undefined : resolveBrandTaglines(facts, copyEntries);
  const approvedTaglines = new Set(taglineResolution?.resolved.map((t) => t.text) ?? []);
  const taglineExpected =
    taglineResolution === undefined || taglineResolution.resolved.length === 0
      ? "(no recorded tagline resolves to an approved Writer copy entry)"
      : taglineResolution.resolved.map((t) => `"${t.text}"`).join(" or ");

  function report(kind: BrandFactsDriftKind, file: string, line: number, found: string, expected: string, message: string): void {
    const key = `${kind}\u0000${file}\u0000${line}\u0000${found}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, file, line, found, expected, message });
  }

  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = (lines[i] as string).replace(/\r$/, "");
      const lineNo = i + 1;
      // The cap comes first: a line that was not read is neither clean nor an override.
      if (raw.length > MAX_LINE_CHARS) {
        longLines++;
        if (longLines <= MAX_LONG_LINE_REASONS) {
          longLineReasons.push(
            `${file.path}:${lineNo} is ${raw.length} characters, over the ${MAX_LINE_CHARS} character limit, and was not checked`,
          );
        }
        continue;
      }
      if (IGNORE_MARKER_RE.test(raw)) {
        ignored.push({ file: file.path, line: lineNo, snippet: snippetOf(raw) });
        continue;
      }

      const prose = blank(blank(raw, URL_RE), EMAIL_RE);
      const lineNamesBrand = brandInPhraseRe.test(prose);

      // 1 + 2. Legal name, and incorporation when the record says there is none.
      let lineHasThirdPartyCompany = false;
      for (const m of prose.matchAll(COMPANY_PHRASE_RE)) {
        const phrase = m[0].replace(/\s+/g, " ");
        const leading = m[1] as string;
        const brandAt = leading.search(brandInPhraseRe);
        if (brandAt === -1) {
          lineHasThirdPartyCompany = true;
          continue;
        }
        const isLegalName = phrase.endsWith(legalName) && (phrase.length === legalName.length || phrase[phrase.length - legalName.length - 1] === " ");
        if (isLegalName) continue;
        const found = m[0].slice(brandAt).replace(/\s+/g, " ");
        if (!facts.legalEntity.incorporated) {
          report("incorporation", file.path, lineNo, found, `not incorporated (legal name "${legalName}")`,
            `incorporation drift: "${found}" presents a company suffix, but the record says the legal entity "${legalName}" is not incorporated.`);
        } else {
          report("legal-name", file.path, lineNo, found, legalName,
            `legal-name drift: found "${found}" but the recorded legal name is "${legalName}".`);
        }
      }
      const thirdPartyOnly = lineHasThirdPartyCompany && !lineNamesBrand;

      if (!facts.legalEntity.incorporated && !thirdPartyOnly) {
        for (const m of prose.matchAll(INCORPORATED_WORDS_RE)) {
          const found = m[0].replace(/\s+/g, " ");
          report("incorporation", file.path, lineNo, found, `not incorporated (legal name "${legalName}")`,
            `incorporation drift: found "${found}" but the record says the legal entity "${legalName}" is not incorporated.`);
        }
      }

      // 3. Jurisdiction, in prose.
      const places: string[] = [];
      const collectPlace = (re: RegExp): void => {
        for (const m of prose.matchAll(re)) {
          const rest = prose.slice((m.index ?? 0) + m[0].length).replace(PLACE_PREFIX_RE, "");
          const place = PLACE_RE.exec(rest)?.[0];
          if (place !== undefined && !NOT_PLACES.has(place.toLowerCase())) places.push(place);
        }
      };
      if (!thirdPartyOnly) collectPlace(JURISDICTION_FORMED_RE);
      collectPlace(JURISDICTION_GOVERNED_RE);
      for (const place of places) {
        if (normalizePlace(place) === normalizePlace(jurisdiction)) continue;
        report("jurisdiction", file.path, lineNo, place, jurisdiction,
          `jurisdiction drift: found "${place}" but the recorded jurisdiction is "${jurisdiction}".`);
      }

      // 4. Brand casing, in prose with URLs, emails, and recorded hostnames blanked.
      const casingText = blank(prose, recordedHostRe);
      for (const m of casingText.matchAll(brandWordRe)) {
        const at = m.index ?? 0;
        if (joinsWord(casingText, at - 1, -1) || joinsWord(casingText, at + m[0].length, 1)) continue;
        const found = m[0];
        if (found === brandName || found === wordmark) continue;
        report("brand-casing", file.path, lineNo, found, brandName,
          `brand-casing drift: found "${found}" but the recorded brand name is ${brandExpected}.`);
      }

      // 5 + 6. Canonical origin and domain, over URLs.
      for (const m of raw.matchAll(URL_RE)) {
        const url = parseUrl(stripTrailingPunctuation(m[0]));
        if (url === undefined) continue;
        if (domains.includes(url.host)) {
          if (url.origin !== facts.canonicalOrigin) {
            report("canonical-origin", file.path, lineNo, url.origin, facts.canonicalOrigin,
              `canonical-origin drift: found "${url.origin}" but the recorded canonical origin is "${facts.canonicalOrigin}".`);
          }
        } else if (!isOwnedHost(url.host) && hasBrandLabel(url.host)) {
          report("domain", file.path, lineNo, url.host, domainsExpected,
            `domain drift: found "${url.host}", which carries the brand name but is not a recorded domain (${domainsExpected}).`);
        }
      }

      // 7. Contact email, over addresses on a brand host.
      for (const m of raw.matchAll(EMAIL_RE)) {
        const address = m[0];
        const host = (address.split("@")[1] as string).toLowerCase();
        if (!isOwnedHost(host) && !hasBrandLabel(host)) continue;
        if (ownedEmails.has(address.toLowerCase())) continue;
        report("contact-email", file.path, lineNo, address, facts.contactEmail,
          `contact-email drift: found "${address}" but the recorded contact address is "${facts.contactEmail}" and the record owns no such address.`);
      }

      // Key/value declarations.
      for (const value of keyValues(raw, LEGAL_NAME_KEYS)) {
        if (value === legalName) continue;
        report("legal-name", file.path, lineNo, value, legalName, `legal-name drift: found "${value}" but the recorded legal name is "${legalName}".`);
      }
      for (const value of keyValues(raw, JURISDICTION_KEYS)) {
        if (normalizePlace(value) === normalizePlace(jurisdiction)) continue;
        report("jurisdiction", file.path, lineNo, value, jurisdiction,
          `jurisdiction drift: found "${value}" but the recorded jurisdiction is "${jurisdiction}".`);
      }
      const brandValues = keyValues(raw, BRAND_NAME_KEYS);
      for (const tag of raw.matchAll(META_TAG_RE)) {
        if (!OG_SITE_NAME_RE.test(tag[0])) continue;
        const content = META_CONTENT_RE.exec(tag[0]);
        const value = content?.[1] ?? content?.[2];
        if (value !== undefined) brandValues.push(value);
      }
      for (const value of brandValues) {
        if (value === brandName || value === wordmark) continue;
        report("brand-casing", file.path, lineNo, value, brandName,
          `brand-casing drift: found "${value}" declared as the brand name but the recorded brand name is ${brandExpected}.`);
      }
      for (const value of keyValues(raw, DOMAIN_KEYS)) {
        const host = hostOfValue(value);
        if (!HOST_SHAPE_RE.test(host) || isOwnedHost(host)) continue;
        report("domain", file.path, lineNo, host, domainsExpected,
          `domain drift: found "${host}" declared as a domain but it is not a recorded domain (${domainsExpected}).`);
      }
      for (const value of keyValues(raw, EMAIL_KEYS)) {
        const address = value.trim().replace(/^mailto:/i, "");
        if (ownedEmails.has(address.toLowerCase())) continue;
        report("contact-email", file.path, lineNo, address, facts.contactEmail,
          `contact-email drift: found "${address}" declared as a contact address but the recorded contact address is "${facts.contactEmail}".`);
      }
      if (taglineResolution !== undefined) {
        for (const value of keyValues(raw, TAGLINE_KEYS)) {
          if (approvedTaglines.has(value)) continue;
          report("tagline", file.path, lineNo, value, taglineExpected,
            `tagline drift: found "${value}" but the approved tagline is ${taglineExpected}.`);
        }
      }
    }
  }

  // 9. Record taglines that do not resolve to an approved Writer entry.
  for (const copyId of taglineResolution?.unresolved ?? []) {
    report("tagline-unresolved", "brand-facts.json", 0, copyId, "an approved Writer copy-registry entry",
      `tagline-unresolved: the record's tagline copyId "${copyId}" does not resolve to an approved Writer copy-registry entry.`);
  }

  const indeterminateReasons: string[] = [...longLineReasons];
  if (longLines > longLineReasons.length) {
    indeterminateReasons.push(`${longLines - longLineReasons.length} more line(s) over the ${MAX_LINE_CHARS} character limit were not checked`);
  }
  if (files.length === 0) indeterminateReasons.push("no files scanned");
  if (facts.taglines.length > 0 && copyEntries === undefined) {
    indeterminateReasons.push(
      `brand-facts.json records ${facts.taglines.length} tagline(s) by copyId, which cannot be checked without the Writer copy registry's entries`,
    );
  }

  const state: BrandFactsDriftState = indeterminateReasons.length > 0 ? "indeterminate" : findings.length > 0 ? "drift" : "clean";
  return { state, findings, ignored, filesScanned: files.length, indeterminateReasons };
}
