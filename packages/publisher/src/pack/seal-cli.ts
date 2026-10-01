#!/usr/bin/env node
/**
 * `publisher-seal` — seals one website pack item from a bundle of render and
 * delivery evidence. Presentation and I/O only: parse argv, read four JSON
 * files, run the pure `sealWebsite` gate, then write or refuse. All real
 * logic lives in `seal.ts`.
 *
 *   publisher-seal <manifest> <ledger> <evidence> <map> --item <id> --strategy-revision <rev> [--now <iso>]
 *
 * Exit codes:
 *
 *   0 — sealed: the manifest and the ledger were both rewritten.
 *   1 — refused: the gate produced findings. Neither file was touched.
 *   2 — could not run: bad arguments, a file missing, unreadable or not JSON,
 *       a manifest, ledger or map that is not itself usable, or a write that
 *       failed. Kept distinct from 1: "could not check" is never "refused".
 *
 * Nothing is written before the gate has accepted. Both outputs are written
 * to temp files first and then renamed; the ledger is renamed before the
 * manifest, so a crash between the two can leave a recorded seal the manifest
 * does not show yet (a rerun is refused as already recorded), never a manifest
 * that claims a seal the ledger lacks. Output never repeats a value from the
 * evidence: findings print a rule and a path only.
 */

import { existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicationMap, type PublicationMap } from "../core/publication-map.js";
import { validateLedger } from "../record/schema.js";
import type { Ledger } from "../record/types.js";
import { sealWebsite } from "./seal.js";
import type { PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

const USAGE = `Usage: publisher-seal <manifest> <ledger> <evidence> <map> --item <id> --strategy-revision <rev> [--now <iso>]

  manifest   Path to the pack manifest (clossys/publisher/pack.json). Rewritten on a seal.
  ledger     Path to the publication ledger (an array of entries). Rewritten on a seal.
  evidence   Path to the website seal evidence bundle (schemaVersion 1). Read only.
  map        Path to the publication map. Read only.

Options:
  --item <id>               The website pack item to seal. Required.
  --strategy-revision <rev> The strategy revision recorded on the ledger entry. Required.
  --now <iso>               ISO 8601 UTC instant to seal at. Defaults to the current time.
  --help                    Print this message and exit 0.

Exit codes: 0 = sealed, 1 = refused (nothing written), 2 = could not run.
`;

/** Anything wrong with the arguments, an input file, or a write: always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  positionals: string[];
  item?: string;
  strategyRevision?: string;
  now?: string;
  help: boolean;
}

const VALUE_FLAGS = new Set(["--item", "--strategy-revision", "--now"]);

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { positionals: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new CliInputError(`${arg} needs a value`);
      index += 1;
      const key = arg === "--item" ? "item" : arg === "--now" ? "now" : "strategyRevision";
      if (args[key] !== undefined) throw new CliInputError(`${arg} was given more than once`);
      args[key] = value;
    } else if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    } else {
      args.positionals.push(arg);
    }
  }
  return args;
}

function readFileText(label: string, path: string): string {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  try {
    if (!statSync(path).isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`cannot read ${label} "${path}"`);
  }
}

/** Parses JSON without ever repeating the parser's message: it can quote the input. */
function readJson(label: string, path: string): unknown {
  const raw = readFileText(label, path);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliInputError(`${label} "${path}" is not valid JSON`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireManifest(value: unknown): PackManifest {
  try {
    if (isPlainObject(value) && Array.isArray(value.items) && validatePackManifest(value as unknown as PackManifest).exitCode === 0) return value as unknown as PackManifest;
  } catch {
    // fall through: a manifest that throws in validation is not usable
  }
  throw new CliInputError("manifest is not a valid pack manifest");
}

function requireLedger(value: unknown): Ledger {
  if (Array.isArray(value) && validateLedger(value).every((finding) => finding.severity !== "error")) return value as Ledger;
  throw new CliInputError("ledger is not a valid publication ledger");
}

function requireMap(value: unknown): PublicationMap {
  const templates = isPlainObject(value) && Array.isArray(value.entries) ? value.entries.flatMap((entry) => (isPlainObject(entry) && typeof entry.template === "string" ? [entry.template] : [])) : [];
  // The map's own templates are passed as the known set: this checks the map's shape, not the host's template registry.
  if (validatePublicationMap(value, templates).length === 0) return value as PublicationMap;
  throw new CliInputError("map is not a valid publication map");
}

function writePair(first: { path: string; text: string }, second: { path: string; text: string }): void {
  const temps = [first, second].map((target) => ({ ...target, temp: `${target.path}.${process.pid}.seal.tmp` }));
  try {
    for (const target of temps) writeFileSync(target.temp, target.text, { flag: "wx" });
    for (const target of temps) renameSync(target.temp, target.path);
  } catch {
    for (const target of temps) {
      try {
        unlinkSync(target.temp);
      } catch {
        // already renamed or never created
      }
    }
    throw new CliInputError("could not write the sealed files");
  }
}

/** Exported so `seal-cli.test.ts` can exercise the whole argv-to-exit-code contract without spawning a process. Never throws: anything that stops a run maps to 2. */
export function main(argv: string[]): number {
  try {
    return execute(argv);
  } catch (error) {
    console.error(error instanceof CliInputError ? `publisher-seal: ${error.message}` : "publisher-seal: unexpected error");
    return 2;
  }
}

function execute(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.positionals.length !== 4) throw new CliInputError("expected <manifest> <ledger> <evidence> <map>");
  if (args.item === undefined) throw new CliInputError("--item is required");
  if (args.strategyRevision === undefined) throw new CliInputError("--strategy-revision is required");
  const now = args.now ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(now) || !Number.isFinite(Date.parse(now))) throw new CliInputError("--now must be an ISO 8601 UTC instant");

  const [manifestPath, ledgerPath, evidencePath, mapPath] = args.positionals.map((path) => resolve(path)) as [string, string, string, string];
  if (manifestPath === ledgerPath) throw new CliInputError("manifest and ledger must be different files");

  const manifest = requireManifest(readJson("manifest", manifestPath));
  const ledger = requireLedger(readJson("ledger", ledgerPath));
  const evidence = readJson("evidence", evidencePath);
  const map = requireMap(readJson("map", mapPath));

  const result = sealWebsite({ manifest, ledger, itemId: args.item, evidence, map, now, strategyRevision: args.strategyRevision });
  if (!result.ok) {
    console.log(`refused: ${result.findings.length} finding(s); nothing was written`);
    for (const finding of result.findings) console.log(`  ${finding.rule} (${finding.path})`);
    return 1;
  }

  writePair(
    { path: ledgerPath, text: `${JSON.stringify(result.ledger, null, 2)}\n` },
    { path: manifestPath, text: `${JSON.stringify(result.manifest, null, 2)}\n` },
  );
  console.log(`sealed "${args.item}": ledger entry ${result.entryId}`);
  return 0;
}

/** Same real-path guard `record/cli.ts` uses: an installed bin is a symlink, so both sides are resolved. */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (detectMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
