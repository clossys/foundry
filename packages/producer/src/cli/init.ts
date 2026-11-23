/**
 * `clossys init [--starters <id,...>] [--root <dir>] [--at <iso>] [--json]`: prepares a consumer workspace for chat agents. It adds the
 * agent-neutral views pointer to the consumer's `AGENTS.md` (system.md 14.9), once, and seats the admin workspace
 * publication, a fixed Publisher responsibility in every consumer (init-admin.ts); a second run changes nothing.
 * With `--publication <id>` it does the same first (the admin workspace is built at init for every consumer, owner A1),
 * then records that publication's install outputs (`init-outputs.ts`).
 * With `--starters <id,...>` it does the same first, then seats each opt-in starter publication and its pages from the
 * Publisher package's own starter and page archetypes (`init-starters.ts`; today `site`).
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ensureAgentsPointer } from "../views/agents-pointer.js";
import { CliUsageError } from "./args.js";
import { seatAdmin } from "./init-admin.js";
import { placeSkills } from "./init-skills.js";
import { seatStarter, type StarterSeat, starterLines } from "./init-starters.js";
import { adoptInitLoops } from "./init-loops.js";
import { INIT_OUTPUTS_USAGE, runInitOutputsCli } from "./init-outputs.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";
import { SEATABLE_STARTERS } from "./starter-plan.js";

export const INIT_USAGE = "Usage: clossys init [--starters <id,...>] [--root <dir>] [--at <iso>] [--json]\n"
  + "  adds the views pointer block to the workspace AGENTS.md (created when missing) unless it is already there:\n"
  + "  run clossys views list, follow clossys views show <id>, answer only through clossys answer.\n"
  + "  seats the admin workspace (Publisher admin pages and publication.admin in the admin tab) through clossys ia,\n"
  + "  and raises one Designer slot request for each frame or section those pages compose that no workspace slot holds\n"
  + "  (the data-bound admin sections among them), then adopts and pins the five loops of every agent the workspace\n"
  + "  places (Publisher always) through the pin gate; --at stamps those writes.\n"
  + `  --starters (${SEATABLE_STARTERS.join(", ")}) then seats that opt-in publication and its routed pages from the Publisher package's\n`
  + "  starter and page archetypes through clossys ia, raises one slot request for each Designer or Writer slot they cite that no\n"
  + "  workspace slot holds, and writes no candidate or pin; a page with no archetype refuses (PageArchetypeError).\n"
  + INIT_OUTPUTS_USAGE;

const isoAt = (value: string | undefined): string => {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) throw new CliUsageError(`--at requires an ISO timestamp\n${INIT_USAGE}`);
  return value;
};

export async function runInitCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv.includes("--publication")) {
    // `--at` stamps the plain init this mode runs first; every other flag is the outputs mode's own (init-outputs.ts).
    const rest: string[] = [];
    let at: string | undefined;
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--at") { at = isoAt(argv[++index]); continue; }
      rest.push(argv[index]!);
    }
    return runInitOutputsCli(rest, cwd, workspace => initWorkspace(workspace, at, cwd, "init --publication refused"));
  }
  let root: string | undefined, at: string | undefined;
  const starters: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: INIT_USAGE };
    if (arg === "--json") continue;
    if (arg === "--starters") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--starters requires a value\n${INIT_USAGE}`);
      for (const id of value.split(",").map(part => part.trim())) {
        if (id === "admin") throw new CliUsageError(`--starters admin: the admin workspace is seated by every clossys init\n${INIT_USAGE}`);
        if (!SEATABLE_STARTERS.includes(id)) throw new CliUsageError(`--starters ${id}: init seats the starters ${SEATABLE_STARTERS.join(", ")}\n${INIT_USAGE}`);
        if (!starters.includes(id)) starters.push(id);
      }
      continue;
    }
    if (arg === "--root") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`--root requires a value\n${INIT_USAGE}`);
      root = value;
      continue;
    }
    if (arg === "--at") {
      at = isoAt(argv[++index]);
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${INIT_USAGE}`);
  }
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const stamp = at ?? new Date().toISOString();
  const init = await initWorkspace(workspace, stamp, cwd);
  if (!starters.length || init.exitCode !== 0) return init;
  const seats: StarterSeat[] = [], lines: string[] = [];
  for (const starter of starters) {
    const { result, seat } = await seatStarter(realpathSync(workspace), starter, stamp);
    seats.push(seat);
    const output = { ...(init.output as Record<string, unknown>), starters: seats };
    if (result) return { ...result, output: { ...output, ...(result.output as Record<string, unknown>) }, message: [init.message, result.message].join("\n") };
    lines.push(...starterLines(seat));
  }
  return { ...init, output: { ...(init.output as Record<string, unknown>), starters: seats }, message: [init.message, ...lines].join("\n") };
}

/**
 * Plain init of the workspace at `workspace`: the views pointer, the admin seat, then the agent loops. Every init mode
 * runs it first.
 * `refused` names the mode in a seat refusal; the outputs mode leads with it, so each mode has one refusal form.
 */
async function initWorkspace(workspace: string, at: string | undefined, cwd: string, refused = "init refused"): Promise<CliResult> {
  const pointer = ensureAgentsPointer(workspace);
  const pointerSaid = pointer.outcome === "added" ? `added the views pointer to ${pointer.file}` : `${pointer.file} already has the views pointer`;
  // The installed packages' agent skills, copied where Claude and Codex discover them (init-skills.ts), then checked.
  const skills = placeSkills(workspace);
  const said = [`placed ${skills.roles.length} agent skill${skills.roles.length === 1 ? "" : "s"} (${skills.roles.join(", ") || "none installed"}); ${skills.written.length} file${skills.written.length === 1 ? "" : "s"} written${skills.claude === "added" ? "; CLAUDE.md imports @AGENTS.md" : ""}`, pointerSaid].join("\n");
  if (skills.issues.length) return { exitCode: 1, root: workspace, output: { ...pointer, skills }, message: (refused === "init refused" ? [said, ...skills.issues.map(issue => `${refused}: ${issue}`)] : [...skills.issues.map(issue => `${refused}: ${issue}`), said]).join("\n") };
  // The slot model follows no symbolic link (records/slots.ts), so the seat runs on the workspace's real path (a tmp
  // or home folder reached through a link still seats).
  const { result, seat } = await seatAdmin(realpathSync(workspace), at ?? new Date().toISOString());
  // Plain mode keeps said-then-reason; the outputs mode leads with its own refusal (one refusal form per mode).
  const refusal = (reasons: readonly string[]): string => (refused === "init refused" ? [said, ...reasons] : [...reasons, said]).join("\n");
  if (result) return { ...result, output: { ...pointer, skills, admin: seat }, message: refusal([result.message.replace(/^init refused: /, `${refused}: `)]) };
  const loops = await adoptInitLoops(realpathSync(workspace), at ?? new Date().toISOString(), cwd);
  if (loops.issues.length) return { exitCode: 1, root: workspace, output: { ...pointer, skills, admin: seat, loops }, message: refusal(loops.issues.map(issue => `${refused}: loops ${issue}`)) };
  const raised = seat.requests.filter(item => item.created);
  const admin = seat.placed.length
    ? `seated the admin workspace: ${seat.placed.length} Publisher slot${seat.placed.length === 1 ? "" : "s"} placed${seat.started ? " in a new Publisher IA" : ""}`
    : "the admin workspace is already seated";
  return {
    exitCode: 0, root: workspace, output: { ...pointer, skills, admin: seat, loops },
    message: [admin, ...(seat.rewired.length ? [`rewired ${seat.rewired.length} admin slot${seat.rewired.length === 1 ? "" : "s"} to the units the workspace now holds: ${seat.rewired.join(", ")}`] : []), ...(raised.length ? [`raised ${raised.length} Designer slot request${raised.length === 1 ? "" : "s"} for admin units no workspace slot holds: ${raised.map(item => item.target).join(", ")}`] : []), ...(seat.seeded.length || seat.waiting.length ? [`seeded ${seat.seeded.length} admin record${seat.seeded.length === 1 ? "" : "s"}; pinned ${seat.pinned.length}${seat.waiting.length ? `; ${seat.waiting.length} wait for upstream pins: ${seat.waiting.map(item => item.slot).join(", ")}` : ""}`] : []), ...(loops.pinned.length ? [`adopted and pinned ${loops.pinned.length} agent loop${loops.pinned.length === 1 ? "" : "s"} (${loops.agents.join(", ")})`] : []), said].join("\n"),
  };
}
