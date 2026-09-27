import { describe, expect, it } from "vitest";
import { assessCopyApprovals, isDelegateScopeItem, isEntryInDelegateScope } from "./approval.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import type { CopyRegistry } from "./types.js";

const now = new Date("2026-09-27T00:00:00.000Z");

const baseRegistry: CopyRegistry = {
  id: "acme-app",
  locale: "en",
  revision: "2026-08-11",
  source: { kind: "consumer", reference: "editorial/revisions/42" },
  entries: [
    {
      id: "home.title",
      text: "Welcome",
      context: "home heading",
      status: "approved",
    },
  ],
};

const currentFingerprint = computeCopyFingerprint(baseRegistry.entries[0].text);

describe("isDelegateScopeItem / isEntryInDelegateScope", () => {
  it("accepts a well-formed single- or multi-segment namespace", () => {
    expect(isDelegateScopeItem("home")).toBe(true);
    expect(isDelegateScopeItem("site.home")).toBe(true);
    expect(isDelegateScopeItem("Site.Home")).toBe(false);
    expect(isDelegateScopeItem("")).toBe(false);
  });

  it("matches an entry id equal to or nested under a scope item, never a sibling with a shared prefix", () => {
    expect(isEntryInDelegateScope("site.home", ["site.home"])).toBe(true);
    expect(isEntryInDelegateScope("site.home.title", ["site.home"])).toBe(true);
    expect(isEntryInDelegateScope("site.homepage.title", ["site.home"])).toBe(false);
  });
});

describe("assessCopyApprovals", () => {
  it("reports approval-record-missing for an approved entry with no record", () => {
    const findings = assessCopyApprovals(baseRegistry, now);
    expect(findings).toEqual([
      expect.objectContaining({ rule: "approval-record-missing", severity: "warning", entryId: "home.title" }),
    ]);
  });

  it("reports no finding for a current owner record", () => {
    const registry: CopyRegistry = {
      ...baseRegistry,
      entries: [
        {
          ...baseRegistry.entries[0],
          approval: {
            approvedBy: "owner",
            approvedAt: "2026-08-01T00:00:00.000Z",
            textFingerprint: currentFingerprint,
            fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
          },
        },
      ],
    };
    expect(assessCopyApprovals(registry, now)).toEqual([]);
  });

  it("reports approval-stale when the fingerprint no longer matches the entry's text", () => {
    const registry: CopyRegistry = {
      ...baseRegistry,
      entries: [
        {
          ...baseRegistry.entries[0],
          approval: {
            approvedBy: "owner",
            approvedAt: "2026-08-01T00:00:00.000Z",
            textFingerprint: computeCopyFingerprint("some earlier text"),
            fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
          },
        },
      ],
    };
    const findings = assessCopyApprovals(registry, now);
    expect(findings).toEqual([expect.objectContaining({ rule: "approval-stale", severity: "error", entryId: "home.title" })]);
  });

  it("reports approval-expired for a delegate record whose expiresAt has passed", () => {
    const registry: CopyRegistry = {
      ...baseRegistry,
      entries: [
        {
          ...baseRegistry.entries[0],
          approval: {
            approvedBy: "delegate",
            approvedAt: "2026-08-01T00:00:00.000Z",
            textFingerprint: currentFingerprint,
            fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
            delegate: { id: "delegate-a", scope: ["home"] },
            pendingOwnerReview: false,
            expiresAt: "2026-09-01T00:00:00.000Z",
          },
        },
      ],
    };
    const findings = assessCopyApprovals(registry, now);
    expect(findings).toEqual([expect.objectContaining({ rule: "approval-expired", severity: "error", entryId: "home.title" })]);
  });

  it("reports approval-pending-owner-review for a current, unexpired delegate record still awaiting review", () => {
    const registry: CopyRegistry = {
      ...baseRegistry,
      entries: [
        {
          ...baseRegistry.entries[0],
          approval: {
            approvedBy: "delegate",
            approvedAt: "2026-08-01T00:00:00.000Z",
            textFingerprint: currentFingerprint,
            fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
            delegate: { id: "delegate-a", scope: ["home"] },
            pendingOwnerReview: true,
          },
        },
      ],
    };
    const findings = assessCopyApprovals(registry, now);
    expect(findings).toEqual([
      expect.objectContaining({ rule: "approval-pending-owner-review", severity: "warning", entryId: "home.title" }),
    ]);
  });

  it("ignores draft and retired entries even when they carry an approval-shaped record", () => {
    const registry: CopyRegistry = {
      ...baseRegistry,
      entries: [
        { ...baseRegistry.entries[0], id: "home.draft", status: "draft" },
        { ...baseRegistry.entries[0], id: "home.retired", status: "retired" },
      ],
    };
    expect(assessCopyApprovals(registry, now)).toEqual([]);
  });
});
