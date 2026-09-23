#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWorkspacePlan,
  cloneMissingInventoryRepositories,
  observeWorkspace,
  planWorkspace,
  launcherPackageRootFromModule,
  readLiveLauncherVersion,
  skeletonRootFromModule,
} from "./core.js";
import { createNodeHost } from "./host.js";
import type { WorkspaceHost } from "./types.js";

export const USAGE = `Usage: launcher [--inventory <path>] [--clone-missing]

Create, resume, or appoint a GitHub repository as the account workspace hub.

Run from an empty directory to create {owner}/workspace. Run from an existing
hub to resume. Run from any GitHub repository you want to own the account-level
hub to appoint it — it does not have to be a new exclusive repo, and it keeps
its current name and files.

Appointing requires a populated generated hub inventory (packed template
skeleton/clossys/.state/inventory.json; the generated path does not ship), or
--inventory <path> pointing at one. Resume refreshes composed skills and
stale hub guidance, and migrates a legacy .clossys/ hub state to
clossys/.state/ automatically. Create may write an empty inventory.

By default launcher never \`gh repo clone\`s a missing inventory entry --
that is not how you talk to the team. --clone-missing is the one explicit,
approved exception (#1179): on resume only, it clones every inventoried
repository not yet sitting beside the hub, and only those.

GitHub-only. Owner is inferred from \`gh\` and git remotes. Public npm reads
need no token.

Exit codes: 0 = satisfied, 1 = a known refusal, 2 = indeterminate.`;

export class LauncherInputError extends Error {}

function exitCodeFor(state: "satisfied" | "violated" | "indeterminate"): number {
  return state === "satisfied" ? 0 : state === "violated" ? 1 : 2;
}

export function parseLauncherArgs(argv: readonly string[]): { help: boolean; inventoryPath?: string; cloneMissing: boolean } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true, cloneMissing: false };
  const rest = [...argv];
  let cloneMissing = false;
  const cloneIndex = rest.indexOf("--clone-missing");
  if (cloneIndex !== -1) {
    cloneMissing = true;
    rest.splice(cloneIndex, 1);
  }
  if (rest.length === 0) return { help: false, cloneMissing };
  if (rest.length === 2 && rest[0] === "--inventory" && rest[1]) return { help: false, inventoryPath: rest[1], cloneMissing };
  throw new LauncherInputError(
    "launcher takes no arguments except optional --inventory <path> and/or --clone-missing; run it from the directory to create or appoint",
  );
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
    if (decision.action === "resume") {
      console.error("launcher: this hub is already appointed; edit clossys/.state/inventory.json to change its inventory");
    } else {
      console.error("launcher: --inventory is only valid when appointing a GitHub repository");
    }
    return 1;
  }
  if (parsed.cloneMissing && decision.action !== "resume") {
    console.error("launcher: --clone-missing is only valid on an already-appointed hub (resume)");
    return 1;
  }
  const result = applyWorkspacePlan(host, decision, skeletonRoot, {
    launcherPackageRoot: launcherPackageRootFromModule(import.meta.url),
    liveLauncherVersion: readLiveLauncherVersion(host),
  });
  console.log(result.message);
  if (parsed.cloneMissing && decision.action === "resume") {
    const outcomes = cloneMissingInventoryRepositories(host, decision.directory, decision.owner);
    for (const outcome of outcomes) {
      if (outcome.result === "skipped-other-reason") continue;
      console.log(`clone-missing (${outcome.inventoryId}): ${outcome.result} -- ${outcome.note}`);
    }
  }
  return 0;
}

function run(): void {
  try {
    const host = createNodeHost();
    const moduleUrl = import.meta.url;
    process.exitCode = main(process.argv.slice(2), host, skeletonRootFromModule(moduleUrl));
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
