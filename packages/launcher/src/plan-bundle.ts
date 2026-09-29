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
// Ownership follows the apply RFC's desired-minus-installed table (§12.1)
// over the installed-state ledger the base carries, and only once that
// ledger is trusted (ledger-trust.ts): every generation it records must be a
// change set the hub holds, and every row one of those sets' own writes;
// anything less skips the whole repository. A whole file is written only by
// compare-and-swap against the ledger's row: added where neither the ledger
// nor the base has it, kept or updated where the base still holds the bytes
// the flow last wrote, and refused otherwise (unowned-existing,
// client-edited, deleted). An owned package key follows the same table. The
// planner never removes what the ledger records and the desired state no
// longer names; it reports that (removal-unbuilt) and leaves the row to be
// carried forward. The bundle still claims no repository state.
//
// A setup-phase repository gets a setup set (code rules C10 to C12): the
// brief, the skills and the ledger as an apply set has them, exactly one item
// for each of the four setup templates -- whose bytes come only from
// renderSetupTemplate() -- the Starter pin the plan names, every install the
// plan names deferred until after setup, and, for pnpm, the one edit that
// exempts the publishing scope from the release-age window. A setup set is
// also the only place the generation-0 adoption pass runs (RFC §12.2): a file
// the base already holds is adopted only by byte proof. Every ambiguity is a
// skip with its own reason id (`package-manager-unsupported`,
// `starter-pin-absent`, `starter-pin-unsupported`, `release-age-text-absent`,
// `starter-request-invalid`, and, for an apply set, `starter-request-stale`),
// never a guess. A repository whose Controller profile needs root entries
// added (code rule C13) is skipped as root-entry-edit-unbuilt when the
// observation does not carry the profile text; when repositoryProfileText is
// present, the profile is edited here.

import type { AdvisorPlan, EngagementBrief, EngagementBriefRole, EngagementContext, PlanPackageAct } from "./plan-contract.js";
import { loadContract, validateAdvisorPlan, validateEngagementBrief } from "./plan-contract.js";
import { planDigest } from "./plan-digest.js";
import { HUB_ONLY_ROLES } from "./plan-rules.js";
import { bundleDigest, changeSetDigest } from "./change-set-digest.js";
import {
  AUTHORIZATION_ABSENT, AUTHORIZATION_PLAN_MISMATCH, BRIEF_PATH, CANONICAL_KEYS, DISCOVERY_ROOTS, EXEMPTION_SURFACES, ID_TOKEN, LEDGER_PATH, derivedPlanItem, SKILLS_MANIFEST_PATH, TEMPLATE_PATHS, canonicalOrder, contentDigest,
  dependencyPointer, discoveryLinkPath, discoveryLinkTarget, isSafeRelativePath, lockfilePath, matchesPathPattern, skillPath, validateApplyBundle, validateRepositoryChangeSet,
  worstVerdict,
} from "./change-set-contract.js";
import type {
  ApplyBundle, ApplyBundleRepository, ApplyCheck, ChangeSetDeferral, ChangeSetItem, ChangeSetPhase, ChangeSetRefusal, DependencyPlacement, DiscoveryRoot,
  FileChange, KeyChange, LockfileName, PackageInvariant, PackageManagerKind, PinnedPackage, ReleaseAgeSurfaceKind, RepositoryChangeSet, RepositoryProfileObservation,
  RepositoryVisibility, TemplateAct,
} from "./change-set-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { JsonEditUnstableError, editJsonPointer } from "./key-editor.js";
import { reconcileWholeFile, trustInstalledLedger } from "./ledger-trust.js";
import type { PlanPackageActs } from "./ledger-trust.js";
import { editReleaseAgeExemption } from "./release-age-edit.js";
import { renderSetupTemplate } from "./setup-templates.js";

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
  /** setup unless the base already carries what proves a later pull request; decided from the base by the caller. A setup repository gets a setup set. */
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
   * `.cursor/skills/`, the setup templates (`.github/workflows/clossys-*`,
   * `.github/scripts/clossys-*` and `.starter/request.json`), and the
   * lockfile -- with its content digest (`sha256:` and 64 hex digits; a
   * symbolic link's content is its target). A path not listed is read as
   * absent, so this must be complete for those paths.
   */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  /** Every entry of the default branch's package.json `dependencies` and `devDependencies`: the name and its value as written. */
  readonly manifestEntries: readonly { readonly placement: DependencyPlacement; readonly name: string; readonly value: string }[];
  /** What the default branch's lockfile resolves each package to. */
  readonly lockedPackages: readonly PinnedPackage[];
  /**
   * The exact bytes of the installed-state ledger, clossys/.state/installed.json,
   * at baseCommit, or null when the base has none. It is trusted only as
   * trustInstalledLedger() allows, against `heldChangeSets`; its generation
   * is the one the set is computed over.
   */
  readonly ledger: Uint8Array | null;
  /**
   * The entries of the base's composed-skill manifest,
   * clossys/.state/skills.json -- each skill's name and the 64 hex digits of
   * its SKILL.md's SHA-256, with no `sha256:` prefix, as
   * serializeComposedSkillsManifest() writes them -- or null when the base
   * has none or it cannot be read. Only a setup set's adoption pass reads it.
   */
  readonly skillsManifest: readonly { readonly name: string; readonly sha256: string }[] | null;
  /** Exact bytes of the Controller repository profile on the default branch, when the caller read them for declare-root-entry (code rule C13). */
  readonly repositoryProfileText?: string | null;
  /**
   * Exact text of pnpm-workspace.yaml on the default branch, when the caller read it (null or absent: not supplied). A pnpm setup
   * set edits this file to exempt the publishing scope from the release-age window; when the file is there and its text is not
   * supplied, the repository is skipped as `release-age-text-absent`. It must be the file `files` digests, or the planner throws.
   */
  readonly pnpmWorkspaceText?: string | null;
  /**
   * Exact text of .npmrc on the default branch, when the caller read it (null or absent: not supplied). A pnpm setup set reads it
   * to refuse an edit that a setting there would contradict; when the file is there and its text is not supplied, the repository
   * is skipped as `release-age-text-absent`. `files` must digest .npmrc too, and the text must be that file, or the planner throws.
   */
  readonly npmrcText?: string | null;
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
  /** The composed SKILL.md text for every staffed role, and for the Advisor voice every staffed repository also gets (D33). */
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
  /** Every change set the hub holds (clossys/.state/apply/change-sets/), read by the caller; a ledger is trusted only against these. */
  readonly heldChangeSets: readonly RepositoryChangeSet[];
  /** Package identities by plan digest for ledger history the held sets name; defaults to this plan's acts per staffed repository. */
  readonly planPackageActs?: readonly PlanPackageActs[];
}

export interface PlanApplyBundleResult {
  readonly bundle: ApplyBundle;
  /** One change set per repository that has one, in the plan's staffing order. */
  readonly changeSets: readonly RepositoryChangeSet[];
}

/** The fixed text a brief carries as its problem in a repository that is not private, read from the packed brief contract. */
export const PUBLIC_PROBLEM_PLACEHOLDER: string = (() => {
  const definitions = loadContract("engagement-brief.json").definitions as Record<string, { const?: unknown }> | undefined;
  const text = definitions?.publicProblemPlaceholder?.const;
  if (typeof text !== "string") throw new Error("the packed brief contract has no publicProblemPlaceholder text");
  return text;
})();

const BASE_ALLOW_LIST = [".agents/skills/clossys-*/**", "clossys/**"];
const ROOT_ENTRIES_ITEM = "root-entries";
const PROFILE_ALLOW_PATTERNS = ["**/repository-profile.json", "**/repository-declaration.json"];

/** Each setup template act, with the item id a set gives it. */
const TEMPLATE_ITEMS: readonly { readonly act: TemplateAct; readonly id: string }[] = [
  { act: "add-caller-workflow", id: "caller-workflow" },
  { act: "write-starter-request", id: "starter-request" },
  { act: "add-ci-template", id: "ci-template" },
  { act: "add-path-scope-job", id: "path-scope-job" },
];
/** The patterns a set that names the setup templates adds to its pathAllowList. */
const TEMPLATE_ALLOW_LIST = [".github/scripts/clossys-*", ".github/workflows/clossys-*", ".starter/request.json"];
/** The one exempt-release-age item a pnpm set carries: a fixed id no plan text can spell, because a planItem is `repository:package`. */
const RELEASE_AGE_ITEM = "release-age";
const RELEASE_AGE_SURFACE = "pnpm-workspace";
const RESERVED_ITEM_IDS = new Set(["brief", "skills", "ledger", ROOT_ENTRIES_ITEM, RELEASE_AGE_ITEM, ...TEMPLATE_ITEMS.map((template) => template.id)]);
const NPMRC_PATH = ".npmrc";

/**
 * The Advisor voice (D33): every staffed repository gets it beside its
 * staffed roles' voices. It is a hub-only role, never staffed itself (plan
 * rule R11), so it can never repeat a staffed role; a packed plan contract
 * that does not list it as hub-only is a build defect.
 */
const ADVISOR_VOICE = "advisor";
if (!HUB_ONLY_ROLES.includes(ADVISOR_VOICE)) throw new Error("the packed plan contract's hub-only roles do not include the Advisor voice");

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

const CASE_VARIANT = "case-variant";

/** The content digest the observation lists for a path (compared case-insensitively, as C3 does); null when none, CASE_VARIANT when several. */
function observedDigest(observation: RepositoryObservation, path: string): string | null {
  const lower = path.toLowerCase();
  const held = observation.files.filter((file) => file.path.toLowerCase() === lower);
  if (held.length === 0) return null;
  return held.length === 1 ? held[0]!.sha256 : CASE_VARIANT;
}

/** Throws unless each release-age surface text the observation supplies is exactly the file it digests. Names the field, never the text. */
function checkSurfaceTexts(observation: RepositoryObservation): void {
  for (const { field, path, text } of [
    { field: "pnpmWorkspaceText", path: EXEMPTION_SURFACES[RELEASE_AGE_SURFACE].path, text: observation.pnpmWorkspaceText },
    { field: "npmrcText", path: NPMRC_PATH, text: observation.npmrcText },
  ]) {
    if (typeof text !== "string") continue;
    if (observedDigest(observation, path) !== contentDigest(text)) throw new TypeError(`${field} does not match the observed ${path} file`);
  }
}

/** The files one setup template act writes, with the item that names them. */
interface SetupTemplate {
  readonly id: string;
  readonly files: readonly { readonly path: string; readonly bytes: string }[];
}

/**
 * Renders the four setup templates for a repository in the setup phase, or
 * names why it cannot: every reason is an id, and the first one found is the
 * one given. The bytes come from renderSetupTemplate() alone; the request
 * takes the manager, the repository id and the plan's one Starter pin, and
 * nothing else reaches a template.
 */
function prepareSetup(observation: RepositoryObservation, acts: readonly PlanPackageAct[]): { readonly templates: readonly SetupTemplate[] } | { readonly skip: string } {
  const packageManager = observation.packageManager;
  if (packageManager !== "npm" && packageManager !== "pnpm") return { skip: "package-manager-unsupported" };
  const pins = acts.filter((act) => act.act === "pin-starter");
  // Plan rule R10 allows at most one, so any other count is an absent pin: a set pins Starter exactly once (C11).
  if (pins.length !== 1) return { skip: "starter-pin-absent" };
  const pin = pins[0]!;
  const request = renderSetupTemplate("write-starter-request", { packageManager, repository: observation.id, starter: { name: pin.name, version: pin.version, integrity: pin.integrity } });
  if (!request.ok) return { skip: request.refusal.reason === "starter-pin-unsupported" ? "starter-pin-unsupported" : "starter-request-invalid" };
  if (packageManager === "pnpm") {
    // The edit needs the surface's exact text, and the .npmrc's when there is one: nothing is edited from a digest.
    const surface = observedDigest(observation, EXEMPTION_SURFACES[RELEASE_AGE_SURFACE].path);
    if (surface !== null && typeof observation.pnpmWorkspaceText !== "string") return { skip: "release-age-text-absent" };
    const npmrc = observation.releaseAgeSurfaces.some((entry) => entry.path === NPMRC_PATH) || observedDigest(observation, NPMRC_PATH) !== null;
    if (npmrc && typeof observation.npmrcText !== "string") return { skip: "release-age-text-absent" };
  }
  const templates: SetupTemplate[] = [];
  for (const { act, id } of TEMPLATE_ITEMS) {
    const rendered = act === "write-starter-request" ? request : renderSetupTemplate(act, act === "add-caller-workflow" ? { packageManager } : undefined);
    if (!rendered.ok) throw new TypeError(`the setup template ${act} does not render`);
    templates.push({ id, files: rendered.files });
  }
  return { templates };
}

interface ComputedSet {
  readonly changeSet: Omit<RepositoryChangeSet, "branch" | "bundle" | "pullRequest" | "changeSetDigest">;
  readonly checks: readonly ApplyCheck[];
}

/** A repository computeChangeSet() does not give a set, and why: an id such as `integrity-mismatch`. */
interface SkippedSet {
  readonly skip: { readonly verdict: "violated" | "indeterminate"; readonly reason: string };
}

function computeChangeSet(
  inputs: PlanApplyBundleInputs,
  planDigestValue: string,
  observation: RepositoryObservation,
  ledger: InstalledLedger | null,
  roles: readonly string[],
  acts: readonly PlanPackageAct[],
  skillContent: ReadonlyMap<string, string>,
  setupTemplates: readonly SetupTemplate[] | null,
): ComputedSet | SkippedSet {
  // Paths compare case-insensitively (code rule C3): a base file that differs only in case is the same file on many checkouts.
  // Two (or more) observed files at the same lowercase path -- distinct case variants, or a repeated entry -- have no single
  // base digest between them: the path is occupied by other bytes than any one of them, so it can never be kept, updated or
  // adopted, whatever the ledger says (fix for issue #1545). CASE_VARIANT_BASE is a sentinel that never equals a real content
  // digest (those are always `sha256:` and 64 hex digits) or null, so it always reads as "occupied by bytes the flow does not
  // own" wherever a base digest is compared.
  const CASE_VARIANT_BASE = "case-variant";
  const fileGroups = new Map<string, string[]>();
  for (const file of observation.files) {
    const key = file.path.toLowerCase();
    const group = fileGroups.get(key);
    if (group === undefined) fileGroups.set(key, [file.sha256]);
    else group.push(file.sha256);
  }
  const isCaseVariant = (path: string) => (fileGroups.get(path.toLowerCase())?.length ?? 0) > 1;
  const existingAt = (path: string): string | undefined => {
    const group = fileGroups.get(path.toLowerCase());
    if (group === undefined) return undefined;
    return group.length > 1 ? CASE_VARIANT_BASE : group[0];
  };
  // The lockfile and the ledger are derived files this planner writes unconditionally; a case-variant there leaves no single
  // base to compare-and-swap against, so the whole repository is skipped rather than guessing which variant is real.
  const lockfile = lockfilePath(observation);
  if (isCaseVariant(LEDGER_PATH) || (lockfile !== null && isCaseVariant(lockfile))) {
    return { skip: { verdict: "indeterminate", reason: "case-variant-path" } };
  }
  // The trusted ledger's rows: files by path (case-insensitively, as C3 and L8 compare paths), keys by pointer.
  const fileRows = new Map((ledger?.files ?? []).map((row) => [row.path.toLowerCase(), row.after]));
  const fileRowAt = (path: string) => fileRows.get(path.toLowerCase()) ?? null;
  const keyRows = new Map((ledger?.keys ?? []).map((row) => [row.pointer, row.value]));
  const items: ChangeSetItem[] = [];
  const files: FileChange[] = [];
  const keys: KeyChange[] = [];
  const refused: ChangeSetRefusal[] = [];
  const deferred: ChangeSetDeferral[] = [];
  const texts: Record<string, string> = {};
  const pathAllowList = [...BASE_ALLOW_LIST];
  // A path is present when a file is there, or when it is a directory holding one.
  const presentAt = (path: string) => existingAt(path) !== undefined || observation.files.some((file) => file.path.toLowerCase().startsWith(`${path.toLowerCase()}/`));
  // The one compare-and-swap table for a whole file (RFC §12.1); only a setup set may adopt what the base has (§12.2).
  const reconcile = (path: string, desired: string) =>
    reconcileWholeFile({
      path,
      desired,
      row: fileRowAt(path),
      base: existingAt(path) ?? null,
      occupied: presentAt(path),
      phase: observation.phase,
      skillsManifest: observation.skillsManifest,
    });

  const writeWhole = (path: string, text: string, item: string, mode: "100644" | "120000" = "100644") => {
    if (!isSafeRelativePath(path) || !pathAllowList.some((pattern) => matchesPathPattern(path, pattern))) {
      refused.push({ path, reason: "unsafe-path", item });
      return false;
    }
    const desired = contentDigest(text);
    const outcome = reconcile(path, desired);
    if (!outcome.write) {
      refused.push({ path, reason: outcome.reason, item });
      return false;
    }
    // An apply set may keep or update only where the trusted ledger already has a row (issue #1545 fix 7).
    if (observation.phase === "apply" && fileRowAt(path) === null && outcome.before === null) {
      refused.push({ path, reason: "unowned-existing", item });
      return false;
    }
    // before is null (add), the desired digest (keep), or the bytes the flow last wrote (update).
    files.push({ path, mode, before: outcome.before, after: desired, item });
    texts[path] = text;
    return true;
  };

  items.push({ id: "brief", act: "write-record", source: "engagement-brief" });
  // The brief's staffedHere names the staffed roles only; the Advisor voice is not staffed (D33).
  const brief = projectEngagementBrief(inputs.hubBrief, roles, observation.visibility);
  const briefValidation = validateEngagementBrief(brief);
  if (!briefValidation.valid) throw new TypeError(`a projected brief does not validate: ${briefValidation.reason}`);
  writeWhole(BRIEF_PATH, serializeEngagementBrief(brief), "brief");

  // Every staffed repository gets the Advisor voice beside its staffed roles' voices (D33), first, then plan order.
  const voices = [ADVISOR_VOICE, ...roles];
  items.push({ id: "skills", act: "compose-skills", roles: voices });
  // A discovery link is written under each root the base does not have as a symbolic link: a write through one would land where it points.
  const linkedRoots = DISCOVERY_ROOTS.filter((root) => !observation.symlinkedSkillRoots.includes(root));
  for (const root of linkedRoots) pathAllowList.push(`${root}/clossys-*`);
  const composed: { role: string; sha256: string }[] = [];
  for (const role of voices) {
    const content = skillContent.get(role);
    if (content === undefined) throw new TypeError("a staffed role has no composed skill content in skills");
    const skill = skillPath(role);
    // Never write through a symbolic link: the bytes would land wherever it points.
    if (observation.linkedAgentsPaths.some((link) => skill.startsWith(`${link}/`))) refused.push({ path: skill, reason: "skills-root-is-link", item: "skills" });
    else if (writeWhole(skill, content, "skills")) {
      // Added, kept or updated: the skill is the flow's, so the manifest lists it and its links are written.
      composed.push({ role, sha256: contentDigest(content) });
      // Links only to a skill the set writes: a link to a refused skill would expose one the flow does not own.
      for (const root of linkedRoots) writeWhole(discoveryLinkPath(root, role), discoveryLinkTarget(role), "skills", "120000");
    }
  }
  writeWhole(SKILLS_MANIFEST_PATH, serializeComposedSkillsManifest(composed, inputs.producer.version), "skills");

  if (setupTemplates !== null) {
    // A setup set holds each template once, its bytes from the renderer alone. The template patterns join the allow list before any
    // write, so a template path is never refused as unsafe; a base file already there is adopted only when its bytes are exactly
    // the set's own, and is unowned-existing otherwise (RFC §12.2).
    pathAllowList.push(...TEMPLATE_ALLOW_LIST);
    for (const { id, files: templateFiles } of setupTemplates) {
      items.push({ id, act: TEMPLATE_ITEMS.find((template) => template.id === id)!.act });
      for (const file of templateFiles) writeWhole(file.path, file.bytes, id);
    }
  } else {
    // The setup templates in an apply set are no-ops: never written anew, only kept where the trusted ledger records them all.
    // A template act the ledger records none of gets no item.
    for (const { act, id } of TEMPLATE_ITEMS) {
      const rows = TEMPLATE_PATHS[act].map((path) => ({ path, row: fileRowAt(path) }));
      const recorded = rows.filter((entry) => entry.row !== null).length;
      if (recorded === 0) continue;
      // A ledger that records some of an act's files and not the others cannot be kept as that act, and nothing here writes the rest.
      if (recorded < rows.length) return { skip: { verdict: "indeterminate", reason: "template-rows-partial" } };
      items.push({ id, act });
      for (const { path, row } of rows) {
        const outcome = reconcile(path, row!);
        if (outcome.write) files.push({ path, mode: "100644", before: row, after: row, item: id });
        else refused.push({ path, reason: outcome.reason, item: id });
      }
    }
    if (items.some((item) => TEMPLATE_ITEMS.some((template) => template.id === item.id))) pathAllowList.push(...TEMPLATE_ALLOW_LIST);
  }

  const invariants: PackageInvariant[] = [];
  for (const act of acts) {
    if (RESERVED_ITEM_IDS.has(act.planItem)) {
      throw new TypeError("a package act's planItem is an item id the change set reserves (brief, skills, ledger, root-entries, release-age, caller-workflow, starter-request, ci-template or path-scope-job)");
    }
    // A setup set defers every install until after setup (code rule C10): no item, no key, no invariant.
    if (observation.phase === "setup" && act.act === "install") {
      deferred.push({ planItem: act.planItem, reason: "after-setup" });
      continue;
    }
    const pinned: PinnedPackage = { name: act.name, version: act.version, integrity: act.integrity };
    const entries = observation.manifestEntries.filter((entry) => entry.name === act.name);
    const pointer = dependencyPointer(act.placement, act.name);
    // The owned key follows the same table as a whole file (RFC §12.1): no row and nothing there adds it; no row and a value
    // there is unowned-existing; a row and nothing there is deleted; a row and another value there is client-edited; a row and
    // its own value there is the flow's key, updated when the plan names another version. This table is consulted before the
    // satisfied-in-base shortcut below (fix for issue #1545): a trusted row the base no longer holds is a client edit even
    // when the base happens to already carry the version the plan wants, so it is never waved through as satisfied.
    const row = keyRows.get(pointer);
    const baseAt = entries.find((entry) => entry.placement === act.placement);
    const own = row === undefined ? (baseAt === undefined ? null : "unowned-existing") : baseAt === undefined ? "deleted" : baseAt.value !== row ? "client-edited" : null;
    const satisfiedInBase =
      entries.length === 1 &&
      baseAt !== undefined &&
      baseAt.value === act.version &&
      (row === undefined || (row === baseAt.value && row === act.version)) &&
      observation.lockedPackages.some((locked) => locked.name === act.name && locked.version === act.version && locked.integrity === act.integrity);
    items.push({ id: act.planItem, act: act.act, planItem: act.planItem, package: pinned, placement: act.placement, satisfiedInBase });
    if (satisfiedInBase) continue;
    if (observation.packageManager === "none") {
      refused.push({ file: "package.json", pointer, reason: "manifest-absent", item: act.planItem });
      continue;
    }
    const others = new Set(entries.filter((entry) => entry.placement !== act.placement).map((entry) => dependencyPointer(entry.placement, entry.name)));
    if (others.size > 0) {
      // The package is also at the other placement, which the flow never wrote: nothing is written for it.
      for (const other of others) refused.push({ file: "package.json", pointer: other, reason: "unowned-existing", item: act.planItem });
      if (own !== null) refused.push({ file: "package.json", pointer, reason: own, item: act.planItem });
      continue;
    }
    if (own !== null) {
      refused.push({ file: "package.json", pointer, reason: own, item: act.planItem });
      continue;
    }
    if (row === undefined || act.version !== row) {
      // The request a setup set wrote names this pin; an apply set that changes it would leave the request naming another, and
      // rewriting the request is not something an apply set does.
      if (act.act === "pin-starter" && observation.phase === "apply") return { skip: { verdict: "indeterminate", reason: "starter-request-stale" } };
      keys.push({ file: "package.json", pointer, before: row ?? null, after: act.version, item: act.planItem });
      invariants.push({ item: act.planItem, ...pinned });
      continue;
    }
    // The key holds the desired version and the flow wrote it, yet the lockfile does not resolve that version at the plan's
    // integrity: a supply-chain signal, never repaired (§12.6), so the repository gets no set.
    return { skip: { verdict: "violated", reason: "integrity-mismatch" } };
  }

  if (invariants.length > 0 && lockfile !== null) {
    pathAllowList.push("package.json", lockfile);
    const sorted = canonicalOrder(invariants, CANONICAL_KEYS.invariant);
    files.push({ path: lockfile, mode: "100644", derived: true, item: sorted[0]!.item, invariants: sorted, before: existingAt(lockfile) ?? null });
  }

  // pnpm reads the release-age window from the workspace file. A setup set exempts the publishing scope there with the one edit
  // editReleaseAgeExemption() makes (code rule C12); an apply set only carries the item when the trusted ledger records that entry,
  // so that it is the setup set's item over again, with no file of its own (RFC D26).
  if (observation.packageManager === "pnpm") {
    const surface = EXEMPTION_SURFACES[RELEASE_AGE_SURFACE];
    const scopeEntry = `${PACKAGE_SCOPE.scope}/*`;
    const recorded = (ledger?.entries ?? []).some((row) => row.file === surface.path && row.key === surface.key && row.value === scopeEntry);
    if (setupTemplates !== null || recorded) {
      items.push({ id: RELEASE_AGE_ITEM, act: "exempt-release-age", scope: PACKAGE_SCOPE.scope, surface: RELEASE_AGE_SURFACE, path: surface.path });
      pathAllowList.push(surface.path);
    }
    if (setupTemplates !== null) {
      const baseDigest = existingAt(surface.path);
      if (baseDigest === undefined && presentAt(surface.path)) {
        // A directory holds the path: there is no file to edit and none to create.
        refused.push({ path: surface.path, reason: "release-age-surface-unparseable", item: RELEASE_AGE_ITEM });
      } else {
        // prepareSetup() skipped every repository that has the file and not its text, and checkSurfaceTexts() held the text to the digest.
        const text = baseDigest === undefined ? null : observation.pnpmWorkspaceText;
        if (typeof text !== "string" && text !== null) throw new TypeError("pnpmWorkspaceText is absent for a pnpm-workspace.yaml the observation digests");
        const edit = editReleaseAgeExemption({ surface: RELEASE_AGE_SURFACE, text, npmrc: observation.npmrcText ?? null });
        if (edit.kind === "edited") {
          files.push({ path: surface.path, mode: "100644", before: baseDigest ?? null, after: contentDigest(edit.text), item: RELEASE_AGE_ITEM });
          texts[surface.path] = edit.text;
        } else if (edit.kind === "refused") {
          refused.push({ path: surface.path, reason: edit.reason, item: RELEASE_AGE_ITEM });
        }
      }
    }
  }

  const generation = ledger?.generation ?? 0;
  items.push({ id: "ledger", act: "write-ledger" });
  files.push({
    path: LEDGER_PATH,
    mode: "100644",
    derived: true,
    item: "ledger",
    invariants: [{ ledgerGeneration: generation + 1 }],
    before: existingAt(LEDGER_PATH) ?? null,
  });

  // A profile that needs no new entry needs no item; one that needs entries added is skipped by the caller when it did not
  // supply the profile text, or edited here when it did. That refusal stays even over a ledger with rootEntries rows: code
  // rule C13 requires the item whenever the observed profile needs one. No declare-root-entry is emitted to carry the
  // ledger's entries rows, and no exempt-release-age either: RENDER carries entries rows forward unchanged.
  const profile = observation.repositoryProfile;
  if (
    profile !== null &&
    profile.rootVocabulary === "checked" &&
    profile.undeclaredRoots.length > 0 &&
    profile.prohibitedRoots.length === 0 &&
    typeof observation.repositoryProfileText === "string"
  ) {
    const sortedRoots = canonicalOrder([...new Set(profile.undeclaredRoots)], CANONICAL_KEYS.name);
    const entries = sortedRoots.map((name) => ({ name, classification: "extension" as const, disposition: "allowed" as const }));
    const text = observation.repositoryProfileText;
    const before = contentDigest(text);
    if (existingAt(profile.path) !== before) throw new TypeError("repositoryProfileText does not match the observed profile file");
    let edited: string;
    try {
      edited = editJsonPointer(
        text,
        entries.map((entry) => ({ pointer: "/rootEntries/-", value: entry })),
      );
    } catch (cause) {
      if (cause instanceof JsonEditUnstableError) return { skip: { verdict: "indeterminate", reason: "json-edit-unstable" } };
      throw cause;
    }
    const pattern = PROFILE_ALLOW_PATTERNS.find((candidate) => matchesPathPattern(profile.path, candidate));
    if (pattern !== undefined && !pathAllowList.some((allowed) => matchesPathPattern(profile.path, allowed))) pathAllowList.push(pattern);
    items.push({ id: ROOT_ENTRIES_ITEM, act: "declare-root-entry", path: profile.path, entries });
    files.push({ path: profile.path, mode: "100644", before, after: contentDigest(edited), item: ROOT_ENTRIES_ITEM });
    texts[profile.path] = edited;
  } else if (profile !== null && (profile.rootVocabulary === "unparseable" || profile.prohibitedRoots.length > 0)) {
    items.push({
      id: ROOT_ENTRIES_ITEM,
      act: "declare-root-entry",
      path: profile.path,
      entries: profile.rootVocabulary === "unparseable" ? [] : profile.undeclaredRoots.map((name) => ({ name, classification: "extension", disposition: "allowed" })),
    });
    refused.push({ path: profile.path, reason: profile.rootVocabulary === "unparseable" ? "root-vocabulary-unknown" : "root-entry-prohibited", item: ROOT_ENTRIES_ITEM });
  }

  // A ledger row the desired state no longer names would be a removal, which this planner does not compute: it is reported,
  // and RENDER carries the row forward. A files row where an entries row names its file is the compare-and-swap record of a
  // file the flow edited (a release-age surface or the Controller profile), carried with its entries, not a removal.
  let unnamed = false;
  if (ledger !== null) {
    const named = new Set([...files.map((file) => file.path), ...refused.flatMap((refusal) => ("path" in refusal ? [refusal.path] : []))].map((path) => path.toLowerCase()));
    const edited = new Set(ledger.entries.map((row) => row.file.toLowerCase()));
    const pointers = new Set(acts.map((act) => dependencyPointer(act.placement, act.name)));
    const planItems = new Set(acts.map((act) => act.planItem));
    unnamed =
      ledger.files.some((row) => !named.has(row.path.toLowerCase()) && !edited.has(row.path.toLowerCase())) ||
      ledger.keys.some((row) => !pointers.has(row.pointer)) ||
      ledger.packages.some((row) => !planItems.has(row.planItem));
  }

  const checks: ApplyCheck[] = [];
  const reasons = new Set(refused.map((refusal) => refusal.reason));
  if (reasons.has("unsafe-path")) checks.push({ check: "V6", verdict: "violated", rule: "unsafe-path" });
  if (reasons.has("manifest-absent")) checks.push({ check: "V6", verdict: "indeterminate", rule: "manifest-absent" });
  if (reasons.has("root-vocabulary-unknown")) checks.push({ check: "V6", verdict: "indeterminate", rule: "root-vocabulary-unknown" });
  if (reasons.has("root-entry-prohibited")) checks.push({ check: "V6", verdict: "indeterminate", rule: "root-entry-prohibited" });
  if (reasons.has("skills-root-is-link")) checks.push({ check: "V6", verdict: "indeterminate", rule: "skills-root-is-link" });
  if (reasons.has("release-age-surface-conflict")) checks.push({ check: "V6", verdict: "indeterminate", rule: "release-age-surface-conflict" });
  if (reasons.has("release-age-surface-unparseable")) checks.push({ check: "V6", verdict: "indeterminate", rule: "release-age-surface-unparseable" });
  // V6 also regenerates the lockfile and checks its invariants; that part is not run here, so a set that changes a lockfile is not satisfied.
  if (files.some((file) => "derived" in file && file.path !== LEDGER_PATH)) checks.push({ check: "V6", verdict: "indeterminate", rule: "lockfile-not-run" });
  if (checks.length === 0) checks.push({ check: "V6", verdict: "satisfied" });
  // V8, ledger and ownership (RFC §7): every write compare-and-swaps against the trusted ledger, and a refused path or key
  // holds the repository. Computed independently of V6.
  const ownership: ApplyCheck[] = [];
  for (const rule of ["unowned-existing", "client-edited", "deleted"] as const) {
    if (reasons.has(rule)) ownership.push({ check: "V8", verdict: "indeterminate", rule });
  }
  if (unnamed) ownership.push({ check: "V8", verdict: "indeterminate", rule: "removal-unbuilt" });
  if (ownership.length === 0) ownership.push({ check: "V8", verdict: "satisfied" });
  checks.push(...ownership);

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
      ledger: { generation },
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
      // A setup set defers each install until after setup, and an apply set defers nothing (code rule C10).
      deferred: canonicalOrder(deferred, CANONICAL_KEYS.deferral),
      pathAllowList: canonicalOrder(pathAllowList, CANONICAL_KEYS.pattern),
      ...(Object.keys(texts).length > 0
        ? { texts: canonicalOrder(Object.entries(texts).map(([path, text]) => ({ path, text })), (entry) => [entry.path]) }
        : {}),
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
 *   with the public placeholder unless it is private), the skills of the
 *   Advisor voice and of its staffed roles (D33: compose-skills roles are
 *   `advisor` then the staffed roles in plan order; the brief's staffedHere
 *   names the staffed roles only) with their discovery links and manifest,
 *   every package act the plan names for it, and the ledger. Every act the
 *   plan authorizes is an item, never dropped, and no act the plan does not
 *   name is ever added.
 * - Trust first: the base's ledger (`ledger`, null when absent) must pass
 *   trustInstalledLedger() against `heldChangeSets`, or the repository is
 *   skipped with the rule as its reason (`ledger-unreadable`, `identity`,
 *   `renamed`, `ledger-chain` or `ledger-foreign-row`), verdict
 *   indeterminate. The set is computed over the trusted ledger's generation
 *   (0 without one).
 * - Every whole file goes through reconcileWholeFile(), the compare-and-swap
 *   table: add where neither the ledger nor the base has the path; keep or
 *   update where the base holds the ledger's `after`; otherwise refuse the
 *   path as `unowned-existing`, `client-edited` or `deleted`. Adoption of
 *   bytes the base already has happens only in a setup set. A package key
 *   follows the same table against the ledger's keys rows; a key that
 *   already holds the desired version the flow wrote, while the lockfile
 *   does not resolve it at the plan's integrity, skips the repository as
 *   `integrity-mismatch`, verdict violated: never repaired.
 * - In an apply set the setup templates are no-ops: a template act whose
 *   files the trusted ledger records is an item whose files are kept (or
 *   refused as `client-edited` or `deleted`); one it records none of has no
 *   item; one it records only some of skips the repository as
 *   `template-rows-partial`. A pnpm apply set carries the release-age
 *   exemption item, with no file, when the trusted ledger records that
 *   entry, so it matches the setup set's item; it adds no other entries.
 * - A setup set holds one item for each of the four setup templates, their
 *   bytes only from renderSetupTemplate(), the plan's one Starter pin, and
 *   every install the plan names as a deferral (`after-setup`) with no item,
 *   key or invariant. A template file the base already has is adopted only
 *   when its bytes are the set's own (else `unowned-existing`), and a
 *   composed skill only when the skills manifest records its digest. For
 *   pnpm it also holds one `release-age` item: the workspace file is created
 *   or edited by editReleaseAgeExemption() over the observed text (`before`
 *   the observed digest, or null), left alone when the entry is already
 *   listed, or refused (`release-age-surface-unparseable`,
 *   `release-age-surface-conflict`, with a V6 `indeterminate` check).
 * - Two or more observed files at the same path, compared case-insensitively
 *   (or a repeated entry), have no single base digest between them: the path
 *   is occupied by other bytes than any one of them, so it is never kept,
 *   updated or adopted -- `client-edited` with a trusted row, `unowned-existing`
 *   without one. When the lockfile's own path or the ledger's has a case
 *   variant, the whole repository is skipped as `case-variant-path`, verdict
 *   indeterminate, the same way as `template-rows-partial`.
 * - A trusted ledger row the desired state no longer names is not removed:
 *   V8 reports `removal-unbuilt`, and the row is carried forward.
 * - V8 carries one indeterminate check per ownership refusal reason present
 *   (`unowned-existing`, `client-edited`, `deleted`) and for
 *   `removal-unbuilt`, and is satisfied otherwise; V6 is computed apart from
 *   it.
 * - A repository whose Controller profile needs root entries added is
 *   edited when `repositoryProfileText` is present, and skipped as
 *   `root-entry-edit-unbuilt` when that text is absent. A profile that is
 *   unparseable, or that prohibits a root name the set introduces, gets a
 *   declare-root-entry item refused as `root-vocabulary-unknown` or
 *   `root-entry-prohibited`.
 * - A role's skill under a symbolic link (`.agents`, `.agents/skills` or its
 *   own directory) is refused as `skills-root-is-link`, never written.
 * - A package act the default branch already satisfies exactly is kept as an
 *   item with `satisfiedInBase: true` and writes nothing.
 * - A setup repository is skipped, `indeterminate`, as
 *   `package-manager-unsupported` (neither npm nor pnpm), `starter-pin-absent`
 *   (no single pin-starter act), `starter-pin-unsupported` (a pin outside the
 *   templates' range), `starter-request-invalid` (a request the renderer
 *   refuses) or `release-age-text-absent` (a pnpm workspace file or `.npmrc`
 *   is there and its text was not supplied). An apply set whose pin-starter
 *   writes a key is skipped as `starter-request-stale`.
 * - A staffed repository with no observation, with a skip reason, whose
 *   ledger is not trusted, whose profile needs root entries added and has no
 *   text, or skipped for any reason above, `integrity-mismatch`,
 *   `template-rows-partial` or `case-variant-path` is left out of the bundle
 *   digest.
 *
 * Throws, naming positions and never values, when the release-age text an
 * observation supplies is not the file it digests, when the plan or hub brief
 * does not validate, the plan has no staffing, a staffed role is not a lowercase id
 * token (`role-not-an-id`), a package act's planItem is not its repository id,
 * a colon and its package name (`plan-item-not-derived`), the hub brief has `staffedHere`, an
 * observation repeats or names an unstaffed repository, a staffed role or
 * the Advisor voice has no skill content, or a computed set or the bundle
 * fails its contract.
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
  // The hub carries every voice, whatever any one repository staffs (D33): a missing Advisor voice is a hub defect.
  if (!skillContent.has(ADVISOR_VOICE)) throw new TypeError("the Advisor voice has no composed skill content in skills");

  const staffedIds = new Set(staffing.map((entry) => entry.repository));
  const observations = new Map<string, RepositoryObservation | SkippedRepositoryObservation>();
  inputs.repositories.forEach((entry, index) => {
    if (!staffedIds.has(entry.id)) throw new TypeError(`repositories[${index}] is not a repository the plan staffs (ids must be spelled as in staffing)`);
    if (observations.has(entry.id)) throw new TypeError(`repositories[${index}] repeats a repository`);
    observations.set(entry.id, entry);
  });

  const digestOfPlan = planDigest(inputs.plan);
  const computed: { id: string; staffingIndex: number; phase: ChangeSetPhase; set: Omit<RepositoryChangeSet, "bundle">; checks: readonly ApplyCheck[] }[] = [];
  const entries: (ApplyBundleRepository | { readonly pending: number })[] = [];
  for (const [staffingIndex, staffingEntry] of staffing.entries()) {
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
    checkSurfaceTexts(observation);
    // A ledger the hub cannot account for refuses the whole repository, and nothing is inferred from it (RFC §12.2, §12.6).
    const repositoryPackages = (inputs.plan.packages ?? [])
      .filter((act) => act.repository === staffingEntry.repository)
      .map(({ planItem, act, name, version, integrity, placement }) => ({ planItem, act, name, version, integrity, placement }));
    const planPackageActs: PlanPackageActs[] = [{ planDigest: digestOfPlan, packages: repositoryPackages }, ...(inputs.planPackageActs ?? [])];
    const trust = trustInstalledLedger(observation.ledger, { id: observation.id, nodeId: observation.nodeId }, inputs.heldChangeSets, { planPackageActs });
    if (trust.state === "refused") {
      entries.push({ id: staffingEntry.repository, verdict: "indeterminate", reason: trust.rule, checks: [] });
      continue;
    }
    const acts = (inputs.plan.packages ?? []).filter((act) => act.repository === staffingEntry.repository);
    let setupTemplates: readonly SetupTemplate[] | null = null;
    if (observation.phase === "setup") {
      // A setup set holds the setup templates (code rule C11); anything that stops them being rendered or the pin being safe is a skip.
      const prepared = prepareSetup(observation, acts);
      if ("skip" in prepared) {
        entries.push({ id: staffingEntry.repository, verdict: "indeterminate", reason: prepared.skip, checks: [] });
        continue;
      }
      setupTemplates = prepared.templates;
    }
    const profile = observation.repositoryProfile;
    if (
      profile !== null &&
      profile.rootVocabulary === "checked" &&
      profile.undeclaredRoots.length > 0 &&
      profile.prohibitedRoots.length === 0 &&
      (observation.repositoryProfileText === null || observation.repositoryProfileText === undefined)
    ) {
      entries.push({ id: staffingEntry.repository, verdict: "indeterminate", reason: "root-entry-edit-unbuilt", checks: [] });
      continue;
    }
    const result = computeChangeSet(inputs, digestOfPlan, observation, trust.ledger, staffingEntry.roles, acts, skillContent, setupTemplates);
    if ("skip" in result) {
      entries.push({ id: staffingEntry.repository, verdict: result.skip.verdict, reason: result.skip.reason, checks: [] });
      continue;
    }
    const { changeSet, checks } = result;
    const digest = changeSetDigest(changeSet);
    const short = digest.slice("sha256:".length, "sha256:".length + 12);
    const set = { ...changeSet, branch: `clossys/apply-${short}`, pullRequest: { title: `Clossys: apply plan ${short}` }, changeSetDigest: digest };
    entries.push({ pending: computed.length });
    computed.push({ id: staffingEntry.repository, staffingIndex, phase: observation.phase, set, checks });
  }

  const authorizationMismatch = inputs.authorization !== null && inputs.authorization.planDigest !== digestOfPlan;
  // Package acts need an execution authorization; a plan that has them and no authorization permits none of them (code rule A4).
  const authorizationAbsent = inputs.plan.packages !== undefined && inputs.authorization === null;
  const digestOfBundle = bundleDigest(digestOfPlan, computed.map((entry) => ({ id: entry.id, changeSetDigest: entry.set.changeSetDigest })));
  const changeSets: RepositoryChangeSet[] = computed.map((entry) => ({ ...entry.set, bundle: digestOfBundle }));
  changeSets.forEach((set, index) => {
    const validation = validateRepositoryChangeSet(set);
    if (!validation.valid) throw new Error(`the change set computed for staffed repository ${computed[index]!.staffingIndex} does not validate: ${validation.reason}`);
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
      // Pure checks that need no observation (code rule A4): an authorization issued for another plan permits none of this one,
      // and a plan with package acts and no authorization permits none of them.
      const authority: ApplyCheck[] = [
        ...(authorizationMismatch ? [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_PLAN_MISMATCH } as const] : []),
        ...(authorizationAbsent ? [{ check: "V3", verdict: "violated", rule: AUTHORIZATION_ABSENT } as const] : []),
      ];
      const checks = sortChecks([...own, ...authority]);
      return { id, verdict: worstVerdict(checks.map((check) => check.verdict)), phase, changeSet: set.changeSetDigest, checks };
    }),
    bundleDigest: digestOfBundle,
  };
  const bundleValidation = validateApplyBundle(bundle);
  if (!bundleValidation.valid) throw new Error(`the computed bundle does not validate: ${bundleValidation.reason}`);
  return { bundle, changeSets };
}
