import type { ExactPackage } from "./types.js";

/** The sole pnpm install command v1 represents. It is data, not caller input. */
export const PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS = Object.freeze({
  command: "pnpm",
  args: ["install", "--frozen-lockfile", "--ignore-scripts"],
  manifestPath: "package.json",
  lockPath: "pnpm-lock.yaml",
});

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function declaredVersion(value: unknown, expected: ExactPackage): boolean {
  if (!record(value)) return false;
  const dependencies = record(value.dependencies) ? value.dependencies : {};
  const devDependencies = record(value.devDependencies) ? value.devDependencies : {};
  return dependencies[expected.name] === expected.version || devDependencies[expected.name] === expected.version;
}

function yamlValue(value: string): string { return value.trim().replace(/^['"]|['"]$/g, ""); }
function packageLine(name: string): RegExp { return new RegExp(`^ {6}(?:['"])?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['"])?\\s*:$`); }
function block(lines: readonly string[], start: number, indent: number): readonly string[] {
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() !== "" && line.length - line.trimStart().length <= indent) break;
    body.push(line);
  }
  return body;
}

/**
 * Deliberately small parser for the exact pnpm lock surface this package
 * needs. An unfamiliar lock shape is indeterminate, never a guessed pass.
 */
export function validatePnpmIdentity(manifest: unknown, lockText: unknown, expected: ExactPackage): string[] {
  const findings: string[] = [];
  if (!declaredVersion(manifest, expected)) findings.push(`package.json does not declare ${expected.name} at exact ${expected.version}`);
  if (typeof lockText !== "string" || lockText.length === 0) return [...findings, "pnpm-lock.yaml is unreadable"];
  const lines = lockText.split(/\r?\n/);
  const importer = lines.findIndex((line) => line === "  .:");
  const packageStart = lines.findIndex((line) => line === "packages:");
  if (importer < 0 || packageStart < 0) return [...findings, "pnpm-lock.yaml lacks the root importer or packages section"];
  const importerLines = lines.slice(importer + 1, packageStart);
  const dependencyLine = importerLines.findIndex((line) => line === "    dependencies:" || line === "    devDependencies:");
  if (dependencyLine < 0) findings.push(`pnpm root importer does not declare ${expected.name}`);
  else {
    const dependency = importerLines.findIndex((line, index) => index > dependencyLine && packageLine(expected.name).test(line));
    if (dependency < 0) findings.push(`pnpm root importer does not declare ${expected.name}`);
    else {
      const info = block(importerLines, dependency, 6).map((line) => line.trim());
      const specifier = info.find((line) => line.startsWith("specifier:"));
      const version = info.find((line) => line.startsWith("version:"));
      if (yamlValue(specifier?.slice("specifier:".length) ?? "") !== expected.version || yamlValue(version?.slice("version:".length) ?? "") !== expected.version) {
        findings.push(`pnpm root importer does not pin ${expected.name} at exact ${expected.version}`);
      }
    }
  }
  const packageKey = `${expected.name}@${expected.version}`;
  const escapedKey = packageKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = lines.findIndex((line) => new RegExp(`^  (?:['"])?${escapedKey}(?:['"])?\\s*:$`).test(line));
  if (entry < 0) findings.push(`pnpm package entry for ${expected.name}@${expected.version} is absent`);
  else {
    const info = block(lines, entry, 2).join("\n");
    const inline = info.match(/integrity:\s*([^,}\n]+)/);
    if (yamlValue(inline?.[1] ?? "") !== expected.integrity) findings.push(`pnpm package entry for ${expected.name} does not match exact integrity`);
  }
  return findings;
}
