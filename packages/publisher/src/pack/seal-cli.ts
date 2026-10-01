#!/usr/bin/env node
/**
 * `publisher-seal` — seals the website pack item from a bundle of render and
 * delivery evidence. Presentation and I/O only: parse argv, read four JSON
 * files, run the pure `sealWebsite` gate, then write or refuse. All real
 * logic lives in `seal.ts`.
 *
 *   publisher-seal <manifest> <ledger> <evidence> <map> --item <id> --strategy-revision <rev>
 *
 * The seal time is always the clock. There is no flag, option or environment
 * variable to set it: a `--now` would let a caller backdate the 24 hour
 * evidence window. `main` takes a clock only so tests can pin it.
 *
 * Exit codes:
 *
 *   0 — sealed: the manifest and the ledger were both rewritten.
 *   1 — refused: the gate produced findings. Neither file was touched.
 *   2 — could not run: bad arguments, a file missing, unreadable or not JSON,
 *       a manifest, ledger or map that is not itself usable, a manifest or
 *       ledger that is a symbolic link or has another hard link, a lock held
 *       by another run, a file that changed while the run was deciding, or a
 *       write that failed. Kept distinct from 1: "could not check" is never
 *       "refused".
 *
 * Nothing is written before the gate has accepted. Only then are the manifest
 * and the ledger locked (`<real directory>/<name>.seal.lock`, created
 * exclusively, so a second run is refused rather than racing; the directory is
 * resolved first, so two spellings of one directory contend), re-read, and
 * compared byte for byte with what the gate saw; a file that changed in
 * between is refused, never overwritten. Only `EEXIST` is reported as another
 * run holding the lock; any other failure to create it is reported with its
 * own error code. Both outputs and a copy of the previous ledger are written
 * to temp files first, each created exclusively and with the permissions of
 * the file it replaces, then renamed. The ledger is renamed before the
 * manifest, so a manifest never claims a seal the ledger lacks. If the
 * manifest rename fails after the ledger rename, the previous ledger is
 * renamed back and the run can simply be repeated; if that fails too, or the
 * run is stopped there, the ledger is ahead of a manifest whose item is still
 * kept. A rerun then finds the identical ledger entry (same id, url and
 * strategy revision) on evidence that still passes the gate, leaves the ledger
 * alone, writes only the manifest with `verifiedAt` set to the entry's
 * `publishedAt`, and exits 0; an entry that differs is refused as
 * `seal-already-recorded`. A run removes only the temp and lock files it
 * created itself; lock files and a restore copy left by a run that was killed
 * are removed by hand once no run is active.
 *
 * Output never repeats a value taken from the evidence, the map, the manifest
 * or the ledger except in the one line a successful seal prints, which names
 * the item and the ledger entry id (itself derived from the commit). Findings
 * print a rule and a path only. Error messages name the file paths exactly as
 * they were given on the command line.
 */

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fchmodSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicationMap, type PublicationMap } from "../core/publication-map.js";
import { validateLedger } from "../record/schema.js";
import type { Ledger } from "../record/types.js";
import { sealWebsite } from "./seal.js";
import type { PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

const USAGE = `Usage: publisher-seal <manifest> <ledger> <evidence> <map> --item <id> --strategy-revision <rev>

  manifest   Path to the pack manifest (clossys/publisher/pack.json). Rewritten on a seal. Not a symbolic link.
  ledger     Path to the publication ledger (an array of entries). Rewritten on a seal. Not a symbolic link.
  evidence   Path to the website seal evidence bundle (schemaVersion 1). Read only.
  map        Path to the publication map. Read only.

Options:
  --item <id>               The pack item to seal; only "website" can be sealed. Required.
  --strategy-revision <rev> The strategy revision recorded on the ledger entry. Required.
  --help                    Print this message and exit 0.

The seal is made at the current time; there is no option to set it.

Exit codes: 0 = sealed, 1 = refused (nothing written), 2 = could not run.
`;

/** Anything wrong with the arguments, an input file, or a write: always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  positionals: string[];
  item?: string;
  strategyRevision?: string;
  help: boolean;
}

const VALUE_FLAGS = new Set(["--item", "--strategy-revision"]);

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
      const key = arg === "--item" ? "item" : "strategyRevision";
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

/** A file this command reads. `writable` ones are replaced by a rename, so a symbolic link or a second hard link would leave the real file unsealed. */
interface Source {
  bytes: Buffer;
  mode: number;
}

function readSource(label: string, path: string, writable: boolean): Source {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  try {
    if (writable && lstatSync(path).isSymbolicLink()) throw new CliInputError(`${label} "${path}" is a symbolic link; give the path of the real file`);
    const stat = statSync(path);
    if (!stat.isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
    if (writable && stat.nlink > 1) throw new CliInputError(`${label} "${path}" has more than one hard link; give a file with a single name`);
    return { bytes: readFileSync(path), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError(`cannot read ${label} "${path}"`);
  }
}

/** Parses JSON without ever repeating the parser's message: it can quote the input. */
function parseJson(label: string, path: string, source: Source): unknown {
  try {
    return JSON.parse(source.bytes.toString("utf8")) as unknown;
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

/** A file the seal replaces: where it is, what it held when the gate looked, and the permissions to keep. */
interface Target {
  label: string;
  path: string;
  before: Source;
  text: string;
}

const LOCK_SUFFIX = ".seal.lock";

/** The real directory plus the file name, not the spelling of the path: two spellings of one directory (a symbolic-linked parent) name one file. Falls back to the given path when the directory cannot be resolved. */
function canonicalPath(path: string): string {
  try {
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

/** The error's own code (`EACCES`, `ENOSPC`, ...) and nothing else of it: its message is never repeated. */
function causeOf(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "unknown error";
}

/** Takes `<real directory>/<name>.seal.lock` exclusively. Returns the lock files this run created, so only those are ever removed. */
function acquireLocks(paths: string[]): string[] {
  const held: string[] = [];
  try {
    for (const path of paths.map(canonicalPath).sort()) {
      const lock = `${path}${LOCK_SUFFIX}`;
      try {
        closeSync(openSync(lock, "wx", 0o600));
      } catch (error) {
        // Only EEXIST means the lock is taken; a permission, space or filesystem error is reported as itself.
        if (causeOf(error) !== "EEXIST") throw new CliInputError(`cannot create the lock "${lock}" (${causeOf(error)})`);
        throw new CliInputError(`another publisher-seal run holds "${lock}" (or it was left behind by a run that stopped); remove it only once no run is active`);
      }
      held.push(lock);
    }
  } catch (error) {
    releaseLocks(held);
    throw error;
  }
  return held;
}

function releaseLocks(held: string[]): void {
  for (const lock of held) {
    try {
      unlinkSync(lock);
    } catch {
      // already gone
    }
  }
}

/** Re-reads a target under the lock: it must still be a plain file with the same bytes the gate accepted. */
function assertUnchanged(target: Target): void {
  let current: Source;
  try {
    current = readSource(target.label, target.path, true);
  } catch {
    throw new CliInputError(`${target.label} "${target.path}" changed while sealing; nothing was written, run again`);
  }
  if (!current.bytes.equals(target.before.bytes) || current.mode !== target.before.mode) {
    throw new CliInputError(`${target.label} "${target.path}" changed while sealing; nothing was written, run again`);
  }
}

/** Writes the ledger then the manifest. With no `ledger` (a seal whose entry is already recorded) only the manifest is written and the ledger is never touched. */
function writePair(ledger: Target | undefined, manifest: Target): void {
  const created: string[] = [];
  let restore: string | undefined;
  /** Writes a new temp file next to `path`, created exclusively with `mode`; only a file this call created is ever tracked for removal. */
  const stage = (path: string, name: string, data: string | Buffer, mode: number): string => {
    const temp = `${path}.${randomBytes(6).toString("hex")}.${name}.seal.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    created.push(temp);
    try {
      writeFileSync(fd, data);
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    return temp;
  };
  const rename = (from: string, to: string): void => {
    renameSync(from, to);
    created.splice(created.indexOf(from), 1);
  };

  let ledgerWritten = false;
  try {
    const nextLedger = ledger === undefined ? undefined : stage(ledger.path, "ledger", ledger.text, ledger.before.mode);
    const nextManifest = stage(manifest.path, "manifest", manifest.text, manifest.before.mode);
    if (ledger !== undefined && nextLedger !== undefined) {
      restore = stage(ledger.path, "restore", ledger.before.bytes, ledger.before.mode);
      rename(nextLedger, ledger.path);
      ledgerWritten = true;
    }
    rename(nextManifest, manifest.path);
  } catch {
    let restored = false;
    if (ledger !== undefined && ledgerWritten && restore !== undefined) {
      try {
        rename(restore, ledger.path);
        restored = true;
      } catch {
        // reported below, with the file that still holds the previous ledger
      }
    }
    // When the ledger could not be put back, its previous copy is the only record of it: keep that one file.
    const keep = ledgerWritten && !restored ? restore : undefined;
    for (const temp of created) {
      if (temp === keep) continue;
      try {
        unlinkSync(temp);
      } catch {
        // already renamed or never created
      }
    }
    if (!ledgerWritten) throw new CliInputError("could not write the sealed files; nothing was changed");
    if (restored) throw new CliInputError("could not write the manifest; the ledger was restored and nothing was changed, run again");
    throw new CliInputError(`could not write the manifest after the ledger was written: the ledger now records the seal and the manifest does not, and the ledger could not be restored; the previous ledger is kept at "${restore}"; running the same command again finishes the manifest from that entry, and the kept copy can then be deleted`);
  }
  for (const temp of created) {
    try {
      unlinkSync(temp);
    } catch {
      // a leftover restore copy is harmless; the seal is complete
    }
  }
}

/** Exported so the whole argv-to-exit-code contract can be exercised without spawning a process. Never throws: anything that stops a run maps to 2. `options.now` exists so tests can pin the clock; the command line has no way to set it. */
export function main(argv: string[], options: { now?: () => Date } = {}): number {
  try {
    return execute(argv, options.now ?? (() => new Date()));
  } catch (error) {
    console.error(error instanceof CliInputError ? `publisher-seal: ${error.message}` : "publisher-seal: unexpected error");
    return 2;
  }
}

function execute(argv: string[], clock: () => Date): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.positionals.length !== 4) throw new CliInputError("expected <manifest> <ledger> <evidence> <map>");
  if (args.item === undefined) throw new CliInputError("--item is required");
  if (args.strategyRevision === undefined) throw new CliInputError("--strategy-revision is required");

  const [manifestPath, ledgerPath, evidencePath, mapPath] = args.positionals.map((path) => resolve(path)) as [string, string, string, string];
  if (canonicalPath(manifestPath) === canonicalPath(ledgerPath)) throw new CliInputError("manifest and ledger must be different files");

  const manifestSource = readSource("manifest", manifestPath, true);
  const ledgerSource = readSource("ledger", ledgerPath, true);
  const manifest = requireManifest(parseJson("manifest", manifestPath, manifestSource));
  const ledger = requireLedger(parseJson("ledger", ledgerPath, ledgerSource));
  const evidence = parseJson("evidence", evidencePath, readSource("evidence", evidencePath, false));
  const map = requireMap(parseJson("map", mapPath, readSource("map", mapPath, false)));

  const now = clock().toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = sealWebsite({ manifest, ledger, itemId: args.item, evidence, map, now, strategyRevision: args.strategyRevision });
  if (!result.ok) {
    console.log(`refused: ${result.findings.length} finding(s); nothing was written`);
    for (const finding of result.findings) console.log(`  ${finding.rule} (${finding.path})`);
    return 1;
  }

  // An interrupted run left the ledger ahead of the manifest: its entry is already there, so only the manifest is written.
  const ledgerTarget: Target = { label: "ledger", path: ledgerPath, before: ledgerSource, text: `${JSON.stringify(result.ledger, null, 2)}\n` };
  const manifestTarget: Target = { label: "manifest", path: manifestPath, before: manifestSource, text: `${JSON.stringify(result.manifest, null, 2)}\n` };
  const held = acquireLocks([ledgerPath, manifestPath]);
  try {
    assertUnchanged(ledgerTarget);
    assertUnchanged(manifestTarget);
    writePair(result.resumed ? undefined : ledgerTarget, manifestTarget);
  } finally {
    releaseLocks(held);
  }
  console.log(result.resumed ? `finished "${args.item}": ledger entry ${result.entryId} was already recorded; the manifest now matches` : `sealed "${args.item}": ledger entry ${result.entryId}`);
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
