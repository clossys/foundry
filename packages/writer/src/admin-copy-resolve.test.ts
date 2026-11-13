import { describe, expect, it } from "vitest";
import { ADMIN_WRITER_COPY_EN, createAdminCopy, resolveAdminCopyRef, type AdminRouteCopy } from "./admin-copy.js";
import { createCopyResolver, resolveCopyRef } from "./resolve.js";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "./fingerprint.js";
import type { CopyApproval, CopyRegistry } from "./types.js";

const record = ADMIN_WRITER_COPY_EN.records.find(row => row.context.endsWith("coverageSummary"))!;
const ref = { id: record.id, values: { records: 7, bindings: 4 } };
const now = new Date("2026-10-29T00:00:00.000Z");
const preview = { target: "preview" as const, now };
const production = { target: "production" as const, now };
// Approval evidence here belongs only to isolated synthetic test records.
const owner: CopyApproval = { approvedBy: "owner", approvedAt: "2026-10-01T00:00:00.000Z", textFingerprint: computeCopyFingerprint(record.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM };
function copyWith(status: "draft" | "approved" | "retired", approval?: CopyApproval) {
  const envelope: AdminRouteCopy = { ...ADMIN_WRITER_COPY_EN, records: [{ ...record, status, ...(approval === undefined ? {} : { approval }) }] };
  return createAdminCopy([envelope]);
}

describe("admin copy target boundary", () => {
  it("refuses a real draft in production, including omitted target and legacy calls", () => {
    const copy = copyWith("draft");
    expect(resolveAdminCopyRef(ref, copy, production)).toBeUndefined();
    expect(resolveAdminCopyRef(ref, copy, {})).toBeUndefined();
    expect(resolveAdminCopyRef(ref, copy)).toBeUndefined();
    expect(resolveAdminCopyRef(ref)).toBeUndefined();
  });
  it("renders an explicit preview draft with its marker without changing the record", () => {
    const copy = copyWith("draft"), before = JSON.stringify(copy);
    expect(resolveAdminCopyRef(ref, copy, preview)).toMatchObject({ text: "7 records; 4 proposed bindings.", status: "draft", activation: "none", servedLocale: "en" });
    expect(JSON.stringify(copy)).toBe(before);
    expect(copy.records[0]).not.toHaveProperty("approval");
  });
  it("refuses retired records in either target", () => {
    for (const options of [preview, production]) expect(resolveAdminCopyRef(ref, copyWith("retired"), options)).toBeUndefined();
  });
  it("keeps missing records, unsupported locales and invalid ICU values as Needs", () => {
    const copy = copyWith("draft");
    for (const invalid of [{ id: "missing" }, { ...ref, locale: "fr" }, { id: ref.id }, { ...ref, values: { records: 7, bindings: 4, unexpected: 1 } }, { ...ref, values: { records: "seven", bindings: 4 } }]) {
      expect(resolveAdminCopyRef(invalid, copy, preview)).toBeUndefined();
    }
  });
  it("refuses an invalid target instead of granting preview access", () => {
    expect(resolveAdminCopyRef(ref, copyWith("draft"), { target: "staging" } as never)).toBeUndefined();
  });
  it("preserves valid owner approval facts in production", () => {
    expect(resolveAdminCopyRef(ref, copyWith("approved", owner), production)).toMatchObject({ text: "7 records; 4 proposed bindings.", status: "approved", approval: { approvedBy: "owner", pendingOwnerReview: false } });
  });
  it("refuses stale owner approval in both targets", () => {
    const approval = { ...owner, textFingerprint: computeCopyFingerprint("Earlier fixture text") };
    for (const options of [preview, production]) expect(resolveAdminCopyRef(ref, copyWith("approved", approval), options)).toBeUndefined();
  });
  it("preserves delegate grant, scope and expiry checks", () => {
    const delegate: CopyApproval = { ...owner, approvedBy: "delegate", delegate: { id: "fixture-reviewer", scope: ["st"] }, pendingOwnerReview: true, expiresAt: "2026-11-01T00:00:00.000Z" };
    const copy = copyWith("approved", delegate);
    expect(resolveAdminCopyRef(ref, copy, preview)).toMatchObject({ approval: { approvedBy: "delegate", pendingOwnerReview: true } });
    expect(resolveAdminCopyRef(ref, copy, production)).toBeUndefined();
    expect(resolveAdminCopyRef(ref, copy, { ...production, acceptDelegateInProduction: true })).toMatchObject({ status: "approved" });
    const outside = copyWith("approved", { ...delegate, delegate: { id: "fixture-reviewer", scope: ["other"] } });
    const expired = copyWith("approved", { ...delegate, expiresAt: "2026-10-02T00:00:00.000Z" });
    for (const options of [preview, { ...production, acceptDelegateInProduction: true }]) {
      expect(resolveAdminCopyRef(ref, outside, options)).toBeUndefined();
      expect(resolveAdminCopyRef(ref, expired, options)).toBeUndefined();
    }
  });
});

it("allows drafts only on the shared resolver's explicit preview target", () => {
  const registry: CopyRegistry = { id: "fixture", locale: "en", revision: "1", source: { kind: "generated", reference: "fixture/admin-copy" }, entries: [{ id: "fixture.draft", text: "Draft copy", context: "Test fixture", status: "draft" }] };
  const reference = { id: "fixture.draft" };
  expect(createCopyResolver(registry, preview)(reference)).toMatchObject({ text: "Draft copy", status: "draft" });
  expect(createCopyResolver(registry, production)(reference)).toBeUndefined();
  expect(resolveCopyRef(registry, reference).issues[0]?.reason).toBe("copy-not-approved");
  registry.entries[0]!.status = "retired";
  expect(createCopyResolver(registry, preview)(reference)).toBeUndefined();
  registry.entries[0]!.status = "approved";
  for (const options of [preview, production]) {
    const approved = createCopyResolver(registry, options)(reference);
    expect(approved?.text).toBe("Draft copy");
    expect(approved).not.toHaveProperty("status");
  }
});
