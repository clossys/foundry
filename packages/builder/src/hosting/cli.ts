/**
 * `builder hosting install` and `builder hosting should-build` (issue #1526).
 *
 * `should-build` exits 1 when a relevant input changed and 0 when none did.
 * Vercel's ignore command continues the build on exit 1 and cancels it on
 * exit 0, so a hosting config can call this command directly.
 */

import { defineHostingDeclaration, HOSTING_DECLARATION_FILE, validateHostingDeclaration } from "./declaration.js";
import type { HostingDeclaration, HostingSurface } from "./declaration.js";
import type { HostingInstallPorts, HostingInstallResult } from "./install.js";
import { runHostingInstall } from "./install.js";
import type { ShouldBuildDecision } from "./should-build.js";
import { decideShouldBuild } from "./should-build.js";

export const USAGE = `Usage: builder hosting install --surface <id>
   or: builder hosting should-build --surface <id>

  --surface <id>   The surface id in ${HOSTING_DECLARATION_FILE}.
  --help           Print this message and exit 0.

install checks each declared private scope's registry route and runs npm ci.
should-build prints each changed input. Exit 1 means that input changed.
Exit 0 means no relevant input changed.
`;

export class HostingCliError extends Error {}

export type HostingCliPort = HostingInstallPorts & {
  readTextFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
  listChangedPaths(): readonly string[];
  hasPreviousRevision(): boolean;
};

type Command = "install" | "should-build";

type Parsed = {
  readonly help: boolean;
  readonly command?: Command;
  readonly surfaceId?: string;
};

export function parseHostingArgs(argv: readonly string[]): Parsed {
  let help = false;
  let command: Command | undefined;
  let surfaceId: string | undefined;
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--surface") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new HostingCliError("--surface requires a value");
      surfaceId = value;
      index += 1;
      continue;
    }
    if (arg !== undefined && arg.startsWith("-")) throw new HostingCliError(`unknown argument ${arg}`);
    if (arg !== undefined) positionals.push(arg);
  }
  if (positionals.length > 0 && positionals[0] !== "hosting") throw new HostingCliError(`unknown command ${positionals[0] ?? ""}`);
  const verb = positionals[1];
  if (verb === "install" || verb === "should-build") command = verb;
  else if (verb !== undefined) throw new HostingCliError(`unknown command hosting ${verb}`);
  if (positionals.length > 2) throw new HostingCliError(`unknown argument ${positionals[2] ?? ""}`);
  return { help, ...(command === undefined ? {} : { command }), ...(surfaceId === undefined ? {} : { surfaceId }) };
}

function loadDeclaration(port: HostingCliPort): HostingDeclaration {
  let text: string;
  try {
    text = port.readTextFile(HOSTING_DECLARATION_FILE);
  } catch {
    throw new HostingCliError(`could not read ${HOSTING_DECLARATION_FILE}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new HostingCliError(`could not read ${HOSTING_DECLARATION_FILE}`);
  }
  const findings = validateHostingDeclaration(parsed);
  if (findings.length > 0) {
    throw new HostingCliError(findings.map((finding) => finding.message).join("\n"));
  }
  return defineHostingDeclaration(parsed);
}

function surfaceById(declaration: HostingDeclaration, id: string): HostingSurface {
  const surface = declaration.surfaces.find((candidate) => candidate.id === id);
  if (surface === undefined) throw new HostingCliError(`unknown surface ${id}`);
  return surface;
}

function readRouteFile(port: HostingCliPort): string {
  try {
    return port.readTextFile(".npmrc");
  } catch {
    return "";
  }
}

export function formatShouldBuild(decision: ShouldBuildDecision): string {
  return decision.changedInputs.map((input) => `changed: ${input}\n`).join("");
}

export function formatBuildEnvironment(result: Extract<HostingInstallResult, { ok: true }>): string {
  const lines = [
    ...result.buildEnvironment.present.map((name) => `build-environment ${name} present`),
    ...result.buildEnvironment.absent.map((name) => `build-environment ${name} absent`),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function main(argv: readonly string[], port: HostingCliPort): number {
  let parsed: Parsed;
  try {
    parsed = parseHostingArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.writeErr(`${message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help || argv.length === 0) {
    port.writeOut(USAGE);
    return 0;
  }
  if (parsed.command === undefined) {
    port.writeErr(`hosting command required\n\n${USAGE}`);
    return 2;
  }
  if (parsed.surfaceId === undefined) {
    port.writeErr(`--surface is required\n\n${USAGE}`);
    return 2;
  }
  try {
    const surface = surfaceById(loadDeclaration(port), parsed.surfaceId);
    if (parsed.command === "should-build") {
      const decision = decideShouldBuild(surface, port.listChangedPaths(), port.hasPreviousRevision());
      port.writeOut(formatShouldBuild(decision));
      return decision.build ? 1 : 0;
    }
    const result = runHostingInstall(surface, { ...port, routeFileText: readRouteFile(port) });
    if (!result.ok) {
      port.writeErr(`${result.message}\n`);
      return 1;
    }
    port.writeOut(formatBuildEnvironment(result));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.writeErr(`${message}\n`);
    return 2;
  }
}
