import { statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lintPages } from "../check/page-lint.js";
import { readPageCheckSource, readPageManifest } from "../check/page-manifest.js";
import type { PageLintReport } from "../check/page-types.js";
import { recordSuitesSummary, runRecordSuites } from "../check/record-suites.js";
import { discoverRoot } from "./root.js";
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

const consumerRoot = (dir: string) => statSync(join(dir, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile() === true;

/**
 * `clossys check`: the PROC-5 page lint (`--pages`/`--report`) and the record suites.
 * `--suites` runs the suites on the discovered consumer root; with `--pages`/`--report`
 * they also run when `--root` itself is a consumer root. Suite findings are report only:
 * the exit code is the page lint's (0 for suites alone) unless `--strict`.
 */
export async function runCheck(args: CliArgs, cwd: string): Promise<CliResult> {
  const page = args.pages !== undefined ? await runPageCheck(args, cwd) : undefined;
  const start = resolve(cwd, args.root ?? ".");
  let root: string | undefined;
  if (args.suites) {
    try { root = discoverRoot(start); } catch (error) {
      const message = `check --suites: ${errorMessage(error)}`;
      return { ...(page ?? { verb: "check" as const, root: start, check: true }), exitCode: 2, message: page ? `${page.message}\n${message}` : message };
    }
  } else if (consumerRoot(start)) root = start;
  if (!root) return page!;
  const suites = await runRecordSuites(root, { strict: args.strict });
  const summary = recordSuitesSummary(suites);
  const exitCode = Math.max(page?.exitCode ?? 0, suites.exitCode) as 0 | 1 | 2;
  return { ...(page ?? { verb: "check" as const, root, check: true }), exitCode, message: page ? `${page.message}\n${summary}` : summary, suites };
}
