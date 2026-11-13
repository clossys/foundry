import { expect, it } from "vitest";
import * as policy from "./approval-policy.js";
import * as server from "./approval.js";
import { computeCopyFingerprint } from "./fingerprint.js";
import type { CopyApproval } from "./types.js";

it("shares every pure approval predicate with the established server exports", () => {
  for (const key of ["COPY_DELEGATE_SCOPE_RE", "isDelegateScopeItem", "isEntryInDelegateScope", "isApprovalStale", "isApprovalExpired"] as const) {
    expect(server[key]).toBe(policy[key]);
  }
});

it("retains scope boundaries, fingerprint comparison and the exact expiry instant", () => {
  const approval: CopyApproval = { approvedBy: "owner", approvedAt: "2026-10-01T00:00:00Z", textFingerprint: computeCopyFingerprint("fixture"), fingerprintAlgorithm: "sha256", expiresAt: "2026-11-01T00:00:00Z" };
  expect(policy.isDelegateScopeItem("site.home")).toBe(true);
  expect(policy.isDelegateScopeItem("site.*")).toBe(false);
  expect(policy.isEntryInDelegateScope("site.home.title", ["site.home"])).toBe(true);
  expect(policy.isEntryInDelegateScope("site.homepage.title", ["site.home"])).toBe(false);
  expect(policy.isApprovalStale({ text: "fixture", approval })).toBe(false);
  expect(policy.isApprovalStale({ text: "changed", approval })).toBe(true);
  expect(policy.isApprovalStale({ text: "fixture" })).toBe(false);
  expect(policy.isApprovalExpired(approval, new Date("2026-10-31T23:59:59.999Z"))).toBe(false);
  expect(policy.isApprovalExpired(approval, new Date(approval.expiresAt!))).toBe(true);
  expect(policy.isApprovalExpired({ ...approval, expiresAt: undefined }, new Date("2026-12-01T00:00:00Z"))).toBe(false);
});
