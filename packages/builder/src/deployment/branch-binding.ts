/**
 * Which branch feeds which deployment environment (issue #929).
 *
 * `DEPLOYMENT_ENVIRONMENTS` enumerates the environments this contract knows
 * about and stops there. A repository that takes day-to-day work on one
 * long-lived branch and deploys from a second one is expressing a real,
 * checkable arrangement, and until now nothing in this package could hold
 * it: a grep of the whole deployment contract for a branch of any kind
 * returned nothing. A surface said *where* it is live and *how to tell*; it
 * never said *what feeds it*.
 *
 * THE PLAIN-STRING SEAM, AND WHY
 * -------------------------------
 * `DeploymentBranchBinding.branch` is a PLAIN STRING. It names a branch that
 * the repository's own profile -- a different package's contract entirely --
 * declares. This package does not import that package to resolve it, and
 * must not start.
 *
 * This is the same discipline `@clossys/strategist`'s `BrandDerivation`
 * already uses: it names token slots (`"--color-accent-primary"`) and voice
 * rules by plain string and never imports a token or a voice package, and
 * `checkBrandCoverage` takes the brandable-slot list as an argument
 * precisely because -- in that package's own words -- the caller is the one
 * place the seam can be closed for real. The same shape applies here. One
 * package declares the topology; this one declares which environment
 * consumes it; the repository that depends on both is where the two names
 * are compared against each other. A typed import in either direction would
 * make the dependency graph of every consumer that only wanted to plan a
 * deployment reach into a governance package it never asked for, and would
 * put the same fact under two owners.
 *
 * READ-ONLY, LIKE EVERY OTHER ADAPTER HERE
 * -----------------------------------------
 * Nothing in this file deploys, mutates a provider, or makes a network call.
 * `checkDeploymentBranchBindings` compares two pieces of caller-supplied
 * data and returns findings. A binding is a contract a repository satisfies,
 * not something enforced at deploy time -- this package's Vercel adapter is
 * read-only by design and this addition does not change that.
 *
 * FAILS CLOSED
 * -------------
 * A checker handed nothing to check must never return the same shape as one
 * that checked everything and found it clean. `checkDeploymentBranchBindings`
 * therefore refuses an empty binding list outright rather than reporting a
 * vacuous pass, and always reports how many surfaces and bindings it
 * actually examined, so "zero things were compared" and "everything agreed"
 * can never be told apart by a caller who only glances at `ok`.
 */

import { DEPLOYMENT_ENVIRONMENTS } from "./types.js";
import type {
  DeploymentEnvironment,
  DeploymentFinding,
  DeploymentManifest,
} from "./types.js";

const BINDING_KEYS = new Set(["environment", "branch"]);

/**
 * The environment a repository must bind to a branch before this contract
 * can say anything useful. Every other environment is optional; `production`
 * is not, because an unbound production environment is the exact case this
 * contract exists to make expressible.
 */
export const REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT = "production" as const;

/** One environment and the branch that feeds it, named by plain string. */
export type DeploymentBranchBindingDefinition = {
  readonly environment: DeploymentEnvironment;
  /**
   * The branch name, by PLAIN STRING -- see this file's header. Validated
   * for shape only: this package has no way to know whether the branch
   * exists, and claiming otherwise would be a checker reporting on evidence
   * it never saw.
   */
  readonly branch: string;
};

/** A validated, detached binding. */
export type DeploymentBranchBinding = DeploymentBranchBindingDefinition;

/** Every structural or agreement reason a branch binding did not pass. */
export type DeploymentBranchBindingFindingRule =
  | "branch-bindings-shape"
  | "branch-binding-object"
  | "branch-binding-unknown-property"
  | "branch-binding-environment"
  | "branch-binding-branch"
  | "duplicate-branch-binding-environment"
  | "branch-bindings-unreadable"
  | "branch-bindings-empty"
  | "manifest-surfaces-empty"
  | "surface-environment-unbound"
  | "required-environment-unbound";

/**
 * What `checkDeploymentBranchBindings` actually compared, always present in
 * every branch of the result.
 */
export type DeploymentBranchBindingCheck = {
  readonly ok: boolean;
  readonly findings: readonly DeploymentFinding[];
  /** How many manifest surfaces were examined. */
  readonly surfacesChecked: number;
  /** How many bindings were examined. */
  readonly bindingsChecked: number;
  /** The branch bound to `production`, present only on a clean result. */
  readonly productionBranch?: string;
};

function record(findings: DeploymentFinding[], rule: DeploymentBranchBindingFindingRule, message: string, path?: string): void {
  findings.push({ rule, severity: "error", message, ...(path === undefined ? {} : { path }) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A branch name this contract is willing to carry. Deliberately a SHAPE
 * check and nothing more: no leading or trailing whitespace, no control
 * characters, no path-separator or ref-syntax characters Git itself refuses.
 * Whether the branch exists is not knowable here.
 */
function isBranchName(value: string): boolean {
  if (value.length === 0 || value.length > 255 || value !== value.trim()) return false;
  if (value === "HEAD" || value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock") || value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || forbidden.has(character)) return false;
  }
  return !value.split("/").some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"));
}

function validate(value: unknown, findings: DeploymentFinding[]): void {
  if (!Array.isArray(value)) {
    record(findings, "branch-bindings-shape", "Branch bindings must be an array.", "branchBindings");
    return;
  }
  const environments = new Set<string>();
  for (const [index, binding] of value.entries()) {
    const path = `branchBindings[${index}]`;
    if (!object(binding)) {
      record(findings, "branch-binding-object", "A branch binding must be an object.", path);
      continue;
    }
    for (const key of Object.keys(binding)) {
      if (!BINDING_KEYS.has(key)) record(findings, "branch-binding-unknown-property", "Unsupported property.", `${path}.${key}`);
    }
    if (!DEPLOYMENT_ENVIRONMENTS.includes(binding.environment as DeploymentEnvironment)) {
      record(findings, "branch-binding-environment", "Environment is not supported.", `${path}.environment`);
    } else if (environments.has(binding.environment as string)) {
      record(findings, "duplicate-branch-binding-environment", "An environment may be bound to at most one branch.", `${path}.environment`);
    } else {
      environments.add(binding.environment as string);
    }
    if (typeof binding.branch !== "string" || !isBranchName(binding.branch)) {
      record(findings, "branch-binding-branch", "Branch must be a valid Git branch name.", `${path}.branch`);
    }
  }
}

/**
 * Reports every supported structural violation without exposing source
 * values. Authoring input can arrive from untyped configuration, including
 * objects with throwing accessors; those are treated as unreadable input
 * rather than allowed to fail validation itself.
 */
export function validateDeploymentBranchBindings(value: unknown): readonly DeploymentFinding[] {
  const findings: DeploymentFinding[] = [];
  try {
    validate(value, findings);
  } catch {
    record(findings, "branch-bindings-unreadable", "Branch bindings could not be read safely.");
  }
  return findings;
}

/** Narrows caller input to a well-formed binding list. */
export function isValidDeploymentBranchBindings(value: unknown): value is readonly DeploymentBranchBindingDefinition[] {
  return !validateDeploymentBranchBindings(value).some((finding) => finding.severity === "error");
}

/** Produces a detached, explicit binding list. Validate author input separately. */
export function defineDeploymentBranchBindings(
  definitions: readonly DeploymentBranchBindingDefinition[],
): readonly DeploymentBranchBinding[] {
  return definitions.map((definition) => ({ environment: definition.environment, branch: definition.branch }));
}

/**
 * The one place this contract's two halves meet: a manifest (which
 * environments this repository actually deploys to) and the bindings (which
 * branch feeds each one).
 *
 * This is a comparison of two caller-supplied lists and nothing else. It
 * performs no I/O, contacts no provider, and cannot tell a current branch
 * name from a stale one -- which is exactly why an empty list on either side
 * is a failure rather than a silent pass.
 */
export function checkDeploymentBranchBindings(input: {
  readonly manifest: DeploymentManifest;
  readonly branchBindings: readonly DeploymentBranchBindingDefinition[];
}): DeploymentBranchBindingCheck {
  const findings: DeploymentFinding[] = [...validateDeploymentBranchBindings(input.branchBindings)];
  const surfaces = Array.isArray(input.manifest?.surfaces) ? input.manifest.surfaces : [];
  const bindings = Array.isArray(input.branchBindings) ? input.branchBindings : [];
  const surfacesChecked = surfaces.length;
  const bindingsChecked = bindings.length;

  if (bindingsChecked === 0) {
    record(findings, "branch-bindings-empty", "No branch bindings were supplied, so nothing could be checked.", "branchBindings");
  }
  if (surfacesChecked === 0) {
    record(findings, "manifest-surfaces-empty", "The manifest declares no surfaces, so nothing could be checked.", "manifest.surfaces");
  }

  const bound = new Map<string, string>();
  for (const binding of bindings) {
    const environment = binding?.environment as string | undefined;
    if (environment !== undefined && typeof binding?.branch === "string" && !bound.has(environment)) {
      bound.set(environment, binding.branch);
    }
  }

  const seen = new Set<string>();
  for (const [index, surface] of surfaces.entries()) {
    if (seen.has(surface.environment)) continue;
    seen.add(surface.environment);
    if (!bound.has(surface.environment)) {
      record(
        findings,
        "surface-environment-unbound",
        "A declared surface's environment has no branch binding. Every environment this repository deploys to must say which branch feeds it.",
        `manifest.surfaces[${index}].environment`,
      );
    }
  }

  if (seen.has(REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT) && !bound.has(REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT)) {
    record(
      findings,
      "required-environment-unbound",
      "The production environment is declared by a surface and is not bound to a branch.",
      "branchBindings",
    );
  }

  const productionBranch = bound.get(REQUIRED_BOUND_DEPLOYMENT_ENVIRONMENT);
  return {
    ok: findings.length === 0,
    findings,
    surfacesChecked,
    bindingsChecked,
    ...(findings.length === 0 && productionBranch !== undefined ? { productionBranch } : {}),
  };
}
