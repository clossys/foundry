import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReadinessRunner } from "./admission.js";
import {
  DOCS_ID,
  LATER_AT,
  SITE_ID,
  buildWorld,
  bundleOf,
  clone,
  corpusSet,
  decide,
  hubRepo,
  mutateSet,
  siteRepo,
} from "./admission-fixture.js";
import type { Loose, World } from "./admission-fixture.js";
import { AUTHORIZATION_ABSENT, AUTHORIZATION_PLAN_MISMATCH, LEDGER_PATH, validateApplyBundle, worstVerdict } from "./change-set-contract.js";
import type { ApplyBundle, ApplyBundleRepository, ApplyCheck, RepositoryChangeSet } from "./change-set-contract.js";
import { derivedLockfile } from "./materialize.js";
import type { PlanApplyBundleResult } from "./plan-bundle.js";
import { plannedBundle } from "./planned-bundle.js";

/*
 * Issue #1708 (RFC apply-approved-plan section 7). plannedBundle turns a report
 * result into a planned one only from the hub's committed, approved plan, only
 * through decideSetBinding, and never changes a digest or a set. Every case
 * builds a real hub and a real clone, so each carries its own timeout.
 */
const TIMEOUT_MS = 60_000;
const NOW = () => new Date("2026-10-01T00:00:00Z");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const satisfied = (check: string): ApplyCheck => ({ check, verdict: "satisfied" }) as ApplyCheck;
const ids = (checks: readonly ApplyCheck[]) => checks.map((check) => `${check.check}:${check.verdict}${check.rule === undefined ? "" : `:${check.rule}`}`);

interface Scene {
  readonly w: World;
  readonly hub: string;
  readonly clone: string;
}

function scene(tree?: (tree: World["tree"]) => void, hubOptions: Partial<Parameters<typeof hubRepo>[1]> = {}): Scene {
  let site: ReturnType<typeof siteRepo> | undefined;
  const w = buildWorld({
    commitBase: (base) => {
      tree?.(base);
      site = siteRepo(roots, base);
      return site.baseCommit;
    },
  });
  const fixture = hubRepo(roots, { plans: [w.plan], sets: [w.setup], bundles: [w.approvedBundle, w.applyBundle], ...hubOptions });
  return { w, hub: fixture.hub, clone: site!.clone };
}

/** A report result over `sets`, each computed repository carrying `checks` (default: V6 and V8 satisfied, as the planner and the dry tree leave them). */
function reportOf(s: Scene, sets: readonly { set: RepositoryChangeSet; checks?: readonly ApplyCheck[] }[], patch: Partial<ApplyBundle> = {}): PlanApplyBundleResult {
  const base = bundleOf(s.w.plan, sets.map(({ set }) => ({ id: set.repository.id, set })), { computedAt: "2026-09-26T12:00:00Z" });
  const repositories = base.repositories.map((entry, index): ApplyBundleRepository => {
    const checks = sets[index]!.checks ?? [satisfied("V6"), satisfied("V8")];
    return { ...(entry as Extract<ApplyBundleRepository, { changeSet: string }>), checks, verdict: worstVerdict(checks.map((check) => check.verdict)) };
  });
  const bundle: ApplyBundle = { ...base, repositories, ...patch };
  // A patched bundle is a deliberate variant (an uncommitted or foreign plan); only the unpatched one must be valid.
  if (Object.keys(patch).length === 0) expect(validateApplyBundle(bundle)).toMatchObject({ valid: true });
  return { bundle, changeSets: sets.map(({ set }) => set) };
}

function options(s: Scene, extra: { runReadiness?: ReadinessRunner; heldChangeSets?: readonly RepositoryChangeSet[] } = {}) {
  return { hub: s.hub, cloneFor: () => s.clone, heldChangeSets: extra.heldChangeSets ?? [s.w.setup], now: NOW, runReadiness: extra.runReadiness };
}

/** A readiness runner that answers `status` and records every request. */
const runner = (status: number | null, calls: unknown[] = []): ReadinessRunner => {
  return (request) => {
    calls.push(request);
    return { status };
  };
};

const entryOf = (result: PlanApplyBundleResult, id: string) => {
  const entry = result.bundle.repositories.find((candidate) => candidate.id === id);
  if (entry === undefined || !("changeSet" in entry)) throw new Error("expected a computed repository");
  return entry;
};

describe("plannedBundle", () => {
  it(
    "binds an admitted apply set, adds V1 V2 V4 V5 V7, keeps the dry tree's checks, and moves no digest or set",
    async () => {
      const s = scene();
      const calls: unknown[] = [];
      const input = reportOf(s, [{ set: s.w.apply, checks: [satisfied("V6"), satisfied("V9"), satisfied("V8")] }]);
      const before = JSON.stringify(input);
      const result = await plannedBundle(input, options(s, { runReadiness: runner(0, calls) }));

      expect(JSON.stringify(input)).toBe(before);
      expect(result.bundle.mode).toBe("planned");
      expect(result.bundle.bundleDigest).toBe(input.bundle.bundleDigest);
      expect(result.bundle.plan).toEqual(input.bundle.plan);
      expect(result.bundle.authorization).toEqual(input.bundle.authorization);
      expect(result.bundle.computedAt).toBe(input.bundle.computedAt);
      expect(result.changeSets).toEqual(input.changeSets);
      const entry = entryOf(result, SITE_ID);
      expect(entry.changeSet).toBe(s.w.apply.changeSetDigest);
      expect(entry.state).toBe("planned");
      expect(entry.verdict).toBe("satisfied");
      expect(entry.binding).toEqual({ kind: "admitted", subjectDigest: s.w.authority.subject, setupChangeSet: s.w.setup.changeSetDigest });
      // One check for each of V1 to V9, in the canonical order, and the readiness of the set's package acts ran once.
      expect(ids(entry.checks)).toEqual(["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"].map((id) => `${id}:satisfied`));
      expect(calls).toHaveLength(1);
      expect(validateApplyBundle(result.bundle)).toMatchObject({ valid: true });
    },
    TIMEOUT_MS,
  );

  it(
    "returns the result as it is unless the plan is committed and the hub's committed plan is approved for this plan digest",
    async () => {
      const calls: unknown[] = [];
      const s = scene();
      const report = reportOf(s, [{ set: s.w.apply }]);

      // The bundle says the plan is not the committed one.
      const uncommitted = reportOf(s, [{ set: s.w.apply }], { plan: { ...report.bundle.plan, committed: false } });
      expect(await plannedBundle(uncommitted, options(s, { runReadiness: runner(0, calls) }))).toBe(uncommitted);

      // The hub's committed plan carries no approval.
      const unapproved = scene();
      const plain = clone(unapproved.w.plan) as unknown as Loose;
      plain.decisions = [];
      const bare = hubRepo(roots, { plans: [plain as never], sets: [], bundles: [] });
      const noApproval = reportOf(unapproved, [{ set: unapproved.w.apply }]);
      expect(await plannedBundle(noApproval, { ...options(unapproved, { runReadiness: runner(0, calls) }), hub: bare.hub })).toBe(noApproval);

      // The approval names a bundle the hub does not hold: it approves nothing this run could be bound by.
      const empty = hubRepo(roots, { plans: [s.w.plan], sets: [], bundles: [] });
      const nothing = reportOf(s, [{ set: s.w.apply }]);
      expect(await plannedBundle(nothing, { ...options(s, { runReadiness: runner(0, calls) }), hub: empty.hub })).toBe(nothing);

      // The approval is for another plan: the digest the hub's plan has is not this bundle's.
      const other = reportOf(s, [{ set: s.w.apply }], { plan: { ...report.bundle.plan, digest: `sha256:${"1".repeat(64)}` } });
      expect(await plannedBundle(other, options(s, { runReadiness: runner(0, calls) }))).toBe(other);

      // The hub's HEAD is detached: the committed plan is not read there, even though it holds the approval.
      const detached = scene(undefined, { detachAt: 0 });
      const attachedOnly = reportOf(detached, [{ set: detached.w.apply }]);
      expect(await plannedBundle(attachedOnly, options(detached, { runReadiness: runner(0, calls) }))).toBe(attachedOnly);
      expect(calls).toHaveLength(0);
    },
    TIMEOUT_MS,
  );

  it(
    "a refused or A4 repository has no binding",
    async () => {
      const s = scene();
      const calls: unknown[] = [];

      // Readiness exits 1: the authorization is not current, so V3 is violated, with the fixed token and no binding.
      const violated = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: runner(1, calls) }));
      let entry = entryOf(violated, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "violated", rule: "readiness-violated" }]);
      expect(entry.verdict).toBe("violated");
      expect(entry).not.toHaveProperty("binding");
      expect(entry).not.toHaveProperty("state");
      expect(violated.bundle.mode).toBe("planned");
      expect(validateApplyBundle(violated.bundle)).toMatchObject({ valid: true });
      expect(calls).toHaveLength(1);

      // A setup set the approved bundle does not hold is not a member: indeterminate, not violated.
      const outsider = mutateSet(s.w.setup, (set) => void (set.producer.version = "9.9.9"));
      expect(outsider.changeSetDigest).not.toBe(s.w.setup.changeSetDigest);
      const unlisted = await plannedBundle(reportOf(s, [{ set: outsider }]), options(s, { runReadiness: runner(0, calls) }));
      entry = entryOf(unlisted, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "indeterminate", rule: "not-member" }]);
      expect(entry.verdict).toBe("indeterminate");
      expect(entry).not.toHaveProperty("binding");
      expect(entry).not.toHaveProperty("state");

      // A4: an authorization for another plan is already a violated V3 on every computed repository. No readiness runs, and nothing is bound.
      const flagged = reportOf(s, [{ set: s.w.apply, checks: [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH }, satisfied("V6"), satisfied("V8")] }], {
        authorization: { planDigest: `sha256:${"2".repeat(64)}`, expiresAt: "2999-01-01T00:00:00Z" },
      });
      const before = calls.length;
      const mismatched = await plannedBundle(flagged, options(s, { runReadiness: runner(0, calls) }));
      expect(calls).toHaveLength(before);
      entry = entryOf(mismatched, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH }]);
      expect(entry).not.toHaveProperty("binding");
      expect(entry).not.toHaveProperty("state");
      expect(validateApplyBundle(mismatched.bundle)).toMatchObject({ valid: true });

      // The same for an authorization that is absent.
      const absent = reportOf(s, [{ set: s.w.apply, checks: [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_ABSENT }, satisfied("V6"), satisfied("V8")] }], { authorization: null });
      const again = calls.length;
      const missing = await plannedBundle(absent, options(s, { runReadiness: runner(0, calls) }));
      expect(calls).toHaveLength(again);
      expect(entryOf(missing, SITE_ID)).not.toHaveProperty("binding");
      expect(entryOf(missing, SITE_ID).checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "violated", rule: AUTHORIZATION_ABSENT }]);
    },
    TIMEOUT_MS,
  );

  it(
    "a refusal never reports the authorization mismatch or absence of the bundle: the fixed reserved tokens are kept for the bundle's own condition",
    async () => {
      // The hub's assessment carries no execution authorization: the readiness step refuses with `authorization-absent`, which is also the planner's
      // A4 token for a bundle with no authorization. This bundle has one, so that token would be a false claim (rule A4): it is reported as not current.
      const s = scene(undefined, { assessment: { engagement: {} } });
      const result = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: runner(0) }));
      const entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "violated", rule: "authorization-not-current" }]);
      expect(entry).not.toHaveProperty("binding");
      expect(validateApplyBundle(result.bundle)).toMatchObject({ valid: true });
    },
    TIMEOUT_MS,
  );

  it(
    "a bound set with V9 indeterminate is not planned",
    async () => {
      const s = scene();
      const input = reportOf(s, [{ set: s.w.apply, checks: [satisfied("V6"), { check: "V9", verdict: "indeterminate", rule: "engine-missing-bin" }, satisfied("V8")] }]);
      const result = await plannedBundle(input, options(s, { runReadiness: runner(0) }));
      expect(result.bundle.mode).toBe("planned");
      const entry = entryOf(result, SITE_ID);
      // The binding is recorded, the state is not: V9 is exactly the one the dry tree left, and no other V9 was added to a set that changes a lockfile.
      expect(entry.binding).toEqual({ kind: "admitted", subjectDigest: s.w.authority.subject, setupChangeSet: s.w.setup.changeSetDigest });
      expect(entry).not.toHaveProperty("state");
      expect(entry.verdict).toBe("indeterminate");
      expect(entry.checks.filter((check) => check.check === "V9")).toEqual([{ check: "V9", verdict: "indeterminate", rule: "engine-missing-bin" }]);
      expect(ids(entry.checks)).toEqual(["V1:satisfied", "V2:satisfied", "V3:satisfied", "V4:satisfied", "V5:satisfied", "V6:satisfied", "V7:satisfied", "V8:satisfied", "V9:indeterminate:engine-missing-bin"]);
      expect(validateApplyBundle(result.bundle)).toMatchObject({ valid: true });
    },
    TIMEOUT_MS,
  );

  it(
    "V9 is satisfied only for a set that changes no lockfile",
    async () => {
      const s = scene();
      const plain = mutateSet(corpusSet("staffing-only") as unknown as RepositoryChangeSet, (set) => void (set.repository.id = DOCS_ID));
      expect(derivedLockfile(plain)).toBeNull();
      expect(derivedLockfile(s.w.apply)).not.toBeNull();
      // The SITE set carries no V9 of its own (the dry tree ran none for it): planned mode must not add a satisfied V9 to a set that changes a lockfile.
      const input = reportOf(s, [{ set: s.w.apply }, { set: plain }]);
      const result = await plannedBundle(input, options(s, { runReadiness: runner(0) }));
      const site = entryOf(result, SITE_ID);
      expect(site.checks.filter((check) => check.check === "V9")).toEqual([{ check: "V9", verdict: "indeterminate", rule: "provenance-not-run" }]);
      expect(site).not.toHaveProperty("state");
      // The other set is refused (its base is not in this clone), yet it still has its own V9 and the four the planner never reports.
      const docs = entryOf(result, DOCS_ID);
      expect(docs.checks.filter((check) => check.check === "V9")).toEqual([satisfied("V9")]);
      for (const id of ["V1", "V2", "V4", "V5", "V7"]) expect(docs.checks.filter((check) => check.check === id)).toEqual([satisfied(id)]);
      expect(docs).not.toHaveProperty("binding");
      expect(docs).not.toHaveProperty("state");
    },
    TIMEOUT_MS,
  );

  it(
    "the base ledger is trusted before it counts: a ledger that is missing for a later generation is ledger-mismatch, and one that is unreadable is ledger-unreadable, with no binding",
    async () => {
      const gone = scene((tree) => void tree.delete(LEDGER_PATH));
      let result = await plannedBundle(reportOf(gone, [{ set: gone.w.apply }]), options(gone, { runReadiness: runner(0) }));
      let entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "violated", rule: "ledger-mismatch" }]);
      expect(entry).not.toHaveProperty("binding");

      const garbage = scene((tree) => void tree.set(LEDGER_PATH, { mode: "100644", bytes: Buffer.from("not a ledger\n") }));
      result = await plannedBundle(reportOf(garbage, [{ set: garbage.w.apply }]), options(garbage, { runReadiness: runner(0) }));
      entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "indeterminate", rule: "ledger-unreadable" }]);
      expect(entry).not.toHaveProperty("binding");

      // The change sets the hub holds are what vouch for the ledger's history: with none held, the ledger is not trusted.
      const s = scene();
      result = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: runner(0), heldChangeSets: [] }));
      entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "indeterminate", rule: "ledger-chain" }]);
      expect(entry).not.toHaveProperty("binding");
    },
    TIMEOUT_MS,
  );

  it(
    "an executable base ledger is ledger-unreadable with no binding",
    async () => {
      // The base commit holds the ledger as mode 100755: not one regular, non-executable blob, so it cannot be read as a ledger.
      const s = scene((tree) => void tree.set(LEDGER_PATH, { ...tree.get(LEDGER_PATH)!, mode: "100755" }));
      let readinessCalls = 0;
      const result = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: () => { readinessCalls += 1; return { status: 0 }; } }));
      const entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([{ check: "V3", verdict: "indeterminate", rule: "ledger-unreadable" }]);
      expect(entry).not.toHaveProperty("binding");
      expect(entry).not.toHaveProperty("state");
      expect(readinessCalls).toBe(0);
    },
    TIMEOUT_MS,
  );

  it(
    "the base ledger is read from the clone the run names, whatever repository the environment points git at",
    async () => {
      const s = scene();
      const saved = { dir: process.env.GIT_DIR, objects: process.env.GIT_OBJECT_DIRECTORY };
      // A hostile environment: git's own location variables name the hub's repository, which holds no base commit of the clone.
      process.env.GIT_DIR = join(s.hub, ".git");
      process.env.GIT_OBJECT_DIRECTORY = join(s.hub, ".git", "objects");
      let result: PlanApplyBundleResult;
      try {
        result = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: runner(0) }));
      } finally {
        for (const [name, value] of [["GIT_DIR", saved.dir], ["GIT_OBJECT_DIRECTORY", saved.objects]] as const) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
      const entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([satisfied("V3")]);
      expect(entry).toHaveProperty("binding");
    },
    TIMEOUT_MS,
  );

  it(
    "a replace ref in the clone does not change the base ledger that is read",
    async () => {
      const s = scene();
      const git = (...args: string[]): string => execFileSync("git", args, { cwd: s.clone, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], input: "not a ledger\n" }).trim();
      const real = git("rev-parse", `${s.w.apply.repository.baseCommit}:${LEDGER_PATH}`);
      const decoy = git("hash-object", "-w", "--stdin");
      git("replace", real, decoy);
      // The replacement shows through a plain `git cat-file`, so the fixture is a real one.
      expect(git("cat-file", "blob", real)).toBe("not a ledger");
      const result = await plannedBundle(reportOf(s, [{ set: s.w.apply }]), options(s, { runReadiness: runner(0) }));
      const entry = entryOf(result, SITE_ID);
      expect(entry.checks.filter((check) => check.check === "V3")).toEqual([satisfied("V3")]);
      expect(entry).toHaveProperty("binding");
    },
    TIMEOUT_MS,
  );

  it(
    "a plan whose approval was superseded by a later rejection is not planned",
    async () => {
      const s = scene();
      const rejected = decide(s.w.plan, "rejected", LATER_AT);
      const hub = hubRepo(roots, { plans: [s.w.plan, rejected], sets: [s.w.setup], bundles: [s.w.approvedBundle, s.w.applyBundle] });
      const input = reportOf(s, [{ set: s.w.apply }]);
      expect(await plannedBundle(input, { ...options(s, { runReadiness: runner(0) }), hub: hub.hub })).toBe(input);
    },
    TIMEOUT_MS,
  );
});
