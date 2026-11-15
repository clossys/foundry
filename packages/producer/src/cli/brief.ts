/**
 * `clossys brief <agent>/<slot-id> [--json] [--root <dir>]` prints the resolved brief (base plus tighten).
 * `clossys brief <agent>/<slot-id> --tighten --path <p> --op <max|min|require|add|remove|narrow> --value <json>
 *   --why <text> --by owner:<ref>|planner:<ref> [--at <iso>] [--root <dir>]` appends one tighten entry
 * (system.md 1 "tighten", 6.1, 7; flows F2 step 2, F5 step 3). The entry must be stricter than the base on its
 * path; a looser one is refused and nothing is written. The tighten list is append only.
 * Folds the int2 `craft-brief` read; agent-run refine-brief writes through this verb.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { tightenFindings } from "../check/brief-tighten-only.js";
import { readBaseSlot, readSlot, resolveBrief, tightenIssue, writeSlot, SLOT_AGENTS } from "../records/slot.js";
import type { Actor, AgentId, Iso, Slot, Tighten, TightenOp } from "../records/types.js";
import { nowIso } from "./ia-sync.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const BRIEF_USAGE = "Usage: clossys brief <agent>/<slot-id> [--json] [--root <dir>]\n"
  + "       clossys brief <agent>/<slot-id> --tighten --path <path> --op <max|min|require|add|remove|narrow> --value <json> --why <text> --by owner:<ref>|planner:<ref> [--at <iso>] [--root <dir>]\n"
  + "A tighten entry may only make the brief stricter than its package base (brief.tighten-only); a looser entry is refused.";

const OPS: readonly TightenOp[] = ["max", "min", "require", "add", "remove", "narrow"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;

function actorOf(by: string): Actor | string {
  const colon = by.indexOf(":");
  const who = colon < 0 ? by : by.slice(0, colon), ref = colon < 0 ? "" : by.slice(colon + 1);
  if ((who === "owner" || who === "planner") && ref) return { actor: who, ref };
  return `--by takes owner:<ref> or planner:<ref>, got ${by}`;
}

export async function runBriefCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const values = new Map<string, string>();
  let tighten = false, target: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: BRIEF_USAGE };
    if (arg === "--tighten") tighten = true;
    else if (arg === "--json") continue;
    else if (["--root", "--path", "--op", "--value", "--why", "--by", "--at"].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { exitCode: 2, message: `${arg} takes a value\n${BRIEF_USAGE}` };
      values.set(arg, value); index += 1;
    } else if (!arg.startsWith("--") && target === undefined) target = arg;
    else return { exitCode: 2, message: `Unknown argument: ${arg}\n${BRIEF_USAGE}` };
  }
  const slash = target?.indexOf("/") ?? -1;
  const agent = target?.slice(0, slash) as AgentId, id = target?.slice(slash + 1) ?? "";
  if (!target || slash < 0 || !SLOT_AGENTS.includes(agent) || !id) return { exitCode: 2, message: `brief takes one <agent>/<slot-id>\n${BRIEF_USAGE}` };
  const root = discoverRoot(resolve(cwd, values.get("--root") ?? "."));
  const file = join(root, "clossys", "agents", agent, id, "slot.json");
  if (!existsSync(file)) return { exitCode: 1, message: `${target}: no slot.json (clossys ia sync, or clossys ia add for a consumer slot)` };
  let slot: Slot;
  try { slot = readSlot(file); } catch (error) { return { exitCode: 1, message: (error as Error).message } }
  let scope: { brief: unknown; contract: unknown } = slot;
  if (slot.base !== null) {
    const base = readBaseSlot(root, agent, id);
    if (!base) return { exitCode: 1, message: `${target}: base ${slot.base.package}/${slot.base.path} is not installed` };
    scope = base.doc;
  }
  if (!tighten) {
    const resolved = resolveBrief(slot, scope);
    return { exitCode: resolved.issues.length ? 1 : 0, root, brief: resolved, message: [JSON.stringify({ brief: resolved.brief, contract: resolved.contract }, null, 2), ...resolved.issues.map(issue => `not applied: ${issue}`)].join("\n") };
  }

  for (const flag of ["--path", "--op", "--value", "--why", "--by"]) if (!values.has(flag)) return { exitCode: 2, message: `brief --tighten needs ${flag}\n${BRIEF_USAGE}` };
  const op = values.get("--op") as TightenOp;
  if (!OPS.includes(op)) return { exitCode: 2, message: `--op takes ${OPS.join(", ")}, got ${op}` };
  let value: unknown;
  try { value = JSON.parse(values.get("--value")!); } catch { return { exitCode: 2, message: `--value takes JSON, got ${values.get("--value")}` }; }
  const by = actorOf(values.get("--by")!);
  if (typeof by === "string") return { exitCode: 2, message: by };
  const at: Iso = values.get("--at") ?? nowIso();
  if (!ISO.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
  const entry: Tighten = { path: values.get("--path")!, op, value, why: values.get("--why")!, by, at };
  const issue = tightenIssue(scope, entry);
  if (issue) return { exitCode: 1, message: `brief.tighten-only: refused, nothing written: ${issue}` };
  const next: Slot = { ...slot, tighten: [...slot.tighten, entry], updatedAt: at };
  const findings = tightenFindings(root, next);
  if (findings.length) return { exitCode: 1, message: `brief.tighten-only: refused, nothing written: ${findings.map(finding => finding.detail).join("; ")}` };
  writeSlot(file, next);
  return { exitCode: 0, root, brief: resolveBrief(next, scope), message: `brief ${target}: tighten[${next.tighten.length - 1}] ${op} ${entry.path} written` };
}
