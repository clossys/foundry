import type { ExactPackage } from "./types.js";

/** The sole pnpm install command v1 represents. It is data, not caller input. */
export const PNPM_INSTALL_FROZEN_IGNORE_SCRIPTS = Object.freeze({
  command: "pnpm",
  args: ["install", "--frozen-lockfile", "--ignore-scripts"],
  manifestPath: "package.json",
  lockPath: "pnpm-lock.yaml",
});

type UnknownRecord = Record<string, unknown>;
const ROOT_DEPENDENCY_SECTION = "devDependencies";
function record(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function declaredVersion(value: unknown, expected: ExactPackage): boolean {
  if (!record(value)) return false;
  const dependencies = record(value[ROOT_DEPENDENCY_SECTION]) ? value[ROOT_DEPENDENCY_SECTION] : {};
  return dependencies[expected.name] === expected.version;
}

function yamlValue(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === "'" || quote === '"') && trimmed.at(-1) === quote ? trimmed.slice(1, -1) : trimmed;
}

const PEER_PACKAGE_NAME = "(?:@[a-z0-9][a-z0-9._-]*\\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)";
const PEER_ATOM = new RegExp(`^${PEER_PACKAGE_NAME}@[^@\\s()]+$`);

/**
 * pnpm appends peer-context groups to an importer resolution. A group holds
 * one npm package/resolution atom followed by zero or more nested groups.
 * Parse that grammar rather than merely counting parentheses: balanced junk is
 * not a peer context and must never make an exact importer look trustworthy.
 */
function peerContextEnd(value: string, start: number): number | null {
  if (value[start] !== "(") return null;
  let cursor = start + 1;
  const atomStart = cursor;
  while (cursor < value.length && value[cursor] !== "(" && value[cursor] !== ")") cursor += 1;
  if (!PEER_ATOM.test(value.slice(atomStart, cursor))) return null;
  while (value[cursor] === "(") {
    const nestedEnd = peerContextEnd(value, cursor);
    if (nestedEnd === null) return null;
    cursor = nestedEnd;
  }
  return value[cursor] === ")" ? cursor + 1 : null;
}

function validPeerContextSuffix(value: string): boolean {
  if (!value.startsWith("(")) return false;
  let cursor = 0;
  while (cursor < value.length) {
    const end = peerContextEnd(value, cursor);
    if (end === null) return false;
    cursor = end;
  }
  return true;
}

/** The importer base must remain exact; only a completely balanced peer suffix may follow it. */
function importerVersionMatches(value: string, expected: string): boolean {
  const resolved = yamlValue(value);
  if (resolved === expected) return true;
  const peerContext = resolved.slice(expected.length);
  return resolved.startsWith(expected) && validPeerContextSuffix(peerContext);
}
function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function packageLine(name: string, indent = 6): RegExp { return new RegExp(`^ {${indent}}(?:['"])?${escaped(name)}(?:['"])?\\s*:$`); }
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
  if (!declaredVersion(manifest, expected)) findings.push(`package.json ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name} at exact ${expected.version}`);
  if (typeof lockText !== "string" || lockText.length === 0) return [...findings, "pnpm-lock.yaml is unreadable"];
  const lines = lockText.split(/\r?\n/);
  const importers = lines.findIndex((line) => line === "importers:");
  const importer = importers < 0 ? -1 : lines.findIndex((line, index) => index > importers && line === "  .:");
  const packageStart = lines.findIndex((line, index) => index > importers && line === "packages:");
  if (importer < 0 || packageStart < 0) return [...findings, "pnpm-lock.yaml lacks the root importer or packages section"];
  const importerEnd = lines.findIndex((line, index) => index > importer && line.trim() !== "" && line.length - line.trimStart().length <= 2);
  const importerLines = lines.slice(importer + 1, importerEnd < 0 ? packageStart : Math.min(importerEnd, packageStart));
  const dependencyLine = importerLines.findIndex((line) => line === `    ${ROOT_DEPENDENCY_SECTION}:`);
  if (dependencyLine < 0) findings.push(`pnpm root importer ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name}`);
  else {
    const dependencyLines = block(importerLines, dependencyLine, 4);
    const dependency = dependencyLines.findIndex((line) => packageLine(expected.name).test(line));
    if (dependency < 0) findings.push(`pnpm root importer ${ROOT_DEPENDENCY_SECTION} does not declare ${expected.name}`);
    else {
      const info = block(dependencyLines, dependency, 6).map((line) => line.trim());
      const specifier = info.find((line) => line.startsWith("specifier:"));
      const version = info.find((line) => line.startsWith("version:"));
      if (yamlValue(specifier?.slice("specifier:".length) ?? "") !== expected.version || !importerVersionMatches(version?.slice("version:".length) ?? "", expected.version)) {
        findings.push(`pnpm root importer ${ROOT_DEPENDENCY_SECTION} does not pin ${expected.name} at exact ${expected.version}`);
      }
    }
  }
  const packageKey = `${expected.name}@${expected.version}`;
  const entry = lines.findIndex((line, index) => index > packageStart && packageLine(packageKey, 2).test(line));
  if (entry < 0) findings.push(`pnpm package entry for ${expected.name}@${expected.version} is absent`);
  else {
    const info = block(lines, entry, 2);
    const resolution = info.findIndex((line) => line === "    resolution:");
    const inline = info.find((line) => /^ {4}resolution:\s*\{/.test(line))?.match(/integrity:\s*([^,}\n]+)/);
    const nested = resolution < 0 ? undefined : block(info, resolution, 4).map((line) => line.trim()).find((line) => line.startsWith("integrity:"))?.slice("integrity:".length);
    if (yamlValue(inline?.[1] ?? nested ?? "") !== expected.integrity) findings.push(`pnpm package entry for ${expected.name} does not match exact resolution integrity`);
  }
  return findings;
}
