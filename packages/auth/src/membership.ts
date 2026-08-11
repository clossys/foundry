import { requireTransactionalQueryAdapter } from "./query.js";
import type { QueryAdapter } from "./query.js";

/** The immutable provider-owned identity of one membership. */
export interface ExternalMembershipIdentity {
  readonly provider: string;
  readonly providerMembershipId: string;
}

/**
 * A locally stored external membership. `TLocal` permits callers to retain
 * their own fields without making them part of this provider-neutral contract.
 */
export type ExternalMembership<TLocal extends object = Record<never, never>> = TLocal & ExternalMembershipIdentity & {
  readonly membershipId: string;
  readonly role: string;
  readonly createdAt: Date | string;
  readonly invitedAt?: Date | string | null;
  readonly acceptedAt?: Date | string | null;
  readonly grants?: readonly string[];
};

interface ExternalMembershipEventBase extends ExternalMembershipIdentity {
  readonly eventId: string;
  readonly occurredAt: Date | string;
  readonly version?: number;
}

/**
 * A provider event normalized by an adapter before it reaches the core.
 * `TEvent` may carry provider-specific context needed when a repository
 * creates a local membership.
 */
export type ExternalMembershipEvent<TEvent extends object = Record<never, never>> = TEvent & (
  | (ExternalMembershipEventBase & { readonly type: "created"; readonly role: string })
  | (ExternalMembershipEventBase & { readonly type: "updated"; readonly role: string })
  | (ExternalMembershipEventBase & { readonly type: "deleted" })
);

/** The ordering state retained independently from a deletable membership row. */
export interface ExternalMembershipEventCursor {
  readonly occurredAt: Date;
  readonly version?: number;
}

/** Provider-namespaced delivery identity used for retry idempotency. */
export interface ExternalMembershipEventClaim {
  readonly provider: string;
  readonly eventId: string;
}

/** Input from which a repository creates its locally owned membership data. */
export interface ExternalMembershipCreateInput<TEvent extends object = Record<never, never>> {
  readonly identity: ExternalMembershipIdentity;
  readonly role: string;
  readonly event: ExternalMembershipEvent<TEvent>;
}

/**
 * Persistence seam for external membership reconciliation. Implementations
 * must make `claimEvent` atomic within the supplied transaction. They must
 * also acquire a transaction-scoped exclusive lock for an external identity,
 * including identities with no membership row yet, before returning from
 * `lockExternalIdentity`. Records passed to `replace` retain all caller-owned
 * fields except where storage requires an equivalent encoding.
 */
export interface ExternalMembershipRepository<
  TMembership extends ExternalMembership = ExternalMembership,
  TEvent extends object = Record<never, never>,
> {
  lockExternalIdentity(query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<void>;
  claimEvent(query: QueryAdapter, claim: ExternalMembershipEventClaim): Promise<boolean>;
  findByExternalIdentity(query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<TMembership | undefined>;
  create(query: QueryAdapter, input: ExternalMembershipCreateInput<TEvent>): Promise<TMembership>;
  replace(query: QueryAdapter, membership: TMembership): Promise<void>;
  delete(query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<void>;
  getCursor(query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<ExternalMembershipEventCursor | undefined>;
  setCursor(query: QueryAdapter, identity: ExternalMembershipIdentity, cursor: ExternalMembershipEventCursor): Promise<void>;
}

/** All dependencies and input for one atomic reconciliation. */
export interface ReconcileExternalMembershipCommand<
  TMembership extends ExternalMembership = ExternalMembership,
  TEvent extends object = Record<never, never>,
> {
  readonly queryAdapter: QueryAdapter;
  readonly repository: ExternalMembershipRepository<TMembership, TEvent>;
  readonly event: ExternalMembershipEvent<TEvent>;
}

/** The observable result of one external membership reconciliation. */
export interface ExternalMembershipReconciliationResult<TMembership extends ExternalMembership = ExternalMembership> {
  readonly status: "created" | "updated" | "deleted" | "duplicate" | "stale" | "unchanged";
  readonly membership?: TMembership;
}

const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function normalizeOccurredAt(value: Date | string): Date {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new TypeError("External membership event occurredAt must be a Date or strict ISO instant string.");
  }
  if (typeof value === "string") {
    const match = ISO_INSTANT_PATTERN.exec(value);
    if (match === null || !isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      throw new TypeError("External membership event occurredAt must be a strict ISO instant with a timezone.");
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("External membership event occurredAt must be a valid date.");
  return date;
}

function requireEvent<TEvent extends object>(event: ExternalMembershipEvent<TEvent>): ExternalMembershipEvent<TEvent> {
  if (typeof event !== "object" || event === null) throw new TypeError("External membership event must be an object.");
  requireNonEmptyString(event.eventId, "External membership event eventId");
  requireNonEmptyString(event.provider, "External membership event provider");
  requireNonEmptyString(event.providerMembershipId, "External membership event providerMembershipId");
  if (event.type !== "created" && event.type !== "updated" && event.type !== "deleted") {
    throw new TypeError("External membership event type must be created, updated, or deleted.");
  }
  if ((event.type === "created" || event.type === "updated") && (typeof event.role !== "string" || event.role.trim().length === 0)) {
    throw new TypeError("Created and updated external membership events require a non-empty role.");
  }
  if (event.version !== undefined && (!Number.isSafeInteger(event.version) || event.version < 0)) {
    throw new TypeError("External membership event version must be a non-negative safe integer when present.");
  }
  normalizeOccurredAt(event.occurredAt);
  return event;
}

function eventIdentity(event: ExternalMembershipEvent): ExternalMembershipIdentity {
  return { provider: event.provider, providerMembershipId: event.providerMembershipId };
}

function sameIdentity(left: ExternalMembershipIdentity, right: ExternalMembershipIdentity): boolean {
  return left.provider === right.provider && left.providerMembershipId === right.providerMembershipId;
}

function normalizeCursor(cursor: ExternalMembershipEventCursor): ExternalMembershipEventCursor {
  const occurredAt = normalizeOccurredAt(cursor.occurredAt);
  if (cursor.version !== undefined && (!Number.isSafeInteger(cursor.version) || cursor.version < 0)) {
    throw new TypeError("External membership repository returned an invalid event cursor version.");
  }
  return { occurredAt, ...(cursor.version === undefined ? {} : { version: cursor.version }) };
}

function eventIsStale(event: ExternalMembershipEvent, cursor: ExternalMembershipEventCursor): boolean {
  if (event.version !== undefined && cursor.version !== undefined) {
    if (event.version !== cursor.version) return event.version < cursor.version;
    // A distinct event already passed the idempotency claim. If provider
    // versions tie, prefer revocation rather than retaining ambiguous access.
    return event.type !== "deleted";
  }
  const eventTime = normalizeOccurredAt(event.occurredAt).getTime();
  const cursorTime = cursor.occurredAt.getTime();
  if (eventTime !== cursorTime) return eventTime < cursorTime;
  // Providers can emit distinct unversioned events at the same timestamp.
  // Prefer revocation in that ambiguity; other tied events remain stale.
  return event.type !== "deleted";
}

function nextCursor(event: ExternalMembershipEvent): ExternalMembershipEventCursor {
  return {
    occurredAt: normalizeOccurredAt(event.occurredAt),
    ...(event.version === undefined ? {} : { version: event.version }),
  };
}

function assertRepositoryIdentity(membership: ExternalMembership, identity: ExternalMembershipIdentity): void {
  if (!sameIdentity(membership, identity)) {
    throw new TypeError("External membership repository returned a membership with a different provider identity.");
  }
}

/**
 * Atomically applies a normalized provider event. Only an `updated` event
 * replaces role data. The membership record is copied before replacement so
 * its local id, creation time, invitations, acceptance state, grants, and
 * caller-defined fields are retained.
 */
export async function reconcileExternalMembership<
  TMembership extends ExternalMembership = ExternalMembership,
  TEvent extends object = Record<never, never>,
>(
  command: ReconcileExternalMembershipCommand<TMembership, TEvent>,
): Promise<ExternalMembershipReconciliationResult<TMembership>> {
  if (!command || typeof command !== "object") throw new TypeError("External membership reconciliation command must be an object.");
  if (!command.repository || typeof command.repository !== "object") throw new TypeError("External membership reconciliation requires a repository.");
  const event = requireEvent(command.event);
  const transactionAdapter = requireTransactionalQueryAdapter(command.queryAdapter);
  const identity = eventIdentity(event);

  return transactionAdapter.transaction(async (query) => {
    await command.repository.lockExternalIdentity(query, identity);
    const claimed = await command.repository.claimEvent(query, {
      provider: event.provider,
      eventId: event.eventId,
    });
    if (!claimed) return { status: "duplicate" };

    const storedCursor = await command.repository.getCursor(query, identity);
    const cursor = storedCursor === undefined ? undefined : normalizeCursor(storedCursor);
    if (cursor !== undefined && eventIsStale(event, cursor)) return { status: "stale" };

    const existing = await command.repository.findByExternalIdentity(query, identity);
    if (existing !== undefined) assertRepositoryIdentity(existing, identity);

    if (event.type === "deleted") {
      await command.repository.delete(query, identity);
      await command.repository.setCursor(query, identity, nextCursor(event));
      return { status: "deleted" };
    }

    if (event.type === "created") {
      if (existing === undefined) {
        const membership = await command.repository.create(query, { identity, role: event.role, event });
        assertRepositoryIdentity(membership, identity);
        await command.repository.setCursor(query, identity, nextCursor(event));
        return { status: "created", membership };
      }
      await command.repository.setCursor(query, identity, nextCursor(event));
      return { status: "unchanged", membership: existing };
    }

    if (existing === undefined) {
      const membership = await command.repository.create(query, { identity, role: event.role, event });
      assertRepositoryIdentity(membership, identity);
      await command.repository.setCursor(query, identity, nextCursor(event));
      return { status: "created", membership };
    }

    const replacement = { ...existing, role: event.role } as TMembership;
    await command.repository.replace(query, replacement);
    await command.repository.setCursor(query, identity, nextCursor(event));
    return { status: "updated", membership: replacement };
  });
}
