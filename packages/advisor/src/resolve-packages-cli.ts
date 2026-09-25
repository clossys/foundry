#!/usr/bin/env node
import { isDirectInvocation } from "./cli.js";
import { AdvisorPackageCliInputError, readStrictJsonInput } from "./package-request-cli.js";
import { resolvePackages } from "./package-resolution.js";

const USAGE = `Usage: advisor-resolve-packages <plan.json> <registry-snapshot.json>\n\nResolves a staffed plan's exact package acts from a registry snapshot: each\npackage at the version the registry's latest dist-tag named, with its sha512\nintegrity value. Reads two files; makes no network call. Prints a JSON report\nto stdout: on success, the plan's packages and resolution, and the package\nreferences a sponsor's grant permits.\nExit codes: 0 = resolved, 1 = violated, 2 = indeterminate, unreadable input, or usage error.`;

/** Testable CLI dispatcher. Invalid arguments or unreadable input throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 2) throw new AdvisorPackageCliInputError("plan.json and registry-snapshot.json are required");
  const plan = readStrictJsonInput("plan", argv[0] as string);
  const snapshot = readStrictJsonInput("snapshot", argv[1] as string);
  const result = resolvePackages(plan, snapshot);
  console.log(JSON.stringify(result, null, 2));
  return result.state === "satisfied" ? 0 : result.state === "violated" ? 1 : 2;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`advisor-resolve-packages: ${cause instanceof AdvisorPackageCliInputError ? cause.message : `failed unexpectedly (${cause instanceof Error ? cause.name : typeof cause})`}`);
    process.exitCode = 2;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
