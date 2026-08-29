import { createGateReasons, foldGateResults, gateResultToExitCode, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import { DestinationCollisionError, composeInstallationPlans, diffRetiredDestinations, verifyComposedInstallation } from "../composition.js";
import type { ComposedPlanOperation, NamedSourcePlan, RetiredDestination } from "../composition.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import type { FileSystemPort, Finding } from "../types.js";
import { discoverAccountWorkspaces, resolveWorkspacesRoot } from "./discovery.js";
import { CLASS_ONE_SOURCE, loadClassOnePolicy, resolveClassOneDeclarationPath } from "./machine-layer.js";
import { buildSkillsManifest } from "./skills-manifest.js";
import { loadThirdPartySkills, resolveThirdPartyRoot } from "./third-party.js";
import type { DiscoveryPort } from "./types.js";

/**
 * `verifyMachine`: the orchestrator behind `builder-verify-machine`.
 *
 * Composes what `machine-layer.ts` (class 1: package-owned, account-neutral
 * conventions content), `discovery.ts` (class 2: per-account skill trees),
 * and `third-party.ts` (class 3: vendor-scoped skills) found into named
 * source plans (README's "Machine composition" section), then runs them
 * through this package's already-tested `composeInstallationPlans` and
 * `verifyComposedInstallation` completely unchanged — one composition path
 * for all three classes, never a second one for class 1.
 *
 * The one rule every branch below is written to protect: an indeterminate
 * source is never quietly excluded from composition while the sources that
 * DID resolve get verified as if they were the whole machine. If ANY of the
 * three classes above is indeterminate, composition itself is reported
 * indeterminate too — see the `composition` row's `sources-indeterminate`
 * branch. A caller reading only `overall` therefore can never mistake "half
 * the machine verified clean" for "the machine verified clean."
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
  /**
   * Overrides the `BUILDER_MACHINE_LAYER_DECLARATION_PATH` environment
   * variable. Optional in the same shape `thirdPartySkillsRoot` is: omitting
   * both this and the environment variable means "this run does not compose
   * class 1," not an error — a caller mid-migration, or one that has not
   * adopted a declaration yet, still gets a real verdict for the sources it
   * DID supply. The retirement #410 exists to unblock requires supplying
   * this explicitly; `verifyMachine` enforces the ternary once it is
   * supplied, it does not force every caller to supply it.
   */
  readonly classOneDeclarationPath?: string;
  /**
   * Path to a JSON document this caller previously persisted, shaped
   * `{"schemaVersion":1,"operations":[{"destinationPath","source","kind"},...]}`
   * — typically a prior run's own `composeInstallationPlans(...).operations`,
   * serialized verbatim (see `../composition.ts`'s `diffRetiredDestinations`
   * doc comment: `ComposedPlanOperation` is a structural superset of
   * `RetiredDestination`, so no conversion is needed on the way out). Entirely
   * optional, and this module never writes this file itself — no storage
   * opinion, the same discipline `observation-bundle.ts` and
   * `coverage-declaration.ts` keep. Omitting it means "this run does not
   * check for retired destinations," not an error.
   */
  readonly previousCompositionPath?: string;
}

export const machineVerifyReasons = createGateReasons([
  "no-inputs-supplied",
  "invalid-inputs",
  "account-workspaces-indeterminate",
  "third-party-skills-indeterminate",
  "class-one-indeterminate",
  "sources-indeterminate",
  "no-sources-found",
  "composition-failed",
  "retirement-indeterminate",
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
  if (raw.classOneDeclarationPath !== undefined && typeof raw.classOneDeclarationPath !== "string") return undefined;
  if (raw.previousCompositionPath !== undefined && typeof raw.previousCompositionPath !== "string") return undefined;
  return {
    schemaVersion: MACHINE_VERIFY_INPUTS_VERSION,
    home: raw.home,
    composedSkillsRoot: raw.composedSkillsRoot,
    ...(raw.accountWorkspacesRoot === undefined ? {} : { accountWorkspacesRoot: raw.accountWorkspacesRoot }),
    ...(raw.thirdPartySkillsRoot === undefined ? {} : { thirdPartySkillsRoot: raw.thirdPartySkillsRoot }),
    ...(raw.classOneDeclarationPath === undefined ? {} : { classOneDeclarationPath: raw.classOneDeclarationPath }),
    ...(raw.previousCompositionPath === undefined ? {} : { previousCompositionPath: raw.previousCompositionPath }),
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

  // -- class one: package-owned, account-neutral conventions --------------------
  // Optional the same way third-party is, just below: an unconfigured class-1
  // source is absent, not a failure. See `MachineVerifyInputs.classOneDeclarationPath`.
  const classOnePath = resolveClassOneDeclarationPath({ path: inputs.classOneDeclarationPath, env: options.env });
  if (classOnePath !== undefined) {
    const classOneResult = loadClassOnePolicy(discovery, { path: classOnePath });
    if (classOneResult.verdict === "indeterminate") {
      rows.push({
        row: "class-one-conventions",
        result: machineVerifyReasons.indeterminate(
          "class-one-indeterminate",
          `${classOneResult.reason ?? "unknown"}: ${classOneResult.detail ?? ""}`,
        ),
      });
    } else {
      const manifest = classOneResult.manifest as NonNullable<typeof classOneResult.manifest>;
      const entryCount = manifest.links.length + manifest.copies.length + manifest.managedBlocks.length;
      rows.push({ row: "class-one-conventions", result: gateSatisfied(evaluatedCount(entryCount)) });
      const runtime = createRuntimeContext(manifest, {
        home: inputs.home,
        sourceRoot: classOneResult.sourceRoot as string,
        workspaceRoot: inputs.home,
      });
      namedPlans.push({ source: CLASS_ONE_SOURCE, plan: planInstallation(manifest, runtime) });
    }
  }

  // -- composition ---------------------------------------------------------------
  // Captured only on a successful `composeInstallationPlans` call, for the
  // retirement comparison below -- `undefined` on every other branch
  // (indeterminate sources, no sources, or a collision/thrown failure),
  // which the retirement row below treats as "nothing to diff against."
  let composedOperations: readonly ComposedPlanOperation[] | undefined;
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
      const composed = composeInstallationPlans(namedPlans);
      composedOperations = composed.operations;
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

  // -- retirement: destinations a prior run owned that this run no longer claims (#240) --
  // Entirely optional -- see `MachineVerifyInputs.previousCompositionPath`.
  // This module never writes the file it reads here; a caller decides for
  // itself whether and how to persist a prior run's composed operations.
  if (inputs.previousCompositionPath !== undefined) {
    const compositionRow = rows.find((row) => row.row === "composition");
    if (compositionRow?.result.verdict === "indeterminate" || composedOperations === undefined) {
      rows.push({
        row: "retirement",
        result: machineVerifyReasons.indeterminate(
          "retirement-indeterminate",
          "Composition itself did not resolve this run, so retirement cannot be evaluated against a partial machine.",
        ),
      });
    } else {
      const raw = discovery.readTextFile(inputs.previousCompositionPath);
      if (raw === undefined) {
        rows.push({
          row: "retirement",
          result: machineVerifyReasons.indeterminate(
            "retirement-indeterminate",
            `${inputs.previousCompositionPath}: could not be read as text`,
          ),
        });
      } else {
        let parsedRaw: unknown;
        let parseErrorMessage: string | undefined;
        try {
          parsedRaw = JSON.parse(raw);
        } catch (error) {
          parseErrorMessage = error instanceof Error ? error.message : String(error);
        }
        const previous = parseErrorMessage === undefined ? parsePreviousComposition(parsedRaw) : undefined;
        if (parseErrorMessage !== undefined || previous === undefined) {
          rows.push({
            row: "retirement",
            result: machineVerifyReasons.indeterminate(
              "retirement-indeterminate",
              parseErrorMessage ??
                `${inputs.previousCompositionPath}: does not match the expected {"schemaVersion":1,"operations":[{"destinationPath","source","kind"}]} shape`,
            ),
          });
        } else {
          const diff = diffRetiredDestinations(previous, composedOperations);
          if (diff.retired.length === 0) {
            rows.push({ row: "retirement", result: gateSatisfied(Math.max(1, previous.length)) });
          } else {
            const findings: Finding[] = diff.retired.map((destination) => ({
              rule: "machine/destination-retired",
              severity: "medium",
              message: `${destination.destinationPath}: previously managed by "${destination.source}" (${destination.kind}); no current source claims it. Retire explicitly — this module never removes it automatically.`,
            }));
            rows.push({ row: "retirement", result: gateViolated(findings) });
          }
        }
      }
    }
  }

  const overall = foldGateResults(rows.map((row) => row.result), {
    emptyReason: "no-inputs-supplied",
    emptyDetail: "No row produced a result.",
  });
  return { rows, overall, exitCode: gateResultToExitCode(overall) };
}

const OPERATION_KINDS = ["link", "copy", "managed-block", "private-directory"] as const;

/**
 * Parses `raw` into `RetiredDestination[]`, or `undefined` for anything that
 * does not match the expected shape. Never throws — a malformed previous-
 * composition file is data for the caller above to fold into `indeterminate`,
 * not a program error.
 */
function parsePreviousComposition(raw: unknown): readonly RetiredDestination[] | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== 1) return undefined;
  const operations = raw.operations;
  if (!Array.isArray(operations)) return undefined;

  const parsed: RetiredDestination[] = [];
  for (const entry of operations) {
    if (!isRecord(entry)) return undefined;
    const { destinationPath, source, kind } = entry;
    if (typeof destinationPath !== "string" || destinationPath === "") return undefined;
    if (typeof source !== "string" || source === "") return undefined;
    if (typeof kind !== "string" || !OPERATION_KINDS.includes(kind as (typeof OPERATION_KINDS)[number])) return undefined;
    parsed.push({ destinationPath, source, kind: kind as RetiredDestination["kind"] });
  }
  return parsed;
}
