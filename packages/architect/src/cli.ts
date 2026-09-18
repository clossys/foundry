#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessArchitectureExceptions } from "./assessment.js";
import { validateOperatingTopology } from "./topology.js";

const USAGE = `Usage: architect-check <assessment.json>
       architect-check topology <topology-file>
       architect-check exceptions <topology-file> <observations-file> --maximum-exception-rate <rate>

Commands:
  <assessment.json>  Assess architecture exception rate from one JSON file containing topology, observations, and maximumExceptionRate.
  topology           Validate a provider-neutral operating topology.
  exceptions         Assess architecture exception rate from observed changes.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or could not run.`;

export class ArchitectCliInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string, label: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new ArchitectCliInputError(`${label} "${path}" does not exist`);
  try { if (!statSync(resolved).isFile()) throw new ArchitectCliInputError(`${label} "${path}" is not a file`); }
  catch (error) { if (error instanceof ArchitectCliInputError) throw error; throw new ArchitectCliInputError(`cannot inspect ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`); }
  try { return JSON.parse(readFileSync(resolved, "utf8")); }
  catch (error) { throw new ArchitectCliInputError(`${label} "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function assessmentCommand(path: string): number {
  const value = readJson(path, "assessment file");
  if (!isRecord(value)) throw new ArchitectCliInputError("assessment file must be a JSON object");
  const maximumExceptionRate = typeof value.maximumExceptionRate === "number" ? value.maximumExceptionRate : Number(value.maximumExceptionRate);
  const report = assessArchitectureExceptions(value.topology, value.observations, { maximumExceptionRate });
  console.log(JSON.stringify({ ...report, proposedPositions: [] }, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

function topologyCommand(argv: readonly string[]): number {
  if (argv.length !== 1) throw new ArchitectCliInputError("topology requires exactly one topology-file");
  const findings = validateOperatingTopology(readJson(argv[0] as string, "topology-file"));
  const report = { state: findings.some((entry) => entry.severity === "error") ? "violated" : "satisfied", findings };
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : 1;
}

function exceptionsCommand(argv: readonly string[]): number {
  let topologyFile: string | undefined;
  let observationsFile: string | undefined;
  let rate: number | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    if (argument === "--maximum-exception-rate") {
      const value = argv[++index];
      if (value === undefined) throw new ArchitectCliInputError("--maximum-exception-rate requires a value");
      rate = Number(value);
    } else if (argument.startsWith("-")) throw new ArchitectCliInputError(`unknown option "${argument}"`);
    else if (topologyFile === undefined) topologyFile = argument;
    else if (observationsFile === undefined) observationsFile = argument;
    else throw new ArchitectCliInputError(`unexpected extra argument "${argument}"`);
  }
  if (topologyFile === undefined || observationsFile === undefined || rate === undefined) throw new ArchitectCliInputError("exceptions requires topology-file, observations-file, and --maximum-exception-rate");
  const report = assessArchitectureExceptions(readJson(topologyFile, "topology-file"), readJson(observationsFile, "observations-file"), { maximumExceptionRate: rate });
  console.log(JSON.stringify(report, null, 2));
  return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2;
}

/** Testable command dispatcher. Invalid arguments throw and the executable maps them to 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(USAGE); return 0; }
  const [command, ...rest] = argv;
  if (command === "topology") return topologyCommand(rest);
  if (command === "exceptions") return exceptionsCommand(rest);
  if (command !== undefined && rest.length === 0) return assessmentCommand(command);
  throw new ArchitectCliInputError(command === undefined ? "a command or assessment.json file is required" : `unknown command "${command}"`);
}

function run(): void {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    console.error(`architect-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

/**
 * Same real-path guard `designer`'s `cli.ts` and `writer`'s `cli.ts` both
 * use, for the same reason: `npm install` publishes `bin` entries as
 * symlinks, so comparing `process.argv[1]` to `import.meta.url` without
 * resolving symlinks on both sides fails the moment this file is actually
 * invoked the only way it ships — as an installed CLI — and does so
 * silently (`run()` never fires, nothing prints, exit code 0).
 */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) run();
