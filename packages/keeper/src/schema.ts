/**
 * The holding contract: what is held about one person, what they did that
 * put it there, where they can see and correct it, what the consumer
 * declared about how long it may be kept, and what was actually erased.
 *
 * Everything here is consumer-authored data. This package ships no retention
 * period, no holding class, no belief class, no disclosure surface and no
 * jurisdiction rule of its own; it ships the shapes those things are written
 * in and the checkers that read them back.
 *
 * THE SUBJECT IS THE KEY
 * -----------------------
 * `subjectId` is the person a record is ABOUT. `actorId` is whoever or
 * whatever put it there. They are separate fields on every record and are
 * never unified, because the person acting and the person acted about are
 * routinely different: a colleague files a note about someone, an agent
 * infers something from a session, an importer loads a referral. Every join
 * in this package keys on the SUBJECT. A record held about one person and
 * shown to another is not visibility, and `checkVisibility` says so by name.
 *
 * Both are opaque host-owned references — never an email address, a name, a
 * phone number, an address, or an IP.
 *
 * NO CONTENT, ANYWHERE
 * ---------------------
 * No record here holds the authored material, the saved work, the note, or
 * the belief's own text. A held item is an `itemId`, a consumer-defined
 * class label, an origin, and a provenance; what the id points at stays in
 * the consumer's own store. A gate can therefore run over a whole holding
 * set without any person-attributable content passing through it — which is
 * what makes it possible to say the next thing.
 *
 * NO PERSON-ATTRIBUTABLE RECORD IS EVER WRITTEN TO GIT
 * -----------------------------------------------------
 * This is the sharpest constraint on this package, and it is not a style
 * preference. Git cannot delete. A record committed once is in the history,
 * in every clone, and in every fork, and no later commit removes it. This
 * role's whole job is disposal — a schedule that runs out, an erasure that
 * leaves no residue, an account that closes. A store this package wrote to
 * git would be a store it could never empty, so there is no such store: the
 * held record lives behind `HoldingStore` and `DisclosureDirectory` below,
 * both host-implemented, and no implementation of either ships here. The
 * fixtures in this package's own tests are synthetic ids in temp
 * directories, never a real holding.
 *
 * Validation here is hand-rolled over `unknown`, with no schema library,
 * matching every other package in this workspace. These validators exist for
 * the boundary where records arrive as untyped JSON — a file the CLI reads,
 * a value read back out of a host's own store — before anything downstream
 * is allowed to trust them.
 */

import {
  isOneOf,
  isPlainObject,
  pushIssue,
  requireArrayOf,
  requireBoolean,
  requireNumber,
  requireString,
  requireTimestamp,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

// ------------------------------------------------------------- source events

/**
 * Something the person did. This is the only thing a holding may trace to.
 *
 * `kind` is a consumer-defined label — this package enumerates no event
 * kinds and inspects no event's meaning. It never carries what happened,
 * only that it did, when, and to whom it belongs.
 */
export interface SourceEvent {
  eventId: string;
  /** The person whose act this was. */
  subjectId: string;
  /** Whoever or whatever recorded it. Separate from `subjectId`, always. */
  actorId: string;
  occurredAt: string;
  /** Consumer-defined label for what they did. This package enumerates none. */
  kind: string;
}

// ---------------------------------------------------------------- provenance

/**
 * Where a held item came from.
 *
 * Three variants, and the third is the point of the type. `"event"` names
 * the source event. `"none"` is a holding that traces to nothing the person
 * did — a real, recordable state, because it is exactly what this package
 * exists to find, and a validator that refused to represent it would turn
 * the central finding into a "could not run". `"indeterminate"` is the store
 * saying it cannot tell, which is neither of the other two and must never
 * round to either: "it came from nowhere" and "we could not find out where
 * it came from" are different answers with different fixes.
 *
 * Both non-event variants REQUIRE a named reason. An absence that cannot say
 * why is the shape this whole package is written against.
 */
export type Provenance =
  | { kind: "event"; sourceEventId: string }
  | { kind: "none"; namedReason: string }
  | { kind: "indeterminate"; namedReason: string };

/** Every provenance kind, for a caller validating untyped input. */
export const PROVENANCE_KINDS = ["event", "none", "indeterminate"] as const;

/** The one provenance kind that is neither a trace nor the absence of one. `cli.ts` maps a set containing it to `2`. */
export const INDETERMINATE_PROVENANCE_KINDS: readonly Provenance["kind"][] = ["indeterminate"];

// -------------------------------------------------------------------- origin

/**
 * How this item came to be held. Four values, and only the fourth is
 * something the person did not themselves put there:
 *
 *   `authored`  — they wrote it.
 *   `saved`     — they kept it.
 *   `observed`  — the accumulated relationship: history, how something went,
 *                 a referral. Recorded by us, ABOUT an act of theirs.
 *   `inferred`  — a belief we formed from their behaviour. Never something
 *                 they said; always something we concluded.
 *
 * The distinction between the first three and the fourth is the reason
 * `InferredBelief` exists as its own type rather than a flag: an inferred
 * belief is the holding a person is least likely to know about and most
 * likely to be wrong about, so it is the one carrying the strictest rules.
 */
export type HoldingOrigin = "authored" | "saved" | "observed" | "inferred";

/** Every origin, for a caller validating untyped input. */
export const HOLDING_ORIGINS: readonly HoldingOrigin[] = ["authored", "saved", "observed", "inferred"];

// ------------------------------------------------------- the boundary rule

/**
 * The person's own confirmation that a belief we formed may constrain what
 * we do. It names the event in which they confirmed it, so a confirmation is
 * itself a thing they did rather than a boolean somebody set.
 */
export interface BeliefConfirmation {
  confirmedAt: string;
  /** The source event in which they confirmed it. Separate from the belief's own source event. */
  sourceEventId: string;
}

/**
 * THE BOUNDARY RULE, AS A TYPE.
 *
 * An instruction constrains us; an understanding only informs us. A belief
 * inferred from behaviour is an understanding, and it may inform anything.
 * The moment it starts CONSTRAINING behaviour it has become an instruction —
 * which is a different role's territory, and one a person is entitled to
 * have been asked about first.
 *
 * So `constrains` carries a `confirmation` field that is REQUIRED and
 * explicitly nullable, never optional. A caller has to write
 * `confirmation: null` on purpose; there is no shape where the confirmation
 * is simply missing and something downstream fills it in. `null` is a real,
 * checkable state — an inference that crossed the line without ever being
 * put to the person — and `checkAttribution` reports it by name
 * (`belief-constrains-without-confirmation`), while `decideHolding` returns
 * `unjustifiable`.
 *
 * There is deliberately no third mode. "Advises", "nudges" and "weights" are
 * all constraints wearing a softer word: either the belief can change what
 * happens to the person or it cannot.
 */
export type BeliefUse =
  | { mode: "informs" }
  | { mode: "constrains"; confirmation: BeliefConfirmation | null };

/** Every belief-use mode, for a caller validating untyped input. */
export const BELIEF_USE_MODES = ["informs", "constrains"] as const;

/**
 * A belief we formed from behaviour, and the reason we hold it.
 *
 * `beliefClass` is a consumer-defined label; this package enumerates no
 * belief classes and never inspects what a belief says. The belief's own
 * reason is not stored here — it is the enclosing item's `provenance`, which
 * names the source event it was inferred FROM. That is deliberate: one
 * provenance field, one answer to "why do you think that about me", and no
 * way for a belief to carry a reason that disagrees with the item's.
 */
export interface InferredBelief {
  /** Consumer-defined class of belief. This package enumerates none. */
  beliefClass: string;
  inferredAt: string;
  use: BeliefUse;
}

// ------------------------------------------------------------- the held item

/**
 * One thing held about one person.
 *
 * Every field is required. `belief` is `null` for every origin but
 * `"inferred"`, written explicitly rather than omitted, for the same reason
 * `provenance` has a `"none"` variant instead of being optional: a field
 * that can be left off is a field something downstream will default, and a
 * defaulted provenance is a holding that justifies itself.
 *
 * `holdingClass` is the consumer's own label, and it is what the disposal
 * gate joins a declared retention rule to. This package declares no classes
 * and no periods — see `RetentionRule`.
 */
export interface HeldItem {
  itemId: string;
  /** The person this is ABOUT. Every join in this package keys on this field. */
  subjectId: string;
  /** Whoever or whatever put it there. Separate from `subjectId`, always. */
  actorId: string;
  heldSince: string;
  /** Consumer-defined class of material. This package declares none. */
  holdingClass: string;
  origin: HoldingOrigin;
  provenance: Provenance;
  /** The belief, when `origin` is `"inferred"`; `null` for every other origin. Written explicitly either way. */
  belief: InferredBelief | null;
}

// -------------------------------------------------------------- disclosure

/**
 * Whether the person can actually reach this item.
 *
 * `"unknown"` is the third value and is not a soft `"hidden"` and certainly
 * not a soft `"visible"`. A consumer that cannot say whether a surface shows
 * a given item has not checked, and this package refuses to decide on its
 * behalf: `checkVisibility` reports it as unverifiable and the CLI exits `2`.
 */
export type DisclosureReach = "visible" | "hidden" | "unknown";

/** Every reach value, for a caller validating untyped input. */
export const DISCLOSURE_REACHES: readonly DisclosureReach[] = ["visible", "hidden", "unknown"];

/**
 * One route by which one person can reach one item.
 *
 * `correctable` is separate from `reach` and is never derived from it. Being
 * shown something you cannot change is not the same as being able to correct
 * it, and the metric this role is measured by names both: an unjustifiable
 * holding is one that traces to nothing they did OR that they have no way to
 * see AND correct.
 *
 * `surface` is a consumer-defined label for where the route is. This package
 * ships no surfaces and renders nothing.
 */
export interface DisclosureRecord {
  itemId: string;
  /** The person this route is FOR. Joined against the item's own subject. */
  subjectId: string;
  /** Consumer-defined label for where it is reachable. This package ships none. */
  surface: string;
  reach: DisclosureReach;
  /** Whether they can change or remove it there, not merely read it. Explicit, never inferred from `reach`. */
  correctable: boolean;
  observedAt: string;
}

// --------------------------------------------------------------- disposal

/**
 * One line of the consumer's own retention schedule: how long a class of
 * material may be held.
 *
 * Declared per class, with NO default and no global period anywhere in this
 * package. A retention period this package invented would be this package
 * authoring one of the consumer's own commitments, and an item whose class
 * the schedule never declared is reported as unverifiable rather than
 * silently kept — see `checkDisposal`.
 */
export interface RetentionRule {
  /** The consumer's own class label, joined against `HeldItem.holdingClass`. */
  holdingClass: string;
  /** Whole days after `heldSince` this class may be held. Consumer-declared. */
  days: number;
}

/**
 * What a deletion actually achieved, as observed.
 *
 * `"failed"` never rolls up into `"erased"`: a delete call that returned is
 * not a record that is gone. `"unknown"` is the third value and is not a soft
 * `"erased"` — an erasure nobody confirmed is an erasure nobody can promise,
 * and `checkDisposal` reports it as unverifiable rather than done.
 */
export type DeletionEffect = "erased" | "failed" | "unknown";

/** Every deletion effect, for a caller validating untyped input. */
export const DELETION_EFFECTS: readonly DeletionEffect[] = ["erased", "failed", "unknown"];

/** One recorded attempt to dispose of one held item. */
export interface DeletionRecord {
  itemId: string;
  /** The person the deleted item was about. */
  subjectId: string;
  /** Whoever or whatever performed it. Separate from `subjectId`, always. */
  actorId: string;
  deletedAt: string;
  effect: DeletionEffect;
}

// -------------------------------------------------------- host-supplied ports

/**
 * Host-implemented store for held items. This package does not choose a
 * database, a bucket, a file or a table — that choice, and its durability
 * AND ERASURE guarantees, belong entirely to the host, and no concrete
 * implementation of this interface ships here.
 *
 * `erase` returns the observed `DeletionEffect` rather than `void` or a
 * boolean. A host that cannot confirm the record is gone must say
 * `"unknown"`, which travels all the way to the disposal gate's exit code —
 * an erasure this package could not verify never reports as done.
 */
export interface HoldingStore {
  read(subjectId: string, itemId: string): Promise<HeldItem | undefined>;
  /** Everything held about one person. This is the read the showing step is built on. */
  readAll(subjectId: string): Promise<readonly HeldItem[]>;
  write(item: HeldItem): Promise<void>;
  erase(subjectId: string, itemId: string): Promise<DeletionEffect>;
}

/**
 * Host-implemented directory of disclosure routes: where, if anywhere, a
 * person can reach and correct what is held about them. This package decides
 * what a route must record; the host decides what its surfaces are and where
 * they live. No implementation ships here.
 */
export interface DisclosureDirectory {
  routesFor(subjectId: string): Promise<readonly DisclosureRecord[]>;
}

/**
 * Host-implemented ledger of source events. Kept separate from
 * `HoldingStore` on purpose: an event log and a holding store have different
 * retention answers — the log of what someone did may legitimately outlive
 * the material it justifies — and a single port would make it easy to erase
 * the evidence along with the record it attributes.
 */
export interface SourceEventLedger {
  eventsFor(subjectId: string): Promise<readonly SourceEvent[]>;
}

// ------------------------------------------------------------------ validators

function result<T>(value: T | undefined, issues: ValidationIssue[]): ValidationResult<T> {
  if (value === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, value };
}

function readProvenance(value: unknown, path: string, issues: ValidationIssue[]): Provenance | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object with a kind of ${PROVENANCE_KINDS.join(", ")}`);
    return undefined;
  }
  const kind = value.kind;
  if (!isOneOf(kind, PROVENANCE_KINDS)) {
    pushIssue(issues, `${path}.kind`, `must be one of ${PROVENANCE_KINDS.join(", ")}`);
    return undefined;
  }
  const before = issues.length;
  if (kind === "event") {
    const sourceEventId = requireString(value.sourceEventId, `${path}.sourceEventId`, issues, { minLength: 1 });
    if (issues.length > before || sourceEventId === undefined) return undefined;
    return { kind, sourceEventId };
  }
  const namedReason = requireString(value.namedReason, `${path}.namedReason`, issues, { minLength: 1 });
  if (issues.length > before || namedReason === undefined) return undefined;
  return { kind, namedReason };
}

function readBeliefConfirmation(value: unknown, path: string, issues: ValidationIssue[]): BeliefConfirmation | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with confirmedAt and sourceEventId, or null");
    return undefined;
  }
  const before = issues.length;
  const confirmedAt = requireTimestamp(value.confirmedAt, `${path}.confirmedAt`, issues);
  const sourceEventId = requireString(value.sourceEventId, `${path}.sourceEventId`, issues, { minLength: 1 });
  if (issues.length > before || confirmedAt === undefined || sourceEventId === undefined) return undefined;
  return { confirmedAt, sourceEventId };
}

function readBeliefUse(value: unknown, path: string, issues: ValidationIssue[]): BeliefUse | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `must be an object with a mode of ${BELIEF_USE_MODES.join(", ")}`);
    return undefined;
  }
  const mode = value.mode;
  if (!isOneOf(mode, BELIEF_USE_MODES)) {
    pushIssue(issues, `${path}.mode`, `must be one of ${BELIEF_USE_MODES.join(", ")}`);
    return undefined;
  }
  if (mode === "informs") return { mode };

  // The confirmation KEY is required even when its value is null. An absent
  // key is not "no confirmation" — it is a caller who never considered the
  // question, and this package refuses to answer it for them.
  if (!("confirmation" in value)) {
    pushIssue(issues, `${path}.confirmation`, "is required on a belief that constrains; write null explicitly if the person was never asked");
    return undefined;
  }
  if (value.confirmation === null) return { mode, confirmation: null };
  const before = issues.length;
  const confirmation = readBeliefConfirmation(value.confirmation, `${path}.confirmation`, issues);
  if (issues.length > before || confirmation === undefined) return undefined;
  return { mode, confirmation };
}

function readInferredBelief(value: unknown, path: string, issues: ValidationIssue[]): InferredBelief | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with beliefClass, inferredAt and use");
    return undefined;
  }
  const before = issues.length;
  const beliefClass = requireString(value.beliefClass, `${path}.beliefClass`, issues, { minLength: 1 });
  const inferredAt = requireTimestamp(value.inferredAt, `${path}.inferredAt`, issues);
  const use = readBeliefUse(value.use, `${path}.use`, issues);
  if (issues.length > before || beliefClass === undefined || inferredAt === undefined || use === undefined) return undefined;
  return { beliefClass, inferredAt, use };
}

function readHeldItem(value: unknown, path: string, issues: ValidationIssue[]): HeldItem | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const itemId = requireString(value.itemId, `${path}.itemId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const heldSince = requireTimestamp(value.heldSince, `${path}.heldSince`, issues);
  const holdingClass = requireString(value.holdingClass, `${path}.holdingClass`, issues, { minLength: 1 });
  if (!isOneOf(value.origin, HOLDING_ORIGINS)) {
    pushIssue(issues, `${path}.origin`, `must be one of ${HOLDING_ORIGINS.join(", ")}`);
  }
  const provenance = readProvenance(value.provenance, `${path}.provenance`, issues);

  // The belief key is required, and its presence must agree with the origin.
  // A belief hanging off a `saved` item, or an `inferred` item with no
  // belief, is a record this package cannot trust — not a finding, because a
  // finding would imply it was understood well enough to judge.
  if (!("belief" in value)) {
    pushIssue(issues, `${path}.belief`, "is required; write null explicitly for any origin other than inferred");
  }
  let belief: InferredBelief | null = null;
  if (value.origin === "inferred") {
    if (value.belief === null || value.belief === undefined) {
      pushIssue(issues, `${path}.belief`, "is required on an item whose origin is inferred");
    } else {
      const read = readInferredBelief(value.belief, `${path}.belief`, issues);
      if (read !== undefined) belief = read;
    }
  } else if ("belief" in value && value.belief !== null) {
    pushIssue(issues, `${path}.belief`, "must be null on an item whose origin is not inferred");
  }

  if (issues.length > before) return undefined;
  if (itemId === undefined || subjectId === undefined || actorId === undefined || heldSince === undefined || holdingClass === undefined || provenance === undefined) {
    return undefined;
  }
  return { itemId, subjectId, actorId, heldSince, holdingClass, origin: value.origin as HoldingOrigin, provenance, belief };
}

function readSourceEvent(value: unknown, path: string, issues: ValidationIssue[]): SourceEvent | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const eventId = requireString(value.eventId, `${path}.eventId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const occurredAt = requireTimestamp(value.occurredAt, `${path}.occurredAt`, issues);
  const kind = requireString(value.kind, `${path}.kind`, issues, { minLength: 1 });
  if (issues.length > before) return undefined;
  if (eventId === undefined || subjectId === undefined || actorId === undefined || occurredAt === undefined || kind === undefined) return undefined;
  return { eventId, subjectId, actorId, occurredAt, kind };
}

function readDisclosureRecord(value: unknown, path: string, issues: ValidationIssue[]): DisclosureRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const itemId = requireString(value.itemId, `${path}.itemId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const surface = requireString(value.surface, `${path}.surface`, issues, { minLength: 1 });
  const correctable = requireBoolean(value.correctable, `${path}.correctable`, issues);
  const observedAt = requireTimestamp(value.observedAt, `${path}.observedAt`, issues);
  if (!isOneOf(value.reach, DISCLOSURE_REACHES)) {
    pushIssue(issues, `${path}.reach`, `must be one of ${DISCLOSURE_REACHES.join(", ")}`);
  }
  if (issues.length > before) return undefined;
  if (itemId === undefined || subjectId === undefined || surface === undefined || correctable === undefined || observedAt === undefined) return undefined;
  return { itemId, subjectId, surface, reach: value.reach as DisclosureReach, correctable, observedAt };
}

function readRetentionRule(value: unknown, path: string, issues: ValidationIssue[]): RetentionRule | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object with holdingClass and days");
    return undefined;
  }
  const before = issues.length;
  const holdingClass = requireString(value.holdingClass, `${path}.holdingClass`, issues, { minLength: 1 });
  const days = requireNumber(value.days, `${path}.days`, issues, { min: 0, integer: true });
  if (issues.length > before || holdingClass === undefined || days === undefined) return undefined;
  return { holdingClass, days };
}

function readDeletionRecord(value: unknown, path: string, issues: ValidationIssue[]): DeletionRecord | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const itemId = requireString(value.itemId, `${path}.itemId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const deletedAt = requireTimestamp(value.deletedAt, `${path}.deletedAt`, issues);
  if (!isOneOf(value.effect, DELETION_EFFECTS)) {
    pushIssue(issues, `${path}.effect`, `must be one of ${DELETION_EFFECTS.join(", ")}`);
  }
  if (issues.length > before) return undefined;
  if (itemId === undefined || subjectId === undefined || actorId === undefined || deletedAt === undefined) return undefined;
  return { itemId, subjectId, actorId, deletedAt, effect: value.effect as DeletionEffect };
}

/** Validates one untyped `HeldItem`. Never throws. */
export function validateHeldItem(value: unknown): ValidationResult<HeldItem> {
  const issues: ValidationIssue[] = [];
  return result(readHeldItem(value, "(root)", issues), issues);
}

/** Validates an untyped array of `HeldItem`s. Never throws. */
export function validateHeldItems(value: unknown): ValidationResult<HeldItem[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readHeldItem), issues);
}

/** Validates one untyped `SourceEvent`. Never throws. */
export function validateSourceEvent(value: unknown): ValidationResult<SourceEvent> {
  const issues: ValidationIssue[] = [];
  return result(readSourceEvent(value, "(root)", issues), issues);
}

/** Validates an untyped array of `SourceEvent`s. Never throws. */
export function validateSourceEvents(value: unknown): ValidationResult<SourceEvent[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readSourceEvent), issues);
}

/** Validates an untyped array of `DisclosureRecord`s. Never throws. */
export function validateDisclosureRecords(value: unknown): ValidationResult<DisclosureRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readDisclosureRecord), issues);
}

/** Validates an untyped array of `RetentionRule`s — the consumer's own declared schedule. Never throws. */
export function validateRetentionRules(value: unknown): ValidationResult<RetentionRule[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readRetentionRule), issues);
}

/** Validates an untyped array of `DeletionRecord`s. Never throws. */
export function validateDeletionRecords(value: unknown): ValidationResult<DeletionRecord[]> {
  const issues: ValidationIssue[] = [];
  return result(requireArrayOf(value, "(root)", issues, readDeletionRecord), issues);
}

/** Convenience guard over `validateHeldItem`, for callers that only need the boolean answer at a type boundary. */
export function isHeldItem(value: unknown): value is HeldItem {
  return validateHeldItem(value).ok;
}

/** Convenience guard over `validateSourceEvent`. */
export function isSourceEvent(value: unknown): value is SourceEvent {
  return validateSourceEvent(value).ok;
}
