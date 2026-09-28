/**
 * The brand-facts record: `brand-facts.json` in a consumer's strategy
 * directory. One place that says who the business legally is, what the
 * brand is called and how it is cased, which hosts it serves, which origin
 * is canonical, which addresses it owns, and which Writer copy entries are
 * its taglines — so every surface that restates one of those can be checked
 * against it (see `brand-facts-drift.ts`) instead of each surface carrying
 * its own copy that quietly drifts.
 *
 * TAGLINES ARE REFERENCES, NEVER TEXT. A tagline is audience-facing copy,
 * and copy already has an owner: the Writer's copy registry, where an entry
 * carries its text and an approval status. Restating that text here would
 * make two records of one sentence, and the second would drift the first
 * time the copy changed. So a tagline here is `{ copyId }` only, and
 * `resolveBrandTaglines` turns it into text through the registry — with the
 * registry's own rule: an entry counts only when its status is "approved".
 *
 * Like `schema.ts`, this is machinery, not content. Validation is hand-rolled
 * over `unknown` via `validation.ts`, never throws, and refuses unknown keys
 * at every object level: a misspelled key in a record whose whole purpose is
 * to be exact would otherwise be silently dropped.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile } from "./json-file.js";
import type { StrategyReadIssue } from "./reader.js";
import {
  describeValue,
  isPlainObject,
  optionalString,
  pushIssue,
  requireArrayOf,
  requireBoolean,
  requirePattern,
  requireString,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export interface BrandLegalEntity {
  /** The exact registered legal name, suffix and punctuation included, e.g. "Example Labs Inc.". */
  name: string;
  incorporated: boolean;
  jurisdiction: string;
}

export interface BrandIdentity {
  /** The canonical prose casing of the brand name. */
  name: string;
  /** The logo casing, when it differs from prose casing. Must equal `name` case-insensitively. */
  wordmark?: string;
}

export interface BrandTagline {
  /** A Writer copy-registry entry id. The tagline's text lives there, never here. */
  copyId: string;
}

export interface BrandFacts {
  legalEntity: BrandLegalEntity;
  brand: BrandIdentity;
  /** Every host the brand serves or redirects from: lowercase hostnames, no scheme, port, or path. Non-empty, unique. */
  domains: string[];
  /** `https://<host>` or `http://<host>` — no path, trailing slash, or port; `<host>` is one of `domains`. */
  canonicalOrigin: string;
  contactEmail: string;
  /** Other addresses this record owns (e.g. a privacy address). Unique, and never `contactEmail` again. */
  additionalEmails?: string[];
  /** May be empty; `copyId`s are unique. */
  taglines: BrandTagline[];
}

export const BRAND_FACTS_FILE = "brand-facts.json";

// ------------------------------------------------------------- validation

const TOP_KEYS = ["legalEntity", "brand", "domains", "canonicalOrigin", "contactEmail", "additionalEmails", "taglines"] as const;
const LEGAL_ENTITY_KEYS = ["name", "incorporated", "jurisdiction"] as const;
const BRAND_KEYS = ["name", "wordmark"] as const;

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ORIGIN_RE = /^(https?):\/\/([^/:?#\s]+)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function refuseUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      pushIssue(issues, prefix === "" ? key : `${prefix}.${key}`, `unknown key "${key}" — allowed keys are ${allowed.join(", ")}`);
    }
  }
}

function readLegalEntity(value: unknown, path: string, issues: ValidationIssue[]): BrandLegalEntity | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object shaped { name, incorporated, jurisdiction }, got ${describeValue(value)}`);
    return undefined;
  }
  refuseUnknownKeys(value, LEGAL_ENTITY_KEYS, path, issues);
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const incorporated = requireBoolean(value.incorporated, `${path}.incorporated`, issues);
  const jurisdiction = requireString(value.jurisdiction, `${path}.jurisdiction`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { name: name as string, incorporated: incorporated as boolean, jurisdiction: jurisdiction as string };
}

function readBrandIdentity(value: unknown, path: string, issues: ValidationIssue[]): BrandIdentity | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object shaped { name, wordmark? }, got ${describeValue(value)}`);
    return undefined;
  }
  refuseUnknownKeys(value, BRAND_KEYS, path, issues);
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const wordmark = optionalString(value.wordmark, `${path}.wordmark`, issues, { minLength: 1 });
  if (name !== undefined && wordmark !== undefined && wordmark.toLowerCase() !== name.toLowerCase()) {
    pushIssue(issues, `${path}.wordmark`, `must be the brand name ${JSON.stringify(name)} in a different casing, got ${JSON.stringify(wordmark)}`);
  }
  if (issues.length > start) return undefined;
  return wordmark === undefined ? { name: name as string } : { name: name as string, wordmark };
}

function readHostname(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const host = requireString(value, path, issues, { minLength: 1 });
  if (host === undefined) return undefined;
  const ok = requirePattern(
    host,
    path,
    issues,
    HOSTNAME_RE,
    `must be a lowercase hostname with no scheme, port, or path (e.g. "brand.example"), got ${JSON.stringify(host)}`,
  );
  return ok ? host : undefined;
}

function readEmail(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const email = requireString(value, path, issues, { minLength: 1 });
  if (email === undefined) return undefined;
  return requirePattern(email, path, issues, EMAIL_RE, `must be an email address, got ${JSON.stringify(email)}`) ? email : undefined;
}

function readTagline(value: unknown, path: string, issues: ValidationIssue[]): BrandTagline | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object shaped { copyId }, got ${describeValue(value)}`);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key === "copyId") continue;
    pushIssue(
      issues,
      `${path}.${key}`,
      key === "text"
        ? "a tagline's text is never restated here — reference the Writer copy-registry entry by copyId and let the registry hold the text"
        : `unknown key "${key}" — a tagline is only { copyId }, a reference to the Writer copy-registry entry that holds its text`,
    );
  }
  const copyId = requireString(value.copyId, `${path}.copyId`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { copyId: copyId as string };
}

/** Pushes a `duplicate` issue at every later index whose key (per `keyOf`) was already seen. */
function refuseDuplicates<T>(items: readonly T[], keyOf: (item: T) => string, pathOf: (i: number) => string, what: string, issues: ValidationIssue[]): void {
  const seenAt = new Map<string, number>();
  items.forEach((item, i) => {
    const key = keyOf(item);
    const first = seenAt.get(key);
    if (first !== undefined) pushIssue(issues, pathOf(i), `duplicate ${what} — already listed at ${pathOf(first)}`);
    else seenAt.set(key, i);
  });
}

/** Validates the whole contents of `brand-facts.json`. */
export function validateBrandFacts(value: unknown): ValidationResult<BrandFacts> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "(root)", message: `must be an object, got ${describeValue(value)}` }] };
  refuseUnknownKeys(value, TOP_KEYS, "", issues);

  const legalEntity = readLegalEntity(value.legalEntity, "legalEntity", issues);
  const brand = readBrandIdentity(value.brand, "brand", issues);

  const domains = requireArrayOf(value.domains, "domains", issues, readHostname, { minLength: 1 });
  if (domains !== undefined) refuseDuplicates(domains, (d) => d, (i) => `domains[${i}]`, "domain", issues);

  const canonicalOrigin = requireString(value.canonicalOrigin, "canonicalOrigin", issues, { minLength: 1 });
  if (canonicalOrigin !== undefined) {
    const m = ORIGIN_RE.exec(canonicalOrigin);
    if (m === null || !HOSTNAME_RE.test(m[2] as string)) {
      pushIssue(
        issues,
        "canonicalOrigin",
        `must be "https://<host>" or "http://<host>" with a lowercase host and no path, trailing slash, or port, got ${JSON.stringify(canonicalOrigin)}`,
      );
    } else if (domains !== undefined && !domains.includes(m[2] as string)) {
      pushIssue(issues, "canonicalOrigin", `host ${JSON.stringify(m[2])} is not one of domains`);
    }
  }

  const contactEmail = readEmail(value.contactEmail, "contactEmail", issues);

  let additionalEmails: string[] | undefined;
  if (value.additionalEmails !== undefined) {
    additionalEmails = requireArrayOf(value.additionalEmails, "additionalEmails", issues, readEmail);
    if (additionalEmails !== undefined) {
      refuseDuplicates(additionalEmails, (e) => e.toLowerCase(), (i) => `additionalEmails[${i}]`, "address", issues);
      additionalEmails.forEach((email, i) => {
        if (contactEmail !== undefined && email.toLowerCase() === contactEmail.toLowerCase()) {
          pushIssue(issues, `additionalEmails[${i}]`, "repeats contactEmail — list each address once");
        }
      });
    }
  }

  const taglines = requireArrayOf(value.taglines, "taglines", issues, readTagline);
  if (taglines !== undefined) refuseDuplicates(taglines, (t) => t.copyId, (i) => `taglines[${i}].copyId`, "copyId", issues);

  if (issues.length > 0) return { ok: false, issues };
  const facts: BrandFacts = {
    legalEntity: legalEntity as BrandLegalEntity,
    brand: brand as BrandIdentity,
    domains: domains as string[],
    canonicalOrigin: canonicalOrigin as string,
    contactEmail: contactEmail as string,
    taglines: taglines as BrandTagline[],
  };
  if (additionalEmails !== undefined) facts.additionalEmails = additionalEmails;
  return { ok: true, value: facts };
}

// ------------------------------------------------------------------- read

export type BrandFactsRead =
  | { status: "ok"; facts: BrandFacts }
  | { status: "missing"; detail: string }
  | { status: "invalid"; issue: StrategyReadIssue };

/**
 * Reads and validates `<strategyDir>/brand-facts.json`. The one I/O function
 * in this module; never throws. "missing" is its own status, apart from
 * "invalid", because a caller deciding whether it can run a drift check at
 * all needs to tell "nobody has recorded brand facts yet" apart from "the
 * record is there and broken".
 */
export function readBrandFacts(strategyDir: string): BrandFactsRead {
  const path = join(strategyDir, BRAND_FACTS_FILE);
  if (!existsSync(path)) {
    return { status: "missing", detail: `${BRAND_FACTS_FILE} does not exist under the strategy root` };
  }
  const result = readJsonFile(path, BRAND_FACTS_FILE, validateBrandFacts);
  return result.ok ? { status: "ok", facts: result.value } : { status: "invalid", issue: result.issue };
}

// --------------------------------------------------------------- taglines

/**
 * The part of a Writer copy-registry entry this package reads. A plain
 * structural shape, never an import of the Writer package — the registry is
 * data at a seam, the same way `brand-derivation.ts` treats token slots.
 */
export interface CopyEntryLike {
  id: string;
  text: string;
  status?: string;
}

export interface ResolvedTagline {
  copyId: string;
  text: string;
}

/**
 * Resolves each recorded tagline `copyId` to its text. An entry resolves
 * only when its `id` matches AND its `status` is exactly "approved" — the
 * Writer registry's own rule for what may be published. A draft, or an
 * entry with no status, is unresolved, not a fallback.
 */
export function resolveBrandTaglines(
  facts: BrandFacts,
  entries: readonly CopyEntryLike[],
): { resolved: ResolvedTagline[]; unresolved: string[] } {
  const resolved: ResolvedTagline[] = [];
  const unresolved: string[] = [];
  for (const { copyId } of facts.taglines) {
    const entry = entries.find((e) => e.id === copyId && e.status === "approved");
    if (entry === undefined) unresolved.push(copyId);
    else resolved.push({ copyId, text: entry.text });
  }
  return { resolved, unresolved };
}

function readCopyEntry(value: unknown, path: string, issues: ValidationIssue[]): CopyEntryLike | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object with id and text, got ${describeValue(value)}`);
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  const text = requireString(value.text, `${path}.text`, issues);
  const status = optionalString(value.status, `${path}.status`, issues);
  if (issues.length > start) return undefined;
  return status === undefined ? { id: id as string, text: text as string } : { id: id as string, text: text as string, status };
}

/**
 * Reads the entries out of a Writer copy registry: an object with an
 * `entries` array of `{ id, text, status? }`. Other keys on the registry and
 * on each entry are the Writer's business and are ignored, not refused.
 */
export function copyEntriesFromRegistry(value: unknown): ValidationResult<CopyEntryLike[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: "(root)", message: `must be an object with an entries array, got ${describeValue(value)}` }] };
  }
  const entries = requireArrayOf(value.entries, "entries", issues, readCopyEntry);
  if (entries === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, value: entries };
}
