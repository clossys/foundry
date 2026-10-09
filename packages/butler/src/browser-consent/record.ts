/**
 * The stored browser consent record and the two functions that create and
 * read it.
 *
 * The record carries no identifier, address, user agent or any other
 * personal reference: a status, two instants, a policy version and, on a
 * grant decided while Global Privacy Control was on and overridable, an
 * override marker. Expiry is fixed when the choice is decided and is never
 * renewed by reading. Reading never writes.
 *
 * Pure: no storage, no clock, no browser global.
 */

import { CalendarMonthsError, addCalendarMonthsUtc } from "../calendar-months.js";

/** How the host treats a visitor who has made no choice. */
export type ConsentRegime = "prompt" | "notice";

/** Request-time signals the host observed for this visitor. */
export interface ConsentSignals {
  gpc: boolean;
}

/** The record a choice writes. Instants are ISO 8601 UTC strings. */
export interface StoredChoice {
  status: "granted" | "denied";
  decidedAt: string;
  expiresAt: string;
  policyVersion: string;
  gpcOverride?: true;
}

/** What the decision functions evaluate: a record, no record, or storage that could not be read. */
export type StoredInput = StoredChoice | null | "unreadable";

/** Host-owned policy values. No field has a package default except `gpcOverridable`. */
export interface ConsentPolicy {
  version: string;
  expiryMonths: number;
  invalidateDenialOnPolicyBump: boolean;
  gpcOverridable?: boolean;
  legacy?: { accept: true; assumedPolicyVersion: string };
}

/** The choice in force for gating. `unknown` is unreadable storage with no in-memory choice and GPC off. */
export type EffectiveChoice = "granted" | "denied" | "none" | "unknown";

export type BrowserConsentErrorCode = "invalid-expiry-months" | "gpc-not-overridable" | "invalid-instant";

/** A caller asked for something the consent rules never produce. */
export class BrowserConsentError extends Error {
  readonly code: BrowserConsentErrorCode;

  constructor(code: BrowserConsentErrorCode, message: string) {
    super(message);
    this.name = "BrowserConsentError";
    this.code = code;
  }
}

/** Throws unless `expiryMonths` is a whole number of at least 1. */
export function assertConsentPolicy(policy: ConsentPolicy): void {
  if (!Number.isInteger(policy.expiryMonths) || policy.expiryMonths < 1) {
    throw new BrowserConsentError(
      "invalid-expiry-months",
      "ConsentPolicy.expiryMonths must be a whole number of at least 1",
    );
  }
}

/** Fail-closed reading of the signal: any truthy `gpc` counts as on. */
export function gpcOn(signals: ConsentSignals | null | undefined): boolean {
  return Boolean(signals?.gpc);
}

/** True when GPC is on and this policy does not let a grant override it. */
export function gpcInForce(signals: ConsentSignals, policy: ConsentPolicy): boolean {
  return gpcOn(signals) && policy.gpcOverridable !== true;
}

/** `"notice"` only for the exact string `"notice"`; anything else, including a missing value, is `"prompt"`. */
export function normalizeRegime(value: unknown): ConsentRegime {
  return value === "notice" ? "notice" : "prompt";
}

/**
 * Builds the record for one explicit choice made at `now`. Expiry is fixed
 * here, once. A grant under a signal the policy does not let it override is
 * never produced: that call throws.
 */
export function decideChoice(
  status: "granted" | "denied",
  now: Date,
  policy: ConsentPolicy,
  signals: ConsentSignals,
): StoredChoice {
  assertConsentPolicy(policy);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new BrowserConsentError("invalid-instant", "decideChoice needs a valid Date");
  }
  if (status === "granted" && gpcInForce(signals, policy)) {
    throw new BrowserConsentError(
      "gpc-not-overridable",
      "A grant cannot be recorded while Global Privacy Control is on and not overridable",
    );
  }
  const choice: StoredChoice = {
    status,
    decidedAt: now.toISOString(),
    expiresAt: addCalendarMonthsUtc(now, policy.expiryMonths).toISOString(),
    policyVersion: policy.version,
  };
  if (status === "granted" && gpcOn(signals)) {
    choice.gpcOverride = true;
  }
  return choice;
}

function instant(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** An ISO 8601 UTC instant (`YYYY-MM-DDTHH:mm:ss[.sss]Z`) naming a real calendar date, or `null`. */
function isoUtcInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Rejects a date the parser would roll over, such as 30 February.
  return date.toISOString().slice(0, 19) === value.slice(0, 19) ? date : null;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeRaw(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Reads a raw stored value (an object, or the JSON text a browser storage
 * holds) into a record, or `null` for anything corrupt or of an unknown
 * shape. A legacy `{ status, decidedAt }` record parses only when the policy
 * accepts it, and takes its expiry from its own `decidedAt`. Expiry is capped
 * at the current policy's length. Liveness against the clock and the policy
 * version is not decided here: see `isLiveChoice`.
 */
export function parseStoredChoice(raw: unknown, policy: ConsentPolicy): StoredChoice | null {
  assertConsentPolicy(policy);
  const value = decodeRaw(raw);
  if (!isRecordObject(value)) return null;
  const status = value["status"];
  if (status !== "granted" && status !== "denied") return null;

  const hasExpiry = "expiresAt" in value;
  const hasVersion = "policyVersion" in value;
  let decidedAt: Date | null;
  let storedExpiry: Date | null;
  let policyVersion: string;

  const legacy = !hasExpiry && !hasVersion;
  if (legacy) {
    // Legacy shape.
    if (policy.legacy?.accept !== true) return null;
    decidedAt = instant(value["decidedAt"]);
    if (decidedAt === null) return null;
    storedExpiry = null;
    policyVersion = policy.legacy.assumedPolicyVersion;
  } else {
    if (typeof value["policyVersion"] !== "string") return null;
    decidedAt = isoUtcInstant(value["decidedAt"]);
    storedExpiry = isoUtcInstant(value["expiresAt"]);
    if (decidedAt === null || storedExpiry === null) return null;
    policyVersion = value["policyVersion"];
  }

  // A legacy record never carries an override; one found there is ignored.
  const gpcOverride = legacy ? undefined : value["gpcOverride"];
  if (status === "granted" && gpcOverride !== undefined && gpcOverride !== true) return null;

  let policyCap: Date;
  try {
    policyCap = addCalendarMonthsUtc(decidedAt, policy.expiryMonths);
  } catch (error) {
    // An instant whose expiry falls outside the Date range reads as no choice.
    if (error instanceof CalendarMonthsError) return null;
    throw error;
  }
  const expiresAt =
    storedExpiry !== null && storedExpiry.getTime() < policyCap.getTime() ? storedExpiry : policyCap;
  if (decidedAt.getTime() > expiresAt.getTime()) return null;

  const choice: StoredChoice = {
    status,
    decidedAt: decidedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    policyVersion,
  };
  if (status === "granted" && gpcOverride === true) {
    choice.gpcOverride = true;
  }
  return choice;
}
