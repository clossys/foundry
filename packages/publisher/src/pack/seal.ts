/**
 * The evidence-gated website seal (#1524, slice 1): a website pack item moves
 * from `kept` to `published` only when a bundle of render and delivery
 * evidence, supplied by the caller, matches the commit that is in production.
 * Provider evidence is an input here; nothing in this file reaches a network,
 * a provider, or a clock of its own. `now` is always passed in.
 *
 * Both functions are pure. A refusal fails closed and carries findings made
 * of a fixed rule name and a fixed field path or an array index (for example
 * `pages[1].servedCommit`). No finding contains any text taken from the
 * evidence, the map, the manifest, the ledger or the item id, so a refusal can
 * be logged or posted without leaking what was refused. That promise covers
 * findings only: a successful seal still returns the entry id, which is
 * derived from the item id and the first 12 characters of the commit, and the
 * accepted manifest and ledger, by design. There is no waiver: nothing in the
 * evidence, the options, or the environment turns a finding off.
 *
 * Only the website pack item can be sealed here, and only on evidence that
 * names that item (`itemId`): the evidence is taken for one item, and another
 * item's evidence, or a different public item, is refused.
 */

import { listPublicationMapPaths, type PublicationMap } from "../core/publication-map.js";
import { appendEntry } from "../record/append.js";
import { validateLedger } from "../record/schema.js";
import type { Ledger, PublicationEntry } from "../record/types.js";
import { sealableItemIds } from "./readiness.js";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

/** One page the provider observed in production, with the commit it served and a digest of each rendered viewport. */
export interface WebsiteSealPage {
  path: string;
  status: number;
  servedCommit: string;
  /** sha256 hex digest of the desktop render. */
  desktopDigest: string;
  /** sha256 hex digest of the mobile render. */
  mobileDigest: string;
}

/** Contact intake is stated, never implied: either a submission was observed reaching its destination, or the site says why it has none. */
export type WebsiteSealContactIntake =
  | { kind: "present"; path: string; submissionDigest: string }
  | { kind: "none"; reason: string };

export interface WebsiteSealEvidence {
  schemaVersion: 1;
  /** The pack item the evidence was taken for; it must equal the item being sealed, which is always `website`. */
  itemId: string;
  /** The 40-hex commit the seal is for. */
  commit: string;
  /** ISO 8601 UTC instant the evidence was observed. */
  observedAt: string;
  delivery: { state: "ready"; deployedCommit: string; productionUrl: string };
  pages: readonly WebsiteSealPage[];
  contactIntake: WebsiteSealContactIntake;
}

/** A refusal reason. Deliberately only a rule and a path: never a value from the input. */
export interface SealFinding {
  rule: string;
  path: string;
}

export interface CheckSealEvidenceOptions {
  map: PublicationMap;
  /** The item being sealed. Required: the evidence's own `itemId` must equal it, and a missing or empty one is refused. */
  itemId: string;
  /** ISO 8601 UTC instant the check is made at. */
  now: string;
}

export interface SealWebsiteInput {
  manifest: PackManifest;
  ledger: Ledger;
  itemId: string;
  evidence: unknown;
  map: PublicationMap;
  /** ISO 8601 UTC instant; becomes the item's `verifiedAt` and the ledger entry's `publishedAt`. */
  now: string;
  strategyRevision: string;
}

export type SealWebsiteResult =
  /** `resumed` is true when the ledger already held this seal's identical entry (an interrupted run) and only the manifest was finished; the ledger is then returned as given. */
  | { ok: true; manifest: PackManifest; ledger: Ledger; entryId: string; resumed: boolean }
  | { ok: false; findings: readonly SealFinding[] };

const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
/** The only item a website seal may name. */
const WEBSITE_ITEM_ID = "website";
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Milliseconds for a real ISO 8601 UTC instant, or undefined. `Date.parse` alone rolls 2026-09-31 over to October, so the calendar and clock fields are checked first. */
function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = INSTANT_RE.exec(value);
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    // Credentials in the URL would reach the ledger `url` and the manifest `publishedTo`.
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isMapShape(map: unknown): map is PublicationMap {
  return isPlainObject(map) && Array.isArray(map.entries) && map.entries.every((entry) => isPlainObject(entry) && isPlainObject(entry.location));
}

/**
 * Checks a website seal evidence bundle against the production commit and the
 * publication map. Returns findings only and never throws; an empty array
 * means the evidence is complete, current, and matches. Every `path` in the
 * map must have a page, every page must be status 200 and served from
 * `commit`, and `delivery` must be `ready` at that same commit.
 */
export function checkSealEvidence(evidence: unknown, options: CheckSealEvidenceOptions): SealFinding[] {
  const findings: SealFinding[] = [];
  const add = (rule: string, path: string): void => void findings.push({ rule, path });
  try {
    checkEvidence(evidence, options, add);
  } catch {
    add("check-failed", "(root)");
  }
  return findings;
}

function checkEvidence(evidence: unknown, options: CheckSealEvidenceOptions | undefined, add: (rule: string, path: string) => void): void {
  const nowMs = parseInstant(options?.now);
  if (nowMs === undefined) add("now-invalid", "now");
  if (!isNonEmptyString(options?.itemId)) add("item-id-invalid", "itemId");

  const map = options?.map;
  let mappedPaths: string[] = [];
  if (!isMapShape(map)) {
    add("map-shape", "map");
  } else {
    mappedPaths = listPublicationMapPaths(map);
    if (mappedPaths.length === 0) add("map-empty", "map.paths");
  }

  if (!isPlainObject(evidence)) {
    add("evidence-shape", "(root)");
    return;
  }

  if (evidence.schemaVersion !== 1) add("schema-version", "schemaVersion");

  if (!isNonEmptyString(evidence.itemId)) add("evidence-item-shape", "itemId");
  else if (isNonEmptyString(options?.itemId) && evidence.itemId !== options.itemId) add("evidence-item-mismatch", "itemId");

  const commit = evidence.commit;
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) add("commit-shape", "commit");

  const observedMs = parseInstant(evidence.observedAt);
  if (observedMs === undefined) {
    add("observed-at-shape", "observedAt");
  } else if (nowMs !== undefined) {
    if (observedMs > nowMs) add("observed-at-future", "observedAt");
    else if (nowMs - observedMs > MAX_EVIDENCE_AGE_MS) add("observed-at-stale", "observedAt");
  }

  const delivery = evidence.delivery;
  if (!isPlainObject(delivery)) {
    add("delivery-shape", "delivery");
  } else {
    if (delivery.state !== "ready") add("delivery-not-ready", "delivery.state");
    if (typeof delivery.deployedCommit !== "string" || !COMMIT_RE.test(delivery.deployedCommit)) add("delivery-commit-shape", "delivery.deployedCommit");
    else if (delivery.deployedCommit !== commit) add("delivery-commit-mismatch", "delivery.deployedCommit");
    if (!isHttpsUrl(delivery.productionUrl)) add("production-url-shape", "delivery.productionUrl");
  }

  const pages = evidence.pages;
  if (!Array.isArray(pages)) {
    add("pages-shape", "pages");
  } else {
    pages.forEach((page: unknown, index) => {
      const at = `pages[${index}]`;
      if (!isPlainObject(page)) {
        add("page-shape", at);
        return;
      }
      if (!isNonEmptyString(page.path)) add("page-path-shape", `${at}.path`);
      if (page.status !== 200) add("page-status", `${at}.status`);
      if (typeof page.servedCommit !== "string" || !COMMIT_RE.test(page.servedCommit)) add("page-commit-shape", `${at}.servedCommit`);
      else if (page.servedCommit !== commit) add("page-commit-mismatch", `${at}.servedCommit`);
      for (const field of ["desktopDigest", "mobileDigest"] as const) {
        if (typeof page[field] !== "string" || !DIGEST_RE.test(page[field])) add("page-digest-shape", `${at}.${field}`);
      }
    });
  }

  const present = new Set(Array.isArray(pages) ? pages.map((page: unknown) => (isPlainObject(page) ? page.path : undefined)) : []);
  mappedPaths.forEach((mapped, index) => {
    if (!present.has(mapped)) add("page-missing", `map.paths[${index}]`);
  });

  const intake = evidence.contactIntake;
  if (intake === undefined || intake === null) {
    add("contact-intake-missing", "contactIntake");
  } else if (!isPlainObject(intake)) {
    add("contact-intake-shape", "contactIntake");
  } else if (intake.kind === "present") {
    if (!isNonEmptyString(intake.path)) add("contact-intake-path-shape", "contactIntake.path");
    if (typeof intake.submissionDigest !== "string" || !DIGEST_RE.test(intake.submissionDigest)) add("contact-intake-digest-shape", "contactIntake.submissionDigest");
  } else if (intake.kind === "none") {
    if (!isNonEmptyString(intake.reason)) add("contact-intake-reason-empty", "contactIntake.reason");
  } else {
    add("contact-intake-shape", "contactIntake.kind");
  }
}

function packFindingsClean(manifest: unknown): boolean {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.items)) return false;
  try {
    return validatePackManifest(manifest as unknown as PackManifest).exitCode === 0;
  } catch {
    return false;
  }
}

/** True when `existing` is the entry a seal on this id, url and strategy revision would have recorded at some earlier instant that is not after `nowMs`. */
function isIdenticalEntry(existing: PublicationEntry, expected: { id: string; url: string; strategyRevision: string }, nowMs: number | undefined): boolean {
  const recordedMs = parseInstant(existing.publishedAt);
  if (recordedMs === undefined || nowMs === undefined || recordedMs > nowMs) return false;
  const wanted: PublicationEntry = { id: expected.id, publishedAt: existing.publishedAt, channel: "web", url: expected.url, strategyRevision: expected.strategyRevision, factCitations: [] };
  // Key order is not part of the entry: a hand-formatted ledger is still the same entry.
  const canonical = (entry: PublicationEntry): string => JSON.stringify(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  return canonical(existing) === canonical(wanted);
}

/**
 * Seals a website pack item. Pure: nothing passed in is mutated, and a
 * refusal returns findings only, never a partial manifest or ledger.
 *
 * It refuses unless `checkSealEvidence` is clean, `itemId` is in
 * `sealableItemIds(manifest)`, `itemId` is the website item, the evidence names
 * that same item, the item is `public`, the manifest and ledger
 * are themselves valid, and the entry id (`website-<itemId>-<first 12 of the
 * commit>`) is not already in the ledger (`seal-already-recorded`). On accept
 * it returns a new manifest whose item is `published` with `verifiedAt` set to
 * `now` and `publishedTo` set to the production URL, and a ledger grown by
 * `appendEntry` with one `web` entry.
 */
export function sealWebsite(input: SealWebsiteInput): SealWebsiteResult {
  const findings: SealFinding[] = [];
  try {
    const result = seal(input, findings);
    if (result) return result;
  } catch {
    findings.push({ rule: "seal-failed", path: "(root)" });
  }
  return { ok: false, findings };
}

/** Returns the accepted seal, or undefined after pushing at least one finding. */
function seal(input: SealWebsiteInput, findings: SealFinding[]): SealWebsiteResult | undefined {
  const add = (rule: string, path: string): void => void findings.push({ rule, path });
  const { manifest, ledger, itemId, evidence, map, now, strategyRevision } = input;
  for (const finding of checkSealEvidence(evidence, { map, now, itemId })) add(finding.rule, finding.path);

  if (itemId !== WEBSITE_ITEM_ID) add("item-not-website", "itemId");

  if (!isNonEmptyString(strategyRevision)) add("strategy-revision-invalid", "strategyRevision");

  const manifestOk = packFindingsClean(manifest);
  if (!manifestOk) add("manifest-invalid", "manifest");

  const ledgerOk = Array.isArray(ledger) && validateLedger(ledger).every((finding) => finding.severity !== "error");
  if (!ledgerOk) add("ledger-invalid", "ledger");

  let target: PackItem | undefined;
  if (manifestOk) {
    target = sealableItemIds(manifest).includes(itemId) ? manifest.items.find((candidate) => candidate.id === itemId) : undefined;
    if (target === undefined) add("item-not-sealable", "itemId");
    else if (target.visibility !== "public") add("item-not-public", "itemId");
  }

  const commit = isPlainObject(evidence) ? evidence.commit : undefined;
  const delivery = isPlainObject(evidence) && isPlainObject(evidence.delivery) ? evidence.delivery : undefined;
  const validCommit = typeof commit === "string" && COMMIT_RE.test(commit) ? commit : undefined;
  const entryId = validCommit !== undefined && typeof itemId === "string" ? `website-${itemId}-${validCommit.slice(0, 12)}` : undefined;
  const productionUrl = typeof delivery?.productionUrl === "string" ? delivery.productionUrl : undefined;

  // An entry already in the ledger is finished, not refused, only when it is exactly the one this evidence would record and the item is still kept.
  let recorded: PublicationEntry | undefined;
  if (entryId !== undefined && ledgerOk) {
    const existing = ledger.find((candidate) => candidate.id === entryId);
    if (existing !== undefined) {
      if (target !== undefined && productionUrl !== undefined && isIdenticalEntry(existing, { id: entryId, url: productionUrl, strategyRevision }, parseInstant(now))) recorded = existing;
      else add("seal-already-recorded", "ledger");
    }
  }

  if (findings.length > 0 || target === undefined || entryId === undefined || productionUrl === undefined) return undefined;

  const verifiedAt = recorded?.publishedAt ?? now;
  const sealedManifest: PackManifest = {
    ...manifest,
    items: manifest.items.map((candidate): PackItem =>
      candidate.id === itemId ? { ...structuredClone(candidate), status: "published", verifiedAt, publishedTo: [productionUrl] } : structuredClone(candidate),
    ),
  };
  if (!packFindingsClean(sealedManifest)) {
    add("manifest-invalid", "manifest");
    return undefined;
  }

  if (recorded !== undefined) return { ok: true, manifest: sealedManifest, ledger, entryId, resumed: true };

  const entry: PublicationEntry = { id: entryId, publishedAt: now, channel: "web", url: productionUrl, strategyRevision, factCitations: [] };
  let grown: Ledger;
  try {
    grown = appendEntry(ledger, entry);
  } catch {
    add("ledger-entry-invalid", "ledger");
    return undefined;
  }
  return { ok: true, manifest: sealedManifest, ledger: grown, entryId, resumed: false };
}
