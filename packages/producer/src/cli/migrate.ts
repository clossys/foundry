/** `clossys migrate copy-keys [--check] [--root <dir>] [--json]`: deterministic copy-id codemod. */
import { resolve } from "node:path";
import { applyCopyKeyMigration, planCopyKeyMigration } from "../migrate/copy-keys.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const MIGRATE_USAGE = "Usage: clossys migrate copy-keys [--check] [--root <dir>] [--json]\n"
  + "Renames camelCase copy ids in Designer and Writer slot.json and Writer candidates to the catalog's kebab-case ids; record text is unchanged. --check reports pending renames and exits 1 when any remain.";

export async function runMigrateCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === undefined) return { exitCode: command ? 0 : 2, message: MIGRATE_USAGE };
  if (command !== "copy-keys") return { exitCode: 2, message: `Unknown migrate command: ${command}\n${MIGRATE_USAGE}` };
  let check = false, root: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") continue;
    else if (arg === "--root" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) root = rest[++index];
    else return { exitCode: 2, message: `Unknown argument: ${arg}\n${MIGRATE_USAGE}` };
  }
  const dir = discoverRoot(resolve(cwd, root ?? "."));
  const consumer = resolve(dir, "clossys");
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
