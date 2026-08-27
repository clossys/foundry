import type { ExactPackage } from "./types.js";

/** The sole npm install command v1 represents. It is data, not caller input. */
export const NPM_CI_IGNORE_SCRIPTS = Object.freeze({
  command: "npm",
  args: ["ci", "--ignore-scripts"],
  manifestPath: "package.json",
  lockPath: "package-lock.json",
});

type UnknownRecord = Record<string, unknown>;
const ROOT_DEPENDENCY_SECTION = "devDependencies";
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function declaredVersion(value: unknown, expected: ExactPackage): boolean {
  if (!record(value)) return false;
  const dependencies = record(value[ROOT_DEPENDENCY_SECTION]) ? value[ROOT_DEPENDENCY_SECTION] : {};
  return dependencies[expected.name] === expected.version;
}

/** Validates npm's root devDependency and lock-v3 package entry without accepting a range or a borrowed section. */
export function validateNpmIdentity(manifest: unknown, lock: unknown, expected: ExactPackage): string[] {
  const findings: string[] = [];
  if (!declaredVersion(manifest, expected)) findings.push(`package.json ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name} at exact ${expected.version}`);
  if (!record(lock) || !record(lock.packages)) return [...findings, "package-lock.json has no packages object"];
  const root = lock.packages[""];
  if (!declaredVersion(root, expected)) findings.push(`package-lock root ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name} at exact ${expected.version}`);
  const entry = lock.packages[`node_modules/${expected.name}`];
  if (!record(entry) || entry.version !== expected.version || entry.integrity !== expected.integrity) {
    findings.push(`package-lock entry for ${expected.name} does not match exact version and integrity`);
  }
  return findings;
}
