#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const args = process.argv.slice(2), options = {};
try {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      console.log("Usage: check-process-gates.mjs [--source-head SHA] [--site ROOT --library DIR --contract JSON] [--html FILE --css FILE --render-manifest JSON] [--report-dir DIR] [--json] [--studio]\nRuns default candidate completeness and the three H3 designer process gates (PROC-1 components only; the separate H1 sections/frames gate is required by Admin), even after a failure. Native selection inputs are required for PROC-2; absent inputs remain red. PROC-3 checks native source by default, or explicit rendered HTML/CSS. Exits: 0 all verified; 1 violations; 2 missing/stale/invalid input or gate. Studio mode retains original failed results and full reports but returns 0 for these suspended render gates.");
      process.exit(0);
    }
    if (arg === "--json") continue;
    if (arg === "--studio") { options.studio = true; continue; }
    const key = { "--source-head": "head", "--site": "site", "--library": "library", "--contract": "contract", "--html": "html", "--css": "css", "--render-manifest": "renderManifest", "--report-dir": "reportDirectory" }[arg];
    if (!key || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${arg}`);
    options[key] = args[++index];
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (options.head && options.head !== head) throw new Error("Stale --source-head differs from current repository HEAD");
  const selected = Object.entries({ site: options.site, library: options.library, contract: options.contract }).flatMap(([key, value]) => value ? [`--${key}`, value] : []);
  const classes = Object.entries({ html: options.html, css: options.css, "render-manifest": options.renderManifest }).flatMap(([key, value]) => value ? [`--${key}`, value] : []);
  const gates = [
    { gate: "PROC-1", script: "check-one-leaf-source.mjs", args: ["--root", repository, "--scope", "components", "--json"] },
    { gate: "PROC-2", script: "check-fill-source-imports.mjs", args: ["--repository", repository, ...selected, "--json"] },
    { gate: "PROC-3", script: "check-rendered-class-rules.mjs", args: classes },
    { gate: "default-candidates", script: "check-default-candidates.mjs", args: [], defaultCandidates: true },
  ];
  if (options.reportDirectory) fs.mkdirSync(options.reportDirectory, { recursive: true });
  const results = [];
  for (const gate of gates) {
    const script = path.join(directory, gate.script);
    if (!fs.existsSync(script)) { results.push({ gate: gate.gate, exitStatus: 2, violations: 0, unverified: ["Missing process gate script"], ...(options.studio ? { blocking: false } : {}) }); continue; }
    const child = spawnSync(process.execPath, [script, ...gate.args, ...(gate.defaultCandidates ? [] : ["--source-head", head])], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    let report;
    try { report = JSON.parse(child.stdout); } catch { report = { unverified: ["Gate did not emit valid JSON", child.error?.message ?? child.stderr], violations: [] }; }
    const status = child.error || child.signal || ![0, 1, 2].includes(child.status) ? 2 : child.status;
    const verifiedHead = report.inputHead ?? report.sourceHead;
    const unverified = (report.unverified ?? report.coverageUnverified ?? []).length;
    // The completeness CLI owns its strict 0/1/2 report contract and accepts no arguments.
    // Preserve its missing/invalid evidence instead of treating it as a PROC report.
    const validReport = gate.defaultCandidates
      ? report.schemaVersion === 1 && Array.isArray(report.missing) && Array.isArray(report.invalid)
        && report.status === ["complete", "missing-candidates", "invalid-input"][status]
        && (status !== 0 || (!report.missing.length && !report.invalid.length))
      : !!report.gate && Array.isArray(report.violations);
    const exitStatus = verifiedHead !== head || !validReport ? 2 : status === 0 && unverified ? 1 : status;
    let reportPath;
    if (options.reportDirectory) {
      reportPath = path.resolve(options.reportDirectory, `${gate.gate.toLowerCase()}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    }
    results.push({ gate: gate.gate, inputHead: verifiedHead ?? null, exitStatus, scope: report.scope, violations: report.violations?.length ?? 0, unverified, ...(options.studio ? { blocking: false, report } : {}), ...(report.counts ? { counts: report.counts } : {}), ...(gate.defaultCandidates ? { status: report.status, missing: report.missing ?? [], invalid: report.invalid ?? [] } : {}), ...(reportPath ? { reportPath } : {}) });
  }
  const exitStatus = results.some(row => row.exitStatus === 2) ? 2 : results.some(row => row.exitStatus !== 0) ? 1 : 0;
  console.log(JSON.stringify({ gate: "designer-process", inputHead: head, ok: exitStatus === 0, exitStatus, ...(options.studio ? { mode: 'studio-report-only', blocking: false } : {}), gates: results }, null, 2));
  process.exitCode = options.studio ? 0 : exitStatus;
} catch (error) {
  console.log(JSON.stringify({ gate: "designer-process", ok: false, exitStatus: 2, unverified: [error.message] }));
  process.exitCode = 2;
}
