/**
 * The record families this package reconciles, and hand-rolled validators for
 * every one of them.
 *
 * WHY HAND-ROLLED
 * ----------------
 * This package declares no `dependencies` at all — only optional peers a
 * consumer opts into by importing the subpath that needs them (see
 * `public-contract.test.ts`, which asserts exactly that). A schema library
 * would be a hard runtime dependency for every consumer of the provider-
 * neutral root, which is the one thing the root is for.
 *
 * WHAT IS AND IS NOT DECLARED HERE
 * ---------------------------------
 * Nothing below is a value. There is no role vocabulary, no tier, no
 * entitlement catalogue, no spend ceiling, no currency, no provider list and
 * no policy. `authority` is an opaque consumer-authored string; so is
 * `providerId`; so is every event name and every field path. This package
 * ships the shape of the question and the checkers that ask it — every
 * consumer authors the answers. A vocabulary shipped from here would be this
 * workspace quietly deciding what "admin" means inside somebody else's
 * product.
 *
 * ACTOR AND SUBJECT ARE NEVER THE SAME FIELD
 * -------------------------------------------
 * Every record that involves both carries `actorId` and `subjectId`
 * separately, in that order, and no function in this package derives either
 * from the other. An operator acting on their own account and an operator
 * acting on somebody else's are different events with different consequences,
 * and one conflated identifier makes them indistinguishable forever — after
 * the fact, in the only record anyone will still have.
 *
 * NO PERSON-ATTRIBUTABLE RECORD IS WRITTEN BY THIS PACKAGE
 * ---------------------------------------------------------
 * These types describe files a CONSUMER produces and hands to the gate. This
 * package reads them, compares them, and prints findings. It writes nothing,
 * stores nothing, and commits nothing; storage is a host-supplied port
 * (`QueryAdapter`, and the repository interfaces in `membership.ts`).
 */

import type { GenericAgentContext } from "./agent/types.js";
import {
  isPlainObject,
  isOneOf,
  optionalString,
  optionalTimestamp,
  pushIssue,
  requireArrayOf,
  requireBoolean,
  requireNumberOrNull,
  requireString,
  requireStringArray,
  requireTimestamp,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

// --------------------------------------------------------------- grant records

/**
 * One authority that is LIVE in the consumer's own system: something their
 * code will act on if asked to right now.
 *
 * `sessionId` is deliberately optional and deliberately never load-bearing.
 * A session is evidence that somebody authenticated at some point. It is not
 * evidence that the authority behind it still exists, and this package's
 * central claim is that treating the first as the second is the defect.
 */
export interface Grant {
  grantId: string;
  /** Who is acting. Never merged with `subjectId`. */
  actorId: string;
  /** Whose account, data or behalf the actor is acting on. Never merged with `actorId`. */
  subjectId: string;
  /** The provider of record expected to still back this authority. Consumer-authored. */
  providerId: string;
  /** What was granted, as the consumer's own opaque string — a role, a scope, an entitlement key. */
  authority: string;
  grantedAt: string;
  /** The consumer's own declared end of this grant, if it has one. */
  expiresAt?: string;
  /** Present only to prove the point that it proves nothing on its own. */
  sessionId?: string;
}

/** Whether a provider of record could be observed at all. */
export const PROVIDER_REACHABILITIES = ["reachable", "unreachable"] as const;
export type ProviderReachability = (typeof PROVIDER_REACHABILITIES)[number];

/** What a provider says about one authority right now. */
export const BACKED_AUTHORITY_STATUSES = ["active", "revoked"] as const;
export type BackedAuthorityStatus = (typeof BACKED_AUTHORITY_STATUSES)[number];

/** One authority a provider of record still (or no longer) stands behind. */
export interface BackedAuthority {
  actorId: string;
  subjectId: string;
  authority: string;
  status: BackedAuthorityStatus;
  /** When the provider last confirmed this — the observation's own timestamp, not the grant's. */
  confirmedAt: string;
}

/**
 * One observation of one provider of record.
 *
 * `reachability` is a first-class field rather than an inference from an
 * empty `backs` array, and that is the single most important shape decision
 * in this file. "The provider says this actor has nothing" and "the provider
 * did not answer" are opposite facts that produce an identical empty list,
 * and a checker that cannot tell them apart will report the second as the
 * first — a clean run against a provider it never reached.
 */
export interface ProviderAssertion {
  providerId: string;
  reachability: ProviderReachability;
  observedAt: string;
  /** Required when `reachability` is `"reachable"`; must be absent otherwise. May be empty — an empty answer from a reachable provider is a real answer. */
  backs?: BackedAuthority[];
  /** Required when `reachability` is `"unreachable"`: why. A decline with no reason is not reportable. */
  unreachableReason?: string;
}

// ---------------------------------------------------------- delegation records

/**
 * A delegated machine actor, as declared by the consumer.
 *
 * Structurally this is the donor's `GenericAgentContext` (`./agent`) — the
 * same record the runtime guards `assertAgentCanCall` and
 * `assertAgentMonetaryAuthority` take. It is validated here rather than there
 * because the runtime guards take a TYPED value from the consumer's own code,
 * while the gate reads an UNTYPED JSON file off disk and has to decide
 * whether it can be trusted at all.
 *
 * `monetaryLimitAmount` has three distinguishable states and the distinction
 * is the point: a number is a declared ceiling, `null` is an operator
 * explicitly saying this actor has no monetary surface, and ABSENT is nobody
 * having decided. `checkDelegationCeiling` treats the third as a finding and
 * — see its own doc comment — treats the second as one too unless the
 * consumer declares that a null ceiling is deliberate.
 */
export type DelegatedActor = Pick<
  GenericAgentContext,
  "agentIdentityId" | "agentKind" | "displayName" | "validFrom" | "validTo" | "revokedAt"
> & {
  /**
   * `toolScope` and `responsibleHumanId` are REQUIRED by the donor's runtime
   * context type and OPTIONAL here, and the difference is deliberate. At
   * runtime a context without either is unusable and the guard refuses it. In
   * a file handed to the gate, an actor declared without either is exactly
   * the record the gate exists to report — and rejecting it at the schema
   * boundary would turn a nameable finding ("this actor answers to nobody")
   * into an anonymous parse error, at which point the gate can only say the
   * file was malformed and not what was wrong with it.
   */
  toolScope?: string[];
  responsibleHumanId?: string;
  /**
   * A number is a declared ceiling. `null` is an operator saying this actor
   * has no monetary surface. ABSENT — the property missing altogether — is
   * nobody having decided, and is the state the gate exists for. The donor's
   * own `GenericAgentContext` types this `number | null`, with no third
   * state, because at runtime there is nothing useful to do with "undecided"
   * except refuse; a gate reading a file off disk has somewhere better to put
   * that answer, so this widens the field rather than narrowing the fact.
   */
  monetaryLimitAmount?: number | null;
  monetaryLimitCurrency?: string | null;
  /** The subject the actor acts on behalf of. Separate from `responsibleHumanId`, which is who answers FOR the actor. */
  subjectId?: string;
  /** An explicit, consumer-authored statement that a `null` ceiling is deliberate for this actor. Absent is not a statement. */
  unlimitedSpendIsDeclared?: boolean;
};

// ------------------------------------------------------ provider-shape records

/** One field an adapter reads out of a provider payload. */
export interface MappedField {
  /** A dotted path into the provider's payload, e.g. `"data.public_user_data.user_id"`. Opaque to this package. */
  path: string;
  /** Whether the adapter's mapping fails without this field, as opposed to degrading. */
  required: boolean;
}

/** The mapping one provider adapter actually performs, as its author declares it. */
export interface AdapterMapping {
  adapterId: string;
  providerId: string;
  /** Event names this adapter recognises and maps. Everything else it deliberately ignores. */
  recognisedEvents: string[];
  readsFields: MappedField[];
}

/** Whether a provider guarantees a field on every payload, or only sometimes. */
export const FIELD_PRESENCES = ["always", "sometimes"] as const;
export type FieldPresence = (typeof FIELD_PRESENCES)[number];

/** One field the provider declares it emits. */
export interface DeclaredField {
  path: string;
  presence: FieldPresence;
}

/**
 * The provider's own declared shape, as the consumer transcribed it from the
 * provider's documentation or schema endpoint.
 *
 * This package never fetches it. A gate that went and read the provider's
 * live schema itself would need network access, credentials, and a per-
 * provider client — and would then be unable to run in the offline, hermetic
 * position where a gate belongs. Transcription is the consumer's job; keeping
 * the transcription honest against the adapter is this gate's.
 */
export interface ProviderShape {
  providerId: string;
  declaredAt: string;
  emittedEvents: string[];
  fields: DeclaredField[];
}

// ------------------------------------------------------------------- readers

function readGrant(value: unknown, path: string, issues: ValidationIssue[]): Grant | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const grantId = requireString(value.grantId, `${path}.grantId`, issues, { minLength: 1 });
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const providerId = requireString(value.providerId, `${path}.providerId`, issues, { minLength: 1 });
  const authority = requireString(value.authority, `${path}.authority`, issues, { minLength: 1 });
  const grantedAt = requireTimestamp(value.grantedAt, `${path}.grantedAt`, issues);
  const expiresAt = optionalTimestamp(value.expiresAt, `${path}.expiresAt`, issues);
  const sessionId = optionalString(value.sessionId, `${path}.sessionId`, issues, { minLength: 1 });
  if (issues.length !== before) return undefined;
  return {
    grantId: grantId as string,
    actorId: actorId as string,
    subjectId: subjectId as string,
    providerId: providerId as string,
    authority: authority as string,
    grantedAt: grantedAt as string,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function readBackedAuthority(value: unknown, path: string, issues: ValidationIssue[]): BackedAuthority | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const actorId = requireString(value.actorId, `${path}.actorId`, issues, { minLength: 1 });
  const subjectId = requireString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });
  const authority = requireString(value.authority, `${path}.authority`, issues, { minLength: 1 });
  if (!isOneOf(value.status, BACKED_AUTHORITY_STATUSES)) {
    pushIssue(issues, `${path}.status`, `must be one of ${BACKED_AUTHORITY_STATUSES.join(", ")}`);
  }
  const confirmedAt = requireTimestamp(value.confirmedAt, `${path}.confirmedAt`, issues);
  if (issues.length !== before) return undefined;
  return {
    actorId: actorId as string,
    subjectId: subjectId as string,
    authority: authority as string,
    status: value.status as BackedAuthorityStatus,
    confirmedAt: confirmedAt as string,
  };
}

function readProviderAssertion(value: unknown, path: string, issues: ValidationIssue[]): ProviderAssertion | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const providerId = requireString(value.providerId, `${path}.providerId`, issues, { minLength: 1 });
  if (!isOneOf(value.reachability, PROVIDER_REACHABILITIES)) {
    pushIssue(issues, `${path}.reachability`, `must be one of ${PROVIDER_REACHABILITIES.join(", ")}`);
  }
  const observedAt = requireTimestamp(value.observedAt, `${path}.observedAt`, issues);

  // The two halves are mutually exclusive, and BOTH directions are enforced.
  // A "reachable" assertion with no `backs` array would otherwise be
  // indistinguishable from a provider that answered "nothing"; an
  // "unreachable" one carrying a `backs` array is a record whose own two
  // halves disagree, and this package refuses to pick which half to believe.
  let backs: BackedAuthority[] | undefined;
  let unreachableReason: string | undefined;
  if (value.reachability === "reachable") {
    backs = requireArrayOf(value.backs, `${path}.backs`, issues, readBackedAuthority);
    if (value.unreachableReason !== undefined) {
      pushIssue(issues, `${path}.unreachableReason`, "must be absent when reachability is \"reachable\"");
    }
  } else if (value.reachability === "unreachable") {
    unreachableReason = requireString(value.unreachableReason, `${path}.unreachableReason`, issues, { minLength: 1 });
    if (value.backs !== undefined) {
      pushIssue(issues, `${path}.backs`, "must be absent when reachability is \"unreachable\" — a provider that did not answer has not listed anything");
    }
  }

  if (issues.length !== before) return undefined;
  return {
    providerId: providerId as string,
    reachability: value.reachability as ProviderReachability,
    observedAt: observedAt as string,
    ...(backs === undefined ? {} : { backs }),
    ...(unreachableReason === undefined ? {} : { unreachableReason }),
  };
}

function readDelegatedActor(value: unknown, path: string, issues: ValidationIssue[]): DelegatedActor | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const agentIdentityId = requireString(value.agentIdentityId, `${path}.agentIdentityId`, issues, { minLength: 1 });
  const agentKind = requireString(value.agentKind, `${path}.agentKind`, issues, { minLength: 1 });
  const displayName = requireString(value.displayName, `${path}.displayName`, issues, { minLength: 1 });
  // Under-declared, not malformed: see `DelegatedActor`'s own comment. An
  // absent `toolScope` or `responsibleHumanId` validates cleanly here and is
  // reported by the gate, with a reason, rather than dying as a parse error
  // that can only say the file was bad.
  const toolScope = value.toolScope === undefined ? undefined : requireStringArray(value.toolScope, `${path}.toolScope`, issues);
  const responsibleHumanId = optionalString(value.responsibleHumanId, `${path}.responsibleHumanId`, issues, { minLength: 1 });
  const subjectId = optionalString(value.subjectId, `${path}.subjectId`, issues, { minLength: 1 });

  // ABSENT and `null` are kept apart on purpose. `requireNumberOrNull` records
  // an issue for a value it cannot read but returns `undefined` for an absent
  // field WITHOUT one, so an actor nobody has decided a ceiling for validates
  // cleanly here and is caught by the gate — where it is a finding with a
  // reason, rather than a schema error with a line number.
  const monetaryLimitAmount =
    value.monetaryLimitAmount === undefined
      ? undefined
      : requireNumberOrNull(value.monetaryLimitAmount, `${path}.monetaryLimitAmount`, issues, { min: 0 });
  const monetaryLimitCurrency =
    value.monetaryLimitCurrency === undefined || value.monetaryLimitCurrency === null
      ? (value.monetaryLimitCurrency as null | undefined)
      : requireString(value.monetaryLimitCurrency, `${path}.monetaryLimitCurrency`, issues, { minLength: 1 });
  const hasCeilingField = Object.hasOwn(value, "monetaryLimitAmount");
  const hasCurrencyField = Object.hasOwn(value, "monetaryLimitCurrency");

  const validFrom = value.validFrom === null ? null : optionalTimestamp(value.validFrom, `${path}.validFrom`, issues);
  const validTo = value.validTo === null ? null : optionalTimestamp(value.validTo, `${path}.validTo`, issues);
  const revokedAt = value.revokedAt === null ? null : optionalTimestamp(value.revokedAt, `${path}.revokedAt`, issues);
  const unlimitedSpendIsDeclared =
    value.unlimitedSpendIsDeclared === undefined
      ? undefined
      : requireBoolean(value.unlimitedSpendIsDeclared, `${path}.unlimitedSpendIsDeclared`, issues);

  if (issues.length !== before) return undefined;
  // The ceiling fields are spread conditionally rather than assigned, so an
  // ABSENT ceiling stays absent through validation instead of arriving at the
  // gate as an indistinguishable `null`. That distinction is the entire
  // subject of `checkDelegationCeiling`, and collapsing it here would delete
  // the finding before the checker ever saw it.
  return {
    agentIdentityId: agentIdentityId as string,
    agentKind: agentKind as string,
    displayName: displayName as string,
    ...(toolScope === undefined ? {} : { toolScope }),
    ...(responsibleHumanId === undefined ? {} : { responsibleHumanId }),
    validFrom: validFrom ?? null,
    validTo: validTo ?? null,
    revokedAt: revokedAt ?? null,
    ...(hasCeilingField ? { monetaryLimitAmount: monetaryLimitAmount as number | null } : {}),
    ...(hasCurrencyField ? { monetaryLimitCurrency: (monetaryLimitCurrency ?? null) as string | null } : {}),
    ...(subjectId === undefined ? {} : { subjectId }),
    ...(unlimitedSpendIsDeclared === undefined ? {} : { unlimitedSpendIsDeclared }),
  };
}

function readMappedField(value: unknown, path: string, issues: ValidationIssue[]): MappedField | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const fieldPath = requireString(value.path, `${path}.path`, issues, { minLength: 1 });
  const required = requireBoolean(value.required, `${path}.required`, issues);
  if (issues.length !== before) return undefined;
  return { path: fieldPath as string, required: required as boolean };
}

function readAdapterMapping(value: unknown, path: string, issues: ValidationIssue[]): AdapterMapping | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const adapterId = requireString(value.adapterId, `${path}.adapterId`, issues, { minLength: 1 });
  const providerId = requireString(value.providerId, `${path}.providerId`, issues, { minLength: 1 });
  const recognisedEvents = requireStringArray(value.recognisedEvents, `${path}.recognisedEvents`, issues);
  const readsFields = requireArrayOf(value.readsFields, `${path}.readsFields`, issues, readMappedField);
  if (issues.length !== before) return undefined;
  return {
    adapterId: adapterId as string,
    providerId: providerId as string,
    recognisedEvents: recognisedEvents as string[],
    readsFields: readsFields as MappedField[],
  };
}

function readDeclaredField(value: unknown, path: string, issues: ValidationIssue[]): DeclaredField | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const fieldPath = requireString(value.path, `${path}.path`, issues, { minLength: 1 });
  if (!isOneOf(value.presence, FIELD_PRESENCES)) {
    pushIssue(issues, `${path}.presence`, `must be one of ${FIELD_PRESENCES.join(", ")}`);
  }
  if (issues.length !== before) return undefined;
  return { path: fieldPath as string, presence: value.presence as FieldPresence };
}

function readProviderShape(value: unknown, path: string, issues: ValidationIssue[]): ProviderShape | undefined {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, "must be an object");
    return undefined;
  }
  const before = issues.length;
  const providerId = requireString(value.providerId, `${path}.providerId`, issues, { minLength: 1 });
  const declaredAt = requireTimestamp(value.declaredAt, `${path}.declaredAt`, issues);
  const emittedEvents = requireStringArray(value.emittedEvents, `${path}.emittedEvents`, issues);
  const fields = requireArrayOf(value.fields, `${path}.fields`, issues, readDeclaredField);
  if (issues.length !== before) return undefined;
  return {
    providerId: providerId as string,
    declaredAt: declaredAt as string,
    emittedEvents: emittedEvents as string[],
    fields: fields as DeclaredField[],
  };
}

// ---------------------------------------------------------------- validators

function collection<T>(
  label: string,
  reader: (value: unknown, path: string, issues: ValidationIssue[]) => T | undefined,
): (value: unknown) => ValidationResult<T[]> {
  return (value: unknown) => {
    const issues: ValidationIssue[] = [];
    const parsed = requireArrayOf(value, label, issues, reader);
    if (parsed === undefined || issues.length > 0) return { ok: false, issues };
    return { ok: true, value: parsed };
  };
}

export const validateGrants = collection("grants", readGrant);
export const validateProviderAssertions = collection("providerAssertions", readProviderAssertion);
export const validateDelegatedActors = collection("delegatedActors", readDelegatedActor);
export const validateAdapterMappings = collection("adapterMappings", readAdapterMapping);
export const validateProviderShapes = collection("providerShapes", readProviderShape);

function single<T>(
  label: string,
  reader: (value: unknown, path: string, issues: ValidationIssue[]) => T | undefined,
): (value: unknown) => ValidationResult<T> {
  return (value: unknown) => {
    const issues: ValidationIssue[] = [];
    const parsed = reader(value, label, issues);
    if (parsed === undefined || issues.length > 0) return { ok: false, issues };
    return { ok: true, value: parsed };
  };
}

export const validateGrant = single("grant", readGrant);
export const validateProviderAssertion = single("providerAssertion", readProviderAssertion);
export const validateDelegatedActor = single("delegatedActor", readDelegatedActor);
export const validateAdapterMapping = single("adapterMapping", readAdapterMapping);
export const validateProviderShape = single("providerShape", readProviderShape);

// ------------------------------------------------------------- type guards

export function isGrant(value: unknown): value is Grant {
  return validateGrant(value).ok;
}

export function isProviderAssertion(value: unknown): value is ProviderAssertion {
  return validateProviderAssertion(value).ok;
}

export function isDelegatedActor(value: unknown): value is DelegatedActor {
  return validateDelegatedActor(value).ok;
}
