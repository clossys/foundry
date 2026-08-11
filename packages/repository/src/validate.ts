import { REPOSITORY_PROFILE_VERSION } from "./types.js";
import type { RepositoryProfile, RepositoryProfileFinding, RepositoryProfileFindingRule } from "./types.js";

type RecordValue = Record<string, unknown>;

const PROFILE_KEYS = new Set(["schemaVersion", "defaultBranch", "commands", "protectedPaths"]);
const COMMAND_KEYS = new Set(["run", "cwd"]);
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:(?:-|:)[a-z0-9]+)*$/;

function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finding(rule: RepositoryProfileFindingRule, path: string, message: string): RepositoryProfileFinding {
  return { rule, severity: "error", path, message };
}

function isRepositoryRelative(value: string, allowPatterns: boolean): boolean {
  if (value.length === 0 || value.startsWith("/") || /^[a-z]:/i.test(value) || value.includes("\\") || value.includes("\0")) return false;
  if (!allowPatterns && /[*?[\]{}]/.test(value)) return false;
  if (allowPatterns && (/[?[\]{}]/.test(value) || /[@+?!*]\(/.test(value) || value.startsWith("!"))) return false;
  return !value.split("/").some((segment) => segment === ".." || segment.length === 0);
}

function isBranchName(value: string): boolean {
  if (value.length === 0 || value === "HEAD" || value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock") || value.includes("..") || value.includes("@{") || value.includes("//")) return false;
  const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || forbidden.has(character)) return false;
  }
  return !value
    .split("/")
    .some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"));
}

function validateRepositoryProfileValue(value: unknown): RepositoryProfileFinding[] {
  if (!isRecord(value)) return [finding("profile-shape", "$", "A repository profile must be an object.")];

  const findings: RepositoryProfileFinding[] = [];
  for (const key of Object.keys(value)) {
    if (!PROFILE_KEYS.has(key)) findings.push(finding("unknown-field", key, `Unknown profile field "${key}".`));
  }

  if (value.schemaVersion !== REPOSITORY_PROFILE_VERSION) {
    findings.push(finding("schema-version", "schemaVersion", `schemaVersion must be ${REPOSITORY_PROFILE_VERSION}.`));
  }

  if (typeof value.defaultBranch !== "string" || !isBranchName(value.defaultBranch)) {
    findings.push(finding("default-branch", "defaultBranch", "defaultBranch must be a valid Git branch name."));
  }

  if (!isRecord(value.commands)) {
    findings.push(finding("commands-shape", "commands", "commands must be a plain object keyed by command name."));
  } else {
    for (const [name, command] of Object.entries(value.commands)) {
      const commandPath = `commands.${name}`;
      if (!COMMAND_NAME.test(name)) {
        findings.push(finding("command-name", commandPath, `Command name "${name}" must be lowercase words separated by hyphens or colons.`));
      }
      if (!isRecord(command)) {
        findings.push(finding("command-shape", commandPath, "A command must be an object."));
        continue;
      }
      for (const key of Object.keys(command)) {
        if (!COMMAND_KEYS.has(key)) findings.push(finding("unknown-field", `${commandPath}.${key}`, `Unknown command field "${key}".`));
      }
      if (typeof command.run !== "string" || command.run.trim().length === 0) {
        findings.push(finding("command-run", `${commandPath}.run`, "run must be a non-empty string."));
      }
      if (command.cwd !== undefined && (typeof command.cwd !== "string" || !isRepositoryRelative(command.cwd, false))) {
        findings.push(finding("command-cwd", `${commandPath}.cwd`, "cwd must be a repository-relative directory without glob syntax or parent traversal."));
      }
    }
  }

  if (!Array.isArray(value.protectedPaths)) {
    findings.push(finding("protected-paths-shape", "protectedPaths", "protectedPaths must be an array."));
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < value.protectedPaths.length; index += 1) {
      const path = value.protectedPaths[index];
      const inputPath = `protectedPaths[${index}]`;
      if (typeof path !== "string" || !isRepositoryRelative(path, true)) {
        findings.push(finding("protected-path", inputPath, "A protected path must be a repository-relative path or glob without parent traversal."));
        continue;
      }
      if (seen.has(path)) findings.push(finding("duplicate-protected-path", inputPath, `Duplicate protected path "${path}".`));
      seen.add(path);
    }
  }

  return findings;
}

/**
 * Validates an untrusted repository profile without I/O or throwing.
 * Findings are emitted in input order and every independently checkable
 * problem is reported.
 */
export function validateRepositoryProfile(value: unknown): RepositoryProfileFinding[] {
  try {
    return validateRepositoryProfileValue(value);
  } catch {
    return [finding("profile-shape", "$", "A repository profile must be a safely readable object.")];
  }
}

/** Returns true only when the value conforms to the complete profile shape. */
export function isRepositoryProfile(value: unknown): value is RepositoryProfile {
  return validateRepositoryProfile(value).length === 0;
}
