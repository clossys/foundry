#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyWorkspacePlan, observeWorkspace, planWorkspace, skeletonRootFromModule } from "./core.js";
import { createNodeHost } from "./host.js";
import type { WorkspaceHost } from "./types.js";

export const USAGE = `Usage: launcher [--inventory <path>]

Create, resume, or appoint a GitHub repository as the account workspace hub.

Run from an empty directory to create {owner}/workspace. Run from an existing
hub to resume. Run from any GitHub repository you want to own the account-level
hub to appoint it — it does not have to be a new exclusive repo, and it keeps
its current name and files.

Appointing requires a populated generated hub inventory (packed template
skeleton/.clossys/inventory.json; the generated path does not ship), or
--inventory <path> pointing at one. Resume does not write. Create may write
an empty inventory.

GitHub-only. Owner is inferred from \`gh\` and git remotes. Public npm reads
need no token.

Exit codes: 0 = satisfied, 1 = a known refusal, 2 = indeterminate.`;

export class LauncherInputError extends Error {}

function exitCodeFor(state: "satisfied" | "violated" | "indeterminate"): number {
  return state === "satisfied" ? 0 : state === "violated" ? 1 : 2;
}

export function parseLauncherArgs(argv: readonly string[]): { help: boolean; inventoryPath?: string } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  if (argv.length === 0) return { help: false };
  if (argv.length === 2 && argv[0] === "--inventory" && argv[1]) return { help: false, inventoryPath: argv[1] };
  throw new LauncherInputError("launcher takes no arguments except optional --inventory <path>; run it from the directory to create or appoint");
}

/** Testable CLI dispatcher. Unknown arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[], host: WorkspaceHost, skeletonRoot: string): number {
  const parsed = parseLauncherArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const observation = observeWorkspace(host);
  if (
    !observation.cwd.empty &&
    !observation.cwd.git &&
    observation.cwd.hub === undefined &&
    !observation.cwd.looksLikeFoundry
  ) {
    console.log(USAGE);
    return 0;
  }
  const decision = planWorkspace(observation, host, { inventoryPath: parsed.inventoryPath });
  if (decision.action === "refuse") {
    console.error(`launcher: ${decision.message}`);
    return exitCodeFor(decision.state);
  }
  if (parsed.inventoryPath !== undefined && decision.action !== "adopt") {
    console.error("launcher: --inventory is only valid when appointing a GitHub repository");
    return 1;
  }
  const result = applyWorkspacePlan(host, decision, skeletonRoot);
  console.log(result.message);
  return 0;
}

function run(): void {
  try {
    const host = createNodeHost();
    process.exitCode = main(process.argv.slice(2), host, skeletonRootFromModule(import.meta.url));
  } catch (cause) {
    console.error(`launcher: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}

/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
