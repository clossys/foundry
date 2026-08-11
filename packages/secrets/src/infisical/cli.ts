#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccessTokenProvider, createOidcTokenProvider } from "./auth.js";
import { parseValueFreeCatalog } from "./catalog.js";
import { createInfisicalClient } from "./client.js";
import { InfisicalError } from "./errors.js";
import type { InfisicalAccessTokenProvider, InfisicalClientConfig } from "./types.js";

const USAGE = `Usage: vespene-secrets-infisical <command> [options]

Commands:
  catalog --catalog <file>  Validate and print value-free catalog metadata.
  check --catalog <file>    Check catalog readiness without printing values.
  list                      Print available secret names only.
  get <key>                 Report whether one key is present; never print its value.
  run -- <command...>       Inject secrets into a child process without writing a file.

Provider options for check, list, get, and run:
  --base-url <url>          Infisical API base URL. Or INFISICAL_API_URL.
  --project-id <id>         Consumer-provided project ID. Or INFISICAL_PROJECT_ID.
  --environment <slug>      Consumer-provided environment. Or INFISICAL_ENVIRONMENT.
  --path <path>             Consumer-provided secret path. Or INFISICAL_SECRET_PATH. Defaults to /.
  --auth <token|oidc>       Authentication mode. Defaults to token.

Token auth reads INFISICAL_TOKEN. OIDC auth reads INFISICAL_MACHINE_IDENTITY_ID
and INFISICAL_JWT, exchanges the JWT in memory, and never prints either token.

Exit codes: 0 = success, 1 = readiness/missing-key failure or child failure,
2 = invalid input, configuration, authentication, or provider failure.
`;

interface ParsedArgs {
  command: string;
  positionals: string[];
  childCommand: string[];
  flags: Map<string, string>;
  help: boolean;
}

class CliInputError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) throw new CliInputError("a command is required");
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { command: "", positionals: [], childCommand: [], flags: new Map(), help: true };
  }
  const command = argv[0] as string;
  const positionals: string[] = [];
  const childCommand: string[] = [];
  const flags = new Map<string, string>();
  let help = false;
  let inChild = false;

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (inChild) {
      childCommand.push(arg);
      continue;
    }
    if (arg === "--") {
      inChild = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliInputError(`${arg} requires a value`);
      const name = arg.slice(2);
      if (flags.has(name)) throw new CliInputError(`option --${name} must not be repeated`);
      flags.set(name, value);
      continue;
    }
    positionals.push(arg);
  }
  return { command, positionals, childCommand, flags, help };
}

function flag(args: ParsedArgs, name: string, environmentName?: string): string | undefined {
  return args.flags.get(name) ?? (environmentName === undefined ? undefined : process.env[environmentName]);
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) throw new CliInputError(`${label} is required`);
  return value;
}

function accessTokenProvider(args: ParsedArgs, baseUrl: string): InfisicalAccessTokenProvider {
  const auth = flag(args, "auth") ?? "token";
  if (auth === "token") {
    return createAccessTokenProvider(() => required(process.env.INFISICAL_TOKEN, "INFISICAL_TOKEN"));
  }
  if (auth === "oidc") {
    return createOidcTokenProvider({
      baseUrl,
      identityId: required(process.env.INFISICAL_MACHINE_IDENTITY_ID, "INFISICAL_MACHINE_IDENTITY_ID"),
      getIdentityToken: async () => required(process.env.INFISICAL_JWT, "INFISICAL_JWT"),
    });
  }
  throw new CliInputError('--auth must be "token" or "oidc"');
}

function clientConfig(args: ParsedArgs): InfisicalClientConfig {
  const baseUrl = required(flag(args, "base-url", "INFISICAL_API_URL"), "--base-url or INFISICAL_API_URL");
  return {
    baseUrl,
    projectId: required(flag(args, "project-id", "INFISICAL_PROJECT_ID"), "--project-id or INFISICAL_PROJECT_ID"),
    environment: required(
      flag(args, "environment", "INFISICAL_ENVIRONMENT"),
      "--environment or INFISICAL_ENVIRONMENT",
    ),
    secretPath: flag(args, "path", "INFISICAL_SECRET_PATH") ?? "/",
    accessTokenProvider: accessTokenProvider(args, baseUrl),
  };
}

function readCatalog(args: ParsedArgs) {
  const path = required(flag(args, "catalog"), "--catalog");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    throw new CliInputError("--catalog must name a readable JSON file");
  }
  return parseValueFreeCatalog(value);
}

function validateCommandArguments(args: ParsedArgs): void {
  const providerFlags = ["base-url", "project-id", "environment", "path", "auth"];
  const allowedByCommand: Record<string, readonly string[]> = {
    catalog: ["catalog"],
    check: ["catalog", ...providerFlags],
    list: providerFlags,
    get: providerFlags,
    run: providerFlags,
  };
  const allowed = allowedByCommand[args.command];
  if (allowed === undefined) return;
  for (const name of args.flags.keys()) {
    if (!allowed.includes(name)) throw new CliInputError(`unknown option --${name} for ${args.command}`);
  }
  if (args.command !== "get" && args.positionals.length > 0) {
    throw new CliInputError(`${args.command} does not accept positional arguments`);
  }
  if (args.command !== "run" && args.childCommand.length > 0) {
    throw new CliInputError(`${args.command} does not accept a child command`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  validateCommandArguments(args);

  switch (args.command) {
    case "catalog": {
      const catalog = readCatalog(args);
      console.log(JSON.stringify(catalog, null, 2));
      return 0;
    }
    case "check": {
      const report = await createInfisicalClient(clientConfig(args)).checkCatalog(readCatalog(args));
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    case "list": {
      const names = await createInfisicalClient(clientConfig(args)).listSecretNames();
      for (const name of names) console.log(name);
      return 0;
    }
    case "get": {
      const key = required(args.positionals[0], "get key");
      if (args.positionals.length !== 1) throw new CliInputError("get accepts exactly one key");
      // This presence-only command deliberately uses the value-free list
      // operation instead of resolving the requested secret.
      const present = (await createInfisicalClient(clientConfig(args)).listSecretNames()).includes(key);
      console.log(JSON.stringify({ key, present }));
      return present ? 0 : 1;
    }
    case "run": {
      if (args.childCommand.length === 0) throw new CliInputError("run requires -- followed by a command");
      const result = await createInfisicalClient(clientConfig(args)).run(args.childCommand);
      if (result.signal !== null) return 1;
      return result.exitCode === 0 ? 0 : 1;
    }
    default:
      throw new CliInputError("unknown command");
  }
}

async function run(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof CliInputError || error instanceof InfisicalError) {
      console.error(`vespene-secrets-infisical: ${error.message}`);
    } else {
      console.error("vespene-secrets-infisical: unexpected failure");
    }
    process.exitCode = 2;
  }
}

function isMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (isMainModule()) void run();
