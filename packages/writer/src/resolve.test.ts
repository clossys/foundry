import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCopyResolver, resolveCopyRef } from "./resolve.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import { planDigest } from "./plan-digest.js";
import type { CopyApproval, CopyRegistry, CopyRegistryEntry } from "./types.js";

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

/*
 * Issue #1586: a delegate-approved entry on "production" resolves under an
 * approvalPlan, the bytes of an Advisor plan record, when planDelegateCopyAuthority()
 * says that plan authorizes it. The plans are the shared digest corpus's, whose
 * approving decisions already name their own digest. Reading the repository's
 * docs here is test-only: nothing at runtime leaves this package.
 */
describe("production resolution authorized by an approvalPlan", () => {
  type Plan = Record<string, any>;
  interface DigestCorpus {
    plans: { name: string; plan: Plan; digest: string }[];
  }
  const CORPUS = JSON.parse(readFileSync(new URL("../../../docs/contracts/advisor-plan-digest.fixture.json", import.meta.url), "utf8")) as DigestCorpus;
  const corpus = (name: string) => CORPUS.plans.find((candidate) => candidate.name === name)!;
  const plan = (name: string): Plan => structuredClone(corpus(name).plan);
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const bytesOf = (name: string): Uint8Array => encode(plan(name));
  const decide = (at: string, chosen: string, subjectDigest?: string) => ({
    at,
    recommended: "compose from confirmed problems",
    chosen,
    by: "sponsor",
    ...(subjectDigest === undefined ? {} : { subjectDigest }),
  });
  const withDecisions = (name: string, ...decisions: unknown[]): Plan => ({ ...plan(name), decisions });

  const SCOPED = corpus("delegated-copy-approval-scoped").digest;
  const UNSCOPED = corpus("delegated-copy-approval-unscoped").digest;
  const OTHER = corpus("blockers-without-due").digest;
  const T1 = "2026-09-21T00:00:00Z";
  const T2 = "2026-09-22T00:00:00Z";
  const now = new Date("2026-09-27T00:00:00.000Z");

  const text = "Welcome home.";
  const fingerprint = computeCopyFingerprint(text);
  const delegate = (scope: string[], extra: Partial<CopyApproval> = {}): CopyApproval => ({
    approvedBy: "delegate",
    approvedAt: "2026-08-01T00:00:00.000Z",
    textFingerprint: fingerprint,
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    delegate: { id: "delegate-a", scope },
    pendingOwnerReview: true,
    ...extra,
  });
  const entryOf = (id: string, approval: CopyApproval | undefined): CopyRegistryEntry => ({ id, text, context: "test fixture", status: "approved", approval });
  const registryOf = (...entries: CopyRegistryEntry[]): CopyRegistry => ({
    id: "acme-app",
    locale: "en",
    revision: "2026-08-11",
    source: { kind: "consumer", reference: "editorial/revisions/42" },
    entries,
  });
  const registry = registryOf(
    entryOf("home.title", delegate(["home"])),
    entryOf("home.hero.title", delegate(["home"])),
    entryOf("about.title", delegate(["about"])),
    entryOf("homepage.title", delegate(["homepage"])),
    entryOf("site.pricing.plan", delegate(["site"])),
    entryOf("owner.title", { approvedBy: "owner", approvedAt: "2026-08-01T00:00:00.000Z", textFingerprint: fingerprint, fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM }),
    entryOf("bare.title", undefined),
  );
  const resolve = (id: string, approvalPlan: unknown, options: Record<string, unknown> = {}) => resolveCopyRef(registry, { id }, { now, approvalPlan, ...options });
  const refusedWith = (result: ReturnType<typeof resolveCopyRef>, planRefusal: string) => {
    expect(result.complete).toBe(false);
    expect(result.resolution).toBeUndefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ reason: "delegate-approval-refused", id: expect.any(String), planRefusal });
  };

  it("resolves the issue's fixture: entry home.title, scope home, the corpus plan delegated-copy-approval-scoped", () => {
    for (const options of [{}, { target: "production" }]) {
      const result = resolve("home.title", bytesOf("delegated-copy-approval-scoped"), options);
      expect(result.complete).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true, authorizingPlanDigest: SCOPED });
      expect(result.resolution?.text).toBe(text);
    }
  });

  it("resolves under the unscoped corpus plan, and under a Node Buffer of the same bytes", () => {
    expect(resolve("home.title", bytesOf("delegated-copy-approval-unscoped")).resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true, authorizingPlanDigest: UNSCOPED });
    expect(resolve("about.title", bytesOf("delegated-copy-approval-unscoped")).complete).toBe(true);
    expect(resolve("home.title", Buffer.from(JSON.stringify(plan("delegated-copy-approval-scoped")), "utf8")).resolution?.approval).toMatchObject({ authorizingPlanDigest: SCOPED });
  });

  it("carries no undefined-valued key on a resolution", () => {
    const approval = resolve("home.title", bytesOf("delegated-copy-approval-scoped")).resolution?.approval;
    expect(Object.keys(approval!).sort()).toEqual(["approvedBy", "authorizingPlanDigest", "pendingOwnerReview"]);
  });

  describe("refuses, as delegate-approval-refused with the plan's reason in planRefusal", () => {
    const scoped = (...decisions: unknown[]) => withDecisions("delegated-copy-approval-scoped", ...decisions);
    const rows: [string, () => Uint8Array, string][] = [
      ["no decisions", () => encode(scoped()), "no-decisions"],
      ["a latest decision that is deferred", () => encode(scoped(decide(T1, "deferred", SCOPED))), "latest-decision-not-approved"],
      ["approved and then deferred later (corpus scoped-new-decisions)", () => bytesOf("delegated-copy-approval-scoped-new-decisions"), "latest-decision-not-approved"],
      ["an approval with no subjectDigest", () => encode(scoped(decide(T1, "approved"))), "approval-without-subject-digest"],
      ["a subjectDigest that is another plan's digest", () => encode(scoped(decide(T1, "approved", OTHER))), "subject-digest-mismatch"],
      ["the field absent, the approval naming the scoped digest (corpus removed)", () => bytesOf("delegated-copy-approval-removed"), "delegated-copy-approval-absent"],
      ["the field absent, the approval naming the plan's own digest", () => encode(withDecisions("blockers-without-due", decide(T1, "approved", OTHER))), "delegated-copy-approval-absent"],
      ["the scopes widened after approval (corpus scope-widened)", () => bytesOf("delegated-copy-approval-scope-widened"), "subject-digest-mismatch"],
      ["the scopes reordered after approval (corpus scopes-reordered)", () => bytesOf("delegated-copy-approval-scopes-reordered"), "subject-digest-mismatch"],
      ["an unknown top-level key", () => encode({ ...plan("delegated-copy-approval-scoped"), extra: true }), "plan-invalid"],
      ["a repeated mandate role (R9)", () => encode({ ...plan("delegated-copy-approval-scoped"), mandate: { ...plan("delegated-copy-approval-scoped").mandate, roles: ["strategist", "writer", "strategist"] } }), "plan-invalid"],
      ["a decision time that does not parse", () => encode(scoped(decide("yesterday", "approved", SCOPED))), "plan-invalid"],
      ["tied approvals with different digests", () => encode(scoped(decide(T1, "approved", SCOPED), decide(T1, "approved", OTHER))), "latest-decisions-disagree"],
      ["tied approvals with different digests, reversed", () => encode(scoped(decide(T1, "approved", OTHER), decide(T1, "approved", SCOPED))), "latest-decisions-disagree"],
      ["a tie of an approval and a rejection", () => encode(scoped(decide(T1, "approved", SCOPED), decide(T1, "rejected"))), "latest-decision-not-approved"],
      ["a tie of a rejection and an approval", () => encode(scoped(decide(T1, "rejected"), decide(T1, "approved", SCOPED))), "latest-decision-not-approved"],
      ["a tie across UTC offsets", () => encode(scoped(decide("2026-09-21T00:00:00Z", "approved", SCOPED), decide("2026-09-21T02:00:00+02:00", "rejected"))), "latest-decision-not-approved"],
      ["a tie across UTC offsets, reversed", () => encode(scoped(decide("2026-09-21T02:00:00+02:00", "rejected"), decide("2026-09-21T00:00:00Z", "approved", SCOPED))), "latest-decision-not-approved"],
      ["a later non-approval listed first", () => encode(scoped(decide(T2, "deferred"), decide(T1, "approved", SCOPED))), "latest-decision-not-approved"],
      ["a later non-approval listed last", () => encode(scoped(decide(T1, "approved", SCOPED), decide(T2, "deferred"))), "latest-decision-not-approved"],
      ["a key repeated in the bytes", () => new TextEncoder().encode(JSON.stringify(plan("delegated-copy-approval-scoped")).replace('"target":"production"', '"target":"production","target":"production"')), "plan-unreadable"],
      ["invalid UTF-8", () => new Uint8Array([0xff, 0xfe, 0xfd]), "plan-unreadable"],
      ["a byte order mark", () => new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf("delegated-copy-approval-scoped")]), "plan-unreadable"],
    ];
    for (const [name, build, planRefusal] of rows) {
      it(`${name}: ${planRefusal}`, () => {
        const result = resolve("home.title", build());
        refusedWith(result, planRefusal);
        expect(result.issues[0]?.message).toBe(`CopyRef "home.title" was approved by a delegate; the approvalPlan given does not authorize it on production (${planRefusal}).`);
      });
    }

    it("resolves the approval listed first at the later time, whatever the array order", () => {
      const result = resolve("home.title", encode(scoped(decide(T2, "approved", SCOPED), decide(T1, "deferred"))));
      expect(result.resolution?.approval).toMatchObject({ authorizingPlanDigest: SCOPED });
    });

    it("never echoes plan text in the message", () => {
      const invalid = { ...plan("delegated-copy-approval-scoped"), mandate: { problem: "PRIVATE-PROBLEM-TEXT", primaryProblemId: "x", roles: ["a", "a"] } };
      const result = resolve("home.title", encode(invalid));
      expect(result.issues[0]?.message).not.toContain("PRIVATE-PROBLEM-TEXT");
      expect(result.issues[0]?.message).toContain("plan-invalid");
    });
  });

  describe("scopes", () => {
    it("refuses an entry outside the plan's scopes (about.title, homepage.title under home and site.pricing)", () => {
      refusedWith(resolve("about.title", bytesOf("delegated-copy-approval-scoped")), "entry-outside-plan-scopes");
      refusedWith(resolve("homepage.title", bytesOf("delegated-copy-approval-scoped")), "entry-outside-plan-scopes");
      expect(resolve("about.title", bytesOf("delegated-copy-approval-scoped")).issues[0]?.message).toBe(
        'CopyRef "about.title" was approved by a delegate; the approvalPlan given does not authorize it on production (entry-outside-plan-scopes).',
      );
    });

    it("covers a nested entry of a declared namespace, and one of a namespace declared with a dot", () => {
      expect(resolve("home.hero.title", bytesOf("delegated-copy-approval-scoped")).complete).toBe(true);
      expect(resolve("site.pricing.plan", bytesOf("delegated-copy-approval-scoped")).complete).toBe(true);
    });

    it("does not intersect the delegate's scope and the plan's any further: home.hero covers home.hero.title, not home.title", () => {
      const narrow = { ...plan("delegated-copy-approval-scoped"), delegatedCopyApproval: { target: "production", scopes: ["home.hero"] } };
      const bytes = encode({ ...narrow, decisions: [decide(T1, "approved", planDigest(narrow))] });
      expect(resolve("home.hero.title", bytes).resolution?.approval).toMatchObject({ authorizingPlanDigest: planDigest(narrow) });
      refusedWith(resolve("home.title", bytes), "entry-outside-plan-scopes");
    });

    it("covers every entry when the plan declares no scopes", () => {
      for (const id of ["home.title", "about.title", "homepage.title", "site.pricing.plan"]) expect(resolve(id, bytesOf("delegated-copy-approval-unscoped")).complete, id).toBe(true);
    });
  });

  describe("precedence", () => {
    const staleRegistry = registryOf(entryOf("home.title", delegate(["home"], { textFingerprint: computeCopyFingerprint("other text") })));
    const expiredRegistry = registryOf(entryOf("home.title", delegate(["home"], { expiresAt: "2026-09-01T00:00:00.000Z" })));

    it("a stale entry is approval-stale under an authorizing plan, and under a plan that would be refused", () => {
      for (const name of ["delegated-copy-approval-scoped", "delegated-copy-approval-removed"]) {
        const result = resolveCopyRef(staleRegistry, { id: "home.title" }, { now, approvalPlan: bytesOf(name) });
        expect(result.issues.map((issue) => issue.reason)).toEqual(["approval-stale"]);
        expect(result.issues[0]).not.toHaveProperty("planRefusal");
      }
    });

    it("an expired entry is approval-expired under an authorizing plan, and under a plan that would be refused", () => {
      for (const name of ["delegated-copy-approval-scoped", "delegated-copy-approval-removed"]) {
        const result = resolveCopyRef(expiredRegistry, { id: "home.title" }, { now, approvalPlan: bytesOf(name) });
        expect(result.issues.map((issue) => issue.reason)).toEqual(["approval-expired"]);
        expect(result.issues[0]).not.toHaveProperty("planRefusal");
      }
    });

    it("preview resolves a delegate entry and ignores the plan entirely, even an unreadable one", () => {
      for (const approvalPlan of [bytesOf("delegated-copy-approval-scoped"), new Uint8Array([0xff]), bytesOf("delegated-copy-approval-removed")]) {
        const result = resolve("about.title", approvalPlan, { target: "preview" });
        expect(result.complete).toBe(true);
        expect(result.resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true });
        expect(Object.hasOwn(result.resolution!.approval!, "authorizingPlanDigest")).toBe(false);
      }
    });

    it("an owner entry is unaffected by a plan, and never consults it", () => {
      for (const approvalPlan of [bytesOf("delegated-copy-approval-scoped"), new Uint8Array([0xff])]) {
        const result = resolve("owner.title", approvalPlan);
        expect(result.complete).toBe(true);
        expect(result.resolution?.approval).toEqual({ approvedBy: "owner", pendingOwnerReview: false });
        expect(Object.hasOwn(result.resolution!.approval!, "authorizingPlanDigest")).toBe(false);
      }
    });

    it("an approved entry with no record resolves as before, and never consults the plan", () => {
      const result = resolve("bare.title", new Uint8Array([0xff]));
      expect(result.complete).toBe(true);
      expect("approval" in result.resolution!).toBe(false);
    });
  });

  describe("the flag and the plan", () => {
    it("a flag-authorized resolution carries no authorizingPlanDigest key at all", () => {
      const result = resolveCopyRef(registry, { id: "home.title" }, { target: "production", acceptDelegateInProduction: true, now });
      expect(result.complete).toBe(true);
      expect(result.resolution?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true });
      expect(Object.hasOwn(result.resolution!.approval!, "authorizingPlanDigest")).toBe(false);
    });

    it("refuses the flag together with a plan as invalid-options, on either target and for any entry", () => {
      for (const target of ["production", "preview"]) {
        for (const id of ["home.title", "owner.title", "bare.title"]) {
          const result = resolveCopyRef(registry, { id }, { target, acceptDelegateInProduction: true, approvalPlan: bytesOf("delegated-copy-approval-scoped"), now });
          expect(result.issues.map((issue) => issue.reason), `${target} ${id}`).toEqual(["invalid-options"]);
          expect(result.complete).toBe(false);
        }
      }
    });

    it("accepts acceptDelegateInProduction: false together with a plan", () => {
      expect(resolve("home.title", bytesOf("delegated-copy-approval-scoped"), { acceptDelegateInProduction: false }).complete).toBe(true);
    });

    it("refuses an approvalPlan that is not a Uint8Array as invalid-options", () => {
      const bytes = bytesOf("delegated-copy-approval-scoped");
      const invalid = [{}, "plan", 5, null, true, [...bytes], new DataView(bytes.buffer as ArrayBuffer), new Uint16Array(2), bytes.buffer, new Proxy(new Uint8Array(bytes), {}), () => bytes];
      invalid.forEach((approvalPlan, index) => {
        const result = resolve("home.title", approvalPlan);
        expect(result.issues.map((issue) => issue.reason), `value ${index}`).toEqual(["invalid-options"]);
      });
    });

    it("treats approvalPlan: undefined as no plan, keeping the existing refusal message and no planRefusal", () => {
      const result = resolve("home.title", undefined);
      expect(result.issues).toEqual([{ reason: "delegate-approval-refused", id: "home.title", message: 'CopyRef "home.title" was approved by a delegate; production resolution requires acceptDelegateInProduction: true.' }]);
      expect(result.issues[0]).not.toHaveProperty("planRefusal");
    });

    it("reads each option once, so a getter cannot answer differently at validation and at use", () => {
      const reads: Record<string, number> = { target: 0, acceptDelegateInProduction: 0, now: 0, approvalPlan: 0 };
      const values: Record<string, unknown> = { target: "production", acceptDelegateInProduction: false, now, approvalPlan: bytesOf("delegated-copy-approval-scoped") };
      const options: Record<string, unknown> = {};
      for (const name of Object.keys(reads)) {
        Object.defineProperty(options, name, { enumerable: true, get: () => { reads[name] = reads[name]! + 1; return values[name]; } });
      }
      const result = resolveCopyRef(registry, { id: "home.title" }, options);
      expect(result.complete).toBe(true);
      expect(reads).toEqual({ target: 1, acceptDelegateInProduction: 1, now: 1, approvalPlan: 1 });
    });
  });

  describe("createCopyResolver", () => {
    it("carries the authorizing digest on the resolution", () => {
      const resolver = createCopyResolver(registry, { approvalPlan: bytesOf("delegated-copy-approval-scoped"), now });
      expect(resolver({ id: "home.title" })?.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true, authorizingPlanDigest: SCOPED });
      expect(resolver({ id: "about.title" })).toBeUndefined();
    });

    it("evaluates the plan on each call, so nothing is cached against the bytes the caller now holds", () => {
      const bytes = bytesOf("delegated-copy-approval-scoped");
      const resolver = createCopyResolver(registry, { approvalPlan: bytes, now });
      expect(resolver({ id: "home.title" })).toBeDefined();
      bytes.fill(0);
      expect(resolver({ id: "home.title" })).toBeUndefined();
    });
  });
});
