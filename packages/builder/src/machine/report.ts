import { createGateReasons, foldGateResults, gateResultToExitCode, gateSatisfied, gateViolated } from "@vespeneventures/controller/gates";
import type { GateResult } from "@vespeneventures/controller/gates";
import { DestinationCollisionError, composeInstallationPlans, verifyComposedInstallation } from "../composition.js";
import type { NamedSourcePlan } from "../composition.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import type { FileSystemPort, Finding } from "../types.js";
import { discoverAccountWorkspaces, resolveWorkspacesRoot } from "./discovery.js";
import { buildSkillsManifest } from "./skills-manifest.js";
import { loadThirdPartySkills, resolveThirdPartyRoot } from "./third-party.js";
import type { DiscoveryPort } from "./types.js";

/**
 * `verifyMachine`: the orchestrator behind `builder-verify-machine`.
 *
 * Composes what `discovery.ts` and `third-party.ts` found into named source
 * plans (§2 of the README's "Machine composition" section — per-skill links,
 * never a directory symlink or a materialized copy), then runs them through
 * this package's already-tested `composeInstallationPlans` and
 * `verifyComposedInstallation` completely unchanged.
 *
 * The one rule every branch below is written to protect: an indeterminate
 * source is never quietly excluded from composition while the sources that
 * DID resolve get verified as if they were the whole machine. If ANY
 * discovered workspace or the third-party source is indeterminate,
 * composition itself is reported indeterminate too — see the `composition`
 * row's `sources-indeterminate` branch. A caller reading only `overall`
 * therefore can never mistake "half the machine verified clean" for "the
 * machine verified clean."
 */

export const MACHINE_VERIFY_INPUTS_VERSION = 1 as const;

export interface MachineVerifyInputs {
  readonly schemaVersion: typeof MACHINE_VERIFY_INPUTS_VERSION;
  /** The operator's home directory. Passed through to `createRuntimeContext`; never inferred. */
  readonly home: string;
  /** Where every composed per-skill link is written. */
  readonly composedSkillsRoot: string;
  /** Overrides the `BUILDER_MACHINE_WORKSPACES_ROOT` environment variable. */
  readonly accountWorkspacesRoot?: string;
  /** Overrides the `BUILDER_MACHINE_THIRD_PARTY_SKILLS_ROOT` environment variable. Third-party is optional: omitting both this and the environment variable means "this machine composes no third-party skills," not an error. */
  readonly thirdPartySkillsRoot?: string;
}

export const machineVerifyReasons = createGateReasons([
  "no-inputs-supplied",
  "invalid-inputs",
  "account-workspaces-indeterminate",
  "third-party-skills-indeterminate",
  "sources-indeterminate",
  "no-sources-found",
  "composition-failed",
] as const);

export type MachineVerifyReason = (typeof machineVerifyReasons.reasons)[number];

export interface MachineVerifyRow {
  readonly row: string;
  readonly result: GateResult<Finding, MachineVerifyReason>;
}

export interface MachineVerifyReport {
  readonly rows: readonly MachineVerifyRow[];
  readonly overall: GateResult<Finding, MachineVerifyReason>;
  /** `0` satisfied, `1` violated, `2` indeterminate. Nothing overrides this mapping. */
  readonly exitCode: 0 | 1 | 2;
}

export interface VerifyMachineOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInputs(raw: unknown): MachineVerifyInputs | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== MACHINE_VERIFY_INPUTS_VERSION) return undefined;
  if (typeof raw.home !== "string" || raw.home === "") return undefined;
  if (typeof raw.composedSkillsRoot !== "string" || raw.composedSkillsRoot === "") return undefined;
  if (raw.accountWorkspacesRoot !== undefined && typeof raw.accountWorkspacesRoot !== "string") return undefined;
  if (raw.thirdPartySkillsRoot !== undefined && typeof raw.thirdPartySkillsRoot !== "string") return undefined;
  return {
    schemaVersion: MACHINE_VERIFY_INPUTS_VERSION,
    home: raw.home,
    composedSkillsRoot: raw.composedSkillsRoot,
    ...(raw.accountWorkspacesRoot === undefined ? {} : { accountWorkspacesRoot: raw.accountWorkspacesRoot }),
    ...(raw.thirdPartySkillsRoot === undefined ? {} : { thirdPartySkillsRoot: raw.thirdPartySkillsRoot }),
  };
}

function buildNamedPlan(
  source: string,
  sourceRoot: string,
  skillNames: readonly string[],
  home: string,
  composedSkillsRoot: string,
): NamedSourcePlan {
  const manifest = buildSkillsManifest(skillNames, { composedSkillsRoot });
  const runtime = createRuntimeContext(manifest, { home, sourceRoot, workspaceRoot: home });
  return { source, plan: planInstallation(manifest, runtime) };
}

/** `gateSatisfied` requires a positive `evaluated` count; an empty-but-readable skill tree is still one real evaluation. */
function evaluatedCount(skillCount: number): number {
  return Math.max(1, skillCount);
}

export function verifyMachine(
  discovery: DiscoveryPort,
  fs: FileSystemPort,
  rawInputs: unknown,
  options: VerifyMachineOptions = {},
): MachineVerifyReport {
  const inputs = parseInputs(rawInputs);
  if (inputs === undefined) {
    const rows: MachineVerifyRow[] = [
      {
        row: "inputs",
        result: machineVerifyReasons.indeterminate(
          isRecord(rawInputs) ? "invalid-inputs" : "no-inputs-supplied",
          isRecord(rawInputs)
            ? `Inputs must declare schemaVersion ${MACHINE_VERIFY_INPUTS_VERSION}, a non-empty home, and a non-empty composedSkillsRoot.`
            : "No inputs document was supplied.",
        ),
      },
    ];
    const overall = foldGateResults(rows.map((row) => row.result), { emptyReason: "no-inputs-supplied" });
    return { rows, overall, exitCode: gateResultToExitCode(overall) };
  }

  const rows: MachineVerifyRow[] = [];
  const namedPlans: NamedSourcePlan[] = [];

  // -- account workspaces -----------------------------------------------------
  const accountRoot = resolveWorkspacesRoot({ root: inputs.accountWorkspacesRoot, env: options.env });
  const discoveryResult = discoverAccountWorkspaces(discovery, { root: accountRoot });
  if (discoveryResult.rootReason !== undefined) {
    rows.push({
      row: "account-workspaces",
      result: machineVerifyReasons.indeterminate(
        "account-workspaces-indeterminate",
        discoveryResult.rootDetail ?? discoveryResult.rootReason,
      ),
    });
  } else {
    rows.push({ row: "account-workspaces", result: gateSatisfied(evaluatedCount(discoveryResult.candidates.length)) });
    for (const candidate of discoveryResult.candidates) {
      if (candidate.verdict === "found") {
        rows.push({
          row: `account-workspace:${candidate.account}`,
          result: gateSatisfied(evaluatedCount(candidate.skillNames.length)),
        });
        if (candidate.skillNames.length > 0) {
          namedPlans.push(
            buildNamedPlan(candidate.account, candidate.skillsPath, candidate.skillNames, inputs.home, inputs.composedSkillsRoot),
          );
        }
      } else {
        rows.push({
          row: `account-workspace:${candidate.account ?? candidate.path}`,
          result: machineVerifyReasons.indeterminate(
            "account-workspaces-indeterminate",
            `${candidate.path}: ${candidate.reason} — ${candidate.detail}`,
          ),
        });
      }
    }
  }

  // -- third-party skills -------------------------------------------------------
  const thirdPartyRoot = resolveThirdPartyRoot({ root: inputs.thirdPartySkillsRoot, env: options.env });
  if (thirdPartyRoot !== undefined) {
    const thirdPartyResult = loadThirdPartySkills(discovery, { root: thirdPartyRoot });
    if (thirdPartyResult.verdict === "indeterminate") {
      rows.push({
        row: "third-party-skills",
        result: machineVerifyReasons.indeterminate(
          "third-party-skills-indeterminate",
          `${thirdPartyResult.reason ?? "unknown"}: ${thirdPartyResult.detail ?? ""}`,
        ),
      });
    } else {
      rows.push({
        row: "third-party-skills",
        result: gateSatisfied(evaluatedCount(thirdPartyResult.skills.length)),
      });
      if (thirdPartyResult.skills.length > 0) {
        namedPlans.push(
          buildNamedPlan(
            "third-party",
            thirdPartyRoot,
            thirdPartyResult.skills.map((skill) => skill.name),
            inputs.home,
            inputs.composedSkillsRoot,
          ),
        );
      }
    }
  }

  // -- composition ---------------------------------------------------------------
  const anySourceIndeterminate = rows.some((row) => row.result.verdict === "indeterminate");
  if (anySourceIndeterminate) {
    rows.push({
      row: "composition",
      result: machineVerifyReasons.indeterminate(
        "sources-indeterminate",
        "Composition was skipped because at least one source above could not be resolved. A machine composed from only the sources that DID resolve is a partial machine, and this module never reports a partial machine as verified.",
      ),
    });
  } else if (namedPlans.length === 0) {
    rows.push({
      row: "composition",
      result: machineVerifyReasons.indeterminate(
        "no-sources-found",
        "No account workspace or third-party source contributed any skill to compose. An empty composition is not evidence of a correctly composed machine.",
      ),
    });
  } else {
    try {
      composeInstallationPlans(namedPlans);
      const findings = verifyComposedInstallation(namedPlans, fs);
      rows.push({
        row: "composition",
        result: findings.length === 0 ? gateSatisfied(namedPlans.length) : gateViolated(findings),
      });
    } catch (error) {
      if (error instanceof DestinationCollisionError) {
        const findings: Finding[] = error.collisions.map((collision) => ({
          rule: "machine/skill-collision",
          severity: "high",
          message: `${collision.destinationPath}: claimed by ${collision.sources.join(", ")}`,
        }));
        rows.push({ row: "composition", result: gateViolated(findings) });
      } else {
        rows.push({
          row: "composition",
          result: machineVerifyReasons.indeterminate(
            "composition-failed",
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }
  }

  const overall = foldGateResults(rows.map((row) => row.result), {
    emptyReason: "no-inputs-supplied",
    emptyDetail: "No row produced a result.",
  });
  return { rows, overall, exitCode: gateResultToExitCode(overall) };
}
