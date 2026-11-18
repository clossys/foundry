/**
 * `clossys init [--root <dir>] [--at <iso>] [--json]`: prepares a consumer workspace for chat agents. It adds the
 * agent-neutral views pointer to the consumer's `AGENTS.md` (system.md 14.9), once, and seats the admin workspace
 * publication, a fixed Publisher responsibility in every consumer (init-admin.ts); a second run changes nothing.
 * Expanding opt-in starters (`--starters`: websites, docs, slides) is separate later work.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ensureAgentsPointer } from "../views/agents-pointer.js";
import { CliUsageError } from "./args.js";
import { seatAdmin } from "./init-admin.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const INIT_USAGE = "Usage: clossys init [--root <dir>] [--at <iso>] [--json]\n"
  + "  adds the views pointer block to the workspace AGENTS.md (created when missing) unless it is already there:\n"
  + "  run clossys views list, follow clossys views show <id>, answer only through clossys answer.\n"
  + "  seats the admin workspace (Publisher admin pages and publication.admin in the admin tab) through clossys ia,\n"
  + "  and raises one Designer slot request for each frame or section those pages compose that no workspace slot holds\n"
  + "  (the data-bound admin sections among them); --at stamps those writes.";

export async function runInitCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let root: string | undefined, at: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: INIT_USAGE };
    if (arg === "--json") continue;
    if (arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--root requires a value\n${INIT_USAGE}`);
      root = value;
      continue;
    }
    if (arg === "--at") {
      const value = argv[++index];
      if (value === undefined || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) throw new CliUsageError(`--at requires an ISO timestamp\n${INIT_USAGE}`);
      at = value;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${INIT_USAGE}`);
  }
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const pointer = ensureAgentsPointer(workspace);
  const said = pointer.outcome === "added" ? `added the views pointer to ${pointer.file}` : `${pointer.file} already has the views pointer`;
  // The slot model follows no symbolic link (records/slots.ts), so the seat runs on the workspace's real path (a tmp
  // or home folder reached through a link still seats).
  const { result, seat } = await seatAdmin(realpathSync(workspace), at ?? new Date().toISOString());
  if (result) return { ...result, output: { ...pointer, admin: seat }, message: [said, result.message].join("\n") };
  const raised = seat.requests.filter(item => item.created);
  const admin = seat.placed.length
    ? `seated the admin workspace: ${seat.placed.length} Publisher slot${seat.placed.length === 1 ? "" : "s"} placed${seat.started ? " in a new Publisher IA" : ""}`
    : "the admin workspace is already seated";
  return {
    exitCode: 0, root: workspace, output: { ...pointer, admin: seat },
    message: [admin, ...(raised.length ? [`raised ${raised.length} Designer slot request${raised.length === 1 ? "" : "s"} for admin units no workspace slot holds: ${raised.map(item => item.target).join(", ")}`] : []), said].join("\n"),
  };
}
