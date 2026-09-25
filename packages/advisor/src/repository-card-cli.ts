#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContractDocument } from "./contract-schema.js";
import { applyRepositoryChoice, repositoryChoiceCard } from "./repository-choice.js";

/**
 * The command the skill uses to list the repositories GitHub's `user/repos`
 * API returns for the signed-in account with the owner, collaborator and
 * organization_member affiliations, on every page, archived ones left out,
 * as one JSON object per line. `--slurp` cannot be combined with `--jq`, so
 * each page's objects are written with `tojson`, which gh prints as one
 * compact line each. Its output is usable only when it exits 0.
 */
export const LIST_REPOSITORIES_COMMAND =
  "gh api --paginate 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100' --jq '.[] | select(.archived | not) | {nameWithOwner: .full_name, description} | tojson'";

export const USAGE = `Usage: advisor-repository-card <repositories-file> [--current <owner/name>] [--choose <id>[,<id>...]]

Builds the hub's repository-choice card from a list of repositories, and
checks a client's choice against it. It reads only the file it is given: no
credentials, no network, so it states only what that file shows and cannot
tell a complete list from a partial one. The file is either a JSON array of
{ nameWithOwner, description } entries or one such entry per line, which is
what this command writes:

  ${LIST_REPOSITORIES_COMMAND} > "$TMPDIR/repositories.jsonl"

Use the file only when that command exits 0: the shell creates it even when
gh fails, and a page that fails partway leaves it partial. Keep it outside
the repository and delete it afterwards: it lists private repository names.

Without --choose, prints the card as JSON. With --choose, prints the checked
choice as JSON: the repositories to pass to \`launcher --repositories\`, in the
card's order. --current names the repository the client is working in; when
it is on the list it is recommended first, and when it is not, the card has
no recommendation. Pass the same --current with --choose as when the card was
shown, so the order matches.

Exit codes: 0 = card built or choice accepted, 1 = the repository list given
is empty or the choice is refused, 2 = unreadable or invalid input.`;

export class AdvisorRepositoryCardCliInputError extends Error {}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Reads the agent-supplied repository list with #1475's strict reader:
 * invalid UTF-8, a byte order mark, a syntax error (reported by position
 * only), or a repeated key is refused. A file whose first non-blank
 * character is `[` is one JSON array; any other file is JSON Lines, one
 * entry per non-blank line, as `gh api --jq '... | tojson'` writes it. A
 * file with no entries at all reads as an empty list.
 */
export function readRepositoryListing(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new AdvisorRepositoryCardCliInputError(`repositories file "${path}" does not exist`);
  const unreadable = (detail: string) => new AdvisorRepositoryCardCliInputError(`repositories file "${path}" is unreadable as strict JSON: ${detail}`);
  let bytes: Uint8Array;
  try {
    if (!statSync(resolved).isFile()) throw new AdvisorRepositoryCardCliInputError(`repositories file "${path}" is not a file`);
    bytes = readFileSync(resolved);
  } catch (cause) {
    if (cause instanceof AdvisorRepositoryCardCliInputError) throw cause;
    throw unreadable(`it ${describeCause(cause)}`);
  }
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    throw unreadable("it is not valid UTF-8");
  }
  if (text.trimStart().startsWith("[") || text.startsWith("\ufeff")) {
    try {
      return readContractDocument(bytes);
    } catch (cause) {
      throw unreadable(`it ${describeCause(cause)}`);
    }
  }
  const entries: unknown[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      entries.push(readContractDocument(new TextEncoder().encode(line)));
    } catch (cause) {
      throw unreadable(`line ${index + 1} ${describeCause(cause)}`);
    }
  }
  return entries;
}

function parseArgs(argv: readonly string[]): { listingPath: string; current?: string; choose?: readonly string[] } {
  const [listingPath, ...rest] = argv;
  if (listingPath === undefined || listingPath.startsWith("--")) throw new AdvisorRepositoryCardCliInputError("exactly one repositories file is required first");
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
  if (built.state === "empty") {
    console.error("advisor-repository-card: the repository list given is empty, so there is nothing to choose from");
    return 1;
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
