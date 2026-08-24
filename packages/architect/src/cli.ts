#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessArchitectureExceptions } from "./assessment.js";
import { validateOperatingTopology } from "./topology.js";

const USAGE = `Usage: architect-check topology <topology-file>
       architect-check exceptions <topology-file> <observations-file> --maximum-exception-rate <rate>

Commands:
  topology    Validate a provider-neutral operating topology.
  exceptions Assess architecture exception rate from observed changes.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or could not run.`;

export class ArchitectCliInputError extends Error {}

function readJson(path: string, label: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new ArchitectCliInputError(`${label} "${path}" does not exist`);
  try { if (!statSync(resolved).isFile()) throw new ArchitectCliInputError(`${label} "${path}" is not a file`); }
  catch (error) { if (error instanceof ArchitectCliInputError) throw error; throw new ArchitectCliInputError(`cannot inspect ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`); }
  try { return JSON.parse(readFileSync(resolved, "utf8")); }
  catch (error) { throw new ArchitectCliInputError(`${label} "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
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
  throw new ArchitectCliInputError(command === undefined ? "a command is required" : `unknown command "${command}"`);
}

function run(): void {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    console.error(`architect-check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) run();
