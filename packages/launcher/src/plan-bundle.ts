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
//
// A setup-phase repository is skipped, not computed: the change-set
// contract requires a setup set to carry the setup templates (code rule
// C11), and this module does not compute them yet. So is a repository whose
// Controller profile needs root entries added (code rule C13): this module
// does not compute the edited profile's bytes yet.

import type { AdvisorPlan, EngagementBrief, EngagementBriefRole, EngagementContext, PlanPackageAct } from "./plan-contract.js";
import { loadPackedContract, validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import {
  AUTHORIZATION_PLAN_MISMATCH, BRIEF_PATH, CANONICAL_KEYS, DISCOVERY_ROOTS, ID_TOKEN, LEDGER_PATH, derivedPlanItem, SKILLS_MANIFEST_PATH, canonicalOrder, contentDigest, dependencyPointer,
  discoveryLinkPath, discoveryLinkTarget, isSafeRelativePath, lockfilePath, matchesPathPattern, skillPath, validateApplyBundle, validateRepositoryChangeSet,
  worstVerdict,
} from "./change-set-contract.js";
import type {
  ApplyBundle, ApplyBundleRepository, ApplyCheck, ChangeSetItem, ChangeSetPhase, ChangeSetRefusal, DependencyPlacement, DiscoveryRoot,
  FileChange, KeyChange, LockfileName, PackageInvariant, PackageManagerKind, PinnedPackage, ReleaseAgeSurfaceKind, RepositoryChangeSet, RepositoryProfileObservation,
  RepositoryVisibility,
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
  /** setup unless the base already carries what proves a later pull request; decided from the base by the caller. A setup repository is skipped for now. */
  readonly phase: ChangeSetPhase;
  readonly packageManager: PackageManagerKind;
  readonly lockfile: LockfileName;
  readonly releaseAgeSurfaces: readonly { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[];
  /** Whether the default branch has a workflow of its own, one whose file name does not start with clossys-. */
  readonly consumerCi: boolean;
  /** The discovery roots that are, or lie under, a symbolic link on the default branch; no discovery link is written under them. */
  readonly symlinkedSkillRoots: readonly DiscoveryRoot[];
  /**
   * The Controller repository profile the default branch declares, or null:
   * its path, whether it has a root vocabulary Controller checks, and which
   * root names this set introduces that it does not declare or prohibits
   * (`wouldViolateRootEntries()` judges these from the profile).
   */
  readonly repositoryProfile: RepositoryProfileObservation | null;
  /** Which of `.agents`, `.agents/skills` and `.agents/skills/clossys-<role>` is a symbolic link on the default branch. */
  readonly linkedAgentsPaths: readonly string[];
  /**
   * Every file on the default branch that the apply flow may write -- under
   * `clossys/`, under `.agents/skills/`, under `.claude/skills/` and
   * `.cursor/skills/`, and the lockfile -- with its content digest (`sha256:`
   * and 64 hex digits; a symbolic link's content is its target). A path not
   * listed is read as absent, so this must be complete for those paths.
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
  /** The exact Integrator package the hub pins. */
  readonly integrator: PinnedPackage;
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

const BASE_ALLOW_LIST = [".agents/skills/clossys-*/**", "clossys/**"];
const RESERVED_ITEM_IDS = new Set(["brief", "skills", "ledger", "root-entries"]);
const ROOT_ENTRIES_ITEM = "root-entries";

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

/**
 * The exact bytes of clossys/.state/skills.json for the skills a set writes:
 * each role's name, source catalogue, the hex SHA-256 of its SKILL.md and the
 * producer's version, sorted by name, as two-space JSON and one line feed,
 * with no time in it (apply-change-set-digest.md, Content digests).
 */
export function serializeComposedSkillsManifest(skills: readonly { readonly role: string; readonly sha256: string }[], producerVersion: string): string {
  const entries = canonicalOrder(skills, (skill) => [skill.role]).map((skill) => ({
    name: skill.role,
    source: "catalogue",
    sha256: skill.sha256.slice("sha256:".length),
    version: producerVersion,
  }));
  return `${JSON.stringify({ schemaVersion: 1, skills: entries }, null, 2)}\n`;
}

function isSkipped(entry: RepositoryObservation | SkippedRepositoryObservation): entry is SkippedRepositoryObservation {
  return Object.hasOwn(entry, "skipped");
}

/** Checks in one order, by check id, then rule. */
function sortChecks(checks: readonly ApplyCheck[]): ApplyCheck[] {
  return canonicalOrder(checks, (check) => [check.check, check.rule ?? ""]);
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
  // Paths compare case-insensitively (code rule C3): a base file that differs only in case is the same file on many checkouts.
  const existing = new Map(observation.files.map((file) => [file.path.toLowerCase(), file.sha256]));
  const existingAt = (path: string) => existing.get(path.toLowerCase());
  const items: ChangeSetItem[] = [];
  const files: FileChange[] = [];
  const keys: KeyChange[] = [];
  const refused: ChangeSetRefusal[] = [];
  const pathAllowList = [...BASE_ALLOW_LIST];
  // A path is present when a file is there, or when it is a directory holding one.
  const presentAt = (path: string) => existingAt(path) !== undefined || observation.files.some((file) => file.path.toLowerCase().startsWith(`${path.toLowerCase()}/`));

  const writeWhole = (path: string, text: string, item: string, mode: "100644" | "120000" = "100644") => {
    if (!isSafeRelativePath(path) || !pathAllowList.some((pattern) => matchesPathPattern(path, pattern))) {
      refused.push({ path, reason: "unsafe-path", item });
      return false;
    }
    if (presentAt(path)) {
      // Empty ledger: nothing shows the flow wrote what is there, so it is not taken over.
      refused.push({ path, reason: "unowned-existing", item });
      return false;
    }
    files.push({ path, mode, before: null, after: contentDigest(text), item });
    return true;
  };

  items.push({ id: "brief", act: "write-record", source: "engagement-brief" });
  const brief = projectEngagementBrief(inputs.hubBrief, roles, observation.visibility);
  const briefValidation = validateEngagementBrief(brief);
  if (!briefValidation.valid) throw new TypeError(`a projected brief does not validate: ${briefValidation.reason}`);
  writeWhole(BRIEF_PATH, serializeEngagementBrief(brief), "brief");

  items.push({ id: "skills", act: "compose-skills", roles: [...roles] });
  // A discovery link is written under each root the base does not have as a symbolic link: a write through one would land where it points.
  const linkedRoots = DISCOVERY_ROOTS.filter((root) => !observation.symlinkedSkillRoots.includes(root));
  for (const root of linkedRoots) pathAllowList.push(`${root}/clossys-*`);
  const composed: { role: string; sha256: string }[] = [];
  for (const role of roles) {
    const content = skillContent.get(role);
    if (content === undefined) throw new TypeError("a staffed role has no composed skill content in skills");
    const skill = skillPath(role);
    // Never write through a symbolic link: the bytes would land wherever it points.
    if (observation.linkedAgentsPaths.some((link) => skill.startsWith(`${link}/`))) refused.push({ path: skill, reason: "skills-root-is-link", item: "skills" });
    else if (writeWhole(skill, content, "skills")) {
      composed.push({ role, sha256: contentDigest(content) });
      // Links only to a skill the set writes: a link to a refused skill would expose one the flow does not own.
      for (const root of linkedRoots) writeWhole(discoveryLinkPath(root, role), discoveryLinkTarget(role), "skills", "120000");
    }
  }
  writeWhole(SKILLS_MANIFEST_PATH, serializeComposedSkillsManifest(composed, inputs.producer.version), "skills");

  const invariants: PackageInvariant[] = [];
  for (const act of acts) {
    if (RESERVED_ITEM_IDS.has(act.planItem)) throw new TypeError("a package act's planItem is an item id the change set reserves (brief, skills, ledger or root-entries)");
    const pinned: PinnedPackage = { name: act.name, version: act.version, integrity: act.integrity };
    const entries = observation.manifestEntries.filter((entry) => entry.name === act.name);
    const satisfiedInBase =
      entries.length === 1 &&
      entries[0]!.placement === act.placement &&
      entries[0]!.value === act.version &&
      observation.lockedPackages.some((locked) => locked.name === act.name && locked.version === act.version && locked.integrity === act.integrity);
    items.push({ id: act.planItem, act: act.act, planItem: act.planItem, package: pinned, placement: act.placement, satisfiedInBase });
    if (satisfiedInBase) continue;
    const pointer = dependencyPointer(act.placement, act.name);
    if (observation.packageManager === "none") {
      refused.push({ file: "package.json", pointer, reason: "manifest-absent", item: act.planItem });
      continue;
    }
    if (entries.length > 0) {
      const pointers = new Set(entries.map((entry) => dependencyPointer(entry.placement, entry.name)));
      for (const existingPointer of pointers) refused.push({ file: "package.json", pointer: existingPointer, reason: "unowned-existing", item: act.planItem });
      continue;
    }
    keys.push({ file: "package.json", pointer, before: null, after: act.version, item: act.planItem });
    invariants.push({ item: act.planItem, ...pinned });
  }

  const lockfile = lockfilePath(observation);
  if (invariants.length > 0 && lockfile !== null) {
    pathAllowList.push("package.json", lockfile);
    const sorted = canonicalOrder(invariants, CANONICAL_KEYS.invariant);
    files.push({ path: lockfile, mode: "100644", derived: true, item: sorted[0]!.item, invariants: sorted, before: existingAt(lockfile) ?? null });
  }

  items.push({ id: "ledger", act: "write-ledger" });
  files.push({
    path: LEDGER_PATH,
    mode: "100644",
    derived: true,
    item: "ledger",
    invariants: [{ ledgerGeneration: observation.ledgerGeneration + 1 }],
    before: existingAt(LEDGER_PATH) ?? null,
  });

  // A profile that needs no new entry needs no item; one that needs entries added is skipped by the caller, so only a refused declaration is written here.
  const profile = observation.repositoryProfile;
  if (profile !== null && (profile.rootVocabulary === "unparseable" || profile.prohibitedRoots.length > 0)) {
    items.push({
      id: ROOT_ENTRIES_ITEM,
      act: "declare-root-entry",
      path: profile.path,
      entries: profile.rootVocabulary === "unparseable" ? [] : profile.undeclaredRoots.map((name) => ({ name, classification: "extension", disposition: "allowed" })),
    });
    refused.push({ path: profile.path, reason: profile.rootVocabulary === "unparseable" ? "root-vocabulary-unknown" : "root-entry-prohibited", item: ROOT_ENTRIES_ITEM });
  }

  const checks: ApplyCheck[] = [];
  const reasons = new Set(refused.map((refusal) => refusal.reason));
  if (reasons.has("unsafe-path")) checks.push({ check: "V6", verdict: "violated", rule: "unsafe-path" });
  if (reasons.has("unowned-existing")) checks.push({ check: "V6", verdict: "indeterminate", rule: "unowned-existing" });
  if (reasons.has("manifest-absent")) checks.push({ check: "V6", verdict: "indeterminate", rule: "manifest-absent" });
  if (reasons.has("root-vocabulary-unknown")) checks.push({ check: "V6", verdict: "indeterminate", rule: "root-vocabulary-unknown" });
  if (reasons.has("root-entry-prohibited")) checks.push({ check: "V6", verdict: "indeterminate", rule: "root-entry-prohibited" });
  if (reasons.has("skills-root-is-link")) checks.push({ check: "V6", verdict: "indeterminate", rule: "skills-root-is-link" });
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
      integrator: { name: inputs.integrator.name, version: inputs.integrator.version, integrity: inputs.integrator.integrity },
      observed: {
        packageManager: observation.packageManager,
        lockfile: observation.lockfile,
        releaseAgeSurfaces: canonicalOrder(
          observation.releaseAgeSurfaces.map((surface) => ({ surface: surface.surface, path: surface.path })),
          CANONICAL_KEYS.surface,
        ),
        consumerCi: observation.consumerCi,
        symlinkedSkillRoots: canonicalOrder([...new Set(observation.symlinkedSkillRoots)], CANONICAL_KEYS.root),
        repositoryProfile:
          profile === null
            ? null
            : {
                path: profile.path,
                rootVocabulary: profile.rootVocabulary,
                undeclaredRoots: canonicalOrder([...new Set(profile.undeclaredRoots)], CANONICAL_KEYS.name),
                prohibitedRoots: canonicalOrder([...new Set(profile.prohibitedRoots)], CANONICAL_KEYS.name),
              },
        linkedAgentsPaths: canonicalOrder([...new Set(observation.linkedAgentsPaths)], CANONICAL_KEYS.name),
      },
      // Every array whose order carries no meaning is written in the contract's canonical order (code rule C8).
      items: canonicalOrder(items, CANONICAL_KEYS.item),
      files: canonicalOrder(files, CANONICAL_KEYS.file),
      keys: canonicalOrder(keys, CANONICAL_KEYS.key),
      refused: canonicalOrder(refused, CANONICAL_KEYS.refusal),
      // Only an apply set is computed, and an apply set defers nothing (code rule C10).
      deferred: [],
      pathAllowList: canonicalOrder(pathAllowList, CANONICAL_KEYS.pattern),
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
 *   skills with their discovery links and manifest, every package act the
 *   plan names for it, and the ledger. Every act the plan authorizes is an
 *   item, never dropped, and no act the plan does not name is ever added.
 * - A setup-phase repository is skipped as `setup-template-unbuilt`, with
 *   verdict indeterminate: a setup set must carry the setup templates, which
 *   this planner does not compute yet. A repository whose Controller profile
 *   needs root entries added is skipped as `root-entry-edit-unbuilt` for the
 *   same reason: the edited profile's bytes are not computed yet. A profile
 *   that is unparseable, or that prohibits a root name the set introduces,
 *   gets a declare-root-entry item refused as `root-vocabulary-unknown` or
 *   `root-entry-prohibited`.
 * - A role's skill under a symbolic link (`.agents`, `.agents/skills` or its
 *   own directory) is refused as `skills-root-is-link`, never written.
 * - A package act the default branch already satisfies exactly is kept as an
 *   item with `satisfiedInBase: true` and writes nothing.
 * - A path or key the default branch already has is refused as
 *   `unowned-existing` (the installed-state ledger is read as empty).
 * - A staffed repository with no observation, with a skip reason, in the
 *   setup phase, or whose profile needs root entries added is skipped and
 *   left out of the bundle digest.
 *
 * Throws, naming positions and never values, when the plan or hub brief does
 * not validate, the plan has no staffing, a staffed role is not a lowercase id
 * token (`role-not-an-id`), a package act's planItem is not its repository id,
 * a colon and its package name (`plan-item-not-derived`), the hub brief has `staffedHere`, an
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

  // Plan text never reaches a public ledger: a role becomes part of paths, and a planItem is written as it is (code rules C16, L5 and L10).
  staffing.forEach((entry, index) => {
    entry.roles.forEach((role, at) => {
      if (!ID_TOKEN.test(role)) throw new TypeError(`staffing[${index}].roles[${at}] is not a lowercase id token (role-not-an-id)`);
    });
  });
  (inputs.plan.packages ?? []).forEach((act, index) => {
    if (act.planItem !== derivedPlanItem(act.repository, act.name)) {
      throw new TypeError(`packages[${index}].planItem is not the repository id, a colon and the package name (plan-item-not-derived)`);
    }
  });

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
    const profile = observation.repositoryProfile;
    if (profile !== null && profile.rootVocabulary === "checked" && profile.undeclaredRoots.length > 0 && profile.prohibitedRoots.length === 0) {
      // Adding the entries needs the edited profile's bytes (code rule C13), which this planner does not compute yet.
      entries.push({ id: staffingEntry.repository, verdict: "indeterminate", reason: "root-entry-edit-unbuilt", checks: [] });
      continue;
    }
    if (observation.phase === "setup") {
      // A setup set must hold the setup templates (code rule C11), which this planner does not compute yet.
      entries.push({ id: staffingEntry.repository, verdict: "indeterminate", reason: "setup-template-unbuilt", checks: [] });
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

  const authorizationMismatch = inputs.authorization !== null && inputs.authorization.planDigest !== digestOfPlan;
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
      const { id, phase, set, checks: own } = computed[entry.pending]!;
      // A pure check that needs no observation: an authorization issued for another plan permits none of this one (code rule A4).
      const checks = sortChecks(authorizationMismatch ? [...own, { check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH }] : own);
      return { id, verdict: worstVerdict(checks.map((check) => check.verdict)), phase, changeSet: set.changeSetDigest, checks };
    }),
    bundleDigest: digestOfBundle,
  };
  const bundleValidation = validateApplyBundle(bundle);
  if (!bundleValidation.valid) throw new Error(`the computed bundle does not validate: ${bundleValidation.reason}`);
  return { bundle, changeSets };
}
