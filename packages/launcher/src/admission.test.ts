import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideBinding, decideSetBinding, planPackagesFor, readHubAuthority, verifyAdmittedSuccession, checkSuccession } from "./admission.js";
import type { AdmissionRefusal, DecideBindingInput, ReadinessRunner } from "./admission.js";
import { approvedSubject } from "./apply-plan.js";
import { LEDGER_PATH, contentDigest, dependencyPointer, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { readInstalledLedger, renderInstalledLedger } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import type { AdvisorPlan } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import {
  ASSESSMENT_FILE,
  DOCS_ID,
  FIRST_AT,
  LATER_AT,
  READINESS_BIN,
  SITE_ID,
  STARTER,
  STRATEGIST,
  WRITER,
  advanceHubUpstream,
  approvedPlan,
  assessmentFor,
  authorityOf,
  buildWorld,
  bundleOf,
  clone,
  commitHubAssessment,
  committedPlanPackages,
  decide,
  decision,
  editLedger,
  git,
  hubRepo,
  lockfileText,
  memoryReaders,
  mutateSet,
  setupLedgerBytes,
  siteRepo,
  withDecisions,
} from "./admission-fixture.js";
import type { HubOptions, Loose, World, WorldOptions } from "./admission-fixture.js";

/*
 * Issue #1178. The hub decides a change set's ApprovalBinding from the hub
 * alone: the committed plan, the stored bundles and sets, the base ledger and
 * the base tree. Every ambiguity refuses. Rows are named for the refusal
 * matrix (P, M, C2, C3 and H); the pure core is tested over in-memory readers,
 * and the parts that need real git use a temporary hub and clone.
 */

// Each git-backed case builds a hub and a clone; a slow machine needs more than the default.
vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const aa = (detail: string): AdmissionRefusal => ({ state: "refused", exitCode: 2, reason: "awaiting-approval", detail });
const admitted = (w: World) => ({ state: "bound", binding: { kind: "admitted", subjectDigest: w.authority.subject, setupChangeSet: w.setup.changeSetDigest } });
const approved = (subject: string) => ({ state: "bound", binding: { kind: "approved", subjectDigest: subject } });

/** The pure core over a world's own readers, with any input replaced. */
function run(w: World, patch: Partial<DecideBindingInput> = {}, state: { bundles?: World["approvedBundle"][]; sets?: RepositoryChangeSet[]; tree?: World["tree"] } = {}) {
  return decideBinding({
    set: w.apply,
    authority: w.authority,
    baseLedger: w.ledger,
    baseLedgerBytes: w.ledgerBytes,
    readers: memoryReaders({ bundles: state.bundles ?? [w.approvedBundle, w.applyBundle], sets: state.sets ?? [w.setup], tree: state.tree ?? w.tree }),
    ...patch,
  });
}

const world = (options: WorldOptions = {}) => buildWorld(options);

// ---- edits of an apply set: each keeps the set valid (C1 to C17), so it reaches the checks under test ----

const sortBy = <T>(values: T[], key: (value: T) => string) => values.sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));
const item = (set: Loose, id: string) => (set.items as Loose[]).find((entry) => entry.id === id)!;
const lockfile = (set: Loose) => (set.files as Loose[]).find((file) => file.derived === true && file.path !== LEDGER_PATH)!;
const nameOf = (planItem: string) => planItem.slice(planItem.indexOf(":") + 1);

/** Puts items, files, keys and invariants back in canonical order and re-ties the lockfile's item to its first invariant (C8, C9). */
function normalize(set: Loose): void {
  sortBy(set.items, (entry: Loose) => entry.id);
  sortBy(set.files, (file: Loose) => file.path);
  sortBy(set.keys, (key: Loose) => `${key.file}\u0000${key.pointer}`);
  sortBy(set.pathAllowList, (pattern: string) => pattern);
  const lock = lockfile(set);
  if (lock !== undefined) {
    sortBy(lock.invariants, (invariant: Loose) => invariant.name ?? "");
    if (lock.invariants.length > 0) lock.item = lock.invariants[0].item;
  }
}

function dropInstall(set: Loose, planItem: string): void {
  set.items = (set.items as Loose[]).filter((entry) => entry.id !== planItem);
  set.keys = (set.keys as Loose[]).filter((key) => key.item !== planItem);
  const lock = lockfile(set);
  lock.invariants = (lock.invariants as Loose[]).filter((invariant) => invariant.item !== planItem);
  normalize(set);
}

function addInstall(set: Loose, name: string, version: string, integrity: string, placement = "devDependencies"): string {
  const planItem = `${SITE_ID}:${name}`;
  set.items.push({ id: planItem, act: "install", planItem, package: { name, version, integrity }, placement, satisfiedInBase: false });
  set.keys.push({ file: "package.json", pointer: dependencyPointer(placement as "devDependencies", name), before: null, after: version, item: planItem });
  lockfile(set).invariants.push({ item: planItem, name, version, integrity });
  normalize(set);
  return planItem;
}

/** Changes what an install carries, keeping its key and invariant tied to it (C9). */
function retarget(set: Loose, planItem: string, patch: { version?: string; integrity?: string; placement?: string }): void {
  const target = item(set, planItem);
  if (patch.version !== undefined) target.package.version = patch.version;
  if (patch.integrity !== undefined) target.package.integrity = patch.integrity;
  if (patch.placement !== undefined) target.placement = patch.placement;
  for (const key of set.keys as Loose[]) {
    if (key.item !== planItem) continue;
    key.pointer = dependencyPointer(target.placement, target.package.name);
    key.after = target.package.version;
  }
  for (const invariant of lockfile(set).invariants as Loose[]) {
    if (invariant.item !== planItem) continue;
    invariant.version = target.package.version;
    invariant.integrity = target.package.integrity;
  }
  normalize(set);
}

const OTHER_INTEGRITY = `sha512-${"A".repeat(86)}==`;
const wholeFile = (set: Loose, path: string) => (set.files as Loose[]).find((file) => file.path === path)!;

/** The pin: a key and an invariant for it, so it is not satisfied in the base. */
function unsatisfyPin(set: Loose): void {
  const pin = item(set, STARTER);
  pin.satisfiedInBase = false;
  set.keys.push({ file: "package.json", pointer: dependencyPointer("devDependencies", pin.package.name), before: null, after: pin.package.version, item: STARTER });
  lockfile(set).invariants.push({ item: STARTER, name: pin.package.name, version: pin.package.version, integrity: pin.package.integrity });
  normalize(set);
}

// ---------------------------------------------------------------------------

describe("the baseline pair P", () => {
  it("is admitted: the unchanged setup and apply pair, with the exact binding", () => {
    const w = world();
    expect(w.apply.phase).toBe("apply");
    expect(w.setup.phase).toBe("setup");
    expect(validateRepositoryChangeSet(w.apply)).toEqual({ valid: true });
    expect(validateRepositoryChangeSet(w.setup)).toEqual({ valid: true });
    expect(run(w)).toEqual(admitted(w));
    // The subject is the approved bundle, not the apply set's own run.
    expect(w.authority.subject).toBe(w.approvedBundle.bundleDigest);
    expect(w.apply.bundle).not.toBe(w.approvedBundle.bundleDigest);
  });

  it("holds in the fixture what the trust check and RENDER need: the setup ledger is trusted, and the apply set renders one admitted generation over it", () => {
    const w = world();
    const acts = [{ planDigest: w.planDigest, packages: committedPlanPackages(w.plan, SITE_ID) }];
    expect(trustInstalledLedger(w.ledgerBytes, { id: SITE_ID, nodeId: "R_exampleSite1" }, [w.setup], { planPackageActs: acts })).toEqual({ state: "trusted", ledger: w.ledger });
    expect(w.ledger.history.map((entry) => [entry.phase, entry.binding.kind])).toEqual([["setup", "approved"]]);
  });

  it("returns a plain result: nothing in it names a path, digest or id but the binding", () => {
    const w = world();
    const refused = run(w, {}, { sets: [] });
    expect(refused).toEqual(aa("setup-unstored"));
    expect(JSON.stringify(refused)).not.toMatch(/sha256|example-owner|\//u);
  });

  it("does not mutate the set, the ledger or the authority it was given", () => {
    const w = world();
    const before = JSON.stringify([w.apply, w.ledger, w.authority]);
    run(w);
    expect(JSON.stringify([w.apply, w.ledger, w.authority])).toBe(before);
  });
});

describe("membership: approved (K4)", () => {
  it("M-02: a setup set that is a member of the approved bundle is approved, with the bundle's digest as its subject", () => {
    const w = world();
    expect(run(w, { set: w.setup })).toEqual(approved(w.approvedBundle.bundleDigest));
  });

  it("M-01 and P-06: an apply set added to the approved bundle is approved by membership, not admitted, even though it would also have been admitted", () => {
    const w = world();
    const reapproved = authorityOf(decide(w.plan, "approved", LATER_AT, w.applyBundle.bundleDigest));
    expect(run(w, { authority: reapproved })).toEqual(approved(w.applyBundle.bundleDigest));
  });

  it("uses only (id, changeSet): the rest of a bundle entry can say anything (P-17)", () => {
    const w = world();
    const edited = clone(w.approvedBundle) as unknown as Loose;
    edited.repositories[0].phase = "apply";
    edited.repositories[0].verdict = "violated";
    edited.repositories[0].state = "planned";
    edited.repositories[0].binding = { kind: "approved", subjectDigest: `sha256:${"1".repeat(64)}` };
    edited.mode = "planned";
    edited.authorization = null;
    edited.computedAt = "2001-01-01T00:00:00Z";
    expect(run(w, {}, { bundles: [edited as never, w.applyBundle] })).toEqual(admitted(w));
    expect(run(w, { set: w.setup }, { bundles: [edited as never, w.applyBundle] })).toEqual(approved(w.approvedBundle.bundleDigest));
  });

  it("M-03: a setup set that is not a member is not-member", () => {
    const w = world();
    const other = mutateSet(w.setup, (set) => {
      set.producer.version = "0.4.1";
    });
    expect(run(w, { set: other })).toEqual(aa("not-member"));
  });

  it("M-04: a bundle that lists the digest under an id differing only in case does not make it a member", () => {
    const w = world();
    const caseVariant = bundleOf(withDecisions(w.plan, []), [{ id: "Example-Owner/Site", set: w.setup }]);
    const reapproved = authorityOf(decide(w.plan, "approved", LATER_AT, caseVariant.bundleDigest));
    expect(run(w, { set: w.setup, authority: reapproved }, { bundles: [caseVariant, w.applyBundle] })).toEqual(aa("not-member"));
    // The apply set continues to the setup check, which reads the setup set's membership by exact id too.
    const ledger = setupLedgerBytes(w.setup, caseVariant.bundleDigest, w.plan);
    expect(run(w, { authority: reapproved, baseLedger: readInstalledLedger(ledger), baseLedgerBytes: ledger }, { bundles: [caseVariant, w.applyBundle] })).toEqual(aa("setup-not-member"));
  });

  it("M-05 and P-20: a set whose plan digest is not the plan's is refused before membership, even in a hand-built bundle that lists it", () => {
    const w = world({
      editApply: (set) => {
        set.planDigest = `sha256:${"e".repeat(64)}`;
      },
    });
    const listing = bundleOf(w.plan, [{ id: SITE_ID, set: w.apply }]);
    const reapproved = authorityOf(decide(w.plan, "approved", LATER_AT, listing.bundleDigest));
    expect(run(w, { authority: reapproved }, { bundles: [listing] })).toEqual(aa("plan-digest-mismatch"));
    expect(run(w)).toEqual(aa("plan-digest-mismatch"));
  });

  it("P-18: a stored bundle for another plan digest is bundle-plan-mismatch", () => {
    const w = world();
    const foreign = bundleOf(w.plan, [{ id: SITE_ID, set: w.setup }], { planDigest: `sha256:${"9".repeat(64)}` });
    const reapproved = authorityOf(decide(w.plan, "approved", LATER_AT, foreign.bundleDigest));
    expect(run(w, { authority: reapproved }, { bundles: [foreign, w.applyBundle] })).toEqual(aa("bundle-plan-mismatch"));
  });

  it("P-16: an approved bundle the hub does not hold is bundle-unreadable; so is one stored under another digest", () => {
    const w = world();
    expect(run(w, {}, { bundles: [w.applyBundle] })).toEqual(aa("bundle-unreadable"));
    const wrongName = { ...(clone(w.approvedBundle) as unknown as Loose), bundleDigest: `sha256:${"7".repeat(64)}` };
    expect(run(w, {}, { bundles: [wrongName as never, w.applyBundle] })).toEqual(aa("bundle-unreadable"));
  });

  it("P-19: a digest-covered change to the plan, re-approved over a bundle of the new digest, leaves the old sets on the old digest", () => {
    const w = world();
    const changed = clone(w.plan) as unknown as Loose;
    changed.mandate.problem = "Our site still does not explain what we do.";
    const bundle = bundleOf(changed as never, [{ id: SITE_ID, set: w.setup }]);
    const authority = authorityOf(approvedPlan(bundle.bundleDigest, changed as never));
    expect(authority.planDigest).not.toBe(w.planDigest);
    expect(run(w, { authority }, { bundles: [bundle, w.applyBundle] })).toEqual(aa("plan-digest-mismatch"));
  });

  it("P-05: re-approving the same subject at a later time changes nothing", () => {
    const w = world();
    const again = authorityOf(decide(w.plan, "approved", LATER_AT, w.approvedBundle.bundleDigest));
    expect(run(w, { authority: again })).toEqual(admitted(w));
  });

  it("P-07: a re-approval of a bundle that holds the setup set but not the apply set leaves the ledger's subject behind", () => {
    const w = world();
    const second = bundleOf(w.plan, [{ id: SITE_ID, set: w.setup }, { id: DOCS_ID, changeSet: `sha256:${"5".repeat(64)}`, phase: "apply" }]);
    const reapproved = authorityOf(decide(w.plan, "approved", LATER_AT, second.bundleDigest));
    expect(run(w, { authority: reapproved }, { bundles: [w.approvedBundle, second, w.applyBundle] })).toEqual(aa("setup-subject-mismatch"));
  });

  it("refuses a bundle whose own digest is not the subject it was read under", () => {
    const w = world();
    const other = { ...(clone(w.approvedBundle) as unknown as Loose) };
    const reader = memoryReaders({ bundles: [w.applyBundle], sets: [w.setup], tree: w.tree });
    const readers = { ...reader, bundle: (digest: string) => (digest === w.authority.subject ? (other as never) : reader.bundle(digest)) };
    // Same bytes under the right name pass; a different digest inside them does not.
    expect(run(w, { readers })).toEqual(admitted(w));
    other.bundleDigest = `sha256:${"3".repeat(64)}`;
    expect(run(w, { readers })).toEqual(aa("bundle-unreadable"));
  });

  it("refuses a reader that throws as unreadable, never as a crash", () => {
    const w = world();
    const readers = memoryReaders({ bundles: [w.approvedBundle, w.applyBundle], sets: [w.setup], tree: w.tree });
    expect(run(w, { readers: { ...readers, bundle: () => { throw new TypeError("a store segment is a symbolic link"); } } })).toEqual(aa("bundle-unreadable"));
    expect(run(w, { readers: { ...readers, setupSet: () => { throw new TypeError("nope"); } } })).toEqual(aa("setup-unstored"));
    expect(run(w, { readers: { ...readers, baseEntry: () => { throw new Error("nope"); } } })).toEqual(aa("base-unreadable"));
  });
});

describe("the change set itself", () => {
  it("refuses a set that does not validate, or whose digest does not recompute, as change-set-invalid", () => {
    const invalid = world({
      editApply: (set) => {
        set.deferred = [{ planItem: WRITER, reason: "after-setup" }];
      },
    });
    expect(validateRepositoryChangeSet(invalid.apply).valid).toBe(false);
    expect(run(invalid)).toEqual({ state: "refused", exitCode: 2, reason: "change-set-invalid" });
    const w = world();
    const edited = { ...clone(w.apply), producer: { name: "@example/launcher", version: "9.9.9" } } as RepositoryChangeSet;
    expect(run(w, { set: edited })).toEqual({ state: "refused", exitCode: 2, reason: "change-set-invalid" });
  });
});

describe("condition 2: the apply set is the setup set's, and nothing else (K8)", () => {
  const rows: [string, WorldOptions, string][] = [
    ["C2-01 an install the setup did not defer", { editApply: (a) => void addInstall(a, "@example/extra", "1.0.0", OTHER_INTEGRITY) }, "package-acts-differ"],
    ["C2-02 a deferred install dropped", { editApply: (a) => dropInstall(a, WRITER) }, "package-acts-differ"],
    ["C2-03 the pin dropped", { editApply: (a) => a.items.splice(a.items.findIndex((entry: Loose) => entry.id === STARTER), 1) }, "package-acts-differ"],
    [
      "C2-06 a deferred planItem carried as the pin, with the setup's pin removed",
      {
        editApply: (a) => {
          a.items.splice(a.items.findIndex((entry: Loose) => entry.id === STARTER), 1);
          item(a, STRATEGIST).act = "pin-starter";
        },
      },
      "package-acts-differ",
    ],
    ["C2-07 a deferred install's version", { editApply: (a) => retarget(a, STRATEGIST, { version: "1.4.1" }) }, "package-acts-differ"],
    ["C2-08 a deferred install's integrity", { editApply: (a) => retarget(a, STRATEGIST, { integrity: OTHER_INTEGRITY }) }, "package-acts-differ"],
    ["C2-09 a deferred install's placement", { editApply: (a) => retarget(a, STRATEGIST, { placement: "dependencies" }) }, "package-acts-differ"],
    [
      "C2-10 the pin at another version, satisfied",
      {
        editApply: (a) => {
          item(a, STARTER).package.version = "0.9.3";
        },
      },
      "package-acts-differ",
    ],
    [
      "C2-12 a write-record the setup did not have",
      {
        editApply: (a) => {
          a.items.push({ id: "agents-pointer", act: "write-record", source: "agents-pointer" });
          a.files.push({ path: "AGENTS.md", mode: "100644", before: null, after: contentDigest("pointer\n"), item: "agents-pointer" });
          a.pathAllowList.push("AGENTS.md");
          normalize(a);
        },
      },
      "items-differ",
    ],
    [
      "C2-14 a role the setup did not compose",
      {
        editApply: (a) => {
          item(a, "skills").roles.push("editor");
          const link = contentDigest("../../.agents/skills/clossys-editor");
          a.files.push(
            { path: ".agents/skills/clossys-editor/SKILL.md", mode: "100644", before: null, after: contentDigest("editor\n"), item: "skills" },
            { path: ".claude/skills/clossys-editor", mode: "120000", before: null, after: link, item: "skills" },
            { path: ".cursor/skills/clossys-editor", mode: "120000", before: null, after: link, item: "skills" },
          );
          normalize(a);
        },
      },
      "items-differ",
    ],
    [
      "C2-15 a declare-root-entry item editing the profile",
      {
        editApply: (a) => {
          const path = "governance/repository-profile.json";
          a.observed.repositoryProfile = { path, rootVocabulary: "checked", undeclaredRoots: ["clossys"], prohibitedRoots: [] };
          a.items.push({ id: "profile", act: "declare-root-entry", path, entries: [{ name: "clossys", classification: "extension", disposition: "allowed" }] });
          a.files.push({ path, mode: "100644", before: contentDigest("{}\n"), after: contentDigest('{"rootEntries":[]}\n'), item: "profile" });
          a.pathAllowList.push("**/repository-profile.json");
          normalize(a);
        },
      },
      "items-differ",
    ],
    ["C2-17 another producer name", { editApply: (a) => void (a.producer.name = "@example/other-launcher") }, "producer-differs"],
    ["C2-18 another producer version", { editApply: (a) => void (a.producer.version = "0.4.1") }, "producer-differs"],
    ["C2-19 another engine", { editApply: (a) => void (a.engine.version = "0.8.1") }, "engine-differs"],
    ["C2-19 another integrator", { editApply: (a) => void (a.integrator.integrity = OTHER_INTEGRITY) }, "engine-differs"],
    ["C2-20 another visibility", { editApply: (a) => void (a.repository.visibility = "public") }, "repository-differs"],
    ["C2-20 another default branch", { editApply: (a) => void (a.repository.defaultBranch = "trunk") }, "repository-differs"],
    [
      "C2-22 another package manager, so another lockfile path",
      {
        editApply: (a) => {
          a.observed.packageManager = "pnpm";
          a.observed.lockfile = "pnpm-lock.yaml";
          lockfile(a).path = "pnpm-lock.yaml";
          a.pathAllowList.push("pnpm-lock.yaml");
          normalize(a);
        },
      },
      "observed-differs",
    ],
    ["C2-23 a whole file that changes (brief rewritten from the ledger's row)", { editApply: (a) => void (wholeFile(a, "clossys/brief.json").before = contentDigest("older\n")) }, "file-not-noop"],
    ["C2-24 a whole file that is added", { editApply: (a) => void (wholeFile(a, "clossys/brief.json").before = null) }, "file-not-noop"],
    [
      "C2-27 a no-op whose bytes are not the setup's",
      {
        editApply: (a) => {
          const file = wholeFile(a, "clossys/brief.json");
          file.after = contentDigest("another brief\n");
          file.before = file.after;
        },
      },
      "file-not-setup",
    ],
    [
      "C2-30 a key for a deferred install over a value the base already has",
      {
        editApply: (a) => {
          for (const key of a.keys as Loose[]) if (key.item === WRITER) key.before = "0.6.0";
        },
      },
      "key-not-deferred",
    ],
    ["C2-29 and C2-34 the pin unsatisfied, with a key for it", { editApply: (a) => unsatisfyPin(a) }, "key-not-deferred"],
    [
      "C2-32 a refusal in the apply set (a key the client edited)",
      {
        editApply: (a) => {
          a.keys = a.keys.filter((key: Loose) => key.item !== WRITER);
          lockfile(a).invariants = lockfile(a).invariants.filter((invariant: Loose) => invariant.item !== WRITER);
          a.refused.push({ file: "package.json", pointer: dependencyPointer("devDependencies", "@example/writer"), reason: "client-edited", item: WRITER });
          normalize(a);
        },
      },
      "refusal-present",
    ],
    [
      "C2-35 and C2-36 a deferred install claimed satisfied in the base (refused whatever the base holds: no rule here verifies it)",
      {
        editApply: (a) => {
          item(a, WRITER).satisfiedInBase = true;
          a.keys = a.keys.filter((key: Loose) => key.item !== WRITER);
          lockfile(a).invariants = lockfile(a).invariants.filter((invariant: Loose) => invariant.item !== WRITER);
          normalize(a);
        },
      },
      "satisfied-unverified",
    ],
  ];

  for (const [label, options, detail] of rows) {
    it(`${label}: refused as ${detail}, from a pair that is otherwise admitted`, () => {
      const w = world(options);
      expect(validateRepositoryChangeSet(w.apply)).toEqual({ valid: true });
      expect(run(w)).toEqual(aa(detail));
    });
  }

  it("U11: a refusal in the setup set is refused too", () => {
    const w = world({
      editSetup: (s) => {
        item(s, STARTER).satisfiedInBase = false;
        s.keys = [];
        lockfile(s).invariants = [];
        s.files = (s.files as Loose[]).filter((file) => file !== lockfile(s));
        s.refused.push({ file: "package.json", pointer: dependencyPointer("devDependencies", "@example/starter"), reason: "client-edited", item: STARTER });
      },
    });
    if (!validateRepositoryChangeSet(w.setup).valid) throw new Error("the fixture setup set must be valid");
    expect(run(w)).toEqual(aa("refusal-present"));
  });

  it("C2-11: refused when the committed plan's act for a deferred planItem is not an install (RENDER would stamp install over it)", () => {
    const w = world();
    const changed = clone(w.plan) as unknown as Loose;
    changed.packages.find((act: Loose) => act.planItem === WRITER).act = "pin-starter";
    const authority = { ...w.authority, plan: changed as never };
    expect(run(w, { authority })).toEqual(aa("deferred-act-not-install"));
  });

  it("C2-38 (U14): the apply set's bundle must be a stored bundle that holds it and is not the approved subject", () => {
    const w = world();
    expect(run(w, {}, { bundles: [w.approvedBundle] })).toEqual(aa("apply-bundle-unrecorded"));
    const other = bundleOf(w.plan, [{ id: SITE_ID, changeSet: `sha256:${"4".repeat(64)}`, phase: "apply" }]);
    const pointed = mutateSet(w.apply, () => undefined);
    const wrong = { ...pointed, bundle: other.bundleDigest } as RepositoryChangeSet;
    expect(run(w, { set: wrong }, { bundles: [w.approvedBundle, other] })).toEqual(aa("apply-bundle-unrecorded"));
    const itself = { ...pointed, bundle: w.approvedBundle.bundleDigest } as RepositoryChangeSet;
    expect(run(w, { set: itself }, { bundles: [w.approvedBundle] })).toEqual(aa("apply-bundle-unrecorded"));
    const caseVariant = bundleOf(w.plan, [{ id: "Example-Owner/Site", set: w.apply }]);
    const looks = { ...pointed, bundle: caseVariant.bundleDigest } as RepositoryChangeSet;
    expect(run(w, { set: looks }, { bundles: [w.approvedBundle, caseVariant] })).toEqual(aa("apply-bundle-unrecorded"));
  });

  it("C2-04: reordered items are change-set-invalid: order is canonical order's business (C8), before K8 looks", () => {
    const w = world();
    const reordered = { ...w.apply, items: [...w.apply.items].reverse() } as RepositoryChangeSet;
    expect(run(w, { set: reordered })).toEqual({ state: "refused", exitCode: 2, reason: "change-set-invalid" });
  });
});

describe("condition 3: the base holds the merged setup, by content (K6, K7, K9)", () => {
  it("C3-01: no ledger at all is ledger-absent", () => {
    const w = world();
    expect(run(w, { baseLedger: null, baseLedgerBytes: null })).toEqual(aa("ledger-absent"));
  });

  it("refuses a ledger and bytes that disagree", () => {
    const w = world();
    const other = editLedger(w.ledgerBytes, (ledger) => void (ledger.files = ledger.files.slice(1)));
    expect(run(w, { baseLedger: w.ledger, baseLedgerBytes: other })).toEqual(aa("base-ledger-inconsistent"));
    expect(run(w, { baseLedger: null, baseLedgerBytes: w.ledgerBytes })).toEqual(aa("base-ledger-inconsistent"));
  });

  it("C3-03: a ledger that ends with an earlier admitted apply set is ledger-not-setup", () => {
    const w = world();
    const next = Buffer.from(renderInstalledLedger(w.ledger, w.apply, { kind: "admitted", subjectDigest: w.authority.subject, setupChangeSet: w.setup.changeSetDigest }, committedPlanPackages(w.plan, SITE_ID)), "utf8");
    const later = mutateSet(w.apply, (a) => void (a.producer.version = "0.4.1"));
    expect(run(w, { set: later, baseLedger: readInstalledLedger(next), baseLedgerBytes: next })).toEqual(aa("ledger-not-setup"));
  });

  it("C3-07 (U4): a setup entry bound to another subject than the latest approval is setup-subject-mismatch", () => {
    const w = world();
    const bytes = setupLedgerBytes(w.setup, `sha256:${"6".repeat(64)}`, w.plan);
    expect(run(w, { baseLedger: readInstalledLedger(bytes), baseLedgerBytes: bytes })).toEqual(aa("setup-subject-mismatch"));
  });

  it("refuses a setup set the hub store does not hold: the caller's copy is never used (C3-22, U3)", () => {
    const w = world();
    expect(run(w, {}, { sets: [] })).toEqual(aa("setup-unstored"));
  });

  it("refuses a setup set of another plan digest as setup-plan-mismatch", () => {
    const w = world({
      editSetup: (s) => void (s.planDigest = `sha256:${"e".repeat(64)}`),
    });
    expect(run(w)).toEqual(aa("setup-plan-mismatch"));
  });

  it("C3-09: a setup set, ledger entry and apply set on another plan digest than the plan's are plan-digest-mismatch", () => {
    const w = world({
      editSetup: (s) => void (s.planDigest = `sha256:${"e".repeat(64)}`),
      editApply: (a) => void (a.planDigest = `sha256:${"e".repeat(64)}`),
    });
    expect(run(w)).toEqual(aa("plan-digest-mismatch"));
  });

  it("C3-11 (U6): a ledger that dropped a files row, though it passes L1 to L10 and the trust check, is not the setup set's render", () => {
    const w = world();
    const bytes = editLedger(w.ledgerBytes, (ledger) => void (ledger.files = ledger.files.slice(1)));
    const acts = [{ planDigest: w.planDigest, packages: committedPlanPackages(w.plan, SITE_ID) }];
    expect(trustInstalledLedger(bytes, { id: SITE_ID, nodeId: "R_exampleSite1" }, [w.setup], { planPackageActs: acts }).state).toBe("trusted");
    expect(run(w, { baseLedger: readInstalledLedger(bytes), baseLedgerBytes: bytes })).toEqual(aa("setup-ledger-not-rendered"));
  });

  it("C3-11: the setup ledger's bytes must be the exact render, with the bundle the entry names (U6)", () => {
    const w = world();
    // A first-stored copy of the setup set can carry another bundle; the ledger names the run that computed it.
    const sibling = { ...w.setup, bundle: `sha256:${"8".repeat(64)}` } as RepositoryChangeSet;
    expect(run(w, {}, { sets: [sibling] })).toEqual(admitted(w));
    const bytes = editLedger(w.ledgerBytes, (ledger) => void (ledger.history[0].bundle = `sha256:${"8".repeat(64)}`));
    expect(run(w, { baseLedger: readInstalledLedger(bytes), baseLedgerBytes: bytes })).toEqual(admitted(w));
  });

  it("C3-25 and C3-26 (K7): a stored, valid setup set that is not a member of the approved bundle is setup-not-member, even under a forged ledger that names it", () => {
    const w = world();
    const other = bundleOf(w.plan, [{ id: DOCS_ID, changeSet: `sha256:${"5".repeat(64)}`, phase: "apply" }]);
    const authority = authorityOf(decide(w.plan, "approved", LATER_AT, other.bundleDigest));
    const bytes = setupLedgerBytes(w.setup, other.bundleDigest, w.plan);
    expect(run(w, { authority, baseLedger: readInstalledLedger(bytes), baseLedgerBytes: bytes }, { bundles: [other, w.applyBundle] })).toEqual(aa("setup-not-member"));
  });

  it("C3-32 (U6): a ledger [setup, apply, setup] followed by an apply set is setup-not-first", () => {
    const w = world();
    const packages = committedPlanPackages(w.plan, SITE_ID);
    const admittedBinding = { kind: "admitted", subjectDigest: w.authority.subject, setupChangeSet: w.setup.changeSetDigest } as const;
    const second = Buffer.from(renderInstalledLedger(w.ledger, mutateSet(w.apply, () => undefined), admittedBinding, packages), "utf8");
    const again = mutateSet(w.setup, (s) => {
      s.ledger.generation = 2;
      s.producer.version = "0.4.1";
      s.deferred = [];
      for (const file of s.files) if (file.derived === true && file.path === LEDGER_PATH) file.invariants = [{ ledgerGeneration: 3 }];
    });
    const third = Buffer.from(renderInstalledLedger(readInstalledLedger(second), again, { kind: "approved", subjectDigest: w.authority.subject }, packages), "utf8");
    expect(run(w, { baseLedger: readInstalledLedger(third), baseLedgerBytes: third }, { sets: [w.setup, again] })).toEqual(aa("setup-not-first"));
  });

  it("P-05 with a repository that is not the setup set's is refused", () => {
    const w = world();
    const moved = mutateSet(w.setup, (s) => void (s.repository.nodeId = "R_exampleOther"));
    expect(run(w, {}, { sets: [moved] })).toEqual(aa("setup-unstored"));
  });

  describe("the base tree (K9)", () => {
    const changeTree = (edit: (tree: World["tree"]) => void, options: WorldOptions = {}) => {
      const w = world(options);
      const tree = new Map(w.tree);
      edit(tree);
      return { w, tree };
    };
    const decideOver = (edit: (tree: World["tree"]) => void, options: WorldOptions = {}) => {
      const { w, tree } = changeTree(edit, options);
      return run(w, {}, { tree });
    };
    const BRIEF = "clossys/brief.json";
    const LINK = ".claude/skills/clossys-writer";
    const bytes = (text: string) => Buffer.from(text, "utf8");

    it("C3-30: an extra unowned file under an owned pattern is not an admission question", () => {
      const w = world();
      expect(decideOver((tree) => void tree.set(".agents/skills/clossys-x/SKILL.md", { mode: "100644", bytes: bytes("x\n") }))).toEqual(admitted(w));
    });

    it("C3-14: a file the setup wrote, deleted from the base, is base-content-missing", () => {
      expect(decideOver((tree) => void tree.delete(BRIEF))).toEqual(aa("base-content-missing"));
    });

    it("C3-15: a file the setup wrote, edited in the base, is base-content-mismatch", () => {
      expect(decideOver((tree) => void tree.set(BRIEF, { mode: "100644", bytes: bytes("edited by the client\n") }))).toEqual(aa("base-content-mismatch"));
      expect(decideOver((tree) => void tree.set(".starter/request.json", { mode: "100644", bytes: bytes("{}\n") }))).toEqual(aa("base-content-mismatch"));
    });

    it("C3-16 (U8): a discovery link replaced by a regular file with the same target bytes is base-mode-mismatch", () => {
      expect(decideOver((tree) => void tree.set(LINK, { mode: "100644", bytes: tree.get(LINK)!.bytes }))).toEqual(aa("base-mode-mismatch"));
    });

    it("C3-17: a discovery link removed, or its root made a symbolic link, is base-content-missing", () => {
      expect(decideOver((tree) => void tree.delete(LINK))).toEqual(aa("base-content-missing"));
      expect(
        decideOver((tree) => {
          for (const key of [...tree.keys()]) if (key.startsWith(".claude/skills/")) tree.delete(key);
          tree.set(".claude/skills", { mode: "120000", bytes: bytes("../.agents/skills") });
        }),
      ).toEqual(aa("base-content-missing"));
    });

    it("C3-18: a regular file set executable, or turned into a directory or a gitlink, is base-mode-mismatch", () => {
      expect(decideOver((tree) => void tree.set(BRIEF, { mode: "100755", bytes: tree.get(BRIEF)!.bytes }))).toEqual(aa("base-mode-mismatch"));
      expect(
        decideOver((tree) => {
          tree.delete(BRIEF);
          tree.set(`${BRIEF}/inside`, { mode: "100644", bytes: bytes("x\n") });
        }),
      ).toEqual(aa("base-mode-mismatch"));
      expect(decideOver((tree) => void tree.set(BRIEF, { mode: "160000", bytes: new Uint8Array(0) }))).toEqual(aa("base-mode-mismatch"));
    });

    it("C3-20 (U8): a case variant next to a path the setup wrote, or next to one of its directories, is base-case-variant", () => {
      expect(decideOver((tree) => void tree.set("clossys/Brief.json", { mode: "100644", bytes: bytes("x\n") }))).toEqual(aa("base-case-variant"));
      expect(decideOver((tree) => void tree.set("Clossys/other.json", { mode: "100644", bytes: bytes("x\n") }))).toEqual(aa("base-case-variant"));
      expect(decideOver((tree) => void tree.set(".Starter/request.json", { mode: "100644", bytes: bytes("x\n") }))).toEqual(aa("base-case-variant"));
    });

    it("C3-21 (U8): bytes that only decode to the same string are base-content-mismatch, because raw bytes are hashed", () => {
      const options: WorldOptions = { editSetup: (_s, texts) => void (texts[BRIEF] = "�\n") };
      const w = world(options);
      expect(run(w)).toEqual(admitted(w));
      const tree = new Map(w.tree);
      tree.set(BRIEF, { mode: "100644", bytes: Buffer.from([0xff, 0x0a]) });
      expect(Buffer.from([0xff, 0x0a]).toString("utf8")).toBe("�\n");
      expect(run(w, {}, { tree })).toEqual(aa("base-content-mismatch"));
    });

    it("C3-19: every path the setup wrote is checked, not only the paths the apply set names", () => {
      // The apply set of this world names them all; the check is over the setup's own list.
      const w = world();
      const namedByApply = new Set(w.apply.files.filter((file) => !("derived" in file)).map((file) => file.path));
      const wrote = w.setup.files.filter((file) => !("derived" in file)).map((file) => file.path);
      expect(wrote.every((path) => namedByApply.has(path))).toBe(true);
      const tree = new Map(w.tree);
      for (const path of wrote) {
        const edited = new Map(tree);
        edited.set(path, { mode: edited.get(path)!.mode, bytes: bytes("client edit\n") });
        expect(run(w, {}, { tree: edited })).toEqual(aa("base-content-mismatch"));
      }
    });

    it("C3-12: the pin's key absent, different, at both placements, repeated or unparseable", () => {
      const manifest = (edit: (doc: Loose) => void) => bytes(`${JSON.stringify((() => { const doc = { name: "site", private: true, devDependencies: { "@example/starter": "0.9.2" } } as Loose; edit(doc); return doc; })(), null, 2)}\n`);
      const set = (raw: Uint8Array | null) => decideOver((tree) => (raw === null ? void tree.delete("package.json") : void tree.set("package.json", { mode: "100644", bytes: raw })));
      expect(set(manifest((doc) => void delete doc.devDependencies))).toEqual(aa("base-key-missing"));
      expect(set(manifest((doc) => void (doc.devDependencies["@example/starter"] = "0.9.1")))).toEqual(aa("base-key-mismatch"));
      expect(set(manifest((doc) => void (doc.dependencies = { "@example/starter": "0.9.2" })))).toEqual(aa("base-key-ambiguous"));
      expect(set(manifest((doc) => void (doc.dependencies = { "@example/starter": "0.9.1" })))).toEqual(aa("base-key-ambiguous"));
      expect(set(manifest((doc) => void (doc.devDependencies["@example/starter"] = 2)))).toEqual(aa("base-key-mismatch"));
      expect(set(bytes('{"devDependencies":{"@example/starter":"0.9.2","@example/starter":"0.9.2"}}\n'))).toEqual(aa("base-unreadable"));
      expect(set(bytes('{"devDependencies":'))).toEqual(aa("base-unreadable"));
      expect(set(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes("{}\n")]))).toEqual(aa("base-unreadable"));
      expect(set(null)).toEqual(aa("base-unreadable"));
    });

    it("C3-13 (U7): the pin's lockfile resolution absent, at another integrity, or a lockfile that cannot be read is refused", () => {
      const w = world();
      const pin = w.setup.items.find((entry) => entry.act === "pin-starter") as Extract<(typeof w.setup.items)[number], { package: unknown }>;
      const lock = (text: string | null) => {
        const tree = new Map(w.tree);
        if (text === null) tree.delete("package-lock.json");
        else tree.set("package-lock.json", { mode: "100644", bytes: bytes(text) });
        return run(w, {}, { tree });
      };
      expect(lock(lockfileText([{ name: pin.package.name, version: pin.package.version, integrity: OTHER_INTEGRITY }]))).toEqual(aa("base-lockfile-mismatch"));
      expect(lock(lockfileText([{ name: pin.package.name, version: "0.9.1", integrity: pin.package.integrity }]))).toEqual(aa("base-lockfile-mismatch"));
      expect(lock(lockfileText([]))).toEqual(aa("base-lockfile-mismatch"));
      expect(lock("not a lockfile")).toEqual(aa("base-unreadable"));
      expect(lock("")).toEqual(aa("base-unreadable"));
      expect(lock(null)).toEqual(aa("base-unreadable"));
      const dependency = lockfileText([{ name: pin.package.name, version: pin.package.version, integrity: pin.package.integrity }], "dependencies");
      expect(lock(dependency)).toEqual(aa("base-lockfile-mismatch"));
    });

    it("refuses a base tree the reader cannot read, and a listing that is missing or unreadable", () => {
      const w = world();
      const readers = memoryReaders({ bundles: [w.approvedBundle, w.applyBundle], sets: [w.setup], tree: w.tree });
      expect(run(w, { readers: { ...readers, baseEntry: () => "unreadable" } })).toEqual(aa("base-unreadable"));
      expect(run(w, { readers: { ...readers, baseDirectory: () => "unreadable" } })).toEqual(aa("base-unreadable"));
      expect(run(w, { readers: { ...readers, baseDirectory: () => null } })).toEqual(aa("base-unreadable"));
    });
  });
});

describe("hardening (K10): the rendered succession must be exactly one admitted generation", () => {
  const verify = (w: World, set: RepositoryChangeSet) =>
    verifyAdmittedSuccession({ baseLedger: w.ledger, baseLedgerBytes: w.ledgerBytes, set, authority: w.authority, setupChangeSet: w.setup.changeSetDigest });

  it("accepts the baseline, with the admitted binding", () => {
    const w = world();
    expect(verify(w, w.apply)).toEqual(admitted(w));
  });

  it("H-01: a set that changes a file, though a K8 rule missed it, is succession-refused (S3)", () => {
    const w = world({ editApply: (a) => void (wholeFile(a, "clossys/brief.json").after = contentDigest("newer\n")) });
    expect(verify(w, w.apply)).toEqual(aa("succession-refused"));
  });

  it("H-01: a set that installs something the setup did not defer, though a K8 rule missed it, is succession-refused", () => {
    const w = world({ editApply: (a) => void addInstall(a, "@example/extra", "1.0.0", OTHER_INTEGRITY) });
    expect(verify(w, w.apply)).toEqual(aa("succession-refused"));
  });

  it("H-01: a refusal in the apply set is succession-refused, because RENDER skips that package row", () => {
    const w = world({
      editApply: (a) => {
        a.keys = a.keys.filter((key: Loose) => key.item !== WRITER);
        lockfile(a).invariants = lockfile(a).invariants.filter((invariant: Loose) => invariant.item !== WRITER);
        a.refused.push({ file: "package.json", pointer: dependencyPointer("devDependencies", "@example/writer"), reason: "client-edited", item: WRITER });
        normalize(a);
      },
    });
    expect(verify(w, w.apply)).toEqual(aa("succession-refused"));
  });

  it("H-02: a set that adds a whole file, or keeps one the ledger has no row for, is render-refused (RENDER throws)", () => {
    const added = world({
      editApply: (a) => {
        a.items.push({ id: "agents-pointer", act: "write-record", source: "agents-pointer" });
        a.files.push({ path: "AGENTS.md", mode: "100644", before: null, after: contentDigest("pointer\n"), item: "agents-pointer" });
        a.pathAllowList.push("AGENTS.md");
        normalize(a);
      },
    });
    expect(verify(added, added.apply)).toEqual(aa("render-refused"));
    const orphan = world({
      editApply: (a) => {
        a.items.push({ id: "agents-pointer", act: "write-record", source: "agents-pointer" });
        const digest = contentDigest("pointer\n");
        a.files.push({ path: "AGENTS.md", mode: "100644", before: digest, after: digest, item: "agents-pointer" });
        a.pathAllowList.push("AGENTS.md");
        normalize(a);
      },
    });
    expect(verify(orphan, orphan.apply)).toEqual(aa("render-refused"));
  });

  it("H-03: a base whose setup entry is bound to another subject is render-refused, by the head's L3", () => {
    const w = world();
    const other = `sha256:${"6".repeat(64)}`;
    const bytes = setupLedgerBytes(w.setup, other, w.plan);
    expect(verifyAdmittedSuccession({ baseLedger: readInstalledLedger(bytes), baseLedgerBytes: bytes, set: w.apply, authority: w.authority, setupChangeSet: w.setup.changeSetDigest })).toEqual(aa("render-refused"));
  });

  it("H-04: only an admitted next generation passes: an approval-claimed head, no change, or a broken pair never does", () => {
    const w = world();
    const packages = committedPlanPackages(w.plan, SITE_ID);
    const claimed = Buffer.from(renderInstalledLedger(w.ledger, w.apply, { kind: "approved", subjectDigest: w.authority.subject }, packages), "utf8");
    expect(checkSuccession(w.ledgerBytes, claimed)).toEqual(aa("succession-refused"));
    expect(checkSuccession(w.ledgerBytes, w.ledgerBytes)).toEqual(aa("succession-refused"));
    expect(checkSuccession(w.ledgerBytes, Buffer.from("{}\n"))).toEqual(aa("succession-refused"));
    // A first generation is bound approved, which no reader without the hub can authenticate.
    expect(checkSuccession(null, w.ledgerBytes)).toEqual(aa("succession-refused"));
    const head = Buffer.from(renderInstalledLedger(w.ledger, w.apply, { kind: "admitted", subjectDigest: w.authority.subject, setupChangeSet: w.setup.changeSetDigest }, packages), "utf8");
    expect(checkSuccession(w.ledgerBytes, head)).toBeNull();
    // Re-serialized bytes are never read as the same ledger.
    const respaced = Buffer.from(JSON.stringify(JSON.parse(head.toString("utf8"))), "utf8");
    expect(checkSuccession(w.ledgerBytes, respaced)).toEqual(aa("succession-refused"));
  });
});

describe("regressions: rows an existing check catches first stay caught", () => {
  it("R0 (C2-16): an apply set that defers something is change-set-invalid before admission looks at it", () => {
    const w = world({ editApply: (a) => void (a.deferred = [{ planItem: WRITER, reason: "after-setup" }]) });
    expect(run(w)).toEqual({ state: "refused", exitCode: 2, reason: "change-set-invalid" });
  });

  it("R2 (C3-08, C3-10): the trust check refuses a re-serialized base ledger and a plan digest that differs from the entry's", () => {
    const w = world();
    const acts = [{ planDigest: w.planDigest, packages: committedPlanPackages(w.plan, SITE_ID) }];
    const respaced = Buffer.from(JSON.stringify(JSON.parse(w.ledgerBytes.toString("utf8"))), "utf8");
    expect(trustInstalledLedger(respaced, { id: SITE_ID, nodeId: "R_exampleSite1" }, [w.setup], { planPackageActs: acts })).toEqual({ state: "refused", rule: "ledger-unreadable" });
    const foreign = mutateSet(w.setup, (s) => void (s.planDigest = `sha256:${"e".repeat(64)}`));
    expect(trustInstalledLedger(w.ledgerBytes, { id: SITE_ID, nodeId: "R_exampleSite1" }, [foreign], { planPackageActs: acts })).toEqual({ state: "refused", rule: "ledger-chain" });
  });

  it("U2: trust and render take the committed plan's acts, not the set's own: the same ledger is a foreign row when the set's items are the plan", () => {
    const w = world();
    const wrong = [{ planDigest: w.planDigest, packages: committedPlanPackages(w.plan, SITE_ID).filter((act) => act.act === "pin-starter") }];
    expect(trustInstalledLedger(w.ledgerBytes, { id: SITE_ID, nodeId: "R_exampleSite1" }, [w.setup], { planPackageActs: wrong })).toEqual({ state: "refused", rule: "ledger-foreign-row" });
  });
});

describe("planPackagesFor", () => {
  it("gives the plan's identity for each package act of one repository, in the shape RENDER and trust take", () => {
    const w = world();
    const site = planPackagesFor(w.authority, SITE_ID);
    expect(site.map((row) => [row.planItem, row.act])).toEqual([
      [STARTER, "pin-starter"],
      [STRATEGIST, "install"],
      [WRITER, "install"],
    ]);
    expect(Object.keys(site[0]!).sort()).toEqual(["act", "integrity", "name", "placement", "planItem", "version"]);
    expect(planPackagesFor(w.authority, DOCS_ID).map((row) => row.planItem)).toEqual(["example-owner/docs:@example/starter", "example-owner/docs:@example/writer"]);
    expect(planPackagesFor(w.authority, "example-owner/other")).toEqual([]);
    expect(planPackagesFor(w.authority, "Example-Owner/Site")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// git-backed: the hub

const hubOf = (options: HubOptions) => hubRepo(roots, options);
/** What readHubAuthority returns for a hub whose HEAD holds `p`: the plan, its digest, its subject and the commit it was read from. */
const authorityAt = (hub: string, p: AdvisorPlan) => ({ plan: p, planDigest: planDigest(p), subject: approvedSubject(p), head: git(hub, "rev-parse", "HEAD").trim() });
const noParts = (value: unknown, ...parts: string[]) => {
  const text = JSON.stringify(value);
  for (const part of parts) expect(text).not.toContain(part);
};

describe("readHubAuthority (K1): the plan as a git object at the hub's head", () => {
  const plan = () => world().plan;

  it("reads the committed plan, its digest and the subject it approves", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p] });
    const result = readHubAuthority(hub);
    expect(result).toEqual(authorityAt(hub, p));
  });

  it("works for a hub inside a larger repository, reading its plan relative to the hub", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p], nested: true });
    expect(readHubAuthority(hub)).toEqual(authorityAt(hub, p));
  });

  it("ignores GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE from the environment", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p] });
    const other = hubOf({ plans: [decide(p, "rejected", LATER_AT)] });
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = `${other.repository}/.git`;
    process.env.GIT_WORK_TREE = other.repository;
    process.env.GIT_INDEX_FILE = `${other.repository}/.git/index`;
    try {
      expect(readHubAuthority(hub)).toEqual(authorityAt(hub, p));
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("P-11: an uncommitted edit that approves a forged subject is ignored; the committed plan is not approved", () => {
    const p = plan();
    const revoked = decide(p, "rejected", LATER_AT);
    const forged = approvedPlan(`sha256:${"f".repeat(64)}`, p);
    const { hub } = hubOf({ plans: [revoked], worktreePlan: forged });
    expect(readHubAuthority(hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-12: an uncommitted edit that revokes is ignored; the committed plan still approves", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p], worktreePlan: decide(p, "rejected", LATER_AT) });
    expect(readHubAuthority(hub)).toEqual(authorityAt(hub, p));
  });

  it("P-01: a later decision, committed, that does not approve leaves nothing approved", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p, decide(p, "rejected", LATER_AT)] });
    expect(readHubAuthority(hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-02 and P-03: decisions at the same latest instant that disagree, in choice or in subject, approve nothing", () => {
    const p = plan();
    const subject = approvedSubject(p)!;
    const tieChoice = withDecisions(p, [decision(FIRST_AT, "approved", subject), decision(LATER_AT, "approved", subject), decision(LATER_AT, "rejected")]);
    expect(readHubAuthority(hubOf({ plans: [tieChoice] }).hub)).toEqual(aa("plan-not-approved"));
    const tieSubject = withDecisions(p, [decision(LATER_AT, "approved", subject), decision(LATER_AT, "approved", `sha256:${"2".repeat(64)}`)]);
    expect(readHubAuthority(hubOf({ plans: [tieSubject] }).hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-04 and P-05: two identical approvals at the latest instant, and a later re-approval of the same subject, approve it", () => {
    const p = plan();
    const subject = approvedSubject(p)!;
    const twice = withDecisions(p, [decision(LATER_AT, "approved", subject), decision(LATER_AT, "approved", subject)]);
    expect(readHubAuthority(hubOf({ plans: [twice] }).hub)).toMatchObject({ subject });
    const later = decide(p, "approved", LATER_AT, subject);
    expect(readHubAuthority(hubOf({ plans: [later] }).hub)).toMatchObject({ subject });
  });

  it("P-08: an approval with no subject, or one that is not a sha256 digest, binds nothing", () => {
    const p = plan();
    expect(readHubAuthority(hubOf({ plans: [withDecisions(p, [decision(FIRST_AT, "approved")])] }).hub)).toEqual(aa("plan-not-approved"));
    expect(readHubAuthority(hubOf({ plans: [withDecisions(p, [decision(FIRST_AT, "approved", "sha256:xyz")])] }).hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-09: a plan.json that is in the worktree but not in the head commit is plan-unreadable", () => {
    const { hub } = hubOf({ plans: [plan()], planMode: "absent" });
    expect(existsSync(`${hub}/clossys/advisor/plan.json`)).toBe(true);
    expect(readHubAuthority(hub)).toEqual(aa("plan-unreadable"));
  });

  it("P-10: a committed plan that does not parse is plan-unreadable; one that does not validate is plan-not-approved", () => {
    const p = plan();
    expect(readHubAuthority(hubOf({ plans: [p], planBytes: "{" }).hub)).toEqual(aa("plan-unreadable"));
    expect(readHubAuthority(hubOf({ plans: [p], planBytes: "﻿{}\n" }).hub)).toEqual(aa("plan-unreadable"));
    expect(readHubAuthority(hubOf({ plans: [p], planBytes: `${JSON.stringify(p).replace(/^\{/u, '{"schemaVersion":1,')}\n` }).hub)).toEqual(aa("plan-unreadable"));
    expect(readHubAuthority(hubOf({ plans: [p], planBytes: `${JSON.stringify({ ...p, unknownMember: true })}\n` }).hub)).toEqual(aa("plan-not-approved"));
    expect(readHubAuthority(hubOf({ plans: [p], planBytes: "[]\n" }).hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-13 (U1): a HEAD detached at an older commit that still carries a since-revoked approval is refused", () => {
    const p = plan();
    const { hub } = hubOf({ plans: [p, decide(p, "rejected", LATER_AT)], detachAt: 0 });
    expect(readHubAuthority(hub)).toEqual(aa("plan-unreadable"));
    const attached = hubOf({ plans: [p, decide(p, "rejected", LATER_AT)] });
    expect(readHubAuthority(attached.hub)).toEqual(aa("plan-not-approved"));
  });

  it("P-14: a plan.json that is a symbolic link, or executable, is plan-unreadable; only a regular blob is read", () => {
    const p = plan();
    expect(readHubAuthority(hubOf({ plans: [p], planMode: "symlink" }).hub)).toEqual(aa("plan-unreadable"));
    expect(readHubAuthority(hubOf({ plans: [p], planMode: "executable" }).hub)).toEqual(aa("plan-unreadable"));
  });

  it("refuses a directory that is not a repository, and one that does not exist", () => {
    const root = hubOf({ plans: [plan()] }).repository;
    rmSync(`${root}/.git`, { recursive: true, force: true });
    expect(readHubAuthority(root)).toEqual(aa("plan-unreadable"));
    expect(readHubAuthority(`${root}/absent`)).toEqual(aa("plan-unreadable"));
  });

  it("a hub head that is not its upstream is refused", () => {
    const p = plan();
    // No upstream at all.
    expect(readHubAuthority(hubOf({ plans: [p], upstream: false }).hub)).toEqual(aa("hub-not-upstream"));
    // One local commit ahead of the upstream.
    const ahead = hubOf({ plans: [p] });
    git(ahead.hub, "commit", "--allow-empty", "-m", "local only");
    expect(readHubAuthority(ahead.hub)).toEqual(aa("hub-not-upstream"));
    // The upstream moved on and was fetched: the head is behind.
    const behind = hubOf({ plans: [p] });
    advanceHubUpstream(roots, behind.hub, behind.origin!);
    expect(readHubAuthority(behind.hub)).toEqual(aa("hub-not-upstream"));
    // Equal to its upstream is admitted, and nothing here fetches: the behind hub's own origin ref is what counts.
    expect(readHubAuthority(hubOf({ plans: [p] }).hub)).toMatchObject({ planDigest: planDigest(p) });
  });

  it("a plan read resolves HEAD once: authority.head is the commit the plan was read from", () => {
    const p = plan();
    const fixture = hubOf({ plans: [p, decide(p, "approved", LATER_AT, approvedSubject(p)!)] });
    const result = readHubAuthority(fixture.hub) as { head: string; plan: unknown };
    expect(result.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(result.head).toBe(fixture.commits[1]);
    expect(git(fixture.hub, "show", `${result.head}:clossys/advisor/plan.json`)).toBe(`${JSON.stringify(result.plan, null, 2)}\n`);
  });

  it("names no path, digest or id in any refusal", () => {
    const p = plan();
    const fixture = hubOf({ plans: [p, decide(p, "rejected", LATER_AT)] });
    noParts(readHubAuthority(fixture.hub), fixture.hub, "sha256", "example-owner");
    noParts(readHubAuthority(`${fixture.hub}/absent`), fixture.hub, "absent");
  });
});

// ---------------------------------------------------------------------------
// git-backed: the whole path, over a real hub and clone

interface Scene {
  readonly w: World;
  readonly hub: string;
  readonly origin: string | null;
  readonly clone: string;
  readonly baseCommit: string;
}

function scene(options: { world?: WorldOptions; hub?: Partial<HubOptions>; tree?: (tree: World["tree"]) => void; mergeStyle?: "direct" | "squash"; storeApply?: boolean } = {}): Scene & { sideTip: string | null } {
  let site: ReturnType<typeof siteRepo> | undefined;
  const w = buildWorld({
    ...options.world,
    commitBase: (tree) => {
      options.tree?.(tree);
      site = siteRepo(roots, tree, { mergeStyle: options.mergeStyle });
      return site.baseCommit;
    },
  });
  const fixture = hubRepo(roots, { plans: [w.plan], sets: [w.setup], bundles: [w.approvedBundle, w.applyBundle], ...options.hub });
  return { w, hub: fixture.hub, origin: fixture.origin, clone: site!.clone, baseCommit: site!.baseCommit, sideTip: site!.sideTip };
}

const bind = (s: Scene, patch: Record<string, unknown> = {}) =>
  decideSetBinding({
    hub: s.hub,
    clone: s.clone,
    set: s.w.apply,
    authority: readHubAuthority(s.hub) as never,
    baseLedger: s.w.ledger,
    baseLedgerBytes: s.w.ledgerBytes,
    now: () => new Date("2026-10-01T00:00:00Z"),
    ...patch,
  });

describe("decideSetBinding over a real hub and a real clone", () => {
  it("P: admits the unchanged pair, reading the plan, the stored setup set and bundles from the hub and the tree from git objects", async () => {
    const s = scene();
    const authority = readHubAuthority(s.hub);
    expect(authority).toMatchObject({ subject: s.w.authority.subject, planDigest: s.w.planDigest });
    expect(await bind(s)).toEqual(admitted(s.w));
    expect(await bind(s, { set: s.w.setup })).toEqual(approved(s.w.approvedBundle.bundleDigest));
  });

  it("P-15: a stored bundle edited so its digest no longer recomputes is bundle-unreadable", async () => {
    const s = scene();
    const path = `${s.hub}/clossys/.state/apply/bundles/${s.w.approvedBundle.bundleDigest.slice(7)}.json`;
    const edited = JSON.parse(readFileSync(path, "utf8")) as Loose;
    edited.repositories[0].changeSet = `sha256:${"0".repeat(64)}`;
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);
    expect(await bind(s)).toEqual(aa("bundle-unreadable"));
  });

  it("refuses a bundle or setup set the hub never stored, whatever the caller holds (U3)", async () => {
    const noBundle = scene({ hub: { bundles: [] } });
    expect(await bind(noBundle)).toEqual(aa("bundle-unreadable"));
    const noSetup = scene({ hub: { sets: [] } });
    expect(await bind(noSetup)).toEqual(aa("setup-unstored"));
    const noApplyBundle = scene({ hub: { bundles: [buildWorld().approvedBundle] } });
    expect(noApplyBundle.w.approvedBundle.bundleDigest).toBe(buildWorld().approvedBundle.bundleDigest);
    expect(await bind(noApplyBundle)).toEqual(aa("apply-bundle-unrecorded"));
  });

  it("refuses a stored setup set that was edited (its digest no longer recomputes)", async () => {
    const s = scene();
    const path = `${s.hub}/clossys/.state/apply/change-sets/${s.w.setup.changeSetDigest.slice(7)}.json`;
    const edited = JSON.parse(readFileSync(path, "utf8")) as Loose;
    edited.producer.version = "9.9.9";
    writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`);
    expect(await bind(s)).toEqual(aa("setup-unstored"));
  });

  it("a changed producer refuses: the apply set is another Launcher's", async () => {
    const s = scene({ world: { editApply: (a) => void (a.producer.version = "0.5.0") } });
    expect(await bind(s)).toEqual(aa("producer-differs"));
  });

  it("C3-27 (D26 condition 3): a setup merged by squash, which leaves no ancestor of the setup branch, is admitted", async () => {
    const s = scene({ mergeStyle: "squash" });
    expect(s.sideTip).not.toBeNull();
    let ancestor = true;
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", s.sideTip!, s.baseCommit], { cwd: s.clone, stdio: "ignore" });
    } catch {
      ancestor = false;
    }
    expect(ancestor).toBe(false);
    expect(await bind(s)).toEqual(admitted(s.w));
  });

  it("C3-29: the setup set's own base commit need not exist in the clone: it is never read", async () => {
    const s = scene();
    expect(s.w.setup.repository.baseCommit).not.toBe(s.baseCommit);
    expect(await bind(s)).toEqual(admitted(s.w));
  });

  it("C3-34: the worktree is never read: a dirty or moved worktree does not change the decision", async () => {
    const s = scene();
    writeFileSync(`${s.clone}/clossys/brief.json`, "edited in the worktree\n");
    expect(await bind(s)).toEqual(admitted(s.w));
    const clean = scene({ tree: (tree) => void tree.set("clossys/brief.json", { mode: "100644", bytes: Buffer.from("edited in the base\n") }) });
    expect(await bind(clean)).toEqual(aa("base-content-mismatch"));
  });

  it("C3-16, C3-18: a discovery link that is a regular file in the base, or a file set executable, is base-mode-mismatch by git's own mode", async () => {
    const link = ".claude/skills/clossys-writer";
    const asFile = scene({ tree: (tree) => void tree.set(link, { mode: "100644", bytes: tree.get(link)!.bytes }) });
    expect(await bind(asFile)).toEqual(aa("base-mode-mismatch"));
    const executable = scene({ tree: (tree) => void tree.set("clossys/brief.json", { mode: "100755", bytes: tree.get("clossys/brief.json")!.bytes }) });
    expect(await bind(executable)).toEqual(aa("base-mode-mismatch"));
  });

  it("C3-17: a discovery link removed from the base is base-content-missing", async () => {
    const s = scene({ tree: (tree) => void tree.delete(".cursor/skills/clossys-strategist") });
    expect(await bind(s)).toEqual(aa("base-content-missing"));
  });

  it("C3-20: a case variant in the base tree is base-case-variant", async () => {
    const s = scene({ tree: (tree) => void tree.set("clossys/Brief.json", { mode: "100644", bytes: Buffer.from("x\n") }) });
    expect(await bind(s)).toEqual(aa("base-case-variant"));
  });

  it("C3-21: raw bytes are hashed, so invalid UTF-8 that decodes to the same string is base-content-mismatch", async () => {
    const s = scene({
      world: { editSetup: (_s, texts) => void (texts["clossys/brief.json"] = "�\n") },
      tree: (tree) => void tree.set("clossys/brief.json", { mode: "100644", bytes: Buffer.from([0xff, 0x0a]) }),
    });
    expect(await bind(s)).toEqual(aa("base-content-mismatch"));
  });

  it("refuses a base commit the clone does not hold, and one that is not a commit id, as base-unreadable", async () => {
    const s = scene();
    const missing = mutateSet(s.w.apply, (a) => void (a.repository.baseCommit = "d".repeat(40)));
    // The stored bundle names the digest the set had; give the bundle the new one so only the tree is unreadable.
    const bundle = bundleOf(s.w.plan, [{ id: SITE_ID, set: missing }]);
    const fixture = hubRepo(roots, { plans: [s.w.plan], sets: [s.w.setup], bundles: [s.w.approvedBundle, bundle] });
    const result = await decideSetBinding({
      hub: fixture.hub,
      clone: s.clone,
      set: { ...missing, bundle: bundle.bundleDigest } as RepositoryChangeSet,
      authority: readHubAuthority(fixture.hub) as never,
      baseLedger: s.w.ledger,
      baseLedgerBytes: s.w.ledgerBytes,
      now: () => new Date("2026-10-01T00:00:00Z"),
    });
    expect(result).toEqual(aa("base-unreadable"));
  });
});

describe("K11: the execution authorization is current (readiness)", () => {
  const NOW = new Date("2026-10-01T00:00:00Z");
  const notCurrent = (detail: string) => ({ state: "refused", exitCode: 1, reason: "authorization-not-current", detail });
  const unverified = (detail: string) => ({ state: "refused", exitCode: 2, reason: "authorization-unverified", detail });
  const plan = () => buildWorld().plan;
  const withAssessment = (assessment: Loose | null, extra: Partial<HubOptions> = {}) => scene({ hub: { assessment, ...extra } });

  it("runs the readiness executable from the hub's own node_modules with the committed bytes and the current instant, and admits on exit 0", async () => {
    const s = scene();
    const seen: { bin: string; assessmentPath: string; asOf: string; cwd: string; bytes: string }[] = [];
    const runner: ReadinessRunner = (request) => {
      seen.push({ ...request, bytes: readFileSync(request.assessmentPath, "utf8") });
      return { status: 0 };
    };
    expect(await bind(s, { runReadiness: runner, now: () => NOW })).toEqual(admitted(s.w));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.bin).toBe(`${s.hub}/${READINESS_BIN}`);
    expect(seen[0]!.asOf).toBe("2026-10-01T00:00:00.000Z");
    expect(seen[0]!.bytes).toBe(readFileSync(`${s.hub}/${ASSESSMENT_FILE}`, "utf8"));
    expect(seen[0]!.assessmentPath.startsWith(s.hub)).toBe(false);
    // The temporary file is removed.
    expect(existsSync(seen[0]!.assessmentPath)).toBe(false);
  });

  it("uses the committed bytes, never the worktree's", async () => {
    const s = scene();
    writeFileSync(`${s.hub}/${ASSESSMENT_FILE}`, `${JSON.stringify(assessmentFor(s.w.plan, { expiresAt: "2001-01-01T00:00:00Z" }))}\n`);
    expect(await bind(s, { now: () => NOW })).toEqual(admitted(s.w));
  });

  it("the default runner is the hub's stub, run with a bare environment: current is admitted, expired is authorization-not-current (exit 1)", async () => {
    const current = scene();
    expect(await bind(current, { now: () => NOW })).toEqual(admitted(current.w));
    const expired = withAssessment(assessmentFor(plan(), { expiresAt: "2026-09-30T00:00:00Z" }));
    expect(await bind(expired, { now: () => NOW })).toEqual(notCurrent("readiness-violated"));
    // The same authorization is current a day earlier: the instant comes from the clock given.
    expect(await bind(expired, { now: () => new Date("2026-09-29T00:00:00Z") })).toEqual(admitted(expired.w));
  });

  it("gives the executable only PATH", async () => {
    const s = scene();
    const bin = `${s.hub}/${READINESS_BIN}`;
    writeFileSync(
      bin,
      '#!/usr/bin/env node\nconst fs = require("node:fs");\nconst path = require("node:path");\nfs.writeFileSync(path.join(__dirname, "seen-env.txt"), Object.keys(process.env).sort().join(","));\nprocess.exit(0);\n',
      { mode: 0o755 },
    );
    expect(await bind(s, { now: () => NOW })).toEqual(admitted(s.w));
    expect(readFileSync(`${s.hub}/node_modules/.bin/seen-env.txt`, "utf8")).toBe("PATH");
  });

  it("an authorization for another plan digest is authorization-not-current", async () => {
    const s = withAssessment(assessmentFor(plan(), { planDigest: `sha256:${"a".repeat(64)}` }));
    expect(await bind(s)).toEqual(notCurrent("plan-mismatch"));
  });

  it("a repository the authorization does not permit is authorization-not-current, so is one it permits by another case", async () => {
    const other = withAssessment(assessmentFor(plan(), {}, [DOCS_ID]));
    expect(await bind(other)).toEqual(notCurrent("repository-not-permitted"));
    const cased = withAssessment(assessmentFor(plan(), { permittedRepositoryIds: ["Example-Owner/Site"] }));
    expect(await bind(cased)).toEqual(notCurrent("repository-not-permitted"));
  });

  it("a package act the authorization does not permit (name, version or integrity) is authorization-not-current", async () => {
    const acts = (mutate: (packages: Loose[]) => Loose[]) => assessmentFor(plan(), { permittedPackages: mutate(assessmentFor(plan()).engagement.executionAuthorization.permittedPackages) });
    for (const packages of [
      acts((rows) => rows.filter((row) => row.name !== "@example/writer")),
      acts((rows) => rows.map((row) => (row.name === "@example/writer" ? { ...row, version: "0.7.1" } : row))),
      acts((rows) => rows.map((row) => (row.name === "@example/starter" ? { ...row, integrity: OTHER_INTEGRITY } : row))),
    ]) {
      expect(await bind(withAssessment(packages))).toEqual(notCurrent("package-not-permitted"));
    }
    // Every act counts: the deferred installs the setup set names are checked too, for an approved setup set.
    const dropped = withAssessment(acts((rows) => rows.filter((row) => row.name !== "@example/strategist")));
    expect(await bind(dropped, { set: dropped.w.setup })).toEqual(notCurrent("package-not-permitted"));
  });

  it("the assessment is read at the authority's commit: a newer assessment committed and pushed afterwards is hub-head-moved", async () => {
    const s = scene();
    const authority = readHubAuthority(s.hub);
    commitHubAssessment(s.hub, assessmentFor(s.w.plan, { expiresAt: "2099-01-01T00:00:00Z" }));
    expect(await bind(s, { authority })).toEqual(unverified("hub-head-moved"));
    // A head that moved and was not pushed, and a head detached at the same commit, are refused the same way.
    const local = scene();
    const localAuthority = readHubAuthority(local.hub);
    git(local.hub, "commit", "--allow-empty", "-m", "local only");
    expect(await bind(local, { authority: localAuthority })).toEqual(unverified("hub-head-moved"));
    const detached = scene();
    const detachedAuthority = readHubAuthority(detached.hub);
    git(detached.hub, "checkout", "-q", "--detach");
    expect(await bind(detached, { authority: detachedAuthority })).toEqual(unverified("hub-head-moved"));
    // The head the authority was read from still admits.
    const fresh = scene();
    expect(await bind(fresh, { authority: readHubAuthority(fresh.hub) })).toEqual(admitted(fresh.w));
  });

  it("a head that no longer matches its upstream is hub-head-moved even at the authority's commit", async () => {
    const s = scene();
    const authority = readHubAuthority(s.hub);
    advanceHubUpstream(roots, s.hub, s.origin!);
    expect(await bind(s, { authority })).toEqual(unverified("hub-head-moved"));
  });

  it("authorization must equal the plan's packages exactly: an extra, a missing package of another repository and a duplicate are packages-not-exact", async () => {
    const exact = (p: AdvisorPlan) => assessmentFor(p).engagement.executionAuthorization.permittedPackages as Loose[];
    const extra = withAssessment(assessmentFor(plan(), { permittedPackages: [...exact(plan()), { name: "@example/extra", version: "1.0.0", integrity: OTHER_INTEGRITY }] }));
    expect(await bind(extra)).toEqual(notCurrent("packages-not-exact"));
    // A package only another repository's act names: the site set's own acts are all permitted, yet the list is not the plan's.
    const elsewhere = (plan0: Loose) => {
      const docsWriter = (plan0.packages as Loose[]).find((act) => act.repository === DOCS_ID && act.name === "@example/writer")!;
      docsWriter.version = "0.6.0";
    };
    const docsOnly = buildWorld({ editPlan: elsewhere }).plan;
    const missing = scene({ world: { editPlan: elsewhere }, hub: { assessment: assessmentFor(docsOnly, { permittedPackages: exact(docsOnly).filter((row) => row.version !== "0.6.0") }) } });
    expect(await bind(missing)).toEqual(notCurrent("packages-not-exact"));
    const duplicated = withAssessment(assessmentFor(plan(), { permittedPackages: [...exact(plan()), exact(plan())[0]!] }));
    expect(await bind(duplicated)).toEqual(notCurrent("packages-not-exact"));
    // Order does not matter, and the exact list admits.
    const reordered = withAssessment(assessmentFor(plan(), { permittedPackages: [...exact(plan())].reverse() }));
    expect(await bind(reordered)).toEqual(admitted(reordered.w));
  });

  it("an approved setup set is held to the same authorization", async () => {
    const expired = withAssessment(assessmentFor(plan(), { expiresAt: "2026-09-30T00:00:00Z" }));
    expect(await bind(expired, { set: expired.w.setup, now: () => NOW })).toEqual(notCurrent("readiness-violated"));
  });

  it("the runner's exit 1 is authorization-not-current, exit 2 and any other result are authorization-unverified", async () => {
    const s = scene();
    expect(await bind(s, { runReadiness: () => ({ status: 1 }) })).toEqual(notCurrent("readiness-violated"));
    expect(await bind(s, { runReadiness: () => ({ status: 2 }) })).toEqual(unverified("readiness-indeterminate"));
    expect(await bind(s, { runReadiness: () => ({ status: null }) })).toEqual(unverified("readiness-failed"));
    expect(await bind(s, { runReadiness: () => ({ status: 137 }) })).toEqual(unverified("readiness-failed"));
    expect(await bind(s, { runReadiness: () => ({ status: 0.5 }) })).toEqual(unverified("readiness-failed"));
    expect(await bind(s, { runReadiness: () => { throw new Error("spawn"); } })).toEqual(unverified("readiness-failed"));
  });

  it("a readiness executable that is absent is authorization-unverified, and the runner is never called", async () => {
    const s = scene({ hub: { readiness: false } });
    let called = false;
    expect(await bind(s, { runReadiness: () => ((called = true), { status: 0 }) })).toEqual(unverified("readiness-bin-missing"));
    expect(called).toBe(false);
    expect(await bind(s)).toEqual(unverified("readiness-bin-missing"));
  });

  it("an executable that does not finish in time is authorization-unverified", async () => {
    const hang = assessmentFor(plan());
    hang.engagement.hang = true;
    const s = withAssessment(hang);
    expect(await bind(s, { readinessTimeoutMs: 400 })).toEqual(unverified("readiness-failed"));
  });

  it("an assessment absent from the head is authorization-unverified", async () => {
    expect(await bind(withAssessment(null))).toEqual(unverified("assessment-unreadable"));
  });

  it("an assessment committed as something that is not strict JSON is authorization-unverified", async () => {
    const garbage = scene();
    writeFileSync(`${garbage.hub}/${ASSESSMENT_FILE}`, "{");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Example Author", GIT_AUTHOR_EMAIL: "author@example.com", GIT_COMMITTER_NAME: "Example Author", GIT_COMMITTER_EMAIL: "author@example.com" };
    execFileSync("git", ["add", "-f", ASSESSMENT_FILE], { cwd: garbage.hub, env });
    execFileSync("git", ["commit", "-q", "-m", "garbage"], { cwd: garbage.hub, env });
    execFileSync("git", ["push", "-q"], { cwd: garbage.hub, env });
    expect(await bind(garbage)).toEqual(unverified("assessment-unreadable"));
  });

  it("an assessment whose shape is not an authorization is refused, never read as current", async () => {
    for (const document of [[], { engagement: null }, { engagement: [] }, {}]) {
      expect(await bind(withAssessment(document as Loose))).toEqual(unverified("assessment-unreadable"));
    }
    expect(await bind(withAssessment({ engagement: {} }))).toEqual(notCurrent("authorization-absent"));
    expect(await bind(withAssessment({ engagement: { executionAuthorization: "yes" } }))).toEqual(unverified("assessment-unreadable"));
    expect(await bind(withAssessment(assessmentFor(plan(), { permittedRepositoryIds: "example-owner/site" })))).toEqual(unverified("assessment-unreadable"));
    expect(await bind(withAssessment(assessmentFor(plan(), { permittedPackages: [null] })))).toEqual(unverified("assessment-unreadable"));
  });

  it("a detached hub head reads no assessment either: it is hub-head-moved", async () => {
    const s = scene({ hub: { plans: [buildWorld().plan, buildWorld().plan], detachAt: 0 } });
    const authority = s.w.authority;
    expect(await bind(s, { authority })).toEqual(unverified("hub-head-moved"));
  });

  it("a set with no package acts (staffing only) skips this step: it needs no assessment and no executable", async () => {
    const w = buildWorld();
    const staffing = (() => {
      const set = mutateSet(w.apply, (a) => {
        a.items = a.items.filter((entry: Loose) => entry.act !== "install" && entry.act !== "pin-starter");
        a.keys = [];
        a.files = a.files.filter((file: Loose) => file.derived !== true || file.path === LEDGER_PATH);
      });
      return set;
    })();
    expect(validateRepositoryChangeSet(staffing)).toEqual({ valid: true });
    const bundle = bundleOf(w.plan, [{ id: SITE_ID, set: staffing }]);
    const authority = authorityOf(decide(w.plan, "approved", LATER_AT, bundle.bundleDigest));
    const fixture = hubRepo(roots, { plans: [authority.plan], bundles: [bundle], assessment: null, readiness: false });
    const result = await decideSetBinding({
      hub: fixture.hub,
      clone: fixture.repository,
      set: staffing,
      authority: readHubAuthority(fixture.hub) as never,
      baseLedger: null,
      baseLedgerBytes: null,
    });
    expect(result).toEqual(approved(bundle.bundleDigest));
  });
});
