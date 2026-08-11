/**
 * Entity shapes and validators for every entity this package knows about.
 * Pure data shape — no I/O, no filesystem knowledge, nothing about where a
 * consumer's real values live on disk (that is `reader.ts`'s job).
 *
 * These entities ship as MACHINERY, not content: this package defines what
 * a `Fact` or a `Mission` document must look like, never what any real
 * product's mission statement says. A consumer repo authors its own values
 * against this shape — the same split `@vespeneventures/ui/tokens` draws
 * between a greyscale contract and a brand binding (see that package's
 * README, "The three-layer contract").
 *
 * VALIDATION IS HAND-ROLLED, DELIBERATELY, NOT A SCHEMA LIBRARY. This
 * package's own README leads with "pure data + validation, safe to
 * install" — and every other zero-dependency package in this foundation
 * (`@vespeneventures/catalog`, `@vespeneventures/policy`,
 * `@vespeneventures/ui/tokens`) backs that claim with zero runtime
 * dependencies. `@vespeneventures/policy`'s `validate.ts` does this exact
 * job — shape validation over `unknown`, emitting findings, no dependency —
 * for one small shape; `validation.ts` in this package generalizes that
 * same pattern (plain type guards, an accumulated issue list, never throws)
 * across several entities without pulling in a schema library whose own
 * major-version churn (a consumer on a different major of that library
 * would hit a duplicate install or a peer conflict, entirely to run a facts
 * gate in CI) would be a real cost for zero necessary expressive power —
 * every constraint below (string length, ISO-date/kebab-case pattern,
 * closed-vocabulary enum, discriminated union, array-of-object) is exactly
 * as checkable by hand as it would be through a schema library, and this
 * package's own test suite proves each validator's error path, not just
 * its happy path.
 */

import {
  isPlainObject,
  optionalString,
  optionalStringArray,
  pushIssue,
  requireArrayOf,
  requireNumber,
  requirePattern,
  requireString,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

// ------------------------------------------------------------------- money

/**
 * A monetary amount is always `{ amount, currency }`, never a bare number —
 * a number alone has no unit, and a unit-less number is exactly the kind of
 * claim `checkFactsTraceability` (see `facts-gate.ts`) exists to catch
 * drifting from reality. `currency` is an ISO 4217 code.
 */
export interface Money {
  amount: number;
  currency: string;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function readMoney(value: unknown, path: string, issues: ValidationIssue[]): Money | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object shaped { amount: number; currency: string }");
    return undefined;
  }
  const amount = requireNumber(value.amount, `${path}.amount`, issues);
  const currency = requireString(value.currency, `${path}.currency`, issues);
  if (currency !== undefined) {
    requirePattern(currency, `${path}.currency`, issues, CURRENCY_RE, 'must be an ISO 4217 code, e.g. "USD"');
  }
  if (issues.length > start) return undefined;
  return { amount: amount as number, currency: currency as string };
}

/** Validates a standalone `Money` value. Most callers never need this directly — `Fact.value` uses it internally. */
export function validateMoney(value: unknown): ValidationResult<Money> {
  const issues: ValidationIssue[] = [];
  const money = readMoney(value, "(root)", issues);
  return money !== undefined ? { ok: true, value: money } : { ok: false, issues };
}

// -------------------------------------------------------------------- fact

/** `key` identifies a fact stably across renames of its label — kebab-case, like a CSS custom property without the `--`. */
const FACT_KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One tracked fact: a value plus who vouches for it and when it was last
 * checked. This is the entity the whole package exists to make checkable —
 * every number or named claim a product states publicly should trace back
 * to exactly one of these.
 *
 * `aliases` is the escape hatch that makes matching prose against a fact
 * tractable without free-form number parsing: the fact's author writes down
 * every literal surface form the value is allowed to appear as in prose
 * (`"$4.2M"`, `"4.2 million"`, `"4,200,000"` might all alias one fact whose
 * `value` is the bare number `4200000`). `buildFactIndex` (see
 * `fact-index.ts`) reads `aliases` verbatim; it does not attempt to derive
 * them from `value` by formatting, because a formatter can only ever
 * guess which of many equally-valid renderings a given piece of prose
 * chose to use.
 */
export interface Fact {
  /** Stable identifier, kebab-case. Referenced from prose via the `<!-- fact:<key> -->` marker (see `facts-gate.ts`). */
  key: string;
  /** Human-readable name for this fact, e.g. "Active customers". */
  label: string;
  /** The value itself. A bare number, string, boolean, or a `Money` object. */
  value: string | number | boolean | Money;
  /** Unit for a bare-number value, e.g. "customers", "%", "countries". Omit for `Money` values — `Money.currency` already carries the unit. */
  unit?: string;
  /** The period or moment this value describes, e.g. "Q2 2026", "as of 2026-06-30". Distinct from `lastUpdatedAt`, which is when the value was last verified, not what period it describes. */
  asOf?: string;
  /** Where this value came from — a filing, an attestation, a dashboard export. Free-form, but required: an unsourced fact is not a fact. */
  source: string;
  /** Who last verified this value (a handle or initials). */
  verifiedBy?: string;
  /** ISO 8601 date this value was last checked against its source. */
  lastUpdatedAt: string;
  /**
   * Every literal string this fact is allowed to appear as in prose, in
   * addition to `value`'s own plain stringification. See this file's
   * top-level doc comment for why aliases are declared, not derived.
   */
  aliases?: string[];
}

function readFactValue(value: unknown, path: string, issues: ValidationIssue[]): Fact["value"] | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (isPlainObject(value)) return readMoney(value, path, issues);
  pushIssue(
    issues,
    path,
    `must be a string, number, boolean, or a Money object ({ amount, currency }), got ${value === undefined ? "undefined" : typeof value}`,
  );
  return undefined;
}

function readFact(value: unknown, path: string, issues: ValidationIssue[]): Fact | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }

  const key = requireString(value.key, `${path}.key`, issues);
  if (key !== undefined) {
    requirePattern(key, `${path}.key`, issues, FACT_KEY_RE, 'must be kebab-case, e.g. "active-customers"');
  }
  const label = requireString(value.label, `${path}.label`, issues, { minLength: 1 });
  const factValue = readFactValue(value.value, `${path}.value`, issues);
  const unit = optionalString(value.unit, `${path}.unit`, issues);
  const asOf = optionalString(value.asOf, `${path}.asOf`, issues);
  const source = requireString(value.source, `${path}.source`, issues, { minLength: 1 });
  const verifiedBy = optionalString(value.verifiedBy, `${path}.verifiedBy`, issues);
  const lastUpdatedAt = requireString(value.lastUpdatedAt, `${path}.lastUpdatedAt`, issues);
  if (lastUpdatedAt !== undefined) {
    requirePattern(lastUpdatedAt, `${path}.lastUpdatedAt`, issues, ISO_DATE_RE, "must be an ISO 8601 date (YYYY-MM-DD)");
  }
  const aliases = optionalStringArray(value.aliases, `${path}.aliases`, issues, { itemMinLength: 1 });

  if (issues.length > start) return undefined;
  return {
    key: key as string,
    label: label as string,
    value: factValue as Fact["value"],
    unit,
    asOf,
    source: source as string,
    verifiedBy,
    lastUpdatedAt: lastUpdatedAt as string,
    aliases,
  };
}

/** Validates a single `Fact`. */
export function validateFact(value: unknown): ValidationResult<Fact> {
  const issues: ValidationIssue[] = [];
  const fact = readFact(value, "(root)", issues);
  return fact !== undefined ? { ok: true, value: fact } : { ok: false, issues };
}

/**
 * Validates the whole contents of a `facts.json` file: an array of `Fact`,
 * each `key` unique. Duplicate-key detection runs after every individual
 * `Fact` has already validated cleanly — a facts file with both a
 * malformed entry and a duplicate key reports the malformed entry first,
 * the same order a reader would want to fix them in.
 */
export function validateFacts(value: unknown): ValidationResult<Fact[]> {
  const issues: ValidationIssue[] = [];
  const facts = requireArrayOf(value, "(root)", issues, readFact);
  if (facts === undefined) return { ok: false, issues };

  const seenAt = new Map<string, number>();
  facts.forEach((fact, i) => {
    const firstIndex = seenAt.get(fact.key);
    if (firstIndex !== undefined) {
      pushIssue(issues, `[${i}].key`, `duplicate fact key "${fact.key}" (first seen at index ${firstIndex})`);
    } else {
      seenAt.set(fact.key, i);
    }
  });

  return issues.length === 0 ? { ok: true, value: facts } : { ok: false, issues };
}

// ----------------------------------------------------------------- mission

export interface OperatingValue {
  name: string;
  /** The decision this value forces when two paths look equally good. Operational, not a slogan. */
  rule: string;
}

function readOperatingValue(value: unknown, path: string, issues: ValidationIssue[]): OperatingValue | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const rule = requireString(value.rule, `${path}.rule`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { name: name as string, rule: rule as string };
}

export interface Mission {
  /** Why the product exists, one line, present tense. */
  statement: string;
  /** The world this product is betting comes true — one horizon out, distinct from the mission's present-tense "why we exist today". */
  vision: string;
  values: OperatingValue[];
}

/** Validates a `Mission` document. */
export function validateMission(value: unknown): ValidationResult<Mission> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: "(root)", message: "must be an object" }] };
  }
  const statement = requireString(value.statement, "statement", issues, { minLength: 10 });
  const vision = requireString(value.vision, "vision", issues, { minLength: 10 });
  const values = requireArrayOf(value.values, "values", issues, readOperatingValue, { minLength: 1 });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { statement: statement as string, vision: vision as string, values: values as OperatingValue[] },
  };
}

// ------------------------------------------------------------- positioning

/**
 * The classic positioning-statement madlib: "For `forWhom`, `productName`
 * is the `category` that `weAre` — unlike `unlike`, `because` `reasonToBelieve`."
 * Kept as discrete fields rather than one free-text paragraph so each part
 * can be reasoned about (and traced to `facts`) on its own.
 */
export interface Positioning {
  productName: string;
  category: string;
  forWhom: string;
  weAre: string;
  unlike: string;
  reasonToBelieve: string;
}

/** Validates a `Positioning` document. */
export function validatePositioning(value: unknown): ValidationResult<Positioning> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: "(root)", message: "must be an object" }] };
  }
  const productName = requireString(value.productName, "productName", issues, { minLength: 1 });
  const category = requireString(value.category, "category", issues, { minLength: 1 });
  const forWhom = requireString(value.forWhom, "forWhom", issues, { minLength: 1 });
  const weAre = requireString(value.weAre, "weAre", issues, { minLength: 1 });
  const unlike = requireString(value.unlike, "unlike", issues, { minLength: 1 });
  const reasonToBelieve = requireString(value.reasonToBelieve, "reasonToBelieve", issues, { minLength: 1 });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      productName: productName as string,
      category: category as string,
      forWhom: forWhom as string,
      weAre: weAre as string,
      unlike: unlike as string,
      reasonToBelieve: reasonToBelieve as string,
    },
  };
}

// ------------------------------------------------------------------ market

export interface Market {
  id: string;
  name: string;
  description: string;
  /** `Fact.key`s this market's sizing claims trace back to (e.g. a TAM figure). Not cross-checked against a live facts set here — pure shape validation, no cross-entity lookups. `readStrategy` (see `reader.ts`) is where that cross-check could happen. */
  factRefs?: string[];
}

function readMarket(value: unknown, path: string, issues: ValidationIssue[]): Market | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const description = requireString(value.description, `${path}.description`, issues, { minLength: 1 });
  const factRefs = optionalStringArray(value.factRefs, `${path}.factRefs`, issues);
  if (issues.length > start) return undefined;
  return { id: id as string, name: name as string, description: description as string, factRefs };
}

/** Validates a single `Market`. */
export function validateMarket(value: unknown): ValidationResult<Market> {
  const issues: ValidationIssue[] = [];
  const market = readMarket(value, "(root)", issues);
  return market !== undefined ? { ok: true, value: market } : { ok: false, issues };
}

/** Validates the whole contents of a `markets.json` file: an array of `Market`. */
export function validateMarkets(value: unknown): ValidationResult<Market[]> {
  const issues: ValidationIssue[] = [];
  const markets = requireArrayOf(value, "(root)", issues, readMarket);
  return markets !== undefined ? { ok: true, value: markets } : { ok: false, issues };
}

// ---------------------------------------------------------------- audience

export interface Audience {
  id: string;
  name: string;
  description: string;
  painPoints?: string[];
  factRefs?: string[];
}

function readAudience(value: unknown, path: string, issues: ValidationIssue[]): Audience | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const description = requireString(value.description, `${path}.description`, issues, { minLength: 1 });
  const painPoints = optionalStringArray(value.painPoints, `${path}.painPoints`, issues, { itemMinLength: 1 });
  const factRefs = optionalStringArray(value.factRefs, `${path}.factRefs`, issues);
  if (issues.length > start) return undefined;
  return { id: id as string, name: name as string, description: description as string, painPoints, factRefs };
}

/** Validates a single `Audience`. */
export function validateAudience(value: unknown): ValidationResult<Audience> {
  const issues: ValidationIssue[] = [];
  const audience = readAudience(value, "(root)", issues);
  return audience !== undefined ? { ok: true, value: audience } : { ok: false, issues };
}

/** Validates the whole contents of an `audiences.json` file: an array of `Audience`. */
export function validateAudiences(value: unknown): ValidationResult<Audience[]> {
  const issues: ValidationIssue[] = [];
  const audiences = requireArrayOf(value, "(root)", issues, readAudience);
  return audiences !== undefined ? { ok: true, value: audiences } : { ok: false, issues };
}

// ----------------------------------------------------------------- roadmap

export type RoadmapStatus = "now" | "next" | "later" | "shipped";

/**
 * `status` is a closed vocabulary on purpose: "now" / "next" / "later" are
 * forward-looking commitments, and "shipped" is the one status that has
 * crossed into being a fact-shaped claim itself (a consumer describing a
 * shipped item as available today should be able to trace that claim the
 * same way any other fact-shaped claim can be traced — see `facts-gate.ts`).
 * Exported as a list, mirroring `@vespeneventures/policy`'s own
 * `DIGEST_ALGORITHMS`, so a new status is one new entry here plus one new
 * `case` anywhere a caller switches over it — not a rewrite of every call
 * site that currently assumes these four are the only options.
 */
export const ROADMAP_STATUSES: readonly RoadmapStatus[] = ["now", "next", "later", "shipped"];

export interface RoadmapItem {
  id: string;
  title: string;
  status: RoadmapStatus;
  description: string;
  targetQuarter?: string;
}

function readRoadmapItem(value: unknown, path: string, issues: ValidationIssue[]): RoadmapItem | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  const title = requireString(value.title, `${path}.title`, issues, { minLength: 1 });
  const statusValue = value.status;
  const statusOk = typeof statusValue === "string" && (ROADMAP_STATUSES as readonly string[]).includes(statusValue);
  if (!statusOk) {
    pushIssue(
      issues,
      `${path}.status`,
      `must be one of ${ROADMAP_STATUSES.join(", ")}, got ${statusValue === undefined ? "undefined" : JSON.stringify(statusValue)}`,
    );
  }
  const description = requireString(value.description, `${path}.description`, issues, { minLength: 1 });
  const targetQuarter = optionalString(value.targetQuarter, `${path}.targetQuarter`, issues);
  if (issues.length > start) return undefined;
  return {
    id: id as string,
    title: title as string,
    status: statusValue as RoadmapStatus,
    description: description as string,
    targetQuarter,
  };
}

/** Validates a single `RoadmapItem`. */
export function validateRoadmapItem(value: unknown): ValidationResult<RoadmapItem> {
  const issues: ValidationIssue[] = [];
  const item = readRoadmapItem(value, "(root)", issues);
  return item !== undefined ? { ok: true, value: item } : { ok: false, issues };
}

/** Validates the whole contents of a `roadmap.json` file: an array of `RoadmapItem`. */
export function validateRoadmapItems(value: unknown): ValidationResult<RoadmapItem[]> {
  const issues: ValidationIssue[] = [];
  const items = requireArrayOf(value, "(root)", issues, readRoadmapItem);
  return items !== undefined ? { ok: true, value: items } : { ok: false, issues };
}

// -------------------------------------------------------------------- brand

/**
 * The irreducible one-line statement of what the brand IS — distinct from
 * `Mission.statement` (why the *product* exists, present tense) and
 * `Positioning.weAre` (how it's framed against a category and a
 * competitor). `BrandEssence` is the thing every `BrandAttribute` below
 * ultimately has to be consistent with: an attribute that contradicts the
 * essence is a defect in the brand itself, not something this validator
 * can catch (it checks shape, never cross-entity consistency of meaning).
 *
 * Kept to a single required field on purpose, the same restraint
 * `Positioning` applies by staying a fixed madlib rather than free text: a
 * brand essence that needs bullet points or sub-clauses to explain itself
 * has already drifted into positioning or values, both of which already
 * have their own entities above (`Positioning`, `Mission.values`).
 */
export interface BrandEssence {
  /** One line, present tense — the same register as `Mission.statement`. */
  statement: string;
}

function readBrandEssence(value: unknown, path: string, issues: ValidationIssue[]): BrandEssence | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object shaped { statement: string }");
    return undefined;
  }
  const statement = requireString(value.statement, `${path}.statement`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { statement: statement as string };
}

/** Validates a `BrandEssence` document. */
export function validateBrandEssence(value: unknown): ValidationResult<BrandEssence> {
  const issues: ValidationIssue[] = [];
  const essence = readBrandEssence(value, "(root)", issues);
  return essence !== undefined ? { ok: true, value: essence } : { ok: false, issues };
}

/**
 * What makes a `BrandAttribute` real rather than an assertion. Two fields,
 * for two different reasons:
 *
 *   - `basis` (REQUIRED, free prose) — the actual reason this attribute is
 *     true: a decision, a build choice, an observed customer pattern, a
 *     founder's stated rule. Required, not optional, because an attribute
 *     with no `basis` at all is exactly a vibe — a word picked because it
 *     sounds good, with nothing behind it. `minLength: 10` mirrors
 *     `OperatingValue.rule`'s own bar: long enough that "because it's
 *     true" cannot satisfy it.
 *   - `factRef` (OPTIONAL, opaque string) — when the basis happens to be a
 *     tracked, checkable number or claim, this names the `Fact.key` it
 *     traces to. This is the exact seam `@vespeneventures/copy/voice`'s
 *     `Claim.factRef` already uses, and the same discipline this very
 *     file's `Market.factRefs`/`Audience.factRefs` already follow: a
 *     plain, optional string, never validated against a real `facts.json`
 *     here (this package does no cross-entity lookup at validation time —
 *     see `Market`'s own doc comment above) and never a typed import.
 *
 * WHY BOTH, NOT ONE OR THE OTHER: a `factRef`-only design would force every
 * brand attribute to be backed by a registered fact, but plenty of
 * legitimate evidence for a brand attribute isn't fact-shaped at all — a
 * design decision, a support policy, a founder's stated rule for breaking
 * ties — and forcing it into a fabricated `Fact` would corrupt the facts
 * registry with entries invented only to satisfy this schema, undermining
 * the exact traceability `checkFactsTraceability` exists to protect. A
 * `basis`-only design (prose, no seam at all) would accept a well-written
 * vibe: prose can be persuasive and still cite nothing checkable, which is
 * the specific failure this whole entity exists to rule out. Requiring
 * `basis` always, and allowing `factRef` as an additional, optional pointer
 * into the one registry this package can actually check something
 * against, gets real evidence in every case and traceable evidence in
 * every case where that's honestly possible.
 */
export interface BrandEvidence {
  basis: string;
  factRef?: string;
}

function readBrandEvidence(value: unknown, path: string, issues: ValidationIssue[]): BrandEvidence | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object shaped { basis: string; factRef?: string }");
    return undefined;
  }
  const basis = requireString(value.basis, `${path}.basis`, issues, { minLength: 10 });
  const factRef = optionalString(value.factRef, `${path}.factRef`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { basis: basis as string, factRef };
}

/**
 * One trait the brand is known for, or is deliberately building toward.
 * Structurally a sibling of `OperatingValue` above: same package, same
 * hand-rolled validation discipline, same job of making a strategy
 * document mechanically checkable instead of just prose. Where
 * `OperatingValue.rule` forces a decision, `BrandAttribute.evidence`
 * forces a citation — see `BrandEvidence`'s own doc comment for why.
 */
export interface BrandAttribute {
  name: string;
  description: string;
  evidence: BrandEvidence;
}

function readBrandAttribute(value: unknown, path: string, issues: ValidationIssue[]): BrandAttribute | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const description = requireString(value.description, `${path}.description`, issues, { minLength: 1 });
  const evidence = readBrandEvidence(value.evidence, `${path}.evidence`, issues);
  if (issues.length > start) return undefined;
  return { name: name as string, description: description as string, evidence: evidence as BrandEvidence };
}

/** Validates a single `BrandAttribute`. */
export function validateBrandAttribute(value: unknown): ValidationResult<BrandAttribute> {
  const issues: ValidationIssue[] = [];
  const attribute = readBrandAttribute(value, "(root)", issues);
  return attribute !== undefined ? { ok: true, value: attribute } : { ok: false, issues };
}

/** Validates the whole contents of a `brand-attributes.json` file: an array of `BrandAttribute`. */
export function validateBrandAttributes(value: unknown): ValidationResult<BrandAttribute[]> {
  const issues: ValidationIssue[] = [];
  const attributes = requireArrayOf(value, "(root)", issues, readBrandAttribute);
  return attributes !== undefined ? { ok: true, value: attributes } : { ok: false, issues };
}
