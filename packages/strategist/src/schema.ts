/**
 * Entity shapes and validators for every entity this package knows about.
 * Pure data shape — no I/O, no filesystem knowledge, nothing about where a
 * consumer's real values live on disk (that is `reader.ts`'s job).
 *
 * These entities ship as MACHINERY, not content: this package defines what
 * a `Fact` or a `Mission` document must look like, never what any real
 * product's mission statement says. A consumer repo authors its own values
 * against this shape — the same split `@example/ui/tokens` draws
 * between a greyscale contract and a brand binding (see that package's
 * README, "The three-layer contract").
 *
 * VALIDATION IS HAND-ROLLED, DELIBERATELY, NOT A SCHEMA LIBRARY. This
 * package's own README leads with "pure data + validation, safe to
 * install" — and every other zero-dependency package in this foundation
 * (`@example/catalog`, `@example/policy`,
 * `@example/ui/tokens`) backs that claim with zero runtime
 * dependencies. `@example/policy`'s `validate.ts` does this exact
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
  requireStringArray,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";
import { readBrandDerivationRecord, type BrandDerivation } from "./brand-derivation.js";

// ------------------------------------------------------------------- money

/**
 * A monetary amount is always `{ amount, currency }` at rest (authored
 * `{ value, currency }` is accepted on read and normalized to `amount`),
 * never a bare number —
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
    pushIssue(issues, path, "must be an object shaped { amount: number; currency: string } (or { value: number; currency: string })");
    return undefined;
  }
  const amountField = value.amount !== undefined ? "amount" : "value";
  const amount = requireNumber(value[amountField], `${path}.${amountField}`, issues);
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
  /**
   * Which file this fact was read from — populated by `readStrategyDirectory`
   * (`facts-dir.ts`) with the leaf's path relative to the facts directory,
   * because a directory of facts has per-file provenance a single flat
   * `facts.json` cannot express. Never required, never validated (an
   * authored `sourceFile` in a facts file is ignored like any field
   * outside the declared shape), and left unset by `readStrategy`
   * (`reader.ts`) — the flat file has one provenance already: itself.
   */
  sourceFile?: string;
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
  id: string;
  /** The decision this value forces when two paths look equally good. Operational, not a slogan. */
  rule: string;
}

function readOperatingValue(value: unknown, path: string, issues: ValidationIssue[]): OperatingValue | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) {
    requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, 'must be kebab-case, e.g. "clarity"');
  }
  const rule = requireString(value.rule, `${path}.rule`, issues, { minLength: 10 });
  if (issues.length > start) return undefined;
  return { id: id as string, rule: rule as string };
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

/** Positioning binds audience and claim ids — not prose audience or reason fields. */
export interface Positioning {
  productName: string;
  category: string;
  audienceIds: string[];
  weAre: string;
  unlike: string;
  claimIds: string[];
  /** Room — not validated beyond string shape. */
  notes?: string;
}

/** Validates a `Positioning` document. */
export function validatePositioning(value: unknown): ValidationResult<Positioning> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: "(root)", message: "must be an object" }] };
  }
  if (value.forWhom !== undefined) {
    pushIssue(issues, "forWhom", "retired — use audienceIds in positioning.json instead");
  }
  if (value.reasonToBelieve !== undefined) {
    pushIssue(issues, "reasonToBelieve", "retired — use claimIds in positioning.json instead");
  }
  const productName = requireString(value.productName, "productName", issues, { minLength: 1 });
  const category = requireString(value.category, "category", issues, { minLength: 1 });
  const audienceIds = requireArrayOf(value.audienceIds, "audienceIds", issues, (item, path, inner) => {
    const id = requireString(item, path, inner, { minLength: 1 });
    if (id !== undefined) requirePattern(id, path, inner, FACT_KEY_RE, "must be kebab-case");
    return id;
  }, { minLength: 1 });
  const weAre = requireString(value.weAre, "weAre", issues, { minLength: 1 });
  const unlike = requireString(value.unlike, "unlike", issues, { minLength: 1 });
  const claimIds = requireArrayOf(value.claimIds, "claimIds", issues, (item, path, inner) => {
    const id = requireString(item, path, inner, { minLength: 1 });
    if (id !== undefined) requirePattern(id, path, inner, FACT_KEY_RE, "must be kebab-case");
    return id;
  }, { minLength: 1 });
  const notes = optionalString(value.notes, "notes", issues);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      productName: productName as string,
      category: category as string,
      audienceIds: audienceIds as string[],
      weAre: weAre as string,
      unlike: unlike as string,
      claimIds: claimIds as string[],
      notes,
    },
  };
}

// ------------------------------------------------------------------ market

export interface Market {
  id: string;
  name: string;
  audienceIds: string[];
  /** `Fact.key`s this market's sizing claims trace back to (e.g. a TAM figure). Not cross-checked against a live facts set here — pure shape validation, no cross-entity lookups. `readStrategy` (see `reader.ts`) is where that cross-check could happen. */
  factRefs?: string[];
  /** Room — optional prose. */
  description?: string;
}

function readMarket(value: unknown, path: string, issues: ValidationIssue[]): Market | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, "must be kebab-case");
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const audienceIds = requireArrayOf(value.audienceIds, `${path}.audienceIds`, issues, (item, itemPath, inner) => {
    const audienceId = requireString(item, itemPath, inner, { minLength: 1 });
    if (audienceId !== undefined) requirePattern(audienceId, itemPath, inner, FACT_KEY_RE, "must be kebab-case");
    return audienceId;
  }, { minLength: 1 });
  const factRefs = optionalStringArray(value.factRefs, `${path}.factRefs`, issues);
  const description = optionalString(value.description, `${path}.description`, issues);
  if (issues.length > start) return undefined;
  return { id: id as string, name: name as string, audienceIds: audienceIds as string[], factRefs, description };
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
  situation: string;
  pains: string[];
  /** Room — optional notes. */
  notes?: string;
}

function readAudience(value: unknown, path: string, issues: ValidationIssue[]): Audience | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, "must be kebab-case");
  const name = requireString(value.name, `${path}.name`, issues, { minLength: 1 });
  const situation = requireString(value.situation, `${path}.situation`, issues, { minLength: 1 });
  const pains = requireArrayOf(value.pains, `${path}.pains`, issues, (item, itemPath, inner) =>
    requireString(item, itemPath, inner, { minLength: 1 }),
  { minLength: 1 });
  const notes = optionalString(value.notes, `${path}.notes`, issues);
  if (issues.length > start) return undefined;
  return { id: id as string, name: name as string, situation: situation as string, pains: pains as string[], notes };
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
 * Exported as a list, mirroring `@example/policy`'s own
 * `DIGEST_ALGORITHMS`, so a new status is one new entry here plus one new
 * `case` anywhere a caller switches over it — not a rewrite of every call
 * site that currently assumes these four are the only options.
 */
export const ROADMAP_STATUSES: readonly RoadmapStatus[] = ["now", "next", "later", "shipped"];

export interface RoadmapItem {
  id: string;
  title: string;
  status: RoadmapStatus;
  description?: string;
  targetQuarter?: string;
  factRef?: string;
  claimId?: string;
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
  const description = optionalString(value.description, `${path}.description`, issues);
  const targetQuarter = optionalString(value.targetQuarter, `${path}.targetQuarter`, issues);
  const factRef = optionalString(value.factRef, `${path}.factRef`, issues);
  const claimId = optionalString(value.claimId, `${path}.claimId`, issues);
  if (statusValue === "shipped" && factRef === undefined && claimId === undefined) {
    pushIssue(issues, `${path}`, 'status "shipped" requires factRef or claimId');
  }
  if (issues.length > start) return undefined;
  return {
    id: id as string,
    title: title as string,
    status: statusValue as RoadmapStatus,
    description,
    targetQuarter,
    factRef,
    claimId,
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

export interface BrandEssence {
  statement: string;
}

export interface BrandAttribute {
  id: string;
  statement: string;
  basis: string;
  factRef?: string;
}

export interface BrandDocument {
  essence: BrandEssence;
  attributes: BrandAttribute[];
  derivations: BrandDerivation[];
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

function readBrandAttribute(value: unknown, path: string, issues: ValidationIssue[]): BrandAttribute | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, "must be kebab-case");
  const statement = requireString(value.statement, `${path}.statement`, issues, { minLength: 1 });
  const basis = requireString(value.basis, `${path}.basis`, issues, { minLength: 10 });
  const factRef = optionalString(value.factRef, `${path}.factRef`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { id: id as string, statement: statement as string, basis: basis as string, factRef };
}

/** Validates `brand.json`. */
export function validateBrand(value: unknown): ValidationResult<BrandDocument> {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "(root)", message: "must be an object" }] };
  const essence = readBrandEssence(value.essence, "essence", issues);
  const attributes = requireArrayOf(value.attributes, "attributes", issues, readBrandAttribute, { minLength: 1 });
  const derivations = requireArrayOf(value.derivations, "derivations", issues, readBrandDerivationRecord, { minLength: 1 });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      essence: essence as BrandEssence,
      attributes: attributes as BrandAttribute[],
      derivations: derivations as BrandDerivation[],
    },
  };
}

/** @deprecated Retired file shape — use `validateBrand` / `brand.json`. */
export function validateBrandEssence(value: unknown): ValidationResult<BrandEssence> {
  const issues: ValidationIssue[] = [];
  const essence = readBrandEssence(value, "(root)", issues);
  return essence !== undefined ? { ok: true, value: essence } : { ok: false, issues };
}

/** @deprecated Retired file shape — use `validateBrand` / `brand.json`. */
export function validateBrandAttribute(value: unknown): ValidationResult<BrandAttribute> {
  const issues: ValidationIssue[] = [];
  const attribute = readBrandAttribute(value, "(root)", issues);
  return attribute !== undefined ? { ok: true, value: attribute } : { ok: false, issues };
}

/** @deprecated Retired file shape — use `validateBrand` / `brand.json`. */
export function validateBrandAttributes(value: unknown): ValidationResult<BrandAttribute[]> {
  const issues: ValidationIssue[] = [];
  const attributes = requireArrayOf(value, "(root)", issues, readBrandAttribute);
  return attributes !== undefined ? { ok: true, value: attributes } : { ok: false, issues };
}

// ------------------------------------------------------------------- claims

export type StrategistClaimStatus = "approved" | "hypothesis";

export interface StrategistClaim {
  id: string;
  status: StrategistClaimStatus;
  assertion: string;
  basis?: string;
  factRefs?: string[];
  audienceIds?: string[];
  example?: string;
}

function readStrategistClaim(value: unknown, path: string, issues: ValidationIssue[]): StrategistClaim | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, "must be kebab-case");
  const statusValue = value.status;
  if (statusValue !== "approved" && statusValue !== "hypothesis") {
    pushIssue(issues, `${path}.status`, 'must be "approved" or "hypothesis"');
  }
  const assertion = requireString(value.assertion, `${path}.assertion`, issues, { minLength: 10 });
  const basis = optionalString(value.basis, `${path}.basis`, issues, { minLength: 10 });
  const factRefs = optionalStringArray(value.factRefs, `${path}.factRefs`, issues);
  const audienceIds = optionalStringArray(value.audienceIds, `${path}.audienceIds`, issues, { itemMinLength: 1 });
  const example = optionalString(value.example, `${path}.example`, issues);
  if (statusValue === "approved" && basis === undefined) {
    pushIssue(issues, `${path}.basis`, "is required when status is approved");
  }
  if (issues.length > start) return undefined;
  return {
    id: id as string,
    status: statusValue as StrategistClaimStatus,
    assertion: assertion as string,
    basis,
    factRefs,
    audienceIds,
    example,
  };
}

export function validateStrategistClaim(value: unknown): ValidationResult<StrategistClaim> {
  const issues: ValidationIssue[] = [];
  const claim = readStrategistClaim(value, "(root)", issues);
  return claim !== undefined ? { ok: true, value: claim } : { ok: false, issues };
}

export function validateStrategistClaims(value: unknown): ValidationResult<StrategistClaim[]> {
  const issues: ValidationIssue[] = [];
  const claims = requireArrayOf(value, "(root)", issues, readStrategistClaim);
  if (claims === undefined) return { ok: false, issues };
  const seenAt = new Map<string, number>();
  claims.forEach((claim, i) => {
    const first = seenAt.get(claim.id);
    if (first !== undefined) pushIssue(issues, `[${i}].id`, `duplicate claim id "${claim.id}" (first seen at index ${first})`);
    else seenAt.set(claim.id, i);
  });
  return issues.length === 0 ? { ok: true, value: claims } : { ok: false, issues };
}

// -------------------------------------------------------------- constraints

export type StrategyConstraintTarget = "copy" | "surface" | "all";

export interface StrategyConstraint {
  id: string;
  target: StrategyConstraintTarget;
  instruction: string;
  why?: string;
}

function readStrategyConstraint(value: unknown, path: string, issues: ValidationIssue[]): StrategyConstraint | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, "must be kebab-case");
  const target = value.target;
  if (target !== "copy" && target !== "surface" && target !== "all") {
    pushIssue(issues, `${path}.target`, 'must be "copy", "surface", or "all"');
  }
  const instruction = requireString(value.instruction, `${path}.instruction`, issues, { minLength: 10 });
  const why = optionalString(value.why, `${path}.why`, issues);
  if (issues.length > start) return undefined;
  return { id: id as string, target: target as StrategyConstraintTarget, instruction: instruction as string, why };
}

export function validateStrategyConstraint(value: unknown): ValidationResult<StrategyConstraint> {
  const issues: ValidationIssue[] = [];
  const constraint = readStrategyConstraint(value, "(root)", issues);
  return constraint !== undefined ? { ok: true, value: constraint } : { ok: false, issues };
}

export function validateStrategyConstraints(value: unknown): ValidationResult<StrategyConstraint[]> {
  const issues: ValidationIssue[] = [];
  const constraints = requireArrayOf(value, "(root)", issues, readStrategyConstraint);
  return constraints !== undefined ? { ok: true, value: constraints } : { ok: false, issues };
}

// --------------------------------------------------------------- direction

/** Strategy files a direction `subject` may point at. `facts.json` is intentionally absent — facts are not direction subjects. */
export const DIRECTION_SUBJECT_FILES = [
  "audiences.json",
  "markets.json",
  "positioning.json",
  "claims.json",
  "constraints.json",
  "brand.json",
  "mission.json",
  "roadmap.json",
] as const;

export type DirectionSubjectFile = (typeof DIRECTION_SUBJECT_FILES)[number];

export interface DirectionSubject {
  file: DirectionSubjectFile;
  id: string;
}

export interface DirectionEntity {
  id: string;
  subject: DirectionSubject;
  decidedOn: string;
  supersedes?: string;
  derivesFrom: string[];
  rationale?: string;
}

function readDirectionSubject(value: unknown, path: string, issues: ValidationIssue[]): DirectionSubject | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object shaped { file: string; id: string }");
    return undefined;
  }
  const file = requireString(value.file, `${path}.file`, issues, { minLength: 1 });
  if (file !== undefined && !(DIRECTION_SUBJECT_FILES as readonly string[]).includes(file)) {
    pushIssue(
      issues,
      `${path}.file`,
      `must be one of ${DIRECTION_SUBJECT_FILES.join(", ")}, got ${JSON.stringify(file)}`,
    );
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (issues.length > start) return undefined;
  return { file: file as DirectionSubjectFile, id: id as string };
}

function readDirectionEntity(value: unknown, path: string, issues: ValidationIssue[]): DirectionEntity | undefined {
  const start = issues.length;
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, issues, { minLength: 1 });
  if (id !== undefined) requirePattern(id, `${path}.id`, issues, FACT_KEY_RE, 'must be kebab-case, e.g. "vision-2026-h2"');
  const subject = readDirectionSubject(value.subject, `${path}.subject`, issues);
  const decidedOn = requireString(value.decidedOn, `${path}.decidedOn`, issues);
  if (decidedOn !== undefined) requirePattern(decidedOn, `${path}.decidedOn`, issues, ISO_DATE_RE, "must be an ISO 8601 date (YYYY-MM-DD)");
  const supersedes = optionalString(value.supersedes, `${path}.supersedes`, issues, { minLength: 1 });
  const derivesFromRaw = value.derivesFrom;
  const derivesFrom =
    derivesFromRaw === undefined
      ? []
      : requireStringArray(derivesFromRaw, `${path}.derivesFrom`, issues, { itemMinLength: 1 }) ?? [];
  const rationale = optionalString(value.rationale, `${path}.rationale`, issues);
  if (issues.length > start) return undefined;
  return {
    id: id as string,
    subject: subject as DirectionSubject,
    decidedOn: decidedOn as string,
    supersedes,
    derivesFrom: derivesFrom as string[],
    rationale,
  };
}

export function validateDirectionEntity(value: unknown): ValidationResult<DirectionEntity> {
  const issues: ValidationIssue[] = [];
  const entity = readDirectionEntity(value, "(root)", issues);
  return entity !== undefined ? { ok: true, value: entity } : { ok: false, issues };
}

export function validateDirectionEntities(value: unknown): ValidationResult<DirectionEntity[]> {
  const issues: ValidationIssue[] = [];
  const entities = requireArrayOf(value, "(root)", issues, readDirectionEntity);
  if (entities === undefined) return { ok: false, issues };

  const seenAt = new Map<string, number>();
  entities.forEach((entity, i) => {
    const firstIndex = seenAt.get(entity.id);
    if (firstIndex !== undefined) {
      pushIssue(issues, `[${i}].id`, `duplicate direction entity id "${entity.id}" (first seen at index ${firstIndex})`);
    } else {
      seenAt.set(entity.id, i);
    }
  });

  return issues.length === 0 ? { ok: true, value: entities } : { ok: false, issues };
}
