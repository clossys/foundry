/**
 * Invoking a discovered, role-owned assessment surface.
 *
 * The invocation is fixed and the caller selects none of it: no shell, no
 * package runner, no caller-supplied command, argument list or executable
 * path. The executable comes from the role's own validated `bin` mapping
 * (see `./discovery.ts`) and the single argument is the consumer-owned
 * evidence file at a derived path. The child's environment is a fixed
 * allowlist, never spread from `process.env` -- see {@link childEnvironment}
 * for why a denylist is the wrong primitive for this boundary -- because a
 * role's first-day assessment reads consumer evidence and has no business
 * holding a credential of any shape.
 *
 * Whatever the role prints is parsed as JSON and carried onward untouched.
 * This module never repairs, defaults or normalizes it: an unparseable answer
 * is `assessment-output-unreadable`, not an empty assessment.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { AssessmentInvocationFailure, AssessmentSurface, RoleAssessmentObservation } from "./types.js";

/**
 * Environment names a first-day assessment child may see. A denylist of
 * credential names -- spread `process.env`, delete a short named list -- is
 * the wrong primitive for this boundary: it can only ever be as complete as
 * the list of credential shapes its author thought of, and has no answer for
 * a cloud provider's own token, an SSH agent socket, or any other secret a
 * consumer's shell happens to export that this module has never heard of.
 * (An earlier version of this function used exactly that shape, and a
 * review of this change is what caught it.) An assessment executable is a
 * role package's own code, run on a real consumer's machine -- there is no
 * bound on what it might be handed by accident, so the child gets an
 * allowlist instead: PATH so Node and any toolchain it shells out to can be
 * found, the HOME/TMPDIR family so code that expects a home or scratch
 * directory does not fail outright, and the locale pair so printed evidence
 * is not corrupted. Nothing on this list can carry a credential.
 */
const INHERITED_ENVIRONMENT = Object.freeze(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"] as const);

export const DEFAULT_ASSESSMENT_TIMEOUT_MS = 120_000;

/** The consumer-owned evidence file a role's assessment reads, derived from the role name alone. */
export function assessmentInputPath(evidenceDirectory: string, role: string): string {
  return join(evidenceDirectory, `${role.replace("@", "").split("/").join("-")}.assessment-input.json`);
}

export interface AssessmentProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly timedOut: boolean;
}

/** The seam tests substitute for. Production callers use {@link nodeAssessmentInvoker}. */
export type AssessmentInvoker = (surface: AssessmentSurface, inputPath: string, timeoutMs: number) => AssessmentProcessResult;

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENVIRONMENT) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/** Runs the role's own executable through Node with no shell and a bounded deadline. */
export const nodeAssessmentInvoker: AssessmentInvoker = (surface, inputPath, timeoutMs) => {
  const result = spawnSync(process.execPath, [surface.executable, inputPath], { encoding: "utf8", timeout: timeoutMs, shell: false, env: childEnvironment(), maxBuffer: 8 * 1024 * 1024 });
  const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return { exitCode: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "", timedOut };
};

const TERNARY: Readonly<Record<string, number>> = { satisfied: 0, violated: 1, indeterminate: 2 };

function parse(stdout: string): { value: unknown; readable: boolean } {
  try { return { value: JSON.parse(stdout) as unknown, readable: true }; }
  catch { return { value: undefined, readable: false }; }
}

/**
 * Observes one role's assessment: resolves its evidence file, runs its
 * declared surface, and reports exactly what came back.
 */
export function observeRoleAssessment(surface: AssessmentSurface, evidenceDirectory: string, invoke: AssessmentInvoker = nodeAssessmentInvoker, timeoutMs: number = DEFAULT_ASSESSMENT_TIMEOUT_MS): RoleAssessmentObservation {
  const inputPath = assessmentInputPath(evidenceDirectory, surface.role);
  const fail = (failure: AssessmentInvocationFailure, exitCode: number | null = null): RoleAssessmentObservation => ({ role: surface.role, surface, absence: null, failure, exitCode, assessment: undefined });
  try { if (!statSync(inputPath).isFile()) return fail("assessment-input-missing"); }
  catch { return fail("assessment-input-missing"); }
  const result = invoke(surface, inputPath, timeoutMs);
  if (result.timedOut) return fail("assessment-timed-out", result.exitCode);
  if (result.exitCode === null || ![0, 1, 2].includes(result.exitCode)) return fail("assessment-exit-inconsistent", result.exitCode);
  const parsed = parse(result.stdout);
  if (!parsed.readable) return fail("assessment-output-unreadable", result.exitCode);
  const state = typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value) ? (parsed.value as Record<string, unknown>).state : undefined;
  if (typeof state === "string" && state in TERNARY && TERNARY[state] !== result.exitCode) return fail("assessment-exit-inconsistent", result.exitCode);
  return { role: surface.role, surface, absence: null, failure: null, exitCode: result.exitCode, assessment: parsed.value };
}
