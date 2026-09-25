// The pure apply planner (issue #1178): from an approved plan's validated
// records and from observations of each staffed repository's default
// branch, it computes one change set per repository and the report-mode
// bundle that holds them. It performs no I/O of any kind -- no file, no
// network, no process, no clock -- so the same inputs always give the same
// bytes. Reading the repositories, the hub and the composed skills is the
// caller's job, and the caller hands the results in.
//
// The shapes it produces are defined by the shared contracts
// repository-change-set.json and apply-bundle.json, and the digests by
// apply-change-set-digest.md (all in the public repository, not shipped in
// this package). Every set and the bundle are validated against those
// contracts, code rules included, before they are returned; a planner
// defect throws rather than returning a set that does not validate.
//
// Ownership follows the apply RFC's desired-minus-installed table with an
// empty installed-state ledger: a path or key the default branch already
// has is refused (unowned-existing), never taken over. Reading a real
// ledger and trusting it is a later check this module does not run, which
// is also why the bundle claims no repository state.

import { createHash } from "node:crypto";
import type { AdvisorPlan, EngagementBrief, EngagementBriefRole, EngagementContext, PlanPackageAct } from "./plan-contract.js";
import { loadPackedContract, validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import { LEDGER_PATH, isSafeRelativePath, matchesPathPattern, validateApplyBundle, validateRepositoryChangeSet } from "./change-set-contract.js";
import type {
  ApplyBundle, ApplyBundleRepository, ApplyCheck, ChangeSetDeferral, ChangeSetItem, ChangeSetPhase, ChangeSetRefusal, CheckVerdict, DependencyPlacement,
  FileChange, KeyChange, LockfileName, PackageInvariant, PackageManagerKind, PinnedPackage, ReleaseAgeSurfaceKind, RepositoryChangeSet, RepositoryVisibility,
} from "./change-set-contract.js";

/** What was read from one staffed repository's default branch. The planner trusts it as given. */
export interface RepositoryObservation {
  /** The repository inventory id, spelled exactly as in the plan's staffing. */
  readonly id: string;
  /** GitHub's immutable node id for the repository. */
  readonly nodeId: string;
  readonly visibility: RepositoryVisibility;
  readonly defaultBranch: string;
  /** The default branch's head commit. */
  readonly baseCommit: string;
  /** setup unless the base already carries what proves a later pull request; decided from the base by the caller. */
  readonly phase: ChangeSetPhase;
  readonly packageManager: PackageManagerKind;
  readonly lockfile: LockfileName;
  readonly releaseAgeSurfaces: readonly { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[];
  /**
   * Every file on the default branch that the apply flow may write -- under
   * `clossys/`, under `.agents/skills/`, and the lockfile -- with its content
   * digest (`sha256:` and 64 hex digits). A path not listed is read as absent,
   * so this must be complete for those paths.
   */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  /** Every entry of the default branch's package.json `dependencies` and `devDependencies`: the name and its value as written. */
  readonly manifestEntries: readonly { readonly placement: DependencyPlacement; readonly name: string; readonly value: string }[];
  /** What the default branch's lockfile resolves each package to. */
  readonly lockedPackages: readonly PinnedPackage[];
  /** The installed-state ledger's generation on the default branch; 0 when there is none. */
  readonly ledgerGeneration: number;
}

/** A staffed repository no change set is computed for, and why, as an id such as `not-in-inventory`. */
export interface SkippedRepositoryObservation {
  readonly id: string;
  readonly skipped: string;
  readonly verdict?: "violated" | "indeterminate";
}

export interface PlanApplyBundleInputs {
  /** The plan, clossys/advisor/plan.json. It must validate and have `staffing`. */
  readonly plan: AdvisorPlan;
  /** The hub brief, clossys/advisor/brief.json: validated, and without `staffedHere`. Each repository gets its own projection of it. */
  readonly hubBrief: EngagementBrief;
  /** One entry per staffed repository; a staffed repository with no entry is skipped as `not-observed`. */
  readonly repositories: readonly (RepositoryObservation | SkippedRepositoryObservation)[];
  /** The composed SKILL.md text for every staffed role. */
  readonly skills: readonly { readonly role: string; readonly content: string }[];
  /** The package and exact version computing the sets. */
  readonly producer: { readonly name: string; readonly version: string };
  /** The exact Advisor package the hub pins. */
  readonly engine: PinnedPackage;
  /** Whether the plan read is the one committed at the hub's default-branch head. */
  readonly planCommitted: boolean;
  /** The execution authorization for the plan's package acts, or null when there is none. */
  readonly authorization: { readonly planDigest: string; readonly expiresAt: string } | null;
  /** When the bundle is computed, supplied by the caller: the planner reads no clock. */
  readonly computedAt: string;
}

export interface PlanApplyBundleResult {
  readonly bundle: ApplyBundle;
  /** One change set per repository that has one, in the plan's staffing order. */
  readonly changeSets: readonly RepositoryChangeSet[];
}

/** The fixed text a brief carries as its problem in a repository that is not private, read from the packed brief contract. */
export const PUBLIC_PROBLEM_PLACEHOLDER: string = (() => {
  const definitions = loadPackedContract("engagement-brief.json").definitions as Record<string, { const?: unknown }> | undefined;
  const text = definitions?.publicProblemPlaceholder?.const;
  if (typeof text !== "string") throw new Error("the packed brief contract has no publicProblemPlaceholder text");
  return text;
})();

const BRIEF_PATH = "clossys/brief.json";
const BASE_ALLOW_LIST = ["clossys/**", ".agents/skills/clossys-*/**"];
const RESERVED_ITEM_IDS = new Set(["brief", "skills", "ledger"]);
const DEFAULT_LOCKFILE: Readonly<Record<Exclude<PackageManagerKind, "none">, Exclude<LockfileName, "none">>> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

function projectRole(role: EngagementBriefRole): EngagementBriefRole {
  return {
    role: role.role,
    why: role.why,
    goal: { metric: role.goal.metric, direction: role.goal.direction },
    inputsFrom: [...role.inputsFrom],
    outputsTo: [...role.outputsTo],
  };
}

function projectContext(context: EngagementContext): EngagementContext {
  return {
    schemaVersion: context.schemaVersion,
    fields: context.fields.map((field) => (field.state === "known" ? { id: field.id, state: field.state, value: field.value } : { id: field.id, state: field.state })),
  };
}

/**
 * One repository's brief, projected from the hub brief: `staffedHere` is set
 * to the roles staffed there, in plan order, and `problem` is replaced by
 * PUBLIC_PROBLEM_PLACEHOLDER unless the repository is private. Nothing else
 * changes. Members are written in one fixed order at every depth -- the order
 * the brief and context contracts declare them -- whatever order the hub
 * brief's file used, because these bytes feed the change-set digest.
 */
export function projectEngagementBrief(hubBrief: EngagementBrief, staffedHere: readonly string[], visibility: RepositoryVisibility): EngagementBrief {
  return {
    schemaVersion: hubBrief.schemaVersion,
    problem: visibility === "private" ? hubBrief.problem : PUBLIC_PROBLEM_PLACEHOLDER,
    roles: hubBrief.roles.map(projectRole),
    sequence: [...hubBrief.sequence],
    deliverables: [...hubBrief.deliverables],
    staffedHere: [...staffedHere],
    ...(hubBrief.context === undefined ? {} : { context: projectContext(hubBrief.context) }),
  };
}

/** The exact bytes written to clossys/brief.json: two-space JSON and one final newline. */
export function serializeEngagementBrief(brief: EngagementBrief): string {
  return `${JSON.stringify(brief, null, 2)}\n`;
}

/** `sha256:` and the hex SHA-256 of a text's UTF-8 bytes: a file's content digest. */
function contentDigest(text: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
}

function pointerFor(placement: DependencyPlacement, name: string): string {
  return `/${placement}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function isSkipped(entry: RepositoryObservation | SkippedRepositoryObservation): entry is SkippedRepositoryObservation {
  return Object.hasOwn(entry, "skipped");
}

const VERDICT_RANK: Readonly<Record<CheckVerdict, number>> = { satisfied: 0, indeterminate: 1, violated: 2 };

function worst(checks: readonly ApplyCheck[]): CheckVerdict {
  return checks.reduce<CheckVerdict>((current, check) => (VERDICT_RANK[check.verdict] > VERDICT_RANK[current] ? check.verdict : current), "satisfied");
}

interface ComputedSet {
  readonly changeSet: Omit<RepositoryChangeSet, "branch" | "bundle" | "pullRequest" | "changeSetDigest">;
  readonly checks: readonly ApplyCheck[];
}

function computeChangeSet(
  inputs: PlanApplyBundleInputs,
  planDigestValue: string,
  observation: RepositoryObservation,
  roles: readonly string[],
  acts: readonly PlanPackageAct[],
  skillContent: ReadonlyMap<string, string>,
): ComputedSet {
  const existing = new Map(observation.files.map((file) => [file.path, file.sha256]));
  const items: ChangeSetItem[] = [];
  const files: FileChange[] = [];
  const keys: KeyChange[] = [];
  const refused: ChangeSetRefusal[] = [];
  const deferred: ChangeSetDeferral[] = [];

  const writeWhole = (path: string, text: string, item: string) => {
    if (!isSafeRelativePath(path) || !BASE_ALLOW_LIST.some((pattern) => matchesPathPattern(path, pattern))) {
      refused.push({ path, reason: "unsafe-path", item });
      return;
    }
    if (existing.has(path)) {
      // Empty ledger: nothing shows the flow wrote what is there, so it is not taken over.
      refused.push({ path, reason: "unowned-existing", item });
      return;
    }
    files.push({ path, mode: "100644", before: null, after: contentDigest(text), item });
  };

  items.push({ id: "brief", act: "write-record", source: "engagement-brief" });
  const brief = projectEngagementBrief(inputs.hubBrief, roles, observation.visibility);
  const briefValidation = validateEngagementBrief(brief);
  if (!briefValidation.valid) throw new TypeError(`a projected brief does not validate: ${briefValidation.reason}`);
  writeWhole(BRIEF_PATH, serializeEngagementBrief(brief), "brief");

  items.push({ id: "skills", act: "compose-skills", roles: [...roles] });
  for (const role of roles) {
    const content = skillContent.get(role);
    if (content === undefined) throw new TypeError("a staffed role has no composed skill content in skills");
    // A role must be one path segment: `a/b` would still match the allow-list's `clossys-*/**`.
    const path = `.agents/skills/clossys-${role}/SKILL.md`;
    if (/[/\\]/.test(role)) refused.push({ path, reason: "unsafe-path", item: "skills" });
    else writeWhole(path, content, "skills");
  }

  const invariants: PackageInvariant[] = [];
  for (const act of acts) {
    if (RESERVED_ITEM_IDS.has(act.planItem)) throw new TypeError("a package act's planItem is an item id the change set reserves (brief, skills or ledger)");
    if (observation.phase === "setup" && act.act === "install") {
      deferred.push({ planItem: act.planItem, reason: "after-setup" });
      continue;
    }
    const pinned: PinnedPackage = { name: act.name, version: act.version, integrity: act.integrity };
    const entries = observation.manifestEntries.filter((entry) => entry.name === act.name);
    const satisfiedInBase =
      entries.length === 1 &&
      entries[0]!.placement === act.placement &&
      entries[0]!.value === act.version &&
      observation.lockedPackages.some((locked) => locked.name === act.name && locked.version === act.version && locked.integrity === act.integrity);
    items.push({ id: act.planItem, act: act.act, planItem: act.planItem, package: pinned, placement: act.placement, satisfiedInBase });
    if (satisfiedInBase) continue;
    const pointer = pointerFor(act.placement, act.name);
    if (observation.packageManager === "none") {
      refused.push({ file: "package.json", pointer, reason: "manifest-absent", item: act.planItem });
      continue;
    }
    if (entries.length > 0) {
      for (const entry of entries) refused.push({ file: "package.json", pointer: pointerFor(entry.placement, entry.name), reason: "unowned-existing", item: act.planItem });
      continue;
    }
    keys.push({ file: "package.json", pointer, before: null, after: act.version, item: act.planItem });
    invariants.push({ item: act.planItem, ...pinned });
  }

  const pathAllowList = [...BASE_ALLOW_LIST];
  if (invariants.length > 0 && observation.packageManager !== "none") {
    const lockfile = observation.lockfile === "none" ? DEFAULT_LOCKFILE[observation.packageManager] : observation.lockfile;
    pathAllowList.push("package.json", lockfile);
    files.push({ path: lockfile, mode: "100644", derived: true, item: invariants[0]!.item, invariants, before: existing.get(lockfile) ?? null });
  }

  items.push({ id: "ledger", act: "write-ledger" });
  files.push({
    path: LEDGER_PATH,
    mode: "100644",
    derived: true,
    item: "ledger",
    invariants: [{ ledgerGeneration: observation.ledgerGeneration + 1 }],
    before: existing.get(LEDGER_PATH) ?? null,
  });

  const checks: ApplyCheck[] = [];
  const reasons = new Set(refused.map((refusal) => refusal.reason));
  if (reasons.has("unsafe-path")) checks.push({ check: "V6", verdict: "violated", rule: "unsafe-path" });
  if (reasons.has("unowned-existing")) checks.push({ check: "V6", verdict: "indeterminate", rule: "unowned-existing" });
  if (reasons.has("manifest-absent")) checks.push({ check: "V6", verdict: "indeterminate", rule: "manifest-absent" });
  // The setup template (caller workflow, Starter request, CI) is not computed yet, so a setup set is incomplete.
  if (observation.phase === "setup") checks.push({ check: "V6", verdict: "indeterminate", rule: "setup-template-unbuilt" });
  if (checks.length === 0) checks.push({ check: "V6", verdict: "satisfied" });

  return {
    changeSet: {
      schemaVersion: 1,
      kind: "clossys.repository-change-set",
      producer: { name: inputs.producer.name, version: inputs.producer.version },
      planDigest: planDigestValue,
      repository: {
        id: observation.id,
        nodeId: observation.nodeId,
        visibility: observation.visibility,
        defaultBranch: observation.defaultBranch,
        baseCommit: observation.baseCommit,
      },
      ledger: { generation: observation.ledgerGeneration },
      phase: observation.phase,
      engine: { name: inputs.engine.name, version: inputs.engine.version, integrity: inputs.engine.integrity },
      observed: {
        packageManager: observation.packageManager,
        lockfile: observation.lockfile,
        releaseAgeSurfaces: observation.releaseAgeSurfaces.map((surface) => ({ surface: surface.surface, path: surface.path })),
      },
      items,
      files,
      keys,
      refused,
      deferred,
      pathAllowList,
    },
    checks,
  };
}

/**
 * Computes one change set per staffed repository and the report-mode bundle
 * holding them, from observations only. Pure: it reads no file, clock,
 * network or process, and the same inputs give the same bytes.
 *
 * - Each repository's items are the brief (its projection of the hub brief,
 *   with the public placeholder unless it is private), its staffed roles'
 *   skills, every package act the plan names for it, and the ledger. In a
 *   setup set, an `install` waits in `deferred` for the apply set, so every
 *   act the plan authorizes is either an item or deferred, never dropped,
 *   and no act the plan does not name is ever added.
 * - A package act the default branch already satisfies exactly is kept as an
 *   item with `satisfiedInBase: true` and writes nothing.
 * - A path or key the default branch already has is refused as
 *   `unowned-existing` (the installed-state ledger is read as empty).
 * - A staffed repository with no observation, or with a skip reason, is
 *   skipped and left out of the bundle digest.
 *
 * Throws, naming positions and never values, when the plan or hub brief does
 * not validate, the plan has no staffing, the hub brief has `staffedHere`, an
 * observation repeats or names an unstaffed repository, a staffed role has
 * no skill content, or a computed set or the bundle fails its contract.
 */
export function planApplyBundle(inputs: PlanApplyBundleInputs): PlanApplyBundleResult {
  const planValidation = validateAdvisorPlan(inputs.plan);
  if (!planValidation.valid) throw new TypeError(`the plan does not validate: ${planValidation.reason}`);
  const staffing = inputs.plan.staffing;
  if (staffing === undefined) throw new TypeError("the plan has no staffing, so no repository has a change set");
  const briefValidation = validateEngagementBrief(inputs.hubBrief);
  if (!briefValidation.valid) throw new TypeError(`the hub brief does not validate: ${briefValidation.reason}`);
  if (inputs.hubBrief.staffedHere !== undefined) throw new TypeError("the hub brief must not have staffedHere; each repository's brief is projected from it");

  const skillContent = new Map<string, string>();
  inputs.skills.forEach((skill, index) => {
    if (skillContent.has(skill.role)) throw new TypeError(`skills[${index}] repeats a role`);
    skillContent.set(skill.role, skill.content);
  });

  const staffedIds = new Set(staffing.map((entry) => entry.repository));
  const observations = new Map<string, RepositoryObservation | SkippedRepositoryObservation>();
  inputs.repositories.forEach((entry, index) => {
    if (!staffedIds.has(entry.id)) throw new TypeError(`repositories[${index}] is not a repository the plan staffs (ids must be spelled as in staffing)`);
    if (observations.has(entry.id)) throw new TypeError(`repositories[${index}] repeats a repository`);
    observations.set(entry.id, entry);
  });

  const digestOfPlan = planDigest(inputs.plan);
  const computed: { id: string; phase: ChangeSetPhase; set: Omit<RepositoryChangeSet, "bundle">; checks: readonly ApplyCheck[] }[] = [];
  const entries: (ApplyBundleRepository | { readonly pending: number })[] = [];
  for (const staffingEntry of staffing) {
    const observation = observations.get(staffingEntry.repository);
    if (observation === undefined || isSkipped(observation)) {
      entries.push({
        id: staffingEntry.repository,
        verdict: observation?.verdict ?? "indeterminate",
        reason: observation === undefined ? "not-observed" : observation.skipped,
        checks: [],
      });
      continue;
    }
    const acts = (inputs.plan.packages ?? []).filter((act) => act.repository === staffingEntry.repository);
    const { changeSet, checks } = computeChangeSet(inputs, digestOfPlan, observation, staffingEntry.roles, acts, skillContent);
    const digest = changeSetDigest(changeSet);
    const short = digest.slice("sha256:".length, "sha256:".length + 12);
    const set = { ...changeSet, branch: `clossys/apply-${short}`, pullRequest: { title: `Clossys: apply plan ${short}` }, changeSetDigest: digest };
    entries.push({ pending: computed.length });
    computed.push({ id: staffingEntry.repository, phase: observation.phase, set, checks });
  }

  const digestOfBundle = bundleDigest(digestOfPlan, computed.map((entry) => ({ id: entry.id, changeSetDigest: entry.set.changeSetDigest })));
  const changeSets: RepositoryChangeSet[] = computed.map((entry) => ({ ...entry.set, bundle: digestOfBundle }));
  changeSets.forEach((set, index) => {
    const validation = validateRepositoryChangeSet(set);
    if (!validation.valid) throw new Error(`the change set computed for staffed repository ${index} does not validate: ${validation.reason}`);
  });

  const bundle: ApplyBundle = {
    schemaVersion: 1,
    kind: "clossys.apply-bundle",
    mode: "report",
    plan: { path: "clossys/advisor/plan.json", digest: digestOfPlan, committed: inputs.planCommitted },
    snapshot: inputs.plan.resolution === undefined ? null : { path: "clossys/.state/apply/registry-snapshot.json", digest: inputs.plan.resolution.snapshotDigest },
    engine: { name: inputs.engine.name, version: inputs.engine.version, integrity: inputs.engine.integrity },
    authorization: inputs.authorization === null ? null : { planDigest: inputs.authorization.planDigest, expiresAt: inputs.authorization.expiresAt },
    computedAt: inputs.computedAt,
    repositories: entries.map((entry) => {
      if (!("pending" in entry)) return entry;
      const { id, phase, set, checks } = computed[entry.pending]!;
      return { id, verdict: worst(checks), phase, changeSet: set.changeSetDigest, checks };
    }),
    bundleDigest: digestOfBundle,
  };
  const bundleValidation = validateApplyBundle(bundle);
  if (!bundleValidation.valid) throw new Error(`the computed bundle does not validate: ${bundleValidation.reason}`);
  return { bundle, changeSets };
}
