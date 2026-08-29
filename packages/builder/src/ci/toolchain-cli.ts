/**
 * `verifyToolchain`: the orchestrator behind `builder-verify-toolchain` —
 * the first concrete gate built on this package's shared CI mechanics (see
 * `./report.ts` and `./version.ts`), and the shape #257 asks a future
 * subject to reuse rather than re-deriving its own fold and its own exit
 * code.
 *
 * Every row folds through the same three-state contract: `verified` /
 * `drifted` / `could-not-verify`. `indeterminate` dominates the fold — one
 * row that could not evaluate makes the whole run "could not evaluate",
 * regardless of how many others were clean — and an empty run is never a
 * pass. Both properties are inherited from `foldGateResults`/`foldLiveStateReports`
 * rather than re-derived here.
 */

import { createGateReasons, foldGateResults, gateResultToExitCode } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { LiveStateFinding, LiveStateReconciliationReason } from "../live-state.js";
import { validateToolchainDeclaration, reconcileToolchain } from "../toolchain.js";
import type { ToolchainDeclaration, ToolchainObservation } from "../toolchain.js";
import { checkVersionFloor } from "./version.js";
import type { VersionFloorReason } from "./version.js";

/** The schema version of the inputs document this CLI accepts. */
export const TOOLCHAIN_VERIFY_INPUTS_VERSION = 1 as const;

export const toolchainCliReasons = createGateReasons([
  "no-inputs-supplied",
  "unsupported-inputs-schema-version",
  "declaration-invalid",
] as const);

export type ToolchainCliReason = (typeof toolchainCliReasons.reasons)[number];

/** Every reason a row of this report can decline to answer. */
export type ToolchainVerifyReason = LiveStateReconciliationReason | ToolchainCliReason | VersionFloorReason;

export interface ToolchainVerifyInputs {
  readonly schemaVersion: typeof TOOLCHAIN_VERIFY_INPUTS_VERSION;
  readonly declaration: ToolchainDeclaration;
  readonly observation: ToolchainObservation;
}

export interface ToolchainVerifyOptions {
  /** This build's own version, as resolved by whatever loaded it. */
  readonly installedVersion: string | undefined;
  /** A floor higher than the compiled one. Never lowers it. */
  readonly minimumVersion?: string;
  /** The range the caller declared for this package in its own manifest. */
  readonly declaredRange?: string;
}

export interface ToolchainVerifyRow {
  readonly row: "version-floor" | "inputs" | "declaration" | string;
  readonly result: GateResult<LiveStateFinding, ToolchainVerifyReason>;
}

export interface ToolchainVerifyReport {
  readonly rows: readonly ToolchainVerifyRow[];
  readonly overall: GateResult<LiveStateFinding, ToolchainVerifyReason>;
  /** `0` verified, `1` drifted, `2` could-not-verify. Nothing overrides this mapping. */
  readonly exitCode: 0 | 1 | 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runs the staleness floor and, when the inputs are usable, reconciles the declared toolchain against the observation. */
export function verifyToolchain(
  inputs: ToolchainVerifyInputs | undefined,
  options: ToolchainVerifyOptions,
): ToolchainVerifyReport {
  const rows: ToolchainVerifyRow[] = [];

  const floor = checkVersionFloor({
    installedVersion: options.installedVersion,
    minimumVersion: options.minimumVersion,
    declaredRange: options.declaredRange,
  });
  rows.push({ row: "version-floor", result: floor.result });

  const supplied: unknown = inputs;
  const documentSupplied = isRecord(supplied);
  const readable = documentSupplied && supplied.schemaVersion === TOOLCHAIN_VERIFY_INPUTS_VERSION;
  if (!readable) {
    rows.push({
      row: "inputs",
      result: toolchainCliReasons.indeterminate(
        documentSupplied ? "unsupported-inputs-schema-version" : "no-inputs-supplied",
        documentSupplied
          ? `The inputs document declares schemaVersion ${JSON.stringify(supplied.schemaVersion)} and this build reads ${TOOLCHAIN_VERIFY_INPUTS_VERSION}.`
          : "No inputs document was supplied.",
      ),
    });
  } else {
    const { declaration, observation } = inputs as ToolchainVerifyInputs;
    const shapeFindings = validateToolchainDeclaration(declaration);
    if (shapeFindings.length > 0) {
      rows.push({
        row: "declaration",
        result: toolchainCliReasons.indeterminate(
          "declaration-invalid",
          shapeFindings.map((finding) => `${finding.rule}: ${finding.message}`).join("; "),
        ),
      });
    } else {
      for (const subjectReport of reconcileToolchain(declaration, observation)) {
        rows.push({ row: subjectReport.subject, result: subjectReport.result });
      }
    }
  }

  const overall = foldGateResults(
    rows.map((row) => row.result),
    { emptyReason: "no-inputs-supplied", emptyDetail: "No row produced a result." },
  );

  return { rows, overall, exitCode: gateResultToExitCode(overall) };
}
