/** `clossys migrate copy-keys|inputs|director-refs [--check] [--root <dir>] [--json]`: deterministic slot-record codemods. */
import { resolve } from "node:path";
import { applyCopyKeyMigration, planCopyKeyMigration } from "../migrate/copy-keys.js";
import { applyDirectorRefs, planDirectorRefs } from "../migrate/director-refs.js";
import { applyInputsMigration, planInputsMigration } from "../migrate/inputs.js";
import type { CliResult } from "./main.js";
import { runPickCli } from "./options.js";
import { discoverRoot } from "./root.js";

export const MIGRATE_USAGE = "Usage: clossys migrate copy-keys|inputs [--check] [--root <dir>] [--json]\n"
  + "       clossys migrate director-refs [--check] [--by agent:writer] [--root <dir>] [--json]\n"
  + "copy-keys renames camelCase copy ids in Designer and Writer slot.json and Writer candidates to the catalog's kebab-case ids; record text is unchanged.\n"
  + "inputs declares Designer and Writer slot.json inputs from the read graph (the Designer brief, slot-contract theme and asset reads, pinned Writer source refs); inputs are only added.\n"
  + "director-refs re-cites each pinned Writer candidate that cites a Director cell older than its pin: when that cell's Direction is byte-identical between the two versions it writes the next Writer candidate with the same copy and the refs at the pinned version, then picks it (--by, default agent:writer); a changed Direction is refused for the Writer skill to re-draft.\n"
  + "--check reports pending changes and exits 1 when any remain.";

export async function runMigrateCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === undefined) return { exitCode: command ? 0 : 2, message: MIGRATE_USAGE };
  if (command !== "copy-keys" && command !== "inputs" && command !== "director-refs") return { exitCode: 2, message: `Unknown migrate command: ${command}\n${MIGRATE_USAGE}` };
  let check = false, root: string | undefined, by: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") continue;
    else if (arg === "--root" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) root = rest[++index];
    else if (arg === "--by" && command === "director-refs" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) by = rest[++index];
    else return { exitCode: 2, message: `Unknown argument: ${arg}\n${MIGRATE_USAGE}` };
  }
  const dir = discoverRoot(resolve(cwd, root ?? "."));
  const consumer = resolve(dir, "clossys");
  if (command === "inputs") return migrateInputs(consumer, dir, check);
  if (command === "director-refs") {
    by ??= "agent:writer";
    if (!/^agent:\S+$/.test(by)) return { exitCode: 2, message: `--by must be agent:<seat>, got ${by}\n${MIGRATE_USAGE}` };
    return migrateDirectorRefs(consumer, dir, check, by);
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

async function migrateDirectorRefs(consumer: string, dir: string, check: boolean, by: string): Promise<CliResult> {
  const plan = await planDirectorRefs(consumer);
  const refs = (bump: { refs: readonly { cell: string; from: number; to: number }[] }) => bump.refs.map(ref => `${ref.cell} @${ref.from} -> @${ref.to}`).join(", ");
  const refused = plan.refusals.map(refusal => `refused writer/${refusal.slot}: director:${refusal.cell}@${refusal.from} -> @${refusal.to}: ${refusal.reason}`);
  if (check) {
    const lines = [
      `migrate director-refs: ${plan.bumps.length} Writer slot(s) pending re-cite, ${new Set(plan.refusals.map(refusal => refusal.slot)).size} refused`,
      ...plan.bumps.map(bump => `writer/${bump.slot}: ${bump.from} cites ${refs(bump)}`),
      ...refused,
    ];
    return { exitCode: plan.bumps.length || plan.refusals.length ? 1 : 0, message: lines.join("\n"), root: dir, check };
  }
  const applied = await applyDirectorRefs(consumer, plan, (slot, candidate) => runPickCli([`writer/${slot}`, candidate, "--by", by, "--root", dir], dir));
  const lines = [
    `migrate director-refs: ${applied.filter(row => row.picked).length} Writer slot(s) re-cited and picked, ${applied.filter(row => !row.picked).length} written without a pick, ${new Set(plan.refusals.map(refusal => refusal.slot)).size} refused`,
    ...applied.map(row => `writer/${row.slot}: ${row.candidate} (${refs(plan.bumps.find(bump => bump.slot === row.slot)!)}): ${row.outcome}`),
    ...refused,
  ];
  return { exitCode: plan.refusals.length || applied.some(row => !row.picked) ? 1 : 0, message: lines.join("\n"), root: dir, check };
}
