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

  async claimEvent(_query: QueryAdapter, eventId: string): Promise<boolean> {
    this.claims += 1;
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
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
    expect(isQueryAdapter(adapter)).toBe(true);
    expect(isTransactionalQueryAdapter(adapter)).toBe(true);
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

  it("does not carry an obsolete version across an unversioned event", async () => {
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
        occurredAt: "2026-02-15T00:00:00.000Z",
        version: 6,
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

  it("does not create a membership from an update event", async () => {
    const repository = new MemoryRepository();
    const result = await reconcileExternalMembership({
      queryAdapter: transactionalAdapter(),
      repository,
      event: event("updated", { role: "owner" }),
    });
    expect(result.status).toBe("unchanged");
    expect(repository.creates).toBe(0);
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
