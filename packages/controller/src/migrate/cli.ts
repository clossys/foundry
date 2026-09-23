/**
 * CLI for issue #1224: schema versions and migrations for every
 * `clossys/` record. Discovers every record `defaultRecordKindRegistry`
 * knows how to classify, migrates/classifies each one, and emits ONE
 * report shaped by the repository contract
 * `docs/contracts/check-output-envelope.json`, which does not ship with
 * this package (issue #1174) -- see `../envelope.js`, the one constructor
 * both this check and #1221's heartbeat check share.
 *
 * Report-only (dry run) by default: `--apply` is required to actually
 * write migrated records and their pre-migration backups.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCheckOutputEnvelope, envelopeToExitCode } from "../envelope.js";
import type { CheckFinding } from "../envelope.js";
import { runMigrations } from "./fs.js";
import { defaultRecordKindRegistry } from "./registry.js";

const PACKAGE_NAME = "@clossys/controller";

function packageVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(url, "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const USAGE = `Usage: foundry-schema-migrate [repoRoot] [--apply]

Discovers every clossys/ record this package knows a migration table for
(loop-state, coverage-declaration -- see registry.js), classifies its
schemaVersion against that table, and -- with --apply -- migrates it to
the table's current version, writing a pre-migration backup under
clossys/.state/schema-backups/. Default is report-only (dry run): nothing
on disk changes. repoRoot defaults to the current directory.

Prints one check-output-envelope JSON report (docs/contracts/
check-output-envelope.json) to stdout.

Exit codes: 0 = satisfied (every record is current, or was migrated
cleanly), 2 = indeterminate (at least one record could not be classified:
missing/non-numeric schemaVersion, a future schemaVersion this package
does not know, a schemaVersion with no migration path, or an unregistered
record kind). This check never reports "violated" (exit 1) -- a
non-current record is either migrated or reported indeterminate, never
treated as a rule violation on its own.`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const apply = argv.includes("--apply");
  const positional = argv.filter((value) => value !== "--apply");
  if (positional.length > 1) {
    console.error(USAGE);
    return 2;
  }
  const repoRoot = resolve(positional[0] ?? ".");
  const registry = defaultRecordKindRegistry();
  const reports = runMigrations(repoRoot, registry, { apply });

  const findings: CheckFinding[] = [];
  for (const report of reports) {
    if (report.outcome.outcome === "already-current") continue;
    if (report.outcome.outcome === "migrated") {
      const steps = report.outcome.appliedSteps.length > 0 ? report.outcome.appliedSteps.join("; ") : "no-op steps";
      findings.push({
        rule: "record-migrated",
        severity: "warning",
        message: `${report.path}: migrated schemaVersion ${report.outcome.fromVersion} -> ${report.outcome.toVersion} (${steps})${apply ? "" : " -- dry run, rerun with --apply to write"}`,
        path: report.path,
      });
    } else {
      findings.push({ rule: "record-indeterminate", severity: "error", message: `${report.path}: ${report.outcome.reason}`, path: report.path });
    }
  }

  const indeterminateCount = reports.filter((report) => report.outcome.outcome === "indeterminate").length;
  const verdict = indeterminateCount > 0 ? "indeterminate" : "satisfied";
  const envelope = buildCheckOutputEnvelope({
    package: PACKAGE_NAME,
    version: packageVersion(),
    verdict,
    summary:
      verdict === "indeterminate"
        ? `${indeterminateCount} of ${reports.length} clossys/ record(s) could not be classified against a known schema.`
        : `${reports.length} clossys/ record(s) checked; every one is current or was migrated cleanly.`,
    findings,
    nextAction: verdict === "indeterminate" ? "Review the indeterminate record(s) named above and add the missing migration step, or confirm the newer schema is expected." : undefined,
  });

  console.log(JSON.stringify(envelope, null, 2));
  return envelopeToExitCode(envelope);
}
