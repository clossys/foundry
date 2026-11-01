#!/usr/bin/env node
// Scan only the selected head and its ancestors, including history before base.
// Base proves ancestry; it is not a lower date bound that could hide old findings.
// Other local branches and archival tags are not release inputs. No path or rule
// is excluded, and every native rule remains enabled within the selected history.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitleaksHistoryArgs, scannerHistoryScope } from "./lib/scanner-history-scope.mjs";

let scratch;
try {
  const args = process.argv.slice(2);
  if (args.length > 3) throw new Error("Invalid arguments");
  const [base = "origin/main", head = "HEAD", output] = args;
  const root = process.cwd(), scope = scannerHistoryScope(root, base, head);
  scratch = mkdtempSync(join(tmpdir(), "release-secret-history-"));
  const template = join(scratch, "metadata.tmpl"), report = join(scratch, "metadata.tsv");
  writeFileSync(template, '{{range .}}{{printf "%s\\t%s\\t%d\\t%d\\t%d\\t%d\\t%s\\t%s\\n" .RuleID .File .StartLine .EndLine .StartColumn .EndColumn .Commit .Fingerprint}}{{end}}');
  const run = spawnSync("gitleaks", gitleaksHistoryArgs(root, scope, template, report), { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (![0, 1].includes(run.status)) throw new Error("Native scanner failed");
  const findings = readFileSync(report, "utf8").split("\n").filter(Boolean).map(line => {
    const fields = line.split("\t");
    if (fields.length !== 8) throw new Error("Invalid metadata report");
    const [rule, file, start, end, column, endColumn, commit, fingerprint] = fields;
    return { rule, file, line: Number(start), endLine: Number(end), column: Number(column), endColumn: Number(endColumn), commit, fingerprint };
  });
  if ((run.status === 0) !== (findings.length === 0)) throw new Error("Native result and metadata disagree");
  const result = { scope, exitCode: run.status, total: findings.length, findings };
  if (output) writeFileSync(resolve(output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ scope, exitCode: run.status, total: findings.length }));
  process.exitCode = run.status;
} catch {
  console.error("Release secret history scan could not verify its scope or native result; diagnostic contents withheld.");
  process.exitCode = 2;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
