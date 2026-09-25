import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundleDigest } from "./change-set-digest.js";
import { AUTHORIZATION_PLAN_MISMATCH, applyBundleViolations, validateApplyBundle } from "./change-set-contract.js";
import type { ApplyBundle, RepositoryChangeSet } from "./change-set-contract.js";

/*
 * Issue #1178. The apply-bundle contract, packed into this package, and its
 * code rules A1-A7: a report bundle claims no repository state, and a
 * planned bundle records a state and a binding only with the checks that
 * earn them. Reading repository files here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const corpus = JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] };
const byName = (name: string) => corpus.changeSets.find((entry) => entry.name === name)!.changeSet;
const SET = byName("apply-with-packages");
const SETUP = byName("setup-site");
const APPLY = byName("apply-after-setup");
type Loose = Record<string, any>;
const loose = (value: unknown): Loose => structuredClone(value) as Loose;
const rules = (value: unknown) => applyBundleViolations(value).map((violation) => `${violation.rule} ${violation.path}`);

const PLAN_DIGEST = SET.planDigest;
const BUNDLE: ApplyBundle = {
  schemaVersion: 1,
  kind: "clossys.apply-bundle",
  mode: "report",
  plan: { path: "clossys/advisor/plan.json", digest: PLAN_DIGEST, committed: true },
  snapshot: null,
  engine: SET.engine,
  authorization: null,
  computedAt: "2026-09-24T12:00:00Z",
  repositories: [
    { id: "example-owner/site", verdict: "satisfied", phase: "apply", changeSet: SET.changeSetDigest, checks: [{ check: "V6", verdict: "satisfied" }] },
    { id: "example-owner/docs", verdict: "indeterminate", reason: "not-in-inventory", checks: [] },
  ],
  bundleDigest: bundleDigest(PLAN_DIGEST, [{ id: "example-owner/site", changeSetDigest: SET.changeSetDigest }]),
};

const ALL_SATISFIED = (["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"] as const).map((check) => ({ check, verdict: "satisfied" as const }));
const ADMITTED = { kind: "admitted" as const, subjectDigest: SETUP.bundle, setupChangeSet: SETUP.changeSetDigest };

/** A planned bundle: the apply set that follows setup-site, admitted under setup-site's approval, and one repository still waiting for approval. */
const PLANNED: ApplyBundle = {
  ...BUNDLE,
  mode: "planned",
  authorization: { planDigest: PLAN_DIGEST, expiresAt: "2026-10-01T00:00:00Z" },
  repositories: [
    { id: "example-owner/site", verdict: "satisfied", phase: "apply", changeSet: APPLY.changeSetDigest, checks: ALL_SATISFIED, state: "planned", binding: ADMITTED },
    {
      id: "example-owner/docs",
      verdict: "indeterminate",
      phase: "setup",
      changeSet: SET.changeSetDigest,
      checks: [...ALL_SATISFIED.filter((check) => check.check !== "V3"), { check: "V3", verdict: "indeterminate", rule: "awaiting-approval" }].sort((a, b) =>
        a.check < b.check ? -1 : 1,
      ),
    },
  ],
  bundleDigest: bundleDigest(PLAN_DIGEST, [
    { id: "example-owner/site", changeSetDigest: APPLY.changeSetDigest },
    { id: "example-owner/docs", changeSetDigest: SET.changeSetDigest },
  ]),
};

describe("apply-bundle contract", () => {
  it("accepts a report-mode bundle with a computed and a skipped repository", () => {
    expect(validateApplyBundle(BUNDLE)).toEqual({ valid: true });
  });

  it("refuses an unknown mode, a state other than planned, and a skipped repository with a state or a verdict of satisfied", () => {
    const mode = loose(BUNDLE);
    mode.mode = "applied";
    expect(validateApplyBundle(mode).valid).toBe(false);
    const state = loose(PLANNED);
    state.repositories[0].state = "applied";
    expect(validateApplyBundle(state).valid).toBe(false);
    const skippedState = loose(BUNDLE);
    skippedState.repositories[1].state = "planned";
    expect(validateApplyBundle(skippedState).valid).toBe(false);
    const skipped = loose(BUNDLE);
    skipped.repositories[1].verdict = "satisfied";
    expect(validateApplyBundle(skipped).valid).toBe(false);
  });

  it("A1: refuses two entries for one repository, compared case-insensitively", () => {
    const bundle = loose(BUNDLE);
    bundle.repositories[1].id = "Example-Owner/Site";
    expect(rules(bundle)).toEqual(["A1 repositories[1].id"]);
  });

  it("A2: refuses a bundle digest that is not over the plan digest and the computed repositories", () => {
    const bundle = loose(BUNDLE);
    bundle.bundleDigest = bundleDigest(PLAN_DIGEST, []);
    expect(applyBundleViolations(bundle).map((violation) => violation.rule)).toEqual(["A2"]);
  });

  it("A3: refuses a verdict that is not the worst of its checks", () => {
    const bundle = loose(BUNDLE);
    bundle.repositories[0].checks = [{ check: "V6", verdict: "indeterminate", rule: "unowned-existing" }];
    expect(rules(bundle)).toEqual(["A3 repositories[0].verdict"]);
    const none = loose(BUNDLE);
    none.repositories[0] = { ...none.repositories[0], verdict: "violated", checks: [] };
    expect(applyBundleViolations(none).map((violation) => violation.rule)).toEqual(["A3"]);
  });

  it("A4: requires the mismatch check when the authorization is for another plan, and refuses it otherwise", () => {
    const mismatched = loose(BUNDLE);
    mismatched.authorization = { planDigest: SET.changeSetDigest, expiresAt: "2026-10-01T00:00:00Z" };
    expect(applyBundleViolations(mismatched).map((violation) => violation.rule)).toEqual(["A4"]);
    mismatched.repositories[0].checks = [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH }, { check: "V6", verdict: "satisfied" }];
    mismatched.repositories[0].verdict = "violated";
    expect(applyBundleViolations(mismatched)).toEqual([]);
    const spurious = loose(mismatched);
    spurious.authorization = { planDigest: PLAN_DIGEST, expiresAt: "2026-10-01T00:00:00Z" };
    expect(applyBundleViolations(spurious).map((violation) => violation.rule)).toEqual(["A4"]);
  });
});

describe("apply-bundle contract: report and planned modes (A5-A7)", () => {
  it("A5: a report bundle claims no state and records no binding", () => {
    const state = loose(BUNDLE);
    state.repositories[0].state = "planned";
    expect(rules(state)).toEqual(["A5 repositories[0].state"]);
    const binding = loose(BUNDLE);
    binding.repositories[0].binding = { kind: "approved", subjectDigest: BUNDLE.bundleDigest };
    expect(rules(binding)).toEqual(["A5 repositories[0].binding"]);
  });

  it("accepts a planned bundle: a satisfied, bound repository is planned, and one awaiting approval carries neither state nor binding", () => {
    expect(validateApplyBundle(PLANNED)).toEqual({ valid: true });
    const approved = loose(PLANNED);
    approved.repositories[0].binding = { kind: "approved", subjectDigest: SETUP.bundle };
    expect(validateApplyBundle(approved)).toEqual({ valid: true });
  });

  it("keeps state and binding out of the bundle digest, so recording them never moves what the approval binds", () => {
    const stripped = loose(PLANNED);
    for (const entry of stripped.repositories) {
      delete entry.state;
      delete entry.binding;
    }
    expect(bundleDigest(stripped.plan.digest, stripped.repositories.map((entry: Loose) => ({ id: entry.id, changeSetDigest: entry.changeSet })))).toBe(PLANNED.bundleDigest);
  });

  it("A6: requires a committed plan, a state exactly on a satisfied bound repository, and all nine checks satisfied under it", () => {
    const uncommitted = loose(PLANNED);
    uncommitted.plan.committed = false;
    expect(rules(uncommitted)).toEqual(["A6 plan.committed"]);
    const missing = loose(PLANNED);
    delete missing.repositories[0].state;
    expect(rules(missing)).toEqual(["A6 repositories[0]"]);
    const unearned = loose(PLANNED);
    unearned.repositories[0].checks = unearned.repositories[0].checks.filter((check: Loose) => check.check !== "V9");
    expect(rules(unearned)).toEqual(["A6 repositories[0].checks"]);
    const failing = loose(PLANNED);
    failing.repositories[0].checks = failing.repositories[0].checks.map((check: Loose) => (check.check === "V8" ? { check: "V8", verdict: "indeterminate", rule: "ledger-chain" } : check));
    failing.repositories[0].verdict = "indeterminate";
    expect(rules(failing)).toEqual(["A6 repositories[0].state", "A6 repositories[0].checks"]);
  });

  it("A7: records a binding exactly when V3 passed, admits only an apply set, and never admits a set as its own setup", () => {
    const unbound = loose(PLANNED);
    unbound.repositories[1].binding = { kind: "approved", subjectDigest: SETUP.bundle };
    expect(rules(unbound)).toEqual(["A7 repositories[1].binding"]);
    const silent = loose(PLANNED);
    delete silent.repositories[0].binding;
    delete silent.repositories[0].state;
    expect(rules(silent)).toEqual(["A7 repositories[0]"]);
    const setupAdmitted = loose(PLANNED);
    setupAdmitted.repositories[0].phase = "setup";
    expect(rules(setupAdmitted)).toEqual(["A7 repositories[0].binding"]);
    const self = loose(PLANNED);
    self.repositories[0].binding.setupChangeSet = APPLY.changeSetDigest;
    expect(rules(self)).toEqual(["A7 repositories[0].binding.setupChangeSet"]);
  });

  it("A7: refuses an admitted binding to this bundle's own digest, two approvals in one bundle, and a binding with no authorization", () => {
    const own = loose(PLANNED);
    own.repositories[0].binding.subjectDigest = own.bundleDigest;
    expect(rules(own)).toEqual(["A7 repositories[0].binding.subjectDigest"]);
    const two = loose(PLANNED);
    two.repositories[1] = { ...two.repositories[1], verdict: "satisfied", checks: ALL_SATISFIED, state: "planned", binding: { kind: "approved", subjectDigest: SET.changeSetDigest } };
    expect(rules(two)).toEqual(["A7 repositories[1].binding.subjectDigest"]);
    two.repositories[1].binding.subjectDigest = SETUP.bundle;
    expect(rules(two)).toEqual([]);
    const unauthorized = loose(PLANNED);
    unauthorized.authorization = null;
    expect(rules(unauthorized)).toEqual(["A7 authorization"]);
    const waiting = loose(PLANNED);
    waiting.authorization = null;
    waiting.repositories = [waiting.repositories[1]];
    waiting.bundleDigest = bundleDigest(PLAN_DIGEST, [{ id: "example-owner/docs", changeSetDigest: SET.changeSetDigest }]);
    expect(rules(waiting)).toEqual([]);
  });

  it("refuses a binding of the wrong shape: an admitted binding with no setup set, or an unknown kind", () => {
    const shape = loose(PLANNED);
    delete shape.repositories[0].binding.setupChangeSet;
    expect(validateApplyBundle(shape).valid).toBe(false);
    const kind = loose(PLANNED);
    kind.repositories[0].binding.kind = "assumed";
    expect(validateApplyBundle(kind).valid).toBe(false);
  });
});
