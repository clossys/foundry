#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STANDARDS_CHECKS } from "./types.js";
import type { StandardsCheckName } from "./types.js";
import { verifyStandards } from "./verify.js";
import type { VerifyStandardsInputs, VerifyStandardsReport } from "./verify.js";

const USAGE = `Usage: inspector-check <assessment.json>

Assess pre-landing rule satisfaction from one caller-assembled JSON document.
This command does not compute change escape rate; Observer owns that metric.
Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.`;

const PROPOSED_POSITIONS: readonly unknown[] = [];

export class InspectorCliInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckName(value: string): value is StandardsCheckName {
  return (STANDARDS_CHECKS as readonly string[]).includes(value);
}

/** Reads this package's own version from the executing build, never from assessment JSON. */
export function resolveOwnVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(readFileSync(require.resolve("../package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/** Reads caller-owned assessment evidence without treating it as validated. */
export function readInspectorAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new InspectorCliInputError(`assessment file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new InspectorCliInputError(`assessment file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof InspectorCliInputError) throw cause;
    throw new InspectorCliInputError(`assessment file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new InspectorCliInputError(`${field} must be a non-empty string when provided`);
  return value;
}

function selectedChecks(value: unknown): readonly StandardsCheckName[] {
  if (value === undefined) return STANDARDS_CHECKS;
  if (!Array.isArray(value)) throw new InspectorCliInputError("selectedChecks must be an array");
  const names: StandardsCheckName[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isCheckName(entry)) {
      throw new InspectorCliInputError(`unknown check ${JSON.stringify(entry)} — known checks are ${STANDARDS_CHECKS.join(", ")}`);
    }
    names.push(entry);
  }
  return names;
}

function assessmentEnvelope(report: VerifyStandardsReport): Record<string, unknown> {
  return {
    state: report.overall.verdict,
    proposedPositions: PROPOSED_POSITIONS,
    rows: report.rows,
    overall: report.overall,
    exitCode: report.exitCode,
  };
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[], installedVersion: string | undefined = resolveOwnVersion()): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new InspectorCliInputError("exactly one assessment.json file is required");
  const value = readInspectorAssessmentJson(argv[0] as string);
  if (!isRecord(value)) throw new InspectorCliInputError("assessment file must be a JSON object");
  const declaredRange = optionalText(value.declaredRange, "declaredRange");
  const minimumVersion = optionalText(value.minimumVersion, "minimumVersion");
  const report = verifyStandards(value as unknown as VerifyStandardsInputs, {
    selectedChecks: selectedChecks(value.selectedChecks),
    installedVersion,
    ...(declaredRange === undefined ? {} : { declaredRange }),
    ...(minimumVersion === undefined ? {} : { minimumVersion }),
  });
  console.log(JSON.stringify(assessmentEnvelope(report), null, 2));
  return report.exitCode;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`inspector-check: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}

/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
