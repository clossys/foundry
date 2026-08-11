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

/** Input from which a repository creates its locally owned membership data. */
export interface ExternalMembershipCreateInput<TEvent extends object = Record<never, never>> {
  readonly identity: ExternalMembershipIdentity;
  readonly role: string;
  readonly event: ExternalMembershipEvent<TEvent>;
}

/**
 * Persistence seam for external membership reconciliation. Implementations
 * must make `claimEvent` atomic within the supplied transaction and preserve
 * all fields of a record passed to `replace` except where their own storage
 * representation requires an equivalent encoding.
 */
export interface ExternalMembershipRepository<
  TMembership extends ExternalMembership = ExternalMembership,
  TEvent extends object = Record<never, never>,
> {
  claimEvent(query: QueryAdapter, eventId: string): Promise<boolean>;
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

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function normalizeOccurredAt(value: Date | string): Date {
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
    return event.version <= cursor.version;
  }
  return normalizeOccurredAt(event.occurredAt).getTime() <= cursor.occurredAt.getTime();
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
    const claimed = await command.repository.claimEvent(query, event.eventId);
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
      await command.repository.setCursor(query, identity, nextCursor(event));
      return { status: "unchanged" };
    }

    const replacement = { ...existing, role: event.role } as TMembership;
    await command.repository.replace(query, replacement);
    await command.repository.setCursor(query, identity, nextCursor(event));
    return { status: "updated", membership: replacement };
  });
}
