/**
 * Role-owned assessment surface discovery.
 *
 * A role declares its own assessment entry point in its own installed
 * manifest:
 *
 * ```json
 * "foundry": { "assessment": { "bin": "advisor-check", "invocation": "single-json-input" } }
 * ```
 *
 * Discovery reads that declaration and resolves it against the same
 * manifest's `bin` map. It never infers a surface: a role that ships five
 * CLIs and declares none has NO assessment surface, because picking which of
 * the five is "the assessment" would be this module deciding what a role's
 * assessment is — exactly the expertise this orchestration must not claim.
 *
 * The absence of a surface is a determinate result, not a skip. Every value
 * in `AssessmentSurfaceAbsence` reaches the report.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ASSESSMENT_INVOCATION_KINDS } from "./types.js";
import type { AssessmentSurface, AssessmentSurfaceAbsence, AssessmentSurfaceDiscovery } from "./types.js";

const SEP = String.fromCharCode(0);
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function absent(role: string, absence: AssessmentSurfaceAbsence): AssessmentSurfaceDiscovery { return { role, surface: null, absence }; }

/** The manifest key a role uses to declare its own assessment entry point. */
export const ASSESSMENT_DECLARATION_PATH = "foundry.assessment";

/**
 * Resolves one role's assessment surface from its installed manifest under
 * `installRoot` (a `node_modules`-shaped directory). Pure filesystem reads —
 * nothing is executed here.
 */
export function discoverRoleAssessmentSurface(installRoot: string, role: string): AssessmentSurfaceDiscovery {
  const packageRoot = join(resolve(installRoot), ...role.split("/"));
  let manifest: unknown;
  try {
    if (!statSync(join(packageRoot, "package.json")).isFile()) return absent(role, "package-not-installed");
  } catch { return absent(role, "package-not-installed"); }
  try { manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")); }
  catch { return absent(role, "manifest-unreadable"); }
  if (!record(manifest) || manifest.name !== role || !text(manifest.version)) return absent(role, "manifest-unreadable");
  const foundry = manifest.foundry;
  if (!record(foundry) || foundry.assessment === undefined) return absent(role, "no-assessment-declaration");
  const declaration = foundry.assessment;
  if (!record(declaration) || Object.keys(declaration).sort().join(SEP) !== ["bin", "invocation"].join(SEP) || !text(declaration.bin) || typeof declaration.invocation !== "string" || !(ASSESSMENT_INVOCATION_KINDS as readonly string[]).includes(declaration.invocation)) {
    return absent(role, "invalid-assessment-declaration");
  }
  const bins = manifest.bin;
  const target = record(bins) ? bins[declaration.bin] : undefined;
  if (!text(target) || isAbsolute(target) || target.split("/").includes("..")) return absent(role, "undeclared-assessment-bin");
  const executable = join(packageRoot, target);
  try { if (!statSync(executable).isFile()) return absent(role, "assessment-executable-missing"); }
  catch { return absent(role, "assessment-executable-missing"); }
  const surface: AssessmentSurface = { role, version: manifest.version, bin: declaration.bin, invocation: declaration.invocation as AssessmentSurface["invocation"], executable };
  return { role, surface, absence: null };
}

/** Discovers every named role's surface, preserving the caller's role order. */
export function discoverRoleAssessmentSurfaces(installRoot: string, roles: readonly string[]): readonly AssessmentSurfaceDiscovery[] {
  return roles.map((role) => discoverRoleAssessmentSurface(installRoot, role));
}
