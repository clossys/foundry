/**
 * The strategy-brief record: `strategy-brief.json` in a consumer's strategy
 * directory. It lists the claims this strategy must never make ("won't
 * claim"), so a surface that makes one can be found (see
 * `wont-claim-drift.ts`) instead of relying on each author to remember.
 *
 * NOT THE ENGAGEMENT BRIEF. `clossys/brief.json` (`brief-contract.ts`) is the
 * founder's engagement brief and has its own owner and schema. This file
 * shares only a word with it; the two are never merged, read through one
 * another, or validated by one another.
 *
 * PATHS ONLY, NEVER VALUES. A validation issue names where a problem is
 * (`wontClaim[2].matchPhrases[1]`) and what rule it broke, and does not echo
 * the offending text back.
 *
 * Like `brand-facts.ts`, this is machinery, not content: hand-rolled over
 * `unknown` via `validation.ts`, never throws, and refuses unknown keys at
 * every object level.
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
  requirePattern,
  requireString,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export interface WontClaim {
  /** Kebab-case, unique within the record. */
  id: string;
  /** A sentence, at least 10 characters, saying what the strategy will not claim. */
  statement: string;
  why?: string;
  /**
   * Literal phrases that mark a surface as making this claim. Non-blank,
   * unique case-insensitively. Never a pattern: `checkWontClaimDrift` escapes
   * every one. An entry without phrases is recorded but not mechanically
   * checked.
   */
  matchPhrases?: string[];
}

export interface StrategyBrief {
  /** May be empty. */
  wontClaim: WontClaim[];
}

export const STRATEGY_BRIEF_FILE = "strategy-brief.json";

/** The shortest `statement` that can be a sentence. */
const STATEMENT_MIN_CHARS = 10;

const TOP_KEYS = ["wontClaim"] as const;
const WONT_CLAIM_KEYS = ["id", "statement", "why", "matchPhrases"] as const;

const KEBAB_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function refuseUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      pushIssue(issues, prefix === "" ? key : `${prefix}.${key}`, `unknown key "${key}" — allowed keys are ${allowed.join(", ")}`);
    }
  }
}

/** A string with at least one non-whitespace character. */
function requireNonBlank(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const text = requireString(value, path, issues, { minLength: 1 });
  if (text === undefined) return undefined;
  if (text.trim() === "") {
    pushIssue(issues, path, "must not be blank");
    return undefined;
  }
  return text;
}

function readMatchPhrases(value: unknown, path: string, issues: ValidationIssue[]): string[] | undefined {
  const start = issues.length;
  const phrases = requireArrayOf(value, path, issues, requireNonBlank);
  if (phrases === undefined) return undefined;
  const seenAt = new Map<string, number>();
  phrases.forEach((phrase, i) => {
    const key = phrase.trim().toLowerCase();
    const first = seenAt.get(key);
    if (first !== undefined) pushIssue(issues, `${path}[${i}]`, `duplicate phrase (case-insensitive) — already listed at ${path}[${first}]`);
    else seenAt.set(key, i);
  });
  return issues.length > start ? undefined : phrases;
}

function readWontClaim(value: unknown, path: string, issues: ValidationIssue[]): WontClaim | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object shaped { id, statement, why?, matchPhrases? }, got ${describeValue(value)}`);
    return undefined;
  }
  refuseUnknownKeys(value, WONT_CLAIM_KEYS, path, issues);

  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, KEBAB_ID_RE, "must be kebab-case (lowercase letters and digits joined by single hyphens)");

  const statement = requireString(value.statement, `${path}.statement`, issues);
  if (statement !== undefined && statement.trim().length < STATEMENT_MIN_CHARS) {
    pushIssue(issues, `${path}.statement`, `must be a sentence of at least ${STATEMENT_MIN_CHARS} characters`);
  }

  const why = optionalString(value.why, `${path}.why`, issues, { minLength: 1 });
  const matchPhrases = value.matchPhrases === undefined ? undefined : readMatchPhrases(value.matchPhrases, `${path}.matchPhrases`, issues);

  if (issues.length > start) return undefined;
  const entry: WontClaim = { id: id as string, statement: statement as string };
  if (why !== undefined) entry.why = why;
  if (matchPhrases !== undefined) entry.matchPhrases = matchPhrases;
  return entry;
}

/** Validates the whole contents of `strategy-brief.json`. */
export function validateStrategyBrief(value: unknown): ValidationResult<StrategyBrief> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "(root)", message: `must be an object, got ${describeValue(value)}` }] };
  refuseUnknownKeys(value, TOP_KEYS, "", issues);

  const wontClaim = requireArrayOf(value.wontClaim, "wontClaim", issues, readWontClaim);
  if (wontClaim !== undefined) {
    const seenAt = new Map<string, number>();
    wontClaim.forEach((entry, i) => {
      const first = seenAt.get(entry.id);
      if (first !== undefined) pushIssue(issues, `wontClaim[${i}].id`, `duplicate id — already used at wontClaim[${first}].id`);
      else seenAt.set(entry.id, i);
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { wontClaim: wontClaim as WontClaim[] } };
}

export type StrategyBriefRead =
  | { status: "ok"; brief: StrategyBrief }
  | { status: "missing"; detail: string }
  | { status: "invalid"; issue: StrategyReadIssue };

/**
 * Reads and validates `<strategyDir>/strategy-brief.json`. Never throws.
 * "missing" is its own status, apart from "invalid", for the same reason as
 * `readBrandFacts`: a caller deciding whether it can run the check at all
 * must tell "nobody has recorded this yet" from "the record is broken".
 */
export function readStrategyBrief(strategyDir: string): StrategyBriefRead {
  const path = join(strategyDir, STRATEGY_BRIEF_FILE);
  if (!existsSync(path)) {
    return { status: "missing", detail: `${STRATEGY_BRIEF_FILE} does not exist under the strategy root` };
  }
  const result = readJsonFile(path, STRATEGY_BRIEF_FILE, validateStrategyBrief);
  return result.ok ? { status: "ok", brief: result.value } : { status: "invalid", issue: result.issue };
}
