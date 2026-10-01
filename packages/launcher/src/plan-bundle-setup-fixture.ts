// Test support for the setup-set planner tests (issue #1178): builders for a
// plan that pins Starter and defers one install, an observation of a
// repository still in the setup phase, and the inputs planApplyBundle() takes.
// Additive: the planner's other tests keep their own fixtures, untouched.
// Nothing here is imported by the shipped code; every name, id and digest is
// an example value.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SITE_ID as MATERIALIZED_SITE_ID, approvedPlan, basePlan, bundleOf, committedPlanPackages, reseal } from "./admission-fixture.js";
import { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT } from "./agents-guide.js";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import { CANONICAL_KEYS, canonicalOrder, contentDigest } from "./change-set-contract.js";
import type { ApplyBundle, ChangeSetItem, RepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryObservation, PlanApplyBundleInputs } from "./plan-bundle.js";
import type { AdvisorPlan, EngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";

export type Loose = Record<string, any>;

const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");

export const clone = <T>(value: T): T => structuredClone(value);
export const sha = (data: string | Uint8Array): string => `sha256:${createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex")}`;

export const SITE_ID = "example-owner/site";
export const SITE_NODE_ID = "R_exampleSite1";
export const STARTER_NAME = "@clossys/starter";
export const WRITER_NAME = "@clossys/writer";
export const STARTER_PLAN_ITEM = `${SITE_ID}:${STARTER_NAME}`;
export const WRITER_PLAN_ITEM = `${SITE_ID}:${WRITER_NAME}`;

const CORPUS_PLAN = (JSON.parse(read("docs/contracts/advisor-plan-digest.fixture.json")) as { plans: { name: string; plan: AdvisorPlan }[] }).plans.find(
  (entry) => entry.name === "staffed-with-packages",
)!.plan;
const CORPUS_STARTER = CORPUS_PLAN.packages!.find((act) => act.act === "pin-starter")!;
const CORPUS_WRITER = CORPUS_PLAN.packages!.find((act) => act.name === "@example/writer")!;

export const STARTER_INTEGRITY = CORPUS_STARTER.integrity;
export const WRITER_INTEGRITY = CORPUS_WRITER.integrity;
export const STARTER_VERSION = "0.2.0";
export const WRITER_VERSION = "0.7.0";

export interface SetupPlanOptions {
  readonly starterVersion?: string;
  readonly starterName?: string;
  /** Leave the Starter pin out of the plan's packages. */
  readonly withoutStarter?: boolean;
  /** Leave the install out of the plan's packages. */
  readonly withoutInstall?: boolean;
  readonly repository?: string;
}

/** A plan that staffs one repository, pins Starter in it and installs one more package there. */
export function setupPlan(options: SetupPlanOptions = {}): AdvisorPlan {
  const repository = options.repository ?? SITE_ID;
  const starterName = options.starterName ?? STARTER_NAME;
  const packages: Loose[] = [];
  if (options.withoutStarter !== true) {
    packages.push({
      planItem: `${repository}:${starterName}`,
      repository,
      act: "pin-starter",
      name: starterName,
      version: options.starterVersion ?? STARTER_VERSION,
      integrity: STARTER_INTEGRITY,
      placement: "devDependencies",
    });
  }
  if (options.withoutInstall !== true) {
    packages.push({
      planItem: `${repository}:${WRITER_NAME}`,
      repository,
      act: "install",
      name: WRITER_NAME,
      version: WRITER_VERSION,
      integrity: WRITER_INTEGRITY,
      placement: "devDependencies",
    });
  }
  const plan = clone(CORPUS_PLAN) as unknown as Loose;
  plan.staffing = [{ repository, roles: ["strategist", "writer"] }];
  plan.packages = packages;
  return plan as AdvisorPlan;
}

export const HUB_BRIEF: EngagementBrief = {
  schemaVersion: 1,
  problem: "Our site doesn't explain what we do.",
  roles: [
    { role: "strategist", why: "Sets the direction.", goal: { metric: "direction-clarity", direction: "increase" }, inputsFrom: [], outputsTo: ["writer"] },
    { role: "writer", why: "Writes the pages.", goal: { metric: "pages-published", direction: "increase" }, inputsFrom: ["strategist"], outputsTo: [] },
  ],
  sequence: ["strategist", "writer"],
  deliverables: ["A direction.", "The pages."],
};

export const SKILLS = [
  { role: "advisor", content: "# Advisor\n" },
  { role: "strategist", content: "# Strategist\n" },
  { role: "writer", content: "# Writer\n" },
];

export const NPM_LOCK_TEXT = `${JSON.stringify({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "site", version: "1.0.0" } } }, null, 2)}\n`;

/** An observation of a repository with no Clossys file in it yet: the setup phase, npm, a lockfile and no Starter. */
export function setupObservation(patch: Partial<RepositoryObservation> = {}): RepositoryObservation {
  return {
    id: SITE_ID,
    nodeId: SITE_NODE_ID,
    visibility: "private",
    defaultBranch: "main",
    baseCommit: "a".repeat(40),
    phase: "setup",
    packageManager: "npm",
    lockfile: "package-lock.json",
    releaseAgeSurfaces: [],
    consumerCi: false,
    symlinkedSkillRoots: [],
    repositoryProfile: null,
    linkedAgentsPaths: [],
    files: [{ path: "package-lock.json", sha256: sha(NPM_LOCK_TEXT) }],
    manifestEntries: [],
    lockedPackages: [],
    ledger: null,
    skillsManifest: null,
    ...patch,
  };
}

export const PNPM_LOCK_TEXT = "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\npackages: {}\n\nsnapshots: {}\n";

/** A pnpm repository still in the setup phase; `surface` is the text of pnpm-workspace.yaml (null: absent). */
export function pnpmSetupObservation(surface: string | null, patch: Partial<RepositoryObservation> = {}): RepositoryObservation {
  return setupObservation({
    packageManager: "pnpm",
    lockfile: "pnpm-lock.yaml",
    releaseAgeSurfaces: surface === null ? [] : [{ surface: "pnpm-workspace", path: "pnpm-workspace.yaml" }],
    files: [
      { path: "pnpm-lock.yaml", sha256: sha(PNPM_LOCK_TEXT) },
      ...(surface === null ? [] : [{ path: "pnpm-workspace.yaml", sha256: sha(surface) }]),
    ],
    ...(surface === null ? {} : { pnpmWorkspaceText: surface }),
    ...patch,
  });
}

export function setupInputs(observation: RepositoryObservation | null, plan: AdvisorPlan = setupPlan(), patch: Partial<PlanApplyBundleInputs> = {}): PlanApplyBundleInputs {
  return {
    plan,
    hubBrief: HUB_BRIEF,
    repositories: observation === null ? [] : [observation],
    skills: SKILLS,
    producer: { name: "@clossys/launcher", version: "0.4.0" },
    engine: { name: "@clossys/advisor", version: "0.8.0", integrity: STARTER_INTEGRITY },
    integrator: { name: "@clossys/integrator", version: "0.6.0", integrity: WRITER_INTEGRITY },
    planCommitted: true,
    authorization: { planDigest: planDigest(plan), expiresAt: "2999-01-01T00:00:00Z" },
    computedAt: "2026-09-24T12:00:00Z",
    heldChangeSets: [],
    ...patch,
  };
}

/**
 * The materialized fixture of apply-step-fixture.ts, its set extended with the `agents-guide` item and the whole file
 * the guide file at AGENTS_GUIDE_PATH (the constant text, or `guideText` to put other bytes in the set), resealed, and bundled, approved and stored in the hub over the extended set. The clone
 * is on the default branch with nothing written: materialize writes the guide from `texts`.
 */
export function buildGuideFixture(roots: string[], guideText: string = AGENTS_GUIDE_TEXT) {
  let extended: { set: RepositoryChangeSet; plan: AdvisorPlan; bundle: ApplyBundle } | null = null;
  const fixture = buildMaterializedFixture(roots, {
    hub: ({ set }) => {
      const loose = clone(set) as unknown as Loose;
      loose.items = canonicalOrder([...(loose.items as ChangeSetItem[]), { id: "agents-guide", act: "write-record", source: "agents-guide" } as ChangeSetItem], CANONICAL_KEYS.item);
      loose.files = canonicalOrder(
        [...(loose.files as RepositoryChangeSet["files"][number][]), { path: AGENTS_GUIDE_PATH, mode: "100644", before: null, after: contentDigest(guideText), item: "agents-guide" } as RepositoryChangeSet["files"][number]],
        CANONICAL_KEYS.file,
      );
      const sealed = reseal(loose);
      const plan0 = basePlan() as unknown as AdvisorPlan;
      const bundle = bundleOf(plan0, [{ id: MATERIALIZED_SITE_ID, set: sealed }]);
      const plan = approvedPlan(bundle.bundleDigest, plan0);
      extended = { set: { ...sealed, bundle: bundle.bundleDigest } as RepositoryChangeSet, plan, bundle };
      return { plans: [plan], bundles: [bundle] };
    },
  });
  if (extended === null) throw new Error("the fixture did not build its hub");
  const { set, plan, bundle } = extended as { set: RepositoryChangeSet; plan: AdvisorPlan; bundle: ApplyBundle };
  return {
    ...fixture,
    set,
    plan,
    bundle,
    binding: { kind: "approved" as const, subjectDigest: bundle.bundleDigest },
    planPackages: committedPlanPackages(plan, MATERIALIZED_SITE_ID),
    texts: { ...fixture.texts, [AGENTS_GUIDE_PATH]: guideText },
  };
}
