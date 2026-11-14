/**
 * `clossys standard <agent>/<id> --by owner|planner [--requirements <file>] [--taste <file>]
 *   [--exemplars <file>] [--exemplar-file <file>]... [--at <iso>] [--root <dir>]`
 *
 * The one way a standard changes (R16.3, slot-constitution.md sections 3 and 5b): only the owner or
 * the planner, never an agent seat. It writes the named parts into `packages/<agent>/standards/<id>/`,
 * validates the whole standard (R15.2-R15.4, R15.6, R15.9) and, only when it is clean, appends one
 * `standard` event to the standard's ledger.json naming every file's sha256. An invalid result is
 * rolled back byte for byte and refused (exit 1). Recipes are never touched here: a recipe edit is an
 * agent skill unit's, and one change never holds both (R16.3).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { criterionIds } from "../constitution/criteria/core/catalog.js";
import { MODEL_AGENTS, STANDARD_ID, type ModelAgent } from "../records/slot-model/types.js";
import {
  exemplarIssues, readStandard, readStandardPolicy, requirementIssues, seedIssues, STANDARD_AUTHORS, STANDARD_FILES,
  tasteIssues, type Standard,
} from "../records/standards.js";
import { sha256Hex } from "../records/hash.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const STANDARD_USAGE = "Usage: clossys standard <agent>/<id> --by owner|planner [--requirements <file>] [--taste <file>] [--exemplars <file>] [--exemplar-file <file>]... [--at <iso>] [--root <dir>]\n"
  + "  writes the named parts of packages/<agent>/standards/<id>/ (requirements.json, taste.md, exemplars/exemplars.json, exemplar files),\n"
  + "  validates the whole standard and appends a `standard` ledger event; only the owner or the planner changes a standard (R16.3).";

const VALUED = ["--by", "--requirements", "--taste", "--exemplars", "--exemplar-file", "--at", "--root"] as const;

interface StandardFlags { positional: string[]; values: Map<string, string[]>; help: boolean }
function parseStandard(argv: readonly string[]): StandardFlags {
  const flags: StandardFlags = { positional: [], values: new Map(), help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") continue;
    if (arg === "--help") { flags.help = true; continue; }
    if ((VALUED as readonly string[]).includes(arg)) {
      const next = argv[++index];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) throw new CliUsageError(`${arg} requires a value\n${STANDARD_USAGE}`);
      flags.values.set(arg, [...(flags.values.get(arg) ?? []), next]);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${STANDARD_USAGE}`);
    flags.positional.push(arg);
  }
  return flags;
}
const one = (flags: StandardFlags, name: string) => flags.values.get(name)?.at(-1);
const refuse = (message: string): CliResult => ({ exitCode: 1, message: `standard refused: ${message}` });

/** Write by renaming a fully written sibling over the target. */
function replaceFile(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(staged, bytes, { flag: "wx" });
  try { renameSync(staged, path); } catch (error) { rmSync(staged, { force: true }); throw error; }
}

/** Every issue of a standard as R15 judges it: read and schema issues, criteria, taste, exemplars, seeds. */
export function standardIssues(standard: Standard, consumer: string): string[] {
  const registered = new Set(criterionIds());
  const policy = readStandardPolicy(consumer, standard.agent);
  const seedPolicy = standard.agent === "designer" ? policy : readStandardPolicy(consumer, "designer");
  return [
    ...standard.issues,
    ...(policy.error ? [policy.error] : []),
    ...requirementIssues(standard, registered),
    ...tasteIssues(standard, registered),
    ...exemplarIssues(standard, policy),
    ...seedIssues(standard, seedPolicy),
  ];
}

export async function runStandardCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parseStandard(argv);
  if (flags.help) return { exitCode: 0, message: STANDARD_USAGE };
  const [target, ...extra] = flags.positional;
  if (!target || extra.length) throw new CliUsageError(`standard takes one <agent>/<id>\n${STANDARD_USAGE}`);
  const slash = target.indexOf("/");
  const agent = target.slice(0, slash) as ModelAgent, id = target.slice(slash + 1);
  if (slash < 0 || !(MODEL_AGENTS as readonly string[]).includes(agent) || !STANDARD_ID.test(id)) {
    throw new CliUsageError(`standard target must be <agent>/<id> with agent ${MODEL_AGENTS.join(", ")} and a standard id, got ${target}\n${STANDARD_USAGE}`);
  }
  const by = one(flags, "--by");
  if (by === undefined) throw new CliUsageError(`--by is required\n${STANDARD_USAGE}`);
  // R16.3: a standard changes by the owner or the planner only; an agent seat never edits its judge.
  if (!(STANDARD_AUTHORS as readonly string[]).includes(by)) return refuse(`--by ${by}: standards change by ${STANDARD_AUTHORS.join(" or ")} only (an agent changes recipes, never its standard)`);
  const at = one(flags, "--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${STANDARD_USAGE}`);

  const root = discoverRoot(resolve(cwd, one(flags, "--root") ?? "."));
  const consumer = join(root, "clossys");
  const dir = join(root, "packages", agent, "standards", id);
  const writes: { rel: string; bytes: Buffer }[] = [];
  const take = (flag: string, rel: string) => {
    const file = one(flags, flag);
    if (file !== undefined) writes.push({ rel, bytes: readFileSync(resolve(cwd, file)) });
  };
  try {
    take("--requirements", STANDARD_FILES.requirements);
    take("--taste", STANDARD_FILES.taste);
    take("--exemplars", `${STANDARD_FILES.exemplars}/exemplars.json`);
    for (const file of flags.values.get("--exemplar-file") ?? []) {
      const name = basename(file);
      if (name === "exemplars.json" || name.startsWith(".")) throw new CliUsageError(`--exemplar-file ${file}: exemplars.json comes through --exemplars, and hidden files are not exemplars\n${STANDARD_USAGE}`);
      writes.push({ rel: `${STANDARD_FILES.exemplars}/${name}`, bytes: readFileSync(resolve(cwd, file)) });
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    return refuse(`cannot read an input file: ${(error as Error).message}`);
  }
  if (!writes.length && existsSync(dir)) return refuse("nothing to change: name at least one of --requirements, --taste, --exemplars, --exemplar-file");
  if (!writes.length) return refuse(`${target} does not exist; a new standard needs --requirements, --taste and --exemplars`);
  const rels = new Set(writes.map(write => write.rel));
  if (rels.size !== writes.length) throw new CliUsageError(`two inputs write the same file\n${STANDARD_USAGE}`);

  // Snapshot every file the write touches (and the ledger) so a refused write is undone byte for byte.
  const touched = [...rels, STANDARD_FILES.ledger].map(rel => join(dir, rel));
  const before = touched.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : null }));
  const newDirs = [join(dir, STANDARD_FILES.exemplars), dir].filter(path => !existsSync(path));
  const undo = () => {
    for (const entry of before) { if (entry.bytes === null) rmSync(entry.path, { force: true }); else replaceFile(entry.path, entry.bytes); }
    // Folders this run created are removed again only when empty (never recursively).
    for (const path of newDirs) { try { rmdirSync(path); } catch { /* not empty or gone: leave it */ } }
  };
  try { for (const write of writes) replaceFile(join(dir, write.rel), write.bytes); } catch (error) { undo(); return refuse(`write failed: ${(error as Error).message}`); }

  const standard = readStandard(root, agent, id);
  const issues = standardIssues(standard, consumer);
  if (issues.length) { undo(); return refuse(`${target} would not be a valid standard: ${issues.slice(0, 8).join("; ")}${issues.length > 8 ? ` (+${issues.length - 8} more)` : ""}`); }

  // The ledger event records every file but the ledger: R16.3 compares the last event to the folder.
  const ledgerPath = join(dir, STANDARD_FILES.ledger);
  let ledger: { schema: string; events: unknown[] } = { schema: "clossys.ledger/1", events: [] };
  if (existsSync(ledgerPath)) {
    try {
      const value = JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown;
      ledger = Array.isArray(value) ? { schema: "clossys.ledger/1", events: value } : value as typeof ledger;
      if (!Array.isArray(ledger.events)) throw new Error("ledger.json has no events array");
    } catch (error) { undo(); return refuse(`ledger.json: ${(error as Error).message}`); }
  }
  const files = Object.fromEntries(Object.entries(standard.files).sort(([a], [b]) => a.localeCompare(b)));
  const event = { op: "standard", at, by, verb: "standard", model: "none", tier: "none", standard: { agent, id, sha256: standard.sha256 }, files };
  const bytes = `${JSON.stringify({ ...ledger, events: [...ledger.events, event] }, null, 2)}\n`;
  try { replaceFile(ledgerPath, bytes); } catch (error) { undo(); return refuse(`ledger write failed: ${(error as Error).message}`); }
  return { exitCode: 0, root, message: `standard: ${target} ${[...rels].sort().join(", ")} written by ${by}; sha ${standard.sha256.slice(0, 12)}; ledger ${sha256Hex(bytes).slice(0, 12)}` };
}
