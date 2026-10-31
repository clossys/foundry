/**
 * `clossys migrate slots [--check] [--compare] [--root <dir>]` and the slot half
 * of `clossys check --slots [--readiness]`.
 */
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkSlotModel, compareSlotModel, formatCoverage, slotCoverage } from "../migrate/slot-check.js";
import { planMigration, writePlan } from "../migrate/slots.js";
import { SLOT_AGENTS } from "../records/slot-model/index.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";

export const MIGRATE_USAGE = "Usage: clossys migrate slots [--check] [--compare] [--root <dir>] [--json]\n"
  + "  (no flag) write the slot model beside the old stores; deterministic and idempotent\n"
  + "  --check   validate the slot model (IA position, one pin, pin hash, single source, no candidate status, refs)\n"
  + "  --compare re-derive the old projections from the old stores and the slot model; any diff fails";

/** A workspace root holds `clossys/clossys.config.ts` or a `clossys/agents/` store. */
export function discoverWorkspace(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    const config = statSync(join(current, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile();
    const agents = statSync(join(current, "clossys", "agents"), { throwIfNoEntry: false })?.isDirectory();
    if (config || agents) return current;
    const parent = dirname(current);
    if (parent === current) throw Object.assign(new Error("Root not found: expected clossys/clossys.config.ts or clossys/agents/ in this directory or an ancestor"), { exitCode: 2 });
    current = parent;
  }
}

export async function runMigrateCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let check = false, compare = false, root: string | undefined, help = false;
  const rest = [...argv];
  if (rest[0] !== "slots" && !rest.includes("--help")) throw new CliUsageError(`migrate requires the slots target\n${MIGRATE_USAGE}`);
  if (rest[0] === "slots") rest.shift();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--compare") compare = true;
    else if (arg === "--json") continue;
    else if (arg === "--help") help = true;
    else if (arg === "--root") { const next = rest[++index]; if (!next || next.startsWith("--")) throw new CliUsageError("--root requires a value"); root = next; }
    else throw new CliUsageError(`Unknown argument: ${arg}\n${MIGRATE_USAGE}`);
  }
  if (help) return { exitCode: 0, message: MIGRATE_USAGE };
  let workspace: string;
  try { workspace = discoverWorkspace(resolve(cwd, root ?? ".")); } catch (error) { return { exitCode: 2, message: (error as Error).message }; }
  const consumer = join(workspace, "clossys");
  const lines: string[] = [];
  let failed = false;
  if (!check && !compare) {
    const plan = await planMigration(consumer);
    const result = writePlan(plan);
    for (const agent of SLOT_AGENTS) {
      const row = plan.agents[agent];
      const slots = [...row.slots.values()];
      lines.push(`${agent}: ${slots.length} slots, ${slots.reduce((n, slot) => n + slot.candidates.length, 0)} candidates, ${slots.filter(slot => slot.pin).length} pins${row.offIa.length ? `; off-IA (not migrated): ${row.offIa.join(", ")}` : ""}`);
    }
    lines.push(`migrate slots: ${result.written.length} written, ${result.unchanged} unchanged, ${result.kept.length} kept${result.kept.length ? ` (${result.kept.join(", ")})` : ""}; ${plan.dropped} unmapped refs dropped`);
    return { exitCode: 0, message: lines.join("\n"), root: workspace };
  }
  if (check) {
    const issues = checkSlotModel(consumer);
    for (const issue of issues) lines.push(`${issue.code} ${issue.path}: ${issue.message}`);
    lines.push(`migrate slots --check: ${issues.length} findings`);
    failed ||= issues.length > 0;
  }
  if (compare) {
    const diffs = await compareSlotModel(consumer);
    for (const diff of diffs) lines.push(`${diff.code}: ${diff.message}`);
    lines.push(`migrate slots --compare: ${diffs.length} diffs`);
    failed ||= diffs.length > 0;
  }
  return { exitCode: failed ? 1 : 0, message: lines.join("\n"), root: workspace, check: true };
}

/** `clossys check --slots [--readiness]`: model findings fail; coverage is reported. */
export function runSlotCheck(start: string, readiness: boolean): CliResult {
  let workspace: string;
  try { workspace = discoverWorkspace(start); } catch (error) { return { exitCode: 2, message: `check --slots: ${(error as Error).message}` }; }
  const consumer = join(workspace, "clossys");
  const issues = checkSlotModel(consumer);
  const lines = issues.map(issue => `${issue.code} ${issue.path}: ${issue.message}`);
  if (!issues.length || issues.some(issue => issue.path !== "agents")) lines.push(formatCoverage(slotCoverage(consumer), readiness));
  lines.push(`check --slots: ${issues.length} findings`);
  return { verb: "check", root: workspace, check: true, exitCode: issues.length ? 1 : 0, message: lines.join("\n") };
}
