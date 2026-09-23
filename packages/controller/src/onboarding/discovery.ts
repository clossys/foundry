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
import { SOLVES_EVIDENCE_LEVELS } from "./types.js";
import type {
  AssessmentSurface,
  AssessmentSurfaceAbsence,
  AssessmentSurfaceDiscovery,
  FeedsDeclaration,
  FeedsDeclarationAbsence,
  FeedsDeclarationDiscovery,
  FeedsEntry,
  FitSurface,
  FitSurfaceAbsence,
  FitSurfaceDiscovery,
  IntakeSurface,
  IntakeSurfaceAbsence,
  IntakeSurfaceDiscovery,
  NeedsDeclaration,
  NeedsDeclarationAbsence,
  NeedsDeclarationDiscovery,
  NeedsEntry,
  OutputsDeclaration,
  OutputsDeclarationAbsence,
  OutputsDeclarationDiscovery,
  SolvesDeclaration,
  SolvesDeclarationAbsence,
  SolvesDeclarationDiscovery,
  SolvesEntry,
  StatusSurface,
  StatusSurfaceAbsence,
  StatusSurfaceDiscovery,
} from "./types.js";

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

/**
 * Discovery for the extended `foundry` manifest block, issue #1172:
 * `intake`, `outputs`, `status`, and `fit`, alongside the `assessment`
 * discovery above. Same
 * discipline throughout: read only the role's own installed manifest, never
 * infer, and report absence as a determinate value rather than guessing or
 * silently skipping.
 */

type ManifestRead = { readonly packageRoot: string; readonly manifest: Record<string, unknown> } | { readonly errorAbsence: "package-not-installed" | "manifest-unreadable" };

function readInstalledManifest(installRoot: string, role: string): ManifestRead {
  const packageRoot = join(resolve(installRoot), ...role.split("/"));
  let manifest: unknown;
  try {
    if (!statSync(join(packageRoot, "package.json")).isFile()) return { errorAbsence: "package-not-installed" };
  } catch { return { errorAbsence: "package-not-installed" }; }
  try { manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")); }
  catch { return { errorAbsence: "manifest-unreadable" }; }
  if (!record(manifest) || manifest.name !== role || !text(manifest.version)) return { errorAbsence: "manifest-unreadable" };
  return { packageRoot, manifest };
}

/** A package-relative path that stays inside the package directory: no leading '/', no '..' segment. */
function isSafeRelativePath(value: unknown): value is string {
  return text(value) && !isAbsolute(value) && !value.split("/").includes("..");
}

const roleShortName = (role: string): string => role.split("/").pop() as string;

/** The manifest key a role uses to declare its own shipped intake-question-cards file. */
export const INTAKE_DECLARATION_PATH = "foundry.intake";

/** Resolves one role's intake-question-cards surface from its installed manifest. */
export function discoverRoleIntakeSurface(installRoot: string, role: string): IntakeSurfaceDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, surface: null, absence: read.errorAbsence };
  const { packageRoot, manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.intake : undefined;
  if (declared === undefined) return { role, surface: null, absence: "no-intake-declaration" };
  if (!isSafeRelativePath(declared)) return { role, surface: null, absence: "invalid-intake-declaration" };
  const file = join(packageRoot, declared);
  try { if (!statSync(file).isFile()) return { role, surface: null, absence: "intake-file-missing" }; }
  catch { return { role, surface: null, absence: "intake-file-missing" }; }
  const surface: IntakeSurface = { role, version: manifest.version as string, path: declared, file };
  return { role, surface, absence: null };
}

/** Discovers every named role's intake surface, preserving the caller's role order. */
export function discoverRoleIntakeSurfaces(installRoot: string, roles: readonly string[]): readonly IntakeSurfaceDiscovery[] {
  return roles.map((role) => discoverRoleIntakeSurface(installRoot, role));
}

/** The manifest key a role uses to declare its own shipped fit-signal-declarations file. */
export const FIT_DECLARATION_PATH = "foundry.fit";

/** Resolves one role's fit-signal surface from its installed manifest. */
export function discoverRoleFitSurface(installRoot: string, role: string): FitSurfaceDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, surface: null, absence: read.errorAbsence };
  const { packageRoot, manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.fit : undefined;
  if (declared === undefined) return { role, surface: null, absence: "no-fit-declaration" };
  if (!isSafeRelativePath(declared)) return { role, surface: null, absence: "invalid-fit-declaration" };
  const file = join(packageRoot, declared);
  try { if (!statSync(file).isFile()) return { role, surface: null, absence: "fit-file-missing" }; }
  catch { return { role, surface: null, absence: "fit-file-missing" }; }
  const surface: FitSurface = { role, version: manifest.version as string, path: declared, file };
  return { role, surface, absence: null };
}

/** Discovers every named role's fit surface, preserving the caller's role order. */
export function discoverRoleFitSurfaces(installRoot: string, roles: readonly string[]): readonly FitSurfaceDiscovery[] {
  return roles.map((role) => discoverRoleFitSurface(installRoot, role));
}

/** The manifest key a role uses to declare its own read-only status probe. */
export const STATUS_DECLARATION_PATH = "foundry.status";

/** Resolves one role's read-only status probe from its installed manifest. Same shape and rules as `assessment`. */
export function discoverRoleStatusSurface(installRoot: string, role: string): StatusSurfaceDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, surface: null, absence: read.errorAbsence };
  const { packageRoot, manifest } = read;
  const foundry = manifest.foundry;
  if (!record(foundry) || foundry.status === undefined) return { role, surface: null, absence: "no-status-declaration" };
  const declaration = foundry.status;
  if (!record(declaration) || Object.keys(declaration).sort().join(SEP) !== ["bin", "invocation"].join(SEP) || !text(declaration.bin) || typeof declaration.invocation !== "string" || !(ASSESSMENT_INVOCATION_KINDS as readonly string[]).includes(declaration.invocation)) {
    return { role, surface: null, absence: "invalid-status-declaration" };
  }
  const bins = manifest.bin;
  const target = record(bins) ? bins[declaration.bin] : undefined;
  if (!text(target) || isAbsolute(target) || target.split("/").includes("..")) return { role, surface: null, absence: "undeclared-status-bin" };
  const executable = join(packageRoot, target);
  try { if (!statSync(executable).isFile()) return { role, surface: null, absence: "status-executable-missing" }; }
  catch { return { role, surface: null, absence: "status-executable-missing" }; }
  const surface: StatusSurface = { role, version: manifest.version as string, bin: declaration.bin, invocation: declaration.invocation as StatusSurface["invocation"], executable };
  return { role, surface, absence: null };
}

/** Discovers every named role's status surface, preserving the caller's role order. */
export function discoverRoleStatusSurfaces(installRoot: string, roles: readonly string[]): readonly StatusSurfaceDiscovery[] {
  return roles.map((role) => discoverRoleStatusSurface(installRoot, role));
}

/** The manifest key a role uses to declare the output paths it owns. */
export const OUTPUTS_DECLARATION_PATH = "foundry.outputs";

/**
 * Resolves one role's declared output paths from its installed manifest.
 * Every path must fall under this role's own `clossys/<role>/` folder
 * (this repository's own docs/contracts/consumer-layout.json, issue #1171,
 * which does not ship with this package -- it is a repository-level
 * convention document, not runtime input); a path outside it is reported
 * as `output-path-outside-role-folder` rather than silently kept.
 */
export function discoverRoleOutputsDeclaration(installRoot: string, role: string): OutputsDeclarationDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, declaration: null, absence: read.errorAbsence };
  const { manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.outputs : undefined;
  if (declared === undefined) return { role, declaration: null, absence: "no-outputs-declaration" };
  if (!Array.isArray(declared) || declared.length === 0 || !declared.every((item) => typeof item === "string")) {
    return { role, declaration: null, absence: "invalid-outputs-declaration" };
  }
  const paths = declared as readonly string[];
  const expectedPrefix = `clossys/${roleShortName(role)}/`;
  if (!paths.every((path) => isSafeRelativePath(path) && path.startsWith(expectedPrefix))) {
    return { role, declaration: null, absence: "output-path-outside-role-folder" };
  }
  const declaration: OutputsDeclaration = { role, version: manifest.version as string, paths };
  return { role, declaration, absence: null };
}

/** Discovers every named role's outputs declaration, preserving the caller's role order. */
export function discoverRoleOutputsDeclarations(installRoot: string, roles: readonly string[]): readonly OutputsDeclarationDiscovery[] {
  return roles.map((role) => discoverRoleOutputsDeclaration(installRoot, role));
}

/**
 * Discovery for schema version 2 of the extended `foundry` manifest block
 * (owner decision on issue #1176): `solves`, `needs`, and `feeds`. Same
 * discipline as everything above -- manifest-only, never inferred -- and
 * shape-level only: whether a `solves.metric` names this role's own owned
 * metric, whether a `solves.proofCase` exists in a qualification adapter,
 * and whether the needs/feeds handoff graph has a cycle are this
 * repository's own dev-time questions, answered by this repository's own
 * gate script in its `--enforce` mode, not ones a runtime orchestration can
 * answer for an arbitrary consumer.
 */

function isSolvesEntry(value: unknown): value is SolvesEntry {
  return record(value) && text(value.problem) && text(value.statement) && text(value.metric) && text(value.proofCase) && typeof value.evidence === "string" && (SOLVES_EVIDENCE_LEVELS as readonly string[]).includes(value.evidence);
}

/** The manifest key a role uses to declare its own verifiable client-problem claims. */
export const SOLVES_DECLARATION_PATH = "foundry.solves";

/** Resolves one role's `solves` declaration from its installed manifest. */
export function discoverRoleSolvesDeclaration(installRoot: string, role: string): SolvesDeclarationDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, declaration: null, absence: read.errorAbsence };
  const { manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.solves : undefined;
  if (declared === undefined) return { role, declaration: null, absence: "no-solves-declaration" };
  if (!Array.isArray(declared) || !declared.every(isSolvesEntry)) return { role, declaration: null, absence: "invalid-solves-declaration" };
  const declaration: SolvesDeclaration = { role, version: manifest.version as string, entries: declared as readonly SolvesEntry[] };
  return { role, declaration, absence: null };
}

/** Discovers every named role's `solves` declaration, preserving the caller's role order. */
export function discoverRoleSolvesDeclarations(installRoot: string, roles: readonly string[]): readonly SolvesDeclarationDiscovery[] {
  return roles.map((role) => discoverRoleSolvesDeclaration(installRoot, role));
}

function isNeedsEntry(value: unknown): value is NeedsEntry {
  return record(value) && text(value.producerRole) && text(value.artifact);
}

/** The manifest key a role uses to declare artifacts it consumes from another role's `feeds`. */
export const NEEDS_DECLARATION_PATH = "foundry.needs";

/** Resolves one role's `needs` declaration from its installed manifest. */
export function discoverRoleNeedsDeclaration(installRoot: string, role: string): NeedsDeclarationDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, declaration: null, absence: read.errorAbsence };
  const { manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.needs : undefined;
  if (declared === undefined) return { role, declaration: null, absence: "no-needs-declaration" };
  if (!Array.isArray(declared) || !declared.every(isNeedsEntry)) return { role, declaration: null, absence: "invalid-needs-declaration" };
  const declaration: NeedsDeclaration = { role, version: manifest.version as string, entries: declared as readonly NeedsEntry[] };
  return { role, declaration, absence: null };
}

/** Discovers every named role's `needs` declaration, preserving the caller's role order. */
export function discoverRoleNeedsDeclarations(installRoot: string, roles: readonly string[]): readonly NeedsDeclarationDiscovery[] {
  return roles.map((role) => discoverRoleNeedsDeclaration(installRoot, role));
}

/** The manifest key a role uses to declare artifacts it produces for other roles. */
export const FEEDS_DECLARATION_PATH = "foundry.feeds";

/**
 * Resolves one role's `feeds` declaration from its installed manifest. Every
 * path must fall under this role's own `clossys/<role>/` folder, the same
 * rule `outputs` already applies.
 */
export function discoverRoleFeedsDeclaration(installRoot: string, role: string): FeedsDeclarationDiscovery {
  const read = readInstalledManifest(installRoot, role);
  if ("errorAbsence" in read) return { role, declaration: null, absence: read.errorAbsence };
  const { manifest } = read;
  const foundry = manifest.foundry;
  const declared = record(foundry) ? foundry.feeds : undefined;
  if (declared === undefined) return { role, declaration: null, absence: "no-feeds-declaration" };
  if (!Array.isArray(declared) || !declared.every((item): item is FeedsEntry => record(item) && text(item.artifact) && text(item.path))) {
    return { role, declaration: null, absence: "invalid-feeds-declaration" };
  }
  const entries = declared as readonly FeedsEntry[];
  const expectedPrefix = `clossys/${roleShortName(role)}/`;
  if (!entries.every((item) => isSafeRelativePath(item.path) && item.path.startsWith(expectedPrefix))) {
    return { role, declaration: null, absence: "feeds-path-outside-role-folder" };
  }
  const declaration: FeedsDeclaration = { role, version: manifest.version as string, entries };
  return { role, declaration, absence: null };
}

/** Discovers every named role's `feeds` declaration, preserving the caller's role order. */
export function discoverRoleFeedsDeclarations(installRoot: string, roles: readonly string[]): readonly FeedsDeclarationDiscovery[] {
  return roles.map((role) => discoverRoleFeedsDeclaration(installRoot, role));
}
