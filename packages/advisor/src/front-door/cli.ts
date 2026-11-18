#!/usr/bin/env node
/**
 * `advisor`: the front door for one repository (a single app or a monorepo). No hub, no kit, no roles.
 * Exit codes: 0 = done, 1 = refused or not ready, 2 = usage.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./doctor.js";
import { realHost, type Host, type VerbResult } from "./host.js";
import { runInit } from "./init.js";
import { runInstall, runUpdate } from "./install.js";
import { runIntake } from "./intake.js";
import { runRelations } from "./relations.js";
import { directorCells, loadLoops, loadTree, PACKAGE_ROOT, runRound } from "./tree.js";

export const USAGE = `Usage: advisor <verb> [--root <dir>] [--json]

  doctor                         check this machine: Node 20+, npm, Git, inside a Git repository (reads no file)
  install --from <pack-dir>      install Producer and the agents from tarballs packed at one foundry commit
  init                           let Producer write the workspace config and views pointer (clossys init)
  intake --answers <file> [--observed <YYYY-MM-DD>]
                                 record the owner's one-time answers as Director evidence (clossys evidence)
  update --from <pack-dir>       install a newer pack; the same commit changes nothing
  relations [--set <file>]       show or record a context-only note about sister repositories
  conform                        run the L0-L3 round over Advisor's own draft tree and loops

Exit codes: 0 = done, 1 = refused or not ready, 2 = usage.`;

const VALUE_FLAGS = new Set(["--root", "--from", "--answers", "--observed", "--set"]);
const ALLOWED: Record<string, readonly string[]> = {
  doctor: ["--root"], install: ["--root", "--from"], init: ["--root"], intake: ["--root", "--answers", "--observed"],
  update: ["--root", "--from"], relations: ["--root", "--set"], conform: [],
};

export function runAdvisor(argv: readonly string[], cwd: string, host: Host = realHost): VerbResult {
  const [verb, ...rest] = argv;
  if (verb === undefined || verb === "--help" || verb === "-h" || verb === "help") return { exitCode: verb === undefined ? 2 : 0, lines: [USAGE] };
  const allowed = ALLOWED[verb];
  if (!allowed) return { exitCode: 2, lines: [`unknown verb ${verb}`, USAGE] };
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--json") continue;
    if (arg === "--help") return { exitCode: 0, lines: [USAGE] };
    if (!VALUE_FLAGS.has(arg) || !allowed.includes(arg)) return { exitCode: 2, lines: [`${verb} does not take ${arg}`, USAGE] };
    const value = rest[++index];
    if (value === undefined || value.startsWith("--")) return { exitCode: 2, lines: [`${arg} needs a value`] };
    flags.set(arg, value);
  }
  const root = resolve(cwd, flags.get("--root") ?? ".");
  const from = flags.has("--from") ? resolve(cwd, flags.get("--from")!) : undefined;
  const tree = loadTree();
  switch (verb) {
    case "doctor": return runDoctor(tree, root, host);
    case "install": return runInstall(root, from, host);
    case "update": return runUpdate(root, from, host);
    case "init": return runInit(root, host);
    case "intake": {
      const answers = flags.get("--answers");
      const observed = flags.get("--observed");
      return runIntake(tree, root, { ...(answers ? { answers: resolve(cwd, answers) } : {}), ...(observed ? { observed } : {}) }, host);
    }
    case "relations": { const set = flags.get("--set"); return runRelations(root, set === undefined ? undefined : resolve(cwd, set)); }
    default: {
      const rows = runRound(tree, loadLoops(tree), directorCells([join(PACKAGE_ROOT, "..", "director")]));
      const red = rows.filter(row => row.status === "red").length;
      return { exitCode: red ? 1 : 0, lines: [...rows.map(row => `${row.status.padEnd(6)} ${row.id} ${row.detail}`), `advisor conform: ${rows.length} rows, ${red} red`], json: { schema: "clossys.advisor-conform/1", rows } };
    }
  }
}

export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean { if (argvPath === undefined) return false; try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath)); } catch { return false; } }

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const argv = process.argv.slice(2);
  let result: VerbResult;
  try { result = runAdvisor(argv, process.cwd()); } catch (error) { result = { exitCode: 1, lines: [`advisor: ${error instanceof Error ? error.message : String(error)}`] }; }
  if (argv.includes("--json") && result.json !== undefined) process.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`);
  else (result.exitCode === 0 ? process.stdout : process.stderr).write(`${result.lines.join("\n")}\n`);
  process.exitCode = result.exitCode;
}
