/**
 * `clossys ia sync [--check] [--at <iso>] [--root <dir>] [--json]` (target format: system.md 1, 6.1, 7, 13.5; flows F1):
 * copies the package slot tree (`packages/<agent>/src/catalog/slots/<slot-id>/slot.json`) into the consumer as
 * `clossys.slot/2` files and records each `base`. It folds the int2 `ia-regroup`: a package move to another L1/L2
 * is applied here. The int2 `clossys ia sync` (cli/owner.ts, slot/1) stays until the verb cutover (ticket 0014).
 *
 * - A consumer copy keeps its `tighten` list (append only), `status`, `createdAt`, `consumedBy` refs and, within the
 *   same L2, `ia.order`. A tighten entry now looser than a new base is kept and raises `queue.clarify` (13.5).
 * - A consumer-added slot (`base: null`) whose id the package now ships is adopted.
 * - A slot/1 file is never rewritten here: `clossys migrate slot-1-to-2` first.
 * - A second run writes nothing. Afterwards `records.computed-match` and `ia.orphans` run (F1 step 2).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { briefTightenOnly } from "../check/brief-tighten-only.js";
import { iaOrphans } from "../check/ia-orphans.js";
import { recordsComputedMatch } from "../check/records-computed-match.js";
import { validateAgainst } from "../records/schema.js";
import {
  SLOT_AGENTS, SLOT_SCHEMA, listBaseSlots, packageVersion, readBaseSlot, readSlot, recordSchema, serializeSlot,
  slotSchemaOf, syncedSlot, tightenIssue, writeSlot, type TreeCheck, type TreeCheckResult,
} from "../records/slot.js";
import type { AgentId, Iso, QueueEntry, Slot } from "../records/types.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

/** The three slot/2 tree checks, by id. */
export const TREE_CHECKS: Readonly<Record<string, TreeCheck>> = {
  [briefTightenOnly.id]: briefTightenOnly,
  [recordsComputedMatch.id]: recordsComputedMatch,
  [iaOrphans.id]: iaOrphans,
};

export const IA_SYNC_USAGE = "Usage: clossys ia sync [--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "Copies every package base slot into clossys/agents/<agent>/<slot-id>/slot.json (clossys.slot/2), keeping the consumer tighten list, status and order.\n"
  + "--check writes nothing and exits 1 when a file would change.";

export interface SyncChange { agent: AgentId; slot: string; action: "added" | "updated" | "adopted" | "moved" }
export interface SyncClarify { agent: AgentId; slot: string; detail: string; entry: string }
export interface SyncPlan { changes: (SyncChange & { file: string; slotDoc: Slot })[]; clarify: SyncClarify[]; findings: string[] }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
export const nowIso = (): Iso => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** What `ia sync` would write, without writing it. */
export function planIaSync(root: string, at: Iso): SyncPlan {
  const plan: SyncPlan = { changes: [], clarify: [], findings: [] };
  for (const agent of SLOT_AGENTS) {
    for (const id of listBaseSlots(root, agent)) {
      let base;
      try { base = readBaseSlot(root, agent, id); } catch (error) { plan.findings.push((error as Error).message); continue; }
      if (!base) continue;
      const file = join(root, "clossys", "agents", agent, id, "slot.json");
      let existing: Slot | undefined;
      if (existsSync(file)) {
        const schema = slotSchemaOf(file);
        if (schema !== SLOT_SCHEMA) { plan.findings.push(`${agent}/${id}: slot.json is ${schema ?? "unreadable"}; run clossys migrate slot-1-to-2 first`); continue; }
        try { existing = readSlot(file); } catch (error) { plan.findings.push((error as Error).message); continue; }
      }
      const next = syncedSlot(base, existing, at);
      next.tighten.forEach((entry, index) => {
        const issue = tightenIssue(base.doc, entry);
        if (issue) plan.clarify.push({ agent, slot: id, entry: `tighten[${index}]`, detail: issue });
      });
      if (existing && serializeSlot(existing) === serializeSlot(next)) continue;
      const action: SyncChange["action"] = !existing ? "added" : existing.base === null ? "adopted" : existing.ia.l2 !== next.ia.l2 || existing.ia.l1 !== next.ia.l1 ? "moved" : "updated";
      plan.changes.push({ agent, slot: id, action, file, slotDoc: next });
    }
  }
  return plan;
}

/** One `queue.clarify` entry per slot with a now-looser tighten entry (system.md 13.5). Returns the written ids. */
function raiseClarify(root: string, clarify: readonly SyncClarify[], at: Iso): string[] {
  const bySlot = new Map<string, SyncClarify[]>();
  for (const item of clarify) bySlot.set(`${item.agent}/${item.slot}`, [...(bySlot.get(`${item.agent}/${item.slot}`) ?? []), item]);
  const stamp = at.replace(/[-:]/g, "").replace(/(T\d{4})\d{2}Z$/, "$1Z");
  const written: string[] = [];
  for (const [subject, items] of bySlot) {
    const id = `${stamp}-${subject.replace(/[/.]/g, "-")}-tighten`;
    const dir = join(root, "clossys", "agents", "producer", "queue.clarify", "entries");
    const file = join(dir, `${id}.json`);
    if (existsSync(file)) continue;
    const entry: QueueEntry = {
      schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status: "open",
      createdBy: { actor: "code", cli: "clossys ia sync", version: packageVersion(root, "producer") },
      createdAt: at, refs: [],
      queue: "queue.clarify",
      ask: `The new package base makes ${items.length} tighten entr${items.length === 1 ? "y" : "ies"} of ${subject} looser than the base: ${items.map(item => `${item.entry} ${item.detail}`).join("; ")}. Keep the base, or write a stricter entry?`,
      subject: { to: subject as QueueEntry["subject"]["to"], rel: "input" },
      decider: "owner",
      default: "keep the package base; the looser entries stay in the list and are not applied",
      events: [{ at, op: "raised", by: "code:clossys ia sync", via: "cli" }],
    };
    const issues = validateAgainst(recordSchema("queue-entry.json"), entry);
    if (issues.length) throw new Error(`queue.clarify entry ${id}: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
    written.push(id);
  }
  return written;
}

export async function runIaSyncCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const args = argv[0] === "sync" ? argv.slice(1) : argv;
  let check = false, rootArg: string | undefined, at: Iso | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help") return { exitCode: 0, message: IA_SYNC_USAGE };
    if (arg === "--check") check = true;
    else if (arg === "--json") continue;
    else if ((arg === "--root" || arg === "--at") && args[index + 1] && !args[index + 1]!.startsWith("--")) {
      if (arg === "--root") rootArg = args[++index]; else at = args[++index];
    } else return { exitCode: 2, message: `Unknown argument: ${arg}\n${IA_SYNC_USAGE}` };
  }
  if (at !== undefined && !ISO.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
  const root = discoverRoot(resolve(cwd, rootArg ?? "."));
  const stamp = at ?? nowIso();
  const plan = planIaSync(root, stamp);
  const clarified = !check ? raiseClarify(root, plan.clarify, stamp) : [];
  if (!check) for (const change of plan.changes) writeSlot(change.file, change.slotDoc);
  const checks: TreeCheckResult[] = check ? [] : [recordsComputedMatch.run(root), iaOrphans.run(root)];
  const failed = checks.filter(result => result.status === "fail");
  const lines = [
    `ia sync${check ? " --check" : ""}: ${plan.changes.length} slot(s) ${check ? "to write" : "written"}, ${plan.clarify.length} looser tighten entr(ies)${clarified.length ? `, queue.clarify ${clarified.join(", ")}` : ""}; ${plan.findings.length} finding(s)`,
    ...plan.changes.map(change => `${change.action} ${change.agent}/${change.slot}`),
    ...plan.clarify.map(item => `clarify ${item.agent}/${item.slot} ${item.entry}: ${item.detail}`),
    ...plan.findings.map(finding => `finding: ${finding}`),
    ...checks.map(result => `${result.check}: ${result.status}${result.findings.length ? ` (${result.findings.length})` : ""}`),
    ...failed.flatMap(result => result.findings.map(finding => `${result.check}: ${finding.subject}: ${finding.detail}`)),
  ];
  const exitCode = plan.findings.length || failed.length || (check && plan.changes.length) ? 1 : 0;
  return {
    exitCode, message: lines.join("\n"), root, check,
    output: { changes: plan.changes.map(({ agent, slot, action }) => ({ agent, slot, action })), clarify: plan.clarify, queue: clarified, findings: plan.findings, checks },
  };
}
