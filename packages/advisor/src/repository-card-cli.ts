#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContractDocument } from "./contract-schema.js";
import { applyRepositoryChoice, repositoryChoiceCard } from "./repository-choice.js";

export const USAGE = `Usage: advisor-repository-card <repositories.json> [--current <owner/name>] [--choose <id>[,<id>...]]

Builds the hub's repository-choice card from the repositories a GitHub
account can see, and checks a client's choice against it. It reads only the
file it is given: no credentials, no network. Make the file with, for example:

  gh repo list --no-archived --limit 200 --json nameWithOwner,description > repositories.json

Without --choose, prints the card as JSON. With --choose, prints the checked
choice as JSON: the repositories to pass to \`launcher --repositories\`, in the
card's order. --current names the repository the client is working in; it
is recommended first.

Exit codes: 0 = card built or choice accepted, 1 = the choice is refused,
2 = unreadable or invalid input.`;

export class AdvisorRepositoryCardCliInputError extends Error {}

/**
 * Reads the agent-supplied repository list as strict JSON (#1475's reader):
 * invalid UTF-8, a syntax error (reported by position only), or a repeated
 * key is refused.
 */
export function readRepositoryListing(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new AdvisorRepositoryCardCliInputError(`repositories file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new AdvisorRepositoryCardCliInputError(`repositories file "${path}" is not a file`);
    return readContractDocument(readFileSync(resolved));
  } catch (cause) {
    if (cause instanceof AdvisorRepositoryCardCliInputError) throw cause;
    throw new AdvisorRepositoryCardCliInputError(`repositories file "${path}" is unreadable as strict JSON: it ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function parseArgs(argv: readonly string[]): { listingPath: string; current?: string; choose?: readonly string[] } {
  const [listingPath, ...rest] = argv;
  if (listingPath === undefined || listingPath.startsWith("--")) throw new AdvisorRepositoryCardCliInputError("exactly one repositories.json file is required first");
  let current: string | undefined;
  let choose: readonly string[] | undefined;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--current" && current === undefined && value !== undefined && !value.startsWith("--")) current = value;
    else if (flag === "--choose" && choose === undefined && value !== undefined && !value.startsWith("--")) choose = value.split(",");
    else throw new AdvisorRepositoryCardCliInputError("after the repositories file, only --current <owner/name> and --choose <id>[,<id>...] are accepted, each once and with a value");
  }
  return { listingPath, ...(current === undefined ? {} : { current }), ...(choose === undefined ? {} : { choose }) };
}

/** Testable CLI dispatcher. Invalid arguments or input throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  const built = repositoryChoiceCard(readRepositoryListing(args.listingPath), args.current === undefined ? {} : { current: args.current });
  if (built.state === "invalid") {
    throw new AdvisorRepositoryCardCliInputError(`the repository list is invalid: ${built.findings.map((finding) => finding.message).join("; ")}`);
  }
  if (args.choose === undefined) {
    console.log(JSON.stringify(built.card, null, 2));
    return 0;
  }
  const applied = applyRepositoryChoice(built.card, args.choose);
  if (applied.kind === "refused") {
    console.error(`advisor-repository-card: the choice is refused: ${applied.findings.map((finding) => finding.message).join("; ")}`);
    return 1;
  }
  console.log(JSON.stringify(applied, null, 2));
  return 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`advisor-repository-card: ${cause instanceof Error ? cause.message : String(cause)}`);
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
