#!/usr/bin/env node
/**
 * `integrator-provenance-check` -- the consumer-invocable bin for issue
 * #885: verifies registry provenance for every installed `@clossys/*`
 * package via the public attestations endpoint
 * (`https://registry.npmjs.org/-/npm/v1/attestations/<pkg>@<version>`),
 * which works under pnpm (pnpm implements no `npm audit signatures`), and
 * reports currency scope-aware -- installed vs. that package's OWN latest
 * published version, never one hard-coded endpoint asked to answer for
 * every package in one run.
 *
 * See this repository's own consumer-adoption document ("Provenance instead
 * of a release-age wait") for the exact consumer-facing guarantee this bin
 * verifies, and its one named exception (a package's owner-present first
 * identity publication carries no trusted-publisher provenance).
 *
 * Presentation and I/O only, same discipline as `cli.ts`: read the plane's
 * own manifest and lockfile, an optional currency policy, call the pure
 * `checkInstalledPackagesProvenance`, print the report, pick an exit code.
 *
 * Exit codes (this repository's three-state convention):
 *   0 -- every installed @clossys package has verified provenance and,
 *        where a currency policy pins it, is at the pinned version.
 *   1 -- at least one package's provenance is missing or mismatched, or is
 *        pinned stale against a declared currency policy.
 *   2 -- could not run to a real answer: no manifest/lockfile found, a
 *        malformed currency-policy file, an unreachable registry, or a
 *        registry error. AN UNREACHABLE REGISTRY IS NEVER A PASS. Zero
 *        installed @clossys packages is also 2, never a vacuous 0 -- this
 *        bin verified nothing.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeInventoryFileSystem } from "./node-fs.js";
import { readInstalledInventoryReport } from "./inventory.js";
import { checkInstalledPackagesProvenance, type CurrencyPolicy, type ProvenanceCheckResult } from "./provenance-check.js";
import type { Transport } from "./reachability.js";

const USAGE = `Usage: integrator-provenance-check [options]

Verifies registry provenance for every installed @clossys/* package under
--cwd via the public npm attestations endpoint, and reports currency
(installed vs. that package's own latest published version) scoped per
package -- never one hard-coded registry endpoint for the whole run.

Options:
  --cwd <dir>               Directory holding package.json and a lockfile (npm or pnpm).
                             Defaults to the current directory.
  --currency-policy <path>  Optional JSON file: { "pins": { "<name>": "<exact expected version>" } }.
                             A package with no pin declared is reported, never blocking, on currency alone.
  --registry <url>          Override the registry base URL. Defaults to https://registry.npmjs.org.
  --help                    Print this message and exit 0.

Exit codes: 0 = verified and current, 1 = violated (missing/mismatched
provenance, or a stale pin against the declared currency policy), 2 =
indeterminate (no manifest/lockfile, malformed policy, unreachable registry,
registry error, or zero installed @clossys packages). An unreachable
registry is never a pass.
`;

/** Exported for this bin's own test suite -- any argument or local-input problem always maps to exit code 2, never 1. */
export class ProvenanceCliInputError extends Error {}

interface ParsedArgs {
  cwd?: string;
  currencyPolicyPath?: string;
  registry?: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let cwd: string | undefined;
  let currencyPolicyPath: string | undefined;
  let registry: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--cwd") {
      cwd = argv[++index];
      if (cwd === undefined) throw new ProvenanceCliInputError("--cwd requires a directory argument");
      continue;
    }
    if (arg === "--currency-policy") {
      currencyPolicyPath = argv[++index];
      if (currencyPolicyPath === undefined) throw new ProvenanceCliInputError("--currency-policy requires a file path argument");
      continue;
    }
    if (arg === "--registry") {
      registry = argv[++index];
      if (registry === undefined) throw new ProvenanceCliInputError("--registry requires a URL argument");
      continue;
    }
    throw new ProvenanceCliInputError(`unknown argument "${arg}"`);
  }

  return { cwd, currencyPolicyPath, registry, help };
}

function readCurrencyPolicy(path: string): CurrencyPolicy {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new ProvenanceCliInputError(`currency-policy file "${path}" does not exist`);
  if (!statSync(resolved).isFile()) throw new ProvenanceCliInputError(`currency-policy file "${path}" is not a file`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new ProvenanceCliInputError(`currency-policy file "${path}" is unreadable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProvenanceCliInputError(`currency-policy file "${path}" must be a JSON object`);
  }
  const pins = (parsed as Record<string, unknown>).pins;
  if (pins !== undefined) {
    if (typeof pins !== "object" || pins === null || Array.isArray(pins)) {
      throw new ProvenanceCliInputError(`currency-policy file "${path}" field "pins" must be an object`);
    }
    for (const [name, version] of Object.entries(pins as Record<string, unknown>)) {
      if (typeof version !== "string" || version.length === 0) {
        throw new ProvenanceCliInputError(`currency-policy file "${path}" pin for "${name}" must be a non-empty version string`);
      }
    }
  }
  return parsed as CurrencyPolicy;
}

function printReport(result: ProvenanceCheckResult): void {
  console.log(JSON.stringify(result, null, 2));
  if (result.packages.length === 0) {
    console.error("No installed @clossys/* packages were found -- nothing was verified. This is indeterminate, never a pass.");
    return;
  }
  for (const pkg of result.packages) {
    if (pkg.state === "verified") continue;
    console.error(`${pkg.name}@${pkg.installedVersion}: ${pkg.state}${pkg.reasons.length > 0 ? ` -- ${pkg.reasons.join("; ")}` : ""}`);
  }
}

function stateToExitCode(state: ProvenanceCheckResult["state"]): number {
  return state === "verified" ? 0 : state === "violated" ? 1 : 2;
}

const fetchTransport: Transport = (input, init) => fetch(input, init);

/**
 * Exported so this bin's own test suite can exercise the whole
 * argv-to-exit-code contract directly, with an injected `Transport` in place
 * of the real network -- `run()` below is the only caller that wires up the
 * real `fetch`.
 */
export async function main(argv: readonly string[], transport: Transport = fetchTransport): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const cwd = args.cwd !== undefined ? resolve(args.cwd) : process.cwd();
  const fs = createNodeInventoryFileSystem();
  const read = readInstalledInventoryReport(fs, {
    manifestPath: join(cwd, "package.json"),
    npmLockfilePath: join(cwd, "package-lock.json"),
    pnpmLockfilePath: join(cwd, "pnpm-lock.yaml"),
  });

  if (read.kind === "indeterminate") {
    console.error(`integrator-provenance-check: could not read the installed inventory under "${cwd}": ${read.reason}${read.detail ? ` -- ${read.detail}` : ""}`);
    return 2;
  }

  const packages = read.inventory.packages
    .filter((pkg) => pkg.name.startsWith("@clossys/"))
    .map((pkg) => ({ name: pkg.name, installedVersion: pkg.installedVersion }));

  const currencyPolicy = args.currencyPolicyPath !== undefined ? readCurrencyPolicy(args.currencyPolicyPath) : undefined;

  const result = await checkInstalledPackagesProvenance({
    packages,
    transport,
    ...(args.registry !== undefined ? { registryBaseUrl: args.registry } : {}),
    ...(currencyPolicy !== undefined ? { currencyPolicy } : {}),
  });

  printReport(result);
  return stateToExitCode(result.state);
}

function run(): void {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof ProvenanceCliInputError) {
        console.error(`integrator-provenance-check: ${error.message}`);
        console.error(`\n${USAGE}`);
      } else {
        console.error(`integrator-provenance-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
      process.exitCode = 2;
    });
}

/**
 * Same real-path guard `cli.ts` and `package-currency-rate-cli.ts` use: `npm
 * install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is actually invoked the only way it
 * ships -- as an installed CLI.
 */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
