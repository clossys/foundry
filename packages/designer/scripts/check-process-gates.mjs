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
      console.log("Usage: check-process-gates.mjs [--source-head SHA] [--site ROOT --library DIR --contract JSON] [--html FILE --css FILE --render-manifest JSON] [--report-dir DIR] [--json] [--studio]\nRuns default candidate completeness and the three H3 designer process gates (PROC-1 components only; the separate H1 sections/frames gate is required by Admin), even after a failure. Each gate's mode (block or report), reason and native inputs come from process-gates.json: a report gate's violations are listed under reports; a broken gate fails in every mode. PROC-2 checks an emitted library: with none of --site/--library/--contract it is not applicable, with some of them it is red until all are valid. PROC-3 checks native source by default, or explicit rendered HTML/CSS. Exits: 0 all verified; 1 violations; 2 missing/stale/invalid input or gate. --studio adds each child's full report to its row; it never changes the exit: a red process gate blocks Studio composition like any other caller.");
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
  // Each gate's mode, reason and native inputs live in its own config (process-gates.json); an absent
  // or malformed config is an error, never a default.
  const config = JSON.parse(fs.readFileSync(path.join(directory, "process-gates.json"), "utf8"));
  const argsOf = {
    "PROC-1": ["--root", repository, "--scope", "components", "--json"],
    "PROC-2": ["--repository", repository, ...selected, "--json"],
    "PROC-3": classes,
    "default-candidates": [],
  };
  const named = ["PROC-1", "PROC-2", "PROC-3", "default-candidates"];
  if (config?.schema !== "clossys.process-gates/1" || !Array.isArray(config.gates) || config.gates.map(row => row.gate).join() !== named.join()) throw new Error("Invalid process-gates.json: expected PROC-1, PROC-2, PROC-3 and default-candidates in order");
  const gates = config.gates.map(row => {
    if (!["block", "report"].includes(row.mode) || typeof row.reason !== "string" || !row.reason.trim() || typeof row.script !== "string") throw new Error(`Invalid process-gates.json row: ${row.gate}`);
    if (row.requires && (!Array.isArray(row.requires) || !row.requires.length || typeof row.whenAbsent !== "string" || !row.whenAbsent.trim())) throw new Error(`Invalid process-gates.json requires: ${row.gate}`);
    return { ...row, args: argsOf[row.gate], defaultCandidates: row.gate === "default-candidates" };
  });
  if (options.reportDirectory) fs.mkdirSync(options.reportDirectory, { recursive: true });
  const results = [];
  for (const gate of gates) {
    const script = path.join(directory, gate.script);
    if (gate.requires && !gate.requires.some(key => options[key])) { results.push({ gate: gate.gate, mode: gate.mode, state: "not-applicable", exitStatus: null, reason: gate.whenAbsent }); continue; }
    if (!fs.existsSync(script)) { results.push({ gate: gate.gate, mode: gate.mode, exitStatus: 2, violations: 0, unverified: ["Missing process gate script"] }); continue; }
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
    results.push({ gate: gate.gate, mode: gate.mode, ...(gate.mode === "report" ? { reason: gate.reason } : {}), inputHead: verifiedHead ?? null, exitStatus, scope: report.scope, violations: report.violations?.length ?? 0, unverified, ...(options.studio ? { report } : {}), ...(report.counts ? { counts: report.counts } : {}), ...(gate.defaultCandidates ? { status: report.status, missing: report.missing ?? [], invalid: report.invalid ?? [] } : {}), ...(reportPath ? { reportPath } : {}) });
  }
  // A broken gate (exit 2) fails in every mode; only a block-mode gate's violations (exit 1) fail.
  const exitStatus = results.some(row => row.exitStatus === 2) ? 2 : results.some(row => row.mode === "block" && row.exitStatus === 1) ? 1 : 0;
  const reports = results.filter(row => row.mode === "report" && row.exitStatus === 1).map(row => ({ gate: row.gate, violations: row.violations, unverified: row.unverified, reason: row.reason }));
  console.log(JSON.stringify({ gate: "designer-process", inputHead: head, ok: exitStatus === 0, exitStatus, gates: results, reports }, null, 2));
  process.exitCode = exitStatus;
} catch (error) {
  console.log(JSON.stringify({ gate: "designer-process", ok: false, exitStatus: 2, unverified: [error.message] }));
  process.exitCode = 2;
}
