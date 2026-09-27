import { describe, expect, it } from "vitest";
import { createCopyResolver, resolveCopyRef } from "./resolve.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import type { CopyApproval, CopyRegistry } from "./types.js";

const registry: CopyRegistry = {
  id: "acme-app",
  locale: "en",
  revision: "2026-08-11",
  source: { kind: "consumer", reference: "editorial/revisions/42" },
  entries: [
    {
      id: "dashboard.welcome",
      text: "Welcome, {name}.",
      context: "dashboard heading",
      placeholders: ["name"],
      status: "approved",
    },
    { id: "dashboard.pending", text: "Pending review", context: "dashboard status", status: "draft" },
  ],
};

describe("resolveCopyRef", () => {
  it("resolves approved copy with deterministic placeholder substitution and provenance", () => {
    const result = resolveCopyRef(registry, { id: "dashboard.welcome", locale: "en", values: { name: "Ada" } });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.resolution).toMatchObject({
      text: "Welcome, Ada.",
      recordId: "acme-app",
      revision: "2026-08-11",
      locale: "en",
      entryId: "dashboard.welcome",
    });
  });

  it("fails closed for a missing entry, wrong locale, draft entry, and missing parameter", () => {
    expect(resolveCopyRef(registry, { id: "dashboard.missing" }).issues[0]?.reason).toBe("unknown-copy-id");
    expect(resolveCopyRef(registry, { id: "dashboard.welcome", locale: "fr" }).issues[0]?.reason).toBe(
      "locale-mismatch",
    );
    expect(resolveCopyRef(registry, { id: "dashboard.pending" }).issues[0]?.reason).toBe("copy-not-approved");
    expect(resolveCopyRef(registry, { id: "dashboard.welcome" }).issues[0]?.reason).toBe("missing-placeholder-value");
  });

  it("fails closed instead of throwing when JavaScript callers supply an invalid registry or ref shape", () => {
    const malformedRegistry = { ...registry, source: { kind: "unsupported", reference: "editorial/revisions/42" } };
    expect(() => resolveCopyRef(malformedRegistry, { id: "dashboard.welcome" })).not.toThrow();
    expect(resolveCopyRef(malformedRegistry, { id: "dashboard.welcome" })).toEqual({
      issues: [expect.objectContaining({ reason: "invalid-registry" })],
      complete: false,
    });

    expect(resolveCopyRef(registry, { id: "dashboard.welcome", values: null } as unknown).issues[0]?.reason).toBe("invalid-ref");
    expect(createCopyResolver({ entries: null })({ id: "dashboard.welcome" })).toBeUndefined();
  });

  it("rejects unexpected or non-scalar interpolation values", () => {
    expect(resolveCopyRef(registry, { id: "dashboard.welcome", values: { name: "Ada", extra: true } }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "unexpected-placeholder-value", placeholder: "extra" })]),
    );
    expect(
      resolveCopyRef(registry, {
        id: "dashboard.welcome",
        values: { name: { invalid: true } as unknown as string },
      }).issues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "missing-placeholder-value", placeholder: "name" })]));
  });

  it("creates the narrow CopyResolver callback surface renderers consume", () => {
    const resolver = createCopyResolver(registry);
    expect(resolver({ id: "dashboard.welcome", values: { name: "Ada" } })?.text).toBe("Welcome, Ada.");
    expect(resolver({ id: "dashboard.missing" })).toBeUndefined();
  });

  describe("approval-aware resolution", () => {
    const now = new Date("2026-09-27T00:00:00.000Z");
    const fingerprint = computeCopyFingerprint("Approved copy.");

    const ownerApproval: CopyApproval = {
      approvedBy: "owner",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: fingerprint,
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    };

    const delegateApproval: CopyApproval = {
      approvedBy: "delegate",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: fingerprint,
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
      delegate: { id: "delegate-a", scope: ["approval"] },
      pendingOwnerReview: true,
    };

    function registryWith(approval: CopyApproval | undefined): CopyRegistry {
      return {
        id: "acme-app",
        locale: "en",
        revision: "2026-08-11",
        source: { kind: "consumer", reference: "editorial/revisions/42" },
        entries: [{ id: "approval.copy", text: "Approved copy.", context: "test fixture", status: "approved", approval }],
      };
    }

    it("owner record resolves on preview and production", () => {
      const reg = registryWith(ownerApproval);
      expect(resolveCopyRef(reg, { id: "approval.copy" }, { target: "preview" }).complete).toBe(true);
      const result = resolveCopyRef(reg, { id: "approval.copy" }, { target: "production" });
      expect(result.complete).toBe(true);
      expect(result.resolution?.approval).toEqual({ approvedBy: "owner", pendingOwnerReview: false });
    });

    it("pending delegate record resolves on preview with approval metadata", () => {
      const reg = registryWith(delegateApproval);
      const result = resolveCopyRef(reg, { id: "approval.copy" }, { target: "preview", now });
      expect(result.complete).toBe(true);
      expect(result.resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true });
    });

    it("delegate record is refused in production by default", () => {
      const reg = registryWith(delegateApproval);
      const result = resolveCopyRef(reg, { id: "approval.copy" }, { now });
      expect(result.complete).toBe(false);
      expect(result.issues[0]?.reason).toBe("delegate-approval-refused");
    });

    it("delegate record resolves in production when accepted", () => {
      const reg = registryWith(delegateApproval);
      const result = resolveCopyRef(reg, { id: "approval.copy" }, { target: "production", acceptDelegateInProduction: true, now });
      expect(result.complete).toBe(true);
      expect(result.resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true });
    });

    it("expired delegate record is refused on both targets", () => {
      const reg = registryWith({ ...delegateApproval, expiresAt: "2026-09-01T00:00:00.000Z" });
      expect(resolveCopyRef(reg, { id: "approval.copy" }, { target: "preview", now }).issues[0]?.reason).toBe("approval-expired");
      expect(
        resolveCopyRef(reg, { id: "approval.copy" }, { target: "production", acceptDelegateInProduction: true, now }).issues[0]
          ?.reason,
      ).toBe("approval-expired");
    });

    it("stale fingerprint is refused", () => {
      const reg = registryWith({ ...ownerApproval, textFingerprint: computeCopyFingerprint("different text") });
      const result = resolveCopyRef(reg, { id: "approval.copy" }, { now });
      expect(result.complete).toBe(false);
      expect(result.issues[0]?.reason).toBe("approval-stale");
    });

    it("approved entry without a record resolves unchanged with no approval field", () => {
      const reg = registryWith(undefined);
      const result = resolveCopyRef(reg, { id: "approval.copy" });
      expect(result.complete).toBe(true);
      expect(result.resolution && "approval" in result.resolution).toBe(false);
    });

    it("invalid options fail closed", () => {
      const reg = registryWith(ownerApproval);
      expect(resolveCopyRef(reg, { id: "approval.copy" }, "not an object" as unknown).issues[0]?.reason).toBe("invalid-options");
      expect(resolveCopyRef(reg, { id: "approval.copy" }, { target: "staging" } as unknown).issues[0]?.reason).toBe(
        "invalid-options",
      );
      expect(
        resolveCopyRef(reg, { id: "approval.copy" }, { acceptDelegateInProduction: "yes" } as unknown).issues[0]?.reason,
      ).toBe("invalid-options");
      expect(resolveCopyRef(reg, { id: "approval.copy" }, { now: "2026-01-01" } as unknown).issues[0]?.reason).toBe(
        "invalid-options",
      );
    });
  });
});
