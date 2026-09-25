import { CAPABILITY_CATALOGUE } from "./capability-catalogue.js";
import type { CapabilityCatalogue } from "./capability-catalogue.js";
import { validateAgainstContract } from "./contract-schema.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { loadPlanContract } from "./plan-contract.js";
import { planRuleViolations } from "./plan-rules.js";
import { byCodeUnits, positionOnly, snapshotDigest, validateRegistrySnapshot } from "./registry-snapshot.js";
import type { RegistrySnapshot, RegistrySnapshotVersion } from "./registry-snapshot.js";
import type { AdvisorPlan, AdvisorPlanPackageAct, AdvisorPlanResolution } from "./status.js";
import type { ImmutablePackageRef } from "./types.js";

/**
 * Exact package acts from a registry snapshot (issue #1178). Two pure steps
 * sit either side of the one network step, which is not in this package:
 *
 * 1. `packageRequest(plan)` names the packages a staffed plan needs: the
 *    package of every staffed role, from this package's packed capability
 *    catalogue, and the pull-request checker package (`starter`) every
 *    staffed repository pins.
 * 2. `resolvePackages(plan, snapshot)` reads a registry snapshot of exactly
 *    those names and writes the plan's `packages` and `resolution`: the
 *    version the registry's `latest` dist-tag named, with its one sha512
 *    integrity value, or a refusal.
 *
 * Neither reads a file, fetches anything, or holds a credential. The scope
 * and the expected registry come from this package's packed copy of its
 * source repository's package-scope.json, never from a literal here.
 *
 * Every finding names a rule and a position (`staffing[0].roles[1]`,
 * `packages[2].versions[0].integrity`) and, at most, a package name this
 * package derived from its own catalogue. It never quotes plan text, a
 * repository id, or any other value read from the plan or the snapshot.
 */

export type ResolutionVerdict = "violated" | "indeterminate" | "warning";

export interface ResolutionFinding {
  /** Which refusal or warning, for example `prerelease-latest`. */
  readonly rule: string;
  readonly verdict: ResolutionVerdict;
  /** The field at fault: a plan position for a plan finding, a snapshot position for a snapshot finding. `""` for a whole document. */
  readonly path: string;
  /** What is wrong, by position and derived package name only. */
  readonly message: string;
}

export type ResolutionState = "satisfied" | "violated" | "indeterminate";

/** The publishing scope and registry this package was built with. */
export interface PackageScope {
  readonly scope: string;
  readonly registry: string;
}

export interface ResolutionOptions {
  /** Defaults to this package's packed capability catalogue. */
  readonly catalogue?: CapabilityCatalogue;
  /** Defaults to this package's packed scope and registry. */
  readonly packageScope?: PackageScope;
}

export type PackageRequestResult =
  | { readonly state: "satisfied"; readonly names: readonly string[]; readonly findings: readonly ResolutionFinding[] }
  | { readonly state: "violated"; readonly findings: readonly ResolutionFinding[] };

export type PackageResolutionResult =
  | {
      readonly state: "satisfied";
      /** Warnings only. */
      readonly findings: readonly ResolutionFinding[];
      /** One `pin-starter` act per staffed repository and one `install` act per staffed role, sorted by repository and then name. */
      readonly packages: readonly AdvisorPlanPackageAct[];
      readonly resolution: AdvisorPlanResolution;
      /** Each distinct package reference in `packages`, sorted by name: what a sponsor's grant permits, exactly. */
      readonly permittedPackages: readonly ImmutablePackageRef[];
    }
  | { readonly state: "violated" | "indeterminate"; readonly findings: readonly ResolutionFinding[] };

/** A pattern the packed plan contract defines, read from it so the two can never disagree. */
function planPattern(definition: string): RegExp {
  const definitions = loadPlanContract("advisor-plan.json").definitions as Record<string, { pattern?: unknown }> | undefined;
  const pattern = definitions?.[definition]?.pattern;
  if (typeof pattern !== "string") throw new Error(`the packed plan contract defines no pattern for ${definition}`);
  return new RegExp(pattern, "u");
}
/** The one integrity value a plan accepts: `sha512-` and the canonical base64 of 64 bytes, and nothing else. */
const SHA512_INTEGRITY = planPattern("sha512Integrity");
/**
 * A prerelease (`-...`) or build (`+...`) suffix on a semantic version. Without
 * one, a version the snapshot contract accepts is one the plan contract
 * accepts: both limit each number to 16 digits. The resolved plan is checked
 * against the plan contract before it is returned, so any disagreement fails
 * closed.
 */
const PRERELEASE_OR_BUILD = /[-+]/u;
/** The directory name of the package every staffed repository pins to check its pull requests. */
export const STARTER_PACKAGE_DIRECTORY = "starter";
/**
 * Role packages that live in the engagement hub only and are never installed
 * in a product repository. The apply-approved-plan RFC (issue #1178) decides
 * this for Advisor in decision D24: Advisor is pinned once, in the hub, and a
 * product repository runs its commands through `npx` at the hub's exact
 * version rather than installing it. The capability catalogue carries no flag
 * for this, so this one list is where it is recorded.
 */
export const HUB_ONLY_PACKAGE_DIRECTORIES: readonly string[] = ["advisor"];
/** Where every resolved act is placed in a repository's package.json. */
export const RESOLVED_PLACEMENT = "devDependencies";

function stateOf(findings: readonly ResolutionFinding[]): ResolutionState {
  if (findings.some((finding) => finding.verdict === "violated")) return "violated";
  if (findings.some((finding) => finding.verdict === "indeterminate")) return "indeterminate";
  return "satisfied";
}

/** A plan's contract and code-rule findings, by position only. */
function planShapeFindings(plan: unknown): ResolutionFinding[] {
  const schema = validateAgainstContract(loadPlanContract("advisor-plan.json"), plan, loadPlanContract);
  if (schema.length > 0) {
    return schema.map((violation) => {
      const { path, message } = positionOnly(violation);
      return { rule: "plan-shape", verdict: "violated", path, message: `plan${path === "" ? "" : path.startsWith("[") ? path : `.${path}`} ${message}` };
    });
  }
  return planRuleViolations(plan as AdvisorPlan).map((violation) => ({
    rule: "plan-shape",
    verdict: "violated",
    path: violation.path,
    message: `plan.${violation.path} ${violation.message} (rule ${violation.rule})`,
  }));
}

/**
 * The package names a staffed plan needs, sorted and unique: `<scope>/<role>`
 * for every role any staffing entry names, and `<scope>/starter`. A role this
 * package's catalogue does not list is refused, as is a role whose package
 * lives in the hub only (`HUB_ONLY_PACKAGE_DIRECTORIES`) and a catalogue entry
 * whose own scoped name disagrees with the packed scope. Pure: no file, no
 * network.
 */
export function packageRequest(plan: unknown, options: ResolutionOptions = {}): PackageRequestResult {
  const shape = planShapeFindings(plan);
  if (shape.length > 0) return { state: "violated", findings: shape };
  const { staffing } = plan as AdvisorPlan;
  if (staffing === undefined) {
    return { state: "violated", findings: [{ rule: "plan-not-staffed", verdict: "violated", path: "staffing", message: "plan.staffing is required: packages are resolved only for staffed repositories" }] };
  }
  const catalogue = options.catalogue ?? CAPABILITY_CATALOGUE;
  const { scope } = options.packageScope ?? PACKAGE_SCOPE;
  const byRole = new Map(catalogue.roles.map((entry) => [entry.role, entry]));
  const findings: ResolutionFinding[] = [];
  const names = new Set<string>([`${scope}/${STARTER_PACKAGE_DIRECTORY}`]);
  staffing.forEach((entry, index) =>
    entry.roles.forEach((role, position) => {
      const path = `staffing[${index}].roles[${position}]`;
      const known = byRole.get(role);
      if (known === undefined || role === STARTER_PACKAGE_DIRECTORY) {
        findings.push({ rule: "role-not-in-catalogue", verdict: "violated", path, message: `plan.${path} is not a role in this package's capability catalogue` });
        return;
      }
      if (HUB_ONLY_PACKAGE_DIRECTORIES.includes(known.role)) {
        findings.push({ rule: "hub-only-package", verdict: "violated", path, message: `plan.${path} is a role whose package lives in the hub only and is never installed in a staffed repository` });
        return;
      }
      const name = `${scope}/${known.role}`;
      if (known.scopeName !== name) {
        findings.push({ rule: "catalogue-scope-mismatch", verdict: "violated", path, message: `plan.${path}: the catalogue's package for this role is not in the packed scope` });
        return;
      }
      names.add(name);
    }),
  );
  if (findings.length > 0) return { state: "violated", findings };
  return { state: "satisfied", names: [...names].sort(byCodeUnits), findings: [] };
}

/** Whether `tarball` is served from anywhere but the registry's own scheme and host, or carries credentials. */
function tarballIsForeign(tarball: string, registry: string): boolean {
  let url: URL;
  let expected: URL;
  try {
    url = new URL(tarball);
    expected = new URL(registry);
  } catch {
    return true;
  }
  return url.protocol !== expected.protocol || url.host !== expected.host || url.username !== "" || url.password !== "";
}

/** The one version entry a requested package resolves to, or the findings that refuse it. */
function selectVersion(
  snapshot: RegistrySnapshot,
  name: string,
  registry: string,
): { version: RegistrySnapshotVersion; findings: ResolutionFinding[] } | { version: null; findings: ResolutionFinding[] } {
  const index = snapshot.packages.findIndex((entry) => entry.name === name);
  if (index === -1) {
    return { version: null, findings: [{ rule: "package-not-in-snapshot", verdict: "indeterminate", path: "packages", message: `snapshot.packages has no entry for ${name}` }] };
  }
  const entry = snapshot.packages[index]!;
  const at = `packages[${index}]`;
  const refuse = (rule: string, verdict: ResolutionVerdict, path: string, message: string) => ({ version: null, findings: [{ rule, verdict, path, message: `snapshot.${path} ${message} (${name})` }] });
  if (entry.status === "not-found") return refuse("package-not-published", "violated", `${at}.status`, "says the registry has no such package");
  if (entry.latest === null) return refuse("no-latest", "indeterminate", `${at}.latest`, "is null: the registry named no latest version");
  if (PRERELEASE_OR_BUILD.test(entry.latest)) return refuse("prerelease-latest", "violated", `${at}.latest`, "names a prerelease or build version, which is never resolved");
  const position = entry.versions.findIndex((version) => version.version === entry.latest);
  if (position === -1) return refuse("tag-points-at-missing-version", "indeterminate", `${at}.latest`, "names a version the snapshot does not record");
  const version = entry.versions[position]!;
  const vat = `${at}.versions[${position}]`;
  const findings: ResolutionFinding[] = [];
  if (version.integrity === null || !SHA512_INTEGRITY.test(version.integrity)) {
    findings.push({ rule: "no-sha512-integrity", verdict: "violated", path: `${vat}.integrity`, message: `snapshot.${vat}.integrity is not one sha512 integrity value (${name})` });
  }
  if (version.deprecated) findings.push({ rule: "deprecated-version", verdict: "violated", path: `${vat}.deprecated`, message: `snapshot.${vat} is deprecated (${name})` });
  if (tarballIsForeign(version.tarball, registry)) {
    findings.push({ rule: "foreign-tarball-host", verdict: "violated", path: `${vat}.tarball`, message: `snapshot.${vat}.tarball is not served over the registry's own scheme and host (${name})` });
  }
  if (findings.length > 0) return { version: null, findings };
  if (!version.hasAttestations) {
    findings.push({ rule: "no-attestation-yet", verdict: "warning", path: `${vat}.hasAttestations`, message: `snapshot.${vat} lists no attestations yet; provenance is checked when the package is installed (${name})` });
  }
  return { version, findings };
}

/**
 * The plan's exact package acts, read from a registry snapshot. Each
 * requested package resolves to the version the registry's `latest`
 * dist-tag named when the snapshot was taken, with that version's one sha512
 * integrity value. A package that is missing, unpublished, has no usable
 * `latest`, or whose `latest` is a prerelease, deprecated, carries no single
 * sha512 integrity value, or is served from another host, is refused. The
 * snapshot's registry must be the packed registry. Pure and deterministic:
 * the same plan and snapshot always give byte-identical output.
 */
export function resolvePackages(plan: unknown, snapshot: unknown, options: ResolutionOptions = {}): PackageResolutionResult {
  const request = packageRequest(plan, options);
  if (request.state !== "satisfied") return { state: "violated", findings: request.findings };
  const { registry, scope } = options.packageScope ?? PACKAGE_SCOPE;

  const shape = validateRegistrySnapshot(snapshot);
  if (shape.length > 0) {
    return {
      state: "violated",
      findings: shape.map((violation) => ({
        rule: "snapshot-shape",
        verdict: "violated",
        path: violation.path,
        message: `snapshot${violation.path === "" ? "" : violation.path.startsWith("[") ? violation.path : `.${violation.path}`} ${violation.message}${violation.rule === "schema" ? "" : ` (rule ${violation.rule})`}`,
      })),
    };
  }
  const read = snapshot as RegistrySnapshot;
  if (read.registry !== registry) {
    return { state: "violated", findings: [{ rule: "foreign-registry", verdict: "violated", path: "registry", message: "snapshot.registry is not the registry this package was built for" }] };
  }

  const findings: ResolutionFinding[] = [];
  const selected = new Map<string, RegistrySnapshotVersion>();
  for (const name of request.names) {
    const choice = selectVersion(read, name, registry);
    findings.push(...choice.findings);
    if (choice.version !== null) selected.set(name, choice.version);
  }
  const state = stateOf(findings);
  if (state !== "satisfied") return { state, findings };

  const starter = `${scope}/${STARTER_PACKAGE_DIRECTORY}`;
  const act = (repository: string, kind: AdvisorPlanPackageAct["act"], name: string): AdvisorPlanPackageAct => {
    const version = selected.get(name)!;
    return { planItem: `${repository}:${name}`, repository, act: kind, name, version: version.version, integrity: version.integrity!, placement: RESOLVED_PLACEMENT };
  };
  const packages = (plan as AdvisorPlan).staffing!
    .flatMap((entry) => [act(entry.repository, "pin-starter", starter), ...entry.roles.map((role) => act(entry.repository, "install", `${scope}/${role}`))])
    .sort((left, right) => byCodeUnits(left.repository, right.repository) || byCodeUnits(left.name, right.name));
  const resolution = { snapshotDigest: snapshotDigest(read) };

  // Fail closed: the resolved plan must itself satisfy the plan contract and R1-R10.
  const resolved = { ...(plan as AdvisorPlan), packages, resolution };
  const invalid = planShapeFindings(resolved);
  if (invalid.length > 0) return { state: "violated", findings: invalid.map((finding) => ({ ...finding, rule: "resolved-plan-invalid" })) };

  const permittedPackages = [...selected.entries()]
    .sort(([left], [right]) => byCodeUnits(left, right))
    .map(([name, version]) => ({ name, version: version.version, integrity: version.integrity! }));
  return { state: "satisfied", findings, packages, resolution, permittedPackages };
}
