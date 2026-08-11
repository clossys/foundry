import { describe, expect, it, vi } from "vitest";
import {
  createAllowedOriginPolicy,
  defineRoleHierarchy,
  hasRoleAtLeast,
  isAllowedOrigin,
  isAuthorized,
  isQueryAdapter,
  isTransactionalQueryAdapter,
  reconcileExternalMembership,
  requireTransactionalQueryAdapter,
  resolveSafeRedirect,
  resolveViewerRole,
  viewerHasAccess,
} from "./index.js";
import type {
  ExternalMembership,
  ExternalMembershipCreateInput,
  ExternalMembershipEvent,
  ExternalMembershipEventClaim,
  ExternalMembershipEventCursor,
  ExternalMembershipIdentity,
  ExternalMembershipRepository,
  QueryAdapter,
} from "./index.js";

interface LocalFields {
  readonly localNote: string;
}

type StoredMembership = ExternalMembership<LocalFields>;

function key(identity: ExternalMembershipIdentity): string {
  return `${identity.provider}\u0000${identity.providerMembershipId}`;
}

class MemoryRepository implements ExternalMembershipRepository<StoredMembership> {
  readonly events = new Set<string>();
  readonly memberships = new Map<string, StoredMembership>();
  readonly cursors = new Map<string, ExternalMembershipEventCursor>();
  claims = 0;
  creates = 0;
  replacements = 0;
  deletes = 0;
  locks = 0;

  async lockExternalIdentity(_query: QueryAdapter, _identity: ExternalMembershipIdentity): Promise<void> {
    this.locks += 1;
  }

  async claimEvent(_query: QueryAdapter, claim: ExternalMembershipEventClaim): Promise<boolean> {
    this.claims += 1;
    const claimKey = `${claim.provider}\u0000${claim.eventId}`;
    if (this.events.has(claimKey)) return false;
    this.events.add(claimKey);
    return true;
  }

  async findByExternalIdentity(_query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<StoredMembership | undefined> {
    return this.memberships.get(key(identity));
  }

  async create(_query: QueryAdapter, input: ExternalMembershipCreateInput): Promise<StoredMembership> {
    this.creates += 1;
    const membership: StoredMembership = {
      membershipId: `local-${this.creates}`,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      invitedAt: new Date("2026-01-02T00:00:00.000Z"),
      acceptedAt: new Date("2026-01-03T00:00:00.000Z"),
      grants: ["local-grant"],
      localNote: "owned by the caller",
      ...input.identity,
      role: input.role,
    };
    this.memberships.set(key(input.identity), membership);
    return membership;
  }

  async replace(_query: QueryAdapter, membership: StoredMembership): Promise<void> {
    this.replacements += 1;
    this.memberships.set(key(membership), membership);
  }

  async delete(_query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<void> {
    this.deletes += 1;
    this.memberships.delete(key(identity));
  }

  async getCursor(_query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<ExternalMembershipEventCursor | undefined> {
    return this.cursors.get(key(identity));
  }

  async setCursor(_query: QueryAdapter, identity: ExternalMembershipIdentity, cursor: ExternalMembershipEventCursor): Promise<void> {
    this.cursors.set(key(identity), { ...cursor, occurredAt: new Date(cursor.occurredAt) });
  }
}

function transactionalAdapter() {
  const adapter = {
    transactions: 0,
    async query<TResult>(): Promise<TResult> {
      return undefined as TResult;
    },
    async transaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult> {
      this.transactions += 1;
      return work(this);
    },
  };
  return adapter;
}

function withTransactionAdapter() {
  const adapter = {
    transactions: 0,
    async query(_statement: string, _parameters?: readonly unknown[]): Promise<{ rows: never[] }> {
      return { rows: [] };
    },
    async withTransaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult> {
      this.transactions += 1;
      return work(this);
    },
  };
  return adapter;
}

interface TransactionScopedQueryAdapter extends QueryAdapter {
  onTransactionComplete(callback: () => void): void;
}

class LockAwareTransactionalAdapter implements QueryAdapter {
  transactions = 0;

  async query<TResult>(): Promise<TResult> {
    return undefined as TResult;
  }

  async transaction<TResult>(work: (query: QueryAdapter) => Promise<TResult>): Promise<TResult> {
    this.transactions += 1;
    const finalizers: Array<() => void> = [];
    const query: TransactionScopedQueryAdapter = {
      query: this.query.bind(this),
      onTransactionComplete(callback) {
        finalizers.push(callback);
      },
    };
    try {
      return await work(query);
    } finally {
      for (const finalize of finalizers.reverse()) finalize();
    }
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Models the required database behavior of `lockExternalIdentity`: only
 * transactions for the same external identity wait for one another, and the
 * lock is released when the transaction completes.
 */
class SerializingMemoryRepository extends MemoryRepository {
  private readonly lockTails = new Map<string, Promise<void>>();

  override async lockExternalIdentity(query: QueryAdapter, identity: ExternalMembershipIdentity): Promise<void> {
    await super.lockExternalIdentity(query, identity);
    const transaction = query as Partial<TransactionScopedQueryAdapter>;
    if (typeof transaction.onTransactionComplete !== "function") {
      throw new TypeError("The test repository requires transaction completion hooks.");
    }

    const identityKey = key(identity);
    const previous = this.lockTails.get(identityKey) ?? Promise.resolve();
    const release = deferred();
    this.lockTails.set(identityKey, release.promise);
    await previous;

    transaction.onTransactionComplete(() => {
      release.resolve();
      if (this.lockTails.get(identityKey) === release.promise) this.lockTails.delete(identityKey);
    });
  }
}

class PausingUpdateRepository extends SerializingMemoryRepository {
  readonly updateReached = deferred();
  readonly continueUpdate = deferred();

  override async replace(query: QueryAdapter, membership: StoredMembership): Promise<void> {
    this.updateReached.resolve();
    await this.continueUpdate.promise;
    await super.replace(query, membership);
  }
}

function event(
  type: "created" | "updated" | "deleted",
  overrides: Partial<ExternalMembershipEvent> = {},
): ExternalMembershipEvent {
  const base = {
    eventId: "event-1",
    provider: "provider-a",
    providerMembershipId: "membership-a",
    occurredAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
  if (type === "deleted") return { ...base, type };
  return { ...base, type, role: overrides.role ?? "viewer" };
}

describe("query adapter compatibility", () => {
  it("accepts only adapters with both query and transaction support", () => {
    const adapter = transactionalAdapter();
    const poolAdapter = withTransactionAdapter();
    expect(isQueryAdapter(adapter)).toBe(true);
    expect(isTransactionalQueryAdapter(adapter)).toBe(true);
    expect(isQueryAdapter(poolAdapter)).toBe(true);
    expect(isTransactionalQueryAdapter(poolAdapter)).toBe(true);
    expect(requireTransactionalQueryAdapter(poolAdapter).transaction).toBeTypeOf("function");
    expect(isQueryAdapter({ transaction() {} })).toBe(false);
    expect(isTransactionalQueryAdapter({ query() {} })).toBe(false);
    expect(() => requireTransactionalQueryAdapter({ query() {} })).toThrow(/transactional/i);
  });

  it("does not touch a repository without transactional semantics", async () => {
    const repository = new MemoryRepository();
    await expect(reconcileExternalMembership({
      queryAdapter: { async query<TResult>(): Promise<TResult> { return undefined as TResult; } },
      repository,
      event: event("created"),
    })).rejects.toThrow(/transactional/i);
    expect(repository.claims).toBe(0);
  });

  it("reconciles through a withTransaction pool without replacing its scoped query", async () => {
    const adapter = withTransactionAdapter();
    const repository = new MemoryRepository();
    await expect(reconcileExternalMembership({
      queryAdapter: adapter,
      repository,
      event: event("created"),
    })).resolves.toMatchObject({ status: "created" });
    expect(adapter.transactions).toBe(1);
  });
});

describe("role hierarchy", () => {
  const hierarchy = defineRoleHierarchy(["viewer", "editor", "owner"]);

  it("evaluates roles by the configured ordering", () => {
    expect(hasRoleAtLeast("owner", "editor", hierarchy)).toBe(true);
    expect(hasRoleAtLeast("viewer", "editor", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "person", role: "editor" }, "viewer", hierarchy)).toBe(true);
  });

  it("fails closed for missing and unknown roles", () => {
    expect(hasRoleAtLeast("unknown", "viewer", hierarchy)).toBe(false);
    expect(hasRoleAtLeast("owner", "unknown", hierarchy)).toBe(false);
    expect(resolveViewerRole({ subjectId: "person", role: "unknown" }, hierarchy)).toBeUndefined();
    expect(viewerHasAccess(undefined, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "person" }, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ role: "owner" } as never, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "", role: "owner" }, "viewer", hierarchy)).toBe(false);
  });
});

describe("isAuthorized", () => {
  it("fails closed before calling a predicate for missing, invalid, or expired sessions", async () => {
    const predicate = vi.fn(() => true);

    await expect(isAuthorized(predicate, null, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, { subjectId: "   " }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: new Date(Number.NaN),
    }, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, { subjectId: undefined } as never, {})).resolves.toBe(false);
    await expect(isAuthorized(predicate, {
      subjectId: "person",
      expiresAt: "2026-01-01T00:00:00.000Z",
    } as never, {})).resolves.toBe(false);
    expect(predicate).not.toHaveBeenCalled();
  });

  it("denies predicate errors and accepts only an explicit successful decision", async () => {
    await expect(isAuthorized(() => {
      throw new Error("decision failed");
    }, { subjectId: "person" }, {})).resolves.toBe(false);
    await expect(isAuthorized(() => true, { subjectId: "person" }, {})).resolves.toBe(true);
    await expect(isAuthorized(() => false, { subjectId: "person" }, {})).resolves.toBe(false);
    await expect(isAuthorized((() => "allowed") as never, { subjectId: "person" }, {})).resolves.toBe(false);
  });
});

describe("reconcileExternalMembership", () => {
  it("creates additively and only permits an update event to replace role data", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };

    const created = await reconcileExternalMembership({ ...command, event: event("created") });
    expect(created.status).toBe("created");
    const initial = repository.memberships.get(key({ provider: "provider-a", providerMembershipId: "membership-a" }));
    expect(initial?.role).toBe("viewer");

    const duplicateIdentityCreate = await reconcileExternalMembership({
      ...command,
      event: event("created", { eventId: "event-2", occurredAt: "2026-02-02T00:00:00.000Z", role: "owner" }),
    });
    expect(duplicateIdentityCreate.status).toBe("unchanged");
    expect(repository.memberships.get(key({ provider: "provider-a", providerMembershipId: "membership-a" }))?.role).toBe("viewer");

    const updated = await reconcileExternalMembership({
      ...command,
      event: event("updated", { eventId: "event-3", occurredAt: "2026-02-03T00:00:00.000Z", role: "owner" }),
    });
    expect(updated.status).toBe("updated");
    expect(repository.memberships.get(key({ provider: "provider-a", providerMembershipId: "membership-a" }))).toMatchObject({
      membershipId: initial?.membershipId,
      createdAt: initial?.createdAt,
      invitedAt: initial?.invitedAt,
      acceptedAt: initial?.acceptedAt,
      grants: ["local-grant"],
      localNote: "owned by the caller",
      role: "owner",
    });
    expect(adapter.transactions).toBe(3);
  });

  it("makes duplicate event ids retry-idempotent", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository, event: event("created") };
    expect((await reconcileExternalMembership(command)).status).toBe("created");
    expect((await reconcileExternalMembership(command)).status).toBe("duplicate");
    expect(repository.creates).toBe(1);
    expect(repository.replacements).toBe(0);
    expect(repository.locks).toBe(2);
  });

  it("serializes concurrent delivery so a stale update cannot reopen a deleted membership", async () => {
    const adapter = new LockAwareTransactionalAdapter();
    const repository = new PausingUpdateRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({
      ...command,
      event: event("created", { version: 1 }),
    });

    const update = reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-update",
        occurredAt: "2026-02-02T00:00:00.000Z",
        version: 2,
        role: "editor",
      }),
    });
    await repository.updateReached.promise;

    let deletionSettled = false;
    const deletion = reconcileExternalMembership({
      ...command,
      event: event("deleted", {
        eventId: "event-delete",
        occurredAt: "2026-02-03T00:00:00.000Z",
        version: 3,
      }),
    }).then((result) => {
      deletionSettled = true;
      return result;
    });
    await vi.waitFor(() => expect(repository.locks).toBe(3));
    expect(deletionSettled).toBe(false);

    repository.continueUpdate.resolve();
    await expect(update).resolves.toMatchObject({ status: "updated" });
    await expect(deletion).resolves.toMatchObject({ status: "deleted" });
    expect(repository.memberships.has(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))).toBe(false);
    expect(repository.cursors.get(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))).toMatchObject({ version: 3 });
  });

  it("serializes concurrent retries to one create and one duplicate result", async () => {
    const adapter = new LockAwareTransactionalAdapter();
    const repository = new SerializingMemoryRepository();
    const command = { queryAdapter: adapter, repository, event: event("created") };

    const results = await Promise.all([
      reconcileExternalMembership(command),
      reconcileExternalMembership(command),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["created", "duplicate"]);
    expect(repository.creates).toBe(1);
    expect(repository.memberships.size).toBe(1);
  });

  it("namespaces event idempotency claims by provider", async () => {
    const repository = new MemoryRepository();
    const command = { queryAdapter: transactionalAdapter(), repository };
    expect((await reconcileExternalMembership({
      ...command,
      event: event("created", { eventId: "shared-event" }),
    })).status).toBe("created");
    expect((await reconcileExternalMembership({
      ...command,
      event: event("created", {
        eventId: "shared-event",
        provider: "provider-b",
        providerMembershipId: "membership-b",
      }),
    })).status).toBe("created");
    expect(repository.creates).toBe(2);
  });

  it("rejects malformed or coercible membership timestamps", async () => {
    for (const occurredAt of ["0", "2026-02-30T00:00:00Z", null, 0, false]) {
      await expect(reconcileExternalMembership({
        queryAdapter: transactionalAdapter(),
        repository: new MemoryRepository(),
        event: event("created", { occurredAt: occurredAt as never }),
      })).rejects.toThrow(/occurredAt/i);
    }
  });

  it("ignores stale timestamps and stale versions", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({ ...command, event: event("created", { version: 4 }) });
    await reconcileExternalMembership({ ...command, event: event("updated", { eventId: "event-2", occurredAt: "2026-02-02T00:00:00.000Z", version: 5, role: "editor" }) });

    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", { eventId: "event-3", occurredAt: "2026-01-01T00:00:00.000Z", role: "owner" }),
    })).status).toBe("stale");
    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", { eventId: "event-4", occurredAt: "2026-03-01T00:00:00.000Z", version: 4, role: "owner" }),
    })).status).toBe("stale");
    expect(repository.memberships.get(key({ provider: "provider-a", providerMembershipId: "membership-a" }))?.role).toBe("editor");
  });

  it("preserves provider version ordering across an unversioned event", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({ ...command, event: event("created", { version: 5 }) });
    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-2",
        occurredAt: "2026-03-01T00:00:00.000Z",
        role: "editor",
      }),
    })).status).toBe("updated");

    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-3",
        occurredAt: "2026-04-01T00:00:00.000Z",
        version: 4,
        role: "owner",
      }),
    })).status).toBe("stale");
    expect(repository.memberships.get(key({ provider: "provider-a", providerMembershipId: "membership-a" }))?.role).toBe("editor");
  });

  it("deletes only the provider-owned identity and accepts repeated deletion", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({ ...command, event: event("created") });
    await reconcileExternalMembership({
      ...command,
      event: event("created", { eventId: "event-other", provider: "provider-b", providerMembershipId: "membership-a" }),
    });

    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", { eventId: "event-delete", occurredAt: "2026-03-01T00:00:00.000Z" }),
    })).status).toBe("deleted");
    expect(repository.memberships.has(key({ provider: "provider-a", providerMembershipId: "membership-a" }))).toBe(false);
    expect(repository.memberships.has(key({ provider: "provider-b", providerMembershipId: "membership-a" }))).toBe(true);
    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", { eventId: "event-delete-again", occurredAt: "2026-04-01T00:00:00.000Z" }),
    })).status).toBe("deleted");
    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", { eventId: "event-delete-again", occurredAt: "2026-04-01T00:00:00.000Z" }),
    })).status).toBe("duplicate");
  });

  it("applies a distinct deletion that ties the stored timestamp", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({ ...command, event: event("created") });

    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", { eventId: "event-delete" }),
    })).status).toBe("deleted");
    expect(repository.memberships.has(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))).toBe(false);
  });

  it("applies a distinct deletion that ties the stored provider version", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({ ...command, event: event("created", { version: 7 }) });

    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", { eventId: "event-delete", version: 7 }),
    })).status).toBe("deleted");
    expect(repository.memberships.has(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))).toBe(false);
  });

  it("keeps cursor time monotonic when an equal-version deletion wins", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({
      ...command,
      event: event("created", { occurredAt: "2026-03-01T00:00:00Z", version: 7 }),
    });
    expect((await reconcileExternalMembership({
      ...command,
      event: event("deleted", {
        eventId: "event-delete",
        occurredAt: "2026-02-01T00:00:00Z",
        version: 7,
      }),
    })).status).toBe("deleted");

    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-stale-update",
        occurredAt: "2026-02-15T00:00:00Z",
        role: "owner",
      }),
    })).status).toBe("stale");
    expect(repository.memberships.has(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))).toBe(false);
  });

  it("keeps cursor time monotonic when a higher-version update wins", async () => {
    const adapter = transactionalAdapter();
    const repository = new MemoryRepository();
    const command = { queryAdapter: adapter, repository };
    await reconcileExternalMembership({
      ...command,
      event: event("created", { occurredAt: "2026-03-01T00:00:00Z", version: 7 }),
    });
    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-new-version",
        occurredAt: "2026-02-01T00:00:00Z",
        role: "owner",
        version: 8,
      }),
    })).status).toBe("updated");

    expect((await reconcileExternalMembership({
      ...command,
      event: event("updated", {
        eventId: "event-stale-update",
        occurredAt: "2026-02-15T00:00:00Z",
        role: "member",
      }),
    })).status).toBe("stale");
    expect(repository.memberships.get(key({
      provider: "provider-a",
      providerMembershipId: "membership-a",
    }))?.role).toBe("owner");
  });

  it("materializes current state when an update arrives before creation", async () => {
    const repository = new MemoryRepository();
    const result = await reconcileExternalMembership({
      queryAdapter: transactionalAdapter(),
      repository,
      event: event("updated", { role: "owner" }),
    });
    expect(result.status).toBe("created");
    expect(result.membership?.role).toBe("owner");
    expect(repository.creates).toBe(1);
  });
});

describe("safe redirects", () => {
  const policy = createAllowedOriginPolicy(["https://app.example.test", "http://localhost:3000"]);

  it("resolves same-origin paths and allowlisted absolute targets", () => {
    expect(resolveSafeRedirect("/account", policy, "https://app.example.test")).toBe("https://app.example.test/account");
    expect(resolveSafeRedirect("https://app.example.test/account?tab=security", policy)).toBe("https://app.example.test/account?tab=security");
    expect(isAllowedOrigin("http://localhost:3000/anything", policy)).toBe(true);
    expect(isAllowedOrigin("https:\\app.example.test", policy)).toBe(false);
  });

  it("rejects malformed, cross-origin, protocol-relative, backslash, non-http, and credential targets", () => {
    for (const target of [
      "https://",
      "https://outside.example.test/account",
      "//outside.example.test/account",
      "/\\outside.example.test",
      "/%5coutside.example.test",
      "javascript:alert(1)",
      "ftp://app.example.test/file",
      "https://user:password@app.example.test/account",
      "account",
      " /account",
    ]) {
      expect(resolveSafeRedirect(target, policy, "https://app.example.test")).toBeUndefined();
    }
    expect(resolveSafeRedirect("/account", policy)).toBeUndefined();
    expect(resolveSafeRedirect("/account", policy, "https://outside.example.test")).toBeUndefined();
  });

  it("rejects malformed origins while constructing the allowlist", () => {
    expect(() => createAllowedOriginPolicy(["https://app.example.test/path"])).toThrow();
    expect(() => createAllowedOriginPolicy(["javascript:alert(1)"])).toThrow();
    expect(() => createAllowedOriginPolicy(["https://user:password@app.example.test"])).toThrow();
  });
});
