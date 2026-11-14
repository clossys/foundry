import { runSlotResolve, slotResolveSummary, type SlotResolveReport } from "../check/slot-resolve.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lintPages } from "../check/page-lint.js";
import { readPageCheckSource, readPageManifest } from "../check/page-manifest.js";
import type { PageLintReport } from "../check/page-types.js";
import { recordSuitesSummary, refVerbatimSuite, runRecordSuites } from "../check/record-suites.js";
import { hasModelRoot } from "../records/slots.js";
import { findWorkspace } from "./workspace.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordError(report: PageLintReport, rule: string, message: string): void {
  report.status = "ERROR";
  report.exitCode = 2;
  report.finishedAt = new Date().toISOString();
  report.findings.push({ rule, url: "", message });
}

export async function runPageCheck(args: CliArgs, cwd: string): Promise<CliResult> {
  const root = resolve(cwd, args.root ?? ".");
  const reportPath = args.report === undefined ? undefined : resolve(root, args.report);
  const startedAt = new Date().toISOString();
  let report: PageLintReport = {
    schemaVersion: 1,
    gate: "PROC-5",
    sourceHead: "",
    sourceDirty: true,
    startedAt,
    finishedAt: startedAt,
    status: "ERROR",
    exitCode: 2,
    pages: [],
    findings: [],
  };
  try {
    if (!args.pages || !reportPath) throw new Error("check requires --pages and --report");
    const source = await readPageCheckSource();
    if (!source || typeof source.sourceHead !== "string" || !/^[a-f0-9]{40}$/i.test(source.sourceHead)
      || typeof source.sourceDirty !== "boolean") {
      throw new Error("Page check source receipt is missing or malformed");
    }
    report.sourceHead = source.sourceHead;
    report.sourceDirty = source.sourceDirty;
    if (source.sourceDirty) throw new Error("Page check source receipt records a dirty source tree; rebuild from clean source");
    const manifest = await readPageManifest(resolve(root, args.pages));
    if (manifest.sourceHead !== source.sourceHead) {
      throw new Error("Page manifest sourceHead does not match the native build source receipt");
    }
    report = await lintPages(manifest.pages, source);
  } catch (error) {
    recordError(report, "page-check", errorMessage(error));
  }

  if (reportPath) {
    try {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch (error) {
      recordError(report, "report-write", `Could not write page check report: ${errorMessage(error)}`);
    }
  }
  return {
    exitCode: report.exitCode,
    message: `Page check ${report.status}${reportPath ? `: ${reportPath}` : ""}`,
    verb: "check",
    root,
    check: true,
    report,
    ...(reportPath ? { reportPath } : {}),
  };
}

/** A slot that is not ready, as a check finding: what blocks it, by slot and reason. */
export interface ReadinessFinding { readonly rule: "readiness-blocked"; readonly agent: string; readonly slot: string; readonly blockedBy: readonly { slot: string; reason: string }[]; readonly message: string }

/**
 * Every blocked slot the slot resolve reported, one finding each. Under `check --readiness --strict` these
 * fail the check (exit 1): a blocked slot is a red readiness row, never only a printed count.
 */
export function readinessFindings(slots: Pick<SlotResolveReport, "coverage">): ReadinessFinding[] {
  return slots.coverage.flatMap(row => row.blocked.map(({ slot, readiness }) => ({
    rule: "readiness-blocked" as const,
    agent: row.agent,
    slot,
    blockedBy: readiness.blockedBy.map(by => ({ slot: by.slot, reason: by.reason })),
    message: `${row.agent}:${slot} is not ready: blocked by ${readiness.blockedBy.map(by => `${by.slot} (${by.reason})`).join(", ") || "an unnamed input"}`,
  })));
}

export function readinessSummary(findings: readonly ReadinessFinding[]): string {
  return `Readiness (strict): ${findings.length} blocked slot(s)${findings.length ? "; each is a finding" : ""}`;
}

const consumerRoot = (dir: string) => statSync(join(dir, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile() === true;

/** Slot integrity is enforced in every check invocation, alongside requested checks. */
export async function runCheck(args: CliArgs, cwd: string): Promise<CliResult> {
  const start = resolve(cwd, args.root ?? ".");
  let root = start;
  let consumer = start;
  if (hasModelRoot(start)) {
    root = dirname(start);
  } else {
    // No workspace ancestor: the slot resolve below reports the missing model inputs.
    root = findWorkspace(start) ?? start;
    consumer = join(root, "clossys");
  }
  if (args.constitution) return runConstitutionCheck(args, root, consumer);
  const slots = await runSlotResolve(consumer);
  const page = args.pages !== undefined ? await runPageCheck(args, cwd) : undefined;
  const suites = args.suites || (page && consumerRoot(start))
    ? await runRecordSuites(root, { strict: args.strict }) : undefined;
  const reference = suites ? undefined : await refVerbatimSuite(root).catch(error => ({
    suite: "ref-verbatim" as const, status: "error" as const, checked: 0,
    totals: { error: 1, warning: 0, info: 0 }, findings: [], error: errorMessage(error), exitCode: 1 as const,
  }));
  const referenceReport = reference ? { schemaVersion: 1 as const, root, strict: true, exitCode: reference.exitCode ?? 0, suites: [reference] } : undefined;
  // Strict readiness: every blocked slot is a finding and fails the check.
  const readiness = args.readiness && args.strict ? readinessFindings(slots) : undefined;
  const exitCode = Math.max(slots.exitCode, page?.exitCode ?? 0, suites?.exitCode ?? 0, reference?.exitCode ?? 0, readiness?.length ? 1 : 0) as 0 | 1 | 2;
  return {
    ...(page ?? { verb: "check" as const, root, check: true }),
    exitCode,
    message: [slotResolveSummary(slots, args.readiness), readiness && readinessSummary(readiness), page?.message, suites && recordSuitesSummary(suites), referenceReport && recordSuitesSummary(referenceReport)].filter(Boolean).join("\n"),
    slots,
    ...(readiness ? { checks: { readiness: { strict: true, blocked: readiness.length, findings: readiness } } } : {}),
    ...(suites || referenceReport ? { suites: suites ?? referenceReport } : {}),
  };
}

const workspaceName = (root: string): string => {
  try { const name = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown }).name; return typeof name === "string" ? name : "(unnamed)"; }
  catch { return "(no package.json)"; }
};

const headCommit = (root: string): string => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim(); }
  catch { return "unknown"; }
};

/**
 * `check --constitution`: every rule over every record, then the delta against the last green
 * report (constitution/green.ts), printed on every run.
 * - plain: exits 1 on any row, pending included (and on a tampered green report);
 * - --enforced (the chain's constitution step): until E2, exits 1 only on the delta, a stale green
 *   key or a tampered report. TODO(E2): make the full gate (--strict) the default here;
 * - --strict: the full gate, exits 1 on every enforced row (and on a tampered report);
 * - --record-green: after a full run whose delta gate passes (or with no report yet), writes the report.
 */
async function runConstitutionCheck(args: CliArgs, root: string, consumer: string): Promise<CliResult> {
  const { formatReport, runConstitution } = await import("../constitution/run.js");
  const green = await import("../constitution/green.js");
  const { index, ...report } = runConstitution({ root, consumer, index: true, ...(args.rule ? { rule: args.rule } : {}), ...(args.agent ? { agent: args.agent } : {}) });
  const path = resolve(root, args.green ?? green.DEFAULT_GREEN_PATH);
  const workspace = workspaceName(root);
  const read = green.readGreen(path, workspace);
  const delta = green.evaluateDelta(report.rows, index!, read, { rules: report.rules.map(rule => rule.id), ...(args.agent ? { agent: args.agent } : {}) });
  const mode = args.strict ? "strict" : args.enforced ? "enforced" : "report";
  let exitCode: 0 | 1 = mode === "strict" ? (delta.enforced || delta.tampered.length ? 1 : 0)
    : mode === "enforced" ? (delta.ok ? 0 : 1)
    : (report.ok && !delta.tampered.length ? 0 : 1);
  const lines = [formatReport(report), green.formatDelta(delta, mode)];
  let recorded: { path: string; written: boolean; reason: string } | undefined;
  if (args.recordGreen) {
    const missing = !existsSync(path);
    const otherWorkspace = !missing && !read.tampered.length && !read.report;
    const refusal = read.tampered.length ? `the report at ${path} failed its integrity check; restore it from git (a deleted report re-seeds only through review)`
      : otherWorkspace ? `${read.baseline}; pass --green <file> for this workspace`
      : !missing && delta.blocking.length ? `the delta gate blocks on ${delta.blocking.length} row(s); only a green run is recorded`
      : undefined;
    if (refusal) {
      recorded = { path, written: false, reason: refusal };
      exitCode = 1;
    } else {
      const next = green.buildGreen(report.rows, index!, { workspace, commit: headCommit(root) });
      await green.writeGreen(path, next);
      recorded = { path, written: true, reason: missing ? "seeded (no report existed)" : `recorded (${delta.stale.length} fixed key(s) dropped)` };
      exitCode = 0;
    }
    lines.push(`constitution --record-green: ${recorded.written ? `${recorded.reason}: ${path}` : `REFUSED: ${recorded.reason}`}`);
  }
  const deltaOut = {
    mode, ok: delta.ok, green: path, ...(delta.baseline ? { baseline: delta.baseline } : {}),
    total: delta.total, pending: delta.pending, enforced: delta.enforced, delta: delta.blocking.length,
    newRows: delta.newRows, changedRows: delta.changedRows, changedRecords: delta.changedRecords, dependantRecords: delta.dependantRecords,
    stale: delta.stale, tampered: delta.tampered, blocking: delta.blocking.map(row => ({ key: green.rowKey(row), ...row })),
  };
  return {
    verb: "check", root, check: true, exitCode, message: lines.join("\n"),
    output: { ...report, delta: deltaOut, enforced: { ok: delta.enforced === 0, findings: delta.enforced }, ...(recorded ? { recorded } : {}) },
  };
}
