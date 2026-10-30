import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { lintPages } from "../check/page-lint.js";
import { readPageCheckSource, readPageManifest } from "../check/page-manifest.js";
import type { PageLintReport } from "../check/page-types.js";
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
