/** `clossys migrate copy-keys|inputs|citations-to-slots [--check|--apply] [--root <dir>] [--json]`: deterministic slot-record codemods. */
import { resolve } from "node:path";
import { applyCopyKeyMigration, planCopyKeyMigration } from "../migrate/copy-keys.js";
import { applyCitationsToSlots, planCitationsToSlots } from "../migrate/citations-to-slots.js";
import { applyInputsMigration, planInputsMigration } from "../migrate/inputs.js";
import { SLOT_AGENTS } from "../records/slot-model/index.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const MIGRATE_USAGE = "Usage: clossys migrate copy-keys|inputs [--check] [--root <dir>] [--json]\n"
  + "       clossys migrate citations-to-slots [--apply] [--root <dir>] [--json]\n"
  + "copy-keys renames camelCase copy ids in Designer and Writer slot.json and Writer candidates to the catalog's kebab-case ids; record text is unchanged.\n"
  + "inputs declares Designer and Writer slot.json inputs from the read graph (the Designer brief, slot-contract theme and asset reads, pinned Writer source refs); inputs are only added.\n"
  + "citations-to-slots rewrites citations to slot ids, which resolve through the cited slot's pin: every versioned citation of a known slot (<slot>@<n>, <agent>:<slot>@<n>) in a candidate becomes <slot> or <agent>:<slot>, and every pin drops recited, its sha256 carried to the rewritten pinned bytes (the decision is kept). It is a dry run that reports counts per agent unless --apply is given; a second run plans nothing.\n"
  + "--check reports pending changes and exits 1 when any remain.";

export async function runMigrateCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === undefined) return { exitCode: command ? 0 : 2, message: MIGRATE_USAGE };
  if (command !== "copy-keys" && command !== "inputs" && command !== "citations-to-slots") return { exitCode: 2, message: `Unknown migrate command: ${command}\n${MIGRATE_USAGE}` };
  let check = false, apply = false, root: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") continue;
    else if (arg === "--root" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) root = rest[++index];
    else if (arg === "--apply" && command === "citations-to-slots") apply = true;
    else return { exitCode: 2, message: `Unknown argument: ${arg}\n${MIGRATE_USAGE}` };
  }
  const dir = discoverRoot(resolve(cwd, root ?? "."));
  const consumer = resolve(dir, "clossys");
  if (command === "inputs") return migrateInputs(consumer, dir, check);
  if (command === "citations-to-slots") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    return migrateCitationsToSlots(consumer, dir, apply, check);
  }
  const plan = planCopyKeyMigration(consumer);
  if (!check) applyCopyKeyMigration(consumer, plan);
  const verb = check ? "pending" : "renamed";
  const lines = [
    `migrate copy-keys: ${plan.renames.length} copy key(s) ${verb}, ${plan.files.length} file(s)${check ? " to rewrite" : " rewritten"}, ${plan.repinned.length} pin(s) carried to renamed bytes; ${plan.findings.length} finding(s)`,
    ...plan.renames.map(rename => `${rename.agent}/${rename.slot}: ${rename.from} -> ${rename.to}`),
    ...plan.repinned.map(slot => `repinned (id rename only): ${slot}`),
    ...plan.findings.map(finding => `finding: ${finding.message}`),
  ];
  const exitCode = plan.findings.length || (check && plan.files.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check };
}

function migrateInputs(consumer: string, dir: string, check: boolean): CliResult {
  const plan = planInputsMigration(consumer);
  if (!check) applyInputsMigration(consumer, plan);
  const lines = [
    `migrate inputs: ${plan.changes.length} slot(s) ${check ? "pending" : "declared"}, ${plan.files.length} file(s)${check ? " to rewrite" : " rewritten"}; ${plan.findings.length} finding(s)`,
    ...plan.changes.map(change => `${change.agent}/${change.slot}: + ${change.added.join(", ")}`),
    ...plan.findings.map(finding => `finding: ${finding.message}`),
  ];
  const exitCode = plan.findings.length || (check && plan.files.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check };
}

function migrateCitationsToSlots(consumer: string, dir: string, apply: boolean, check: boolean): CliResult {
  const plan = planCitationsToSlots(consumer);
  const refused = apply ? applyCitationsToSlots(consumer, plan) : [];
  const verb = apply ? "rewritten" : "pending";
  const row = (name: string, counts: { candidates: number; citations: number; pins: number; rehashed: number }) =>
    `${name}: ${counts.candidates} candidate(s) ${verb} (${counts.citations} citation(s)), ${counts.pins} pin(s) drop recited, ${counts.rehashed} pin sha256(s) carried`;
  const lines = [
    `migrate citations-to-slots${apply ? "" : " (dry run; --apply rewrites)"}: ${plan.changes.length} slot(s) ${verb}; ${plan.findings.length} finding(s)${apply ? `, ${refused.length} refused` : ""}`,
    ...SLOT_AGENTS.map(agent => row(agent, plan.counts[agent])),
    row("total", plan.totals),
    ...plan.findings.map(finding => `finding: ${finding.agent}/${finding.slot}: ${finding.message}`),
    ...refused.map(finding => `refused: ${finding.agent}/${finding.slot}: ${finding.message}`),
  ];
  const pending = !apply && plan.changes.length > 0;
  const exitCode = refused.length || (check && (pending || plan.findings.length)) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { counts: plan.counts, totals: plan.totals, slots: plan.changes.length, findings: plan.findings, refused, applied: apply } };
}
