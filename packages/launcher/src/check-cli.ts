#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectInvocation } from "./cli.js";
import { isHubDocument, planWorkspace } from "./core.js";
import type {
  CommandResult,
  CwdObservation,
  InventoryObservation,
  WorkspaceHost,
  WorkspaceObservation,
} from "./types.js";

export const CHECK_USAGE = `Usage: launcher-check --input <observation.json>

Grade a captured workspace observation through planWorkspace. This bin does
not create, resume, or appoint a hub.

Exit codes: 0 = a create, resume, or adopt plan, 1 = a known refusal,
2 = indeterminate or the input could not be read.`;

export class LauncherCheckInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseInventoryObservation(value: unknown): InventoryObservation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new LauncherCheckInputError("observation.cwd.inventory must be an object");
  }
  if (value.status !== "missing" && value.status !== "empty" && value.status !== "populated") {
    throw new LauncherCheckInputError("observation.cwd.inventory.status must be missing, empty, or populated");
  }
  if (typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 0) {
    throw new LauncherCheckInputError("observation.cwd.inventory.count must be a nonnegative integer");
  }
  return { status: value.status, count: value.count };
}

function parseCwd(value: unknown): CwdObservation {
  if (!isRecord(value) || !isText(value.absolutePath)) {
    throw new LauncherCheckInputError("observation.cwd.absolutePath must be a nonempty string");
  }
  if (typeof value.empty !== "boolean" || typeof value.git !== "boolean" || typeof value.looksLikeFoundry !== "boolean") {
    throw new LauncherCheckInputError("observation.cwd must declare empty, git, and looksLikeFoundry booleans");
  }
  if (value.githubOwner !== undefined && !isText(value.githubOwner)) {
    throw new LauncherCheckInputError("observation.cwd.githubOwner must be a string");
  }
  if (value.githubRepository !== undefined && !isText(value.githubRepository)) {
    throw new LauncherCheckInputError("observation.cwd.githubRepository must be a string");
  }
  if (value.hub !== undefined && !isHubDocument(value.hub)) {
    throw new LauncherCheckInputError("observation.cwd.hub must be a v1 account-hub marker (schemaVersion, kind, owner, repository)");
  }
  const inventory = parseInventoryObservation(value.inventory);
  return {
    absolutePath: value.absolutePath,
    empty: value.empty,
    git: value.git,
    looksLikeFoundry: value.looksLikeFoundry,
    ...(isText(value.githubOwner) ? { githubOwner: value.githubOwner } : {}),
    ...(isText(value.githubRepository) ? { githubRepository: value.githubRepository } : {}),
    ...(isHubDocument(value.hub) ? { hub: value.hub } : {}),
    ...(inventory === undefined ? {} : { inventory }),
  };
}

export function parseObservation(value: unknown): WorkspaceObservation {
  if (!isRecord(value)) throw new LauncherCheckInputError("observation must be a JSON object");
  if (!Array.isArray(value.ownerCandidates) || value.ownerCandidates.some((item) => typeof item !== "string")) {
    throw new LauncherCheckInputError("observation.ownerCandidates must be an array of strings");
  }
  if (typeof value.ghAvailable !== "boolean" || typeof value.gitAvailable !== "boolean") {
    throw new LauncherCheckInputError("observation must declare ghAvailable and gitAvailable booleans");
  }
  if (value.envOwner !== undefined && !isText(value.envOwner)) {
    throw new LauncherCheckInputError("observation.envOwner must be a string");
  }
  if (value.advisorVersion !== undefined && !isText(value.advisorVersion)) {
    throw new LauncherCheckInputError("observation.advisorVersion must be a string");
  }
  return {
    cwd: parseCwd(value.cwd),
    ownerCandidates: value.ownerCandidates,
    ghAvailable: value.ghAvailable,
    gitAvailable: value.gitAvailable,
    ...(isText(value.envOwner) ? { envOwner: value.envOwner } : {}),
    ...(isText(value.advisorVersion) ? { advisorVersion: value.advisorVersion } : {}),
  };
}

function unused(): CommandResult {
  return { status: 1, stdout: "", stderr: "launcher-check does not run host commands" };
}

/** Host used only for owner prompting. Grading never creates a hub. */
export function planningHost(): WorkspaceHost {
  return {
    cwd: "/",
    env: {},
    isTTY: false,
    now: () => "1970-01-01T00:00:00.000Z",
    exists: () => false,
    isDirectory: () => false,
    readText: () => null,
    writeText: () => {
      throw new Error("launcher-check does not write");
    },
    mkdirp: () => {
      throw new Error("launcher-check does not write");
    },
    readDir: () => [],
    run: () => unused(),
    prompt: () => null,
  };
}

export function parseCheckArgs(argv: readonly string[]): { help: boolean; inputPath?: string } {
  if (argv.length === 0) return { help: true };
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  if (argv.length === 2 && argv[0] === "--input" && argv[1]) return { help: false, inputPath: argv[1] };
  throw new LauncherCheckInputError("expected --input <observation.json>, or --help");
}

export function checkMain(
  argv: readonly string[],
  readText: (path: string) => string,
  writeOut: (text: string) => void,
  writeErr: (text: string) => void,
): number {
  const parsed = parseCheckArgs(argv);
  if (parsed.help) {
    writeOut(`${CHECK_USAGE}\n`);
    return 0;
  }
  const inputPath = parsed.inputPath;
  if (inputPath === undefined) throw new LauncherCheckInputError("expected --input <observation.json>");
  let raw: string;
  try {
    raw = readText(resolve(inputPath));
  } catch {
    throw new LauncherCheckInputError(`cannot read ${inputPath}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new LauncherCheckInputError(`${inputPath} is not JSON`);
  }
  const observation = parseObservation(parsedJson);
  const decision = planWorkspace(observation, planningHost());
  if (decision.action === "refuse") {
    writeErr(`launcher-check: ${decision.message}\n`);
    return decision.state === "violated" ? 1 : 2;
  }
  writeOut(`${JSON.stringify({ action: decision.action, owner: decision.owner, repository: decision.repository })}\n`);
  return 0;
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    process.exitCode = checkMain(
      process.argv.slice(2),
      (path) => readFileSync(path, "utf8"),
      (text) => {
        process.stdout.write(text);
      },
      (text) => {
        process.stderr.write(text);
      },
    );
  } catch (cause) {
    process.stderr.write(`launcher-check: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 2;
  }
}
