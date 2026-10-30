#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const args = process.argv.slice(2), options = {};
try {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") {
      console.log("Usage: check-process-gates.mjs [--source-head SHA] [--site ROOT --library DIR --contract JSON] [--html FILE --css FILE --render-manifest JSON] [--report-dir DIR] [--json]\nRuns all four designer process checks (PROC-1 components and sections/frames independently, PROC-2, PROC-3), even after a failure. Native selection inputs are required for PROC-2; absent inputs remain red. PROC-3 checks native source by default, or explicit rendered HTML/CSS. Exits: 0 all verified; 1 violations; 2 missing/stale/invalid input or gate.");
      process.exit(0);
    }
    if (arg === "--json") continue;
    const key = { "--source-head": "head", "--site": "site", "--library": "library", "--contract": "contract", "--html": "html", "--css": "css", "--render-manifest": "renderManifest", "--report-dir": "reportDirectory" }[arg];
    if (!key || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${arg}`);
    options[key] = args[++index];
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (options.head && options.head !== head) throw new Error("Stale --source-head differs from current repository HEAD");
  const selected = Object.entries({ site: options.site, library: options.library, contract: options.contract }).flatMap(([key, value]) => value ? [`--${key}`, value] : []);
  const classes = Object.entries({ html: options.html, css: options.css, "render-manifest": options.renderManifest }).flatMap(([key, value]) => value ? [`--${key}`, value] : []);
  const gates = [
    { gate: "PROC-1", id: "PROC-1-components", nativeGate: "PROC-1", script: "check-one-leaf-source.mjs", args: ["--root", repository, "--scope", "components", "--json"] },
    { gate: "PROC-1", id: "PROC-1-surfaces", surface: true, script: "check-surface-source-identity.mjs", args: [] },
    { gate: "PROC-2", nativeGate: "fill-source-imports", script: "check-fill-source-imports.mjs", args: ["--repository", repository, ...selected, "--json"] },
    { gate: "PROC-3", nativeGate: "rendered-class-rules", script: "check-rendered-class-rules.mjs", args: classes },
  ];
  const reportBase = path.resolve(options.reportDirectory ?? path.join(repository, "coverage/tmp/process-gates"));
  fs.mkdirSync(reportBase, { recursive: true });
  const surfaceDirectory = fs.mkdtempSync(path.join(reportBase, "surface-"));
  const results = [];
  for (const gate of gates) {
    const id = gate.id ?? gate.gate;
    const reportPath = gate.surface ? path.join(surfaceDirectory, "proc-1-surfaces.json") : options.reportDirectory ? path.join(reportBase, `${gate.gate.toLowerCase()}.json`) : undefined;
    const script = path.join(directory, gate.script);
    if (!fs.existsSync(script)) { results.push({ gate: gate.gate, id, scope: gate.surface ? "sections,frames" : undefined, exitStatus: 2, violations: 0, unverified: ["Missing process gate script"] }); continue; }
    const childArgs = gate.surface ? ["--source", head, "--report", reportPath] : [...gate.args, "--source-head", head];
    const child = spawnSync(process.execPath, [script, ...childArgs], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    let report;
    try { report = JSON.parse(gate.surface ? fs.readFileSync(reportPath, "utf8") : child.stdout); if (!report || typeof report !== "object") throw new Error("Invalid report object"); } catch { report = { unverified: ["Gate did not emit valid JSON", child.error?.message ?? child.stderr], violations: [] }; }
    const status = child.error || child.signal || ![0, 1, 2].includes(child.status) ? 2 : child.status;
    const verifiedHead = gate.surface ? report.head : report.inputHead ?? report.sourceHead;
    const unresolved = report.unverified ?? report.coverageUnverified ?? [];
    const violations = gate.surface ? report.findings : report.violations;
    const counts = ["registered", "sections", "frames", "resolved", "packageRoutes", "nativeRoutes", "catalogOffers"];
    const validSurface = report.gate === "PROC-1" && report.scope === "sections,frames" && report.tree === tree && report.sourceState === "committed"
      && ["PASS", "FAIL"].includes(report.status) && Array.isArray(report.findings)
      && report.findings.every(row => typeof row?.code === "string" && typeof row.detail === "string")
      && counts.every(key => Number.isInteger(report.counts?.[key]) && report.counts[key] >= 0)
      && ["inventory", "sources", "nativeOutputs"].every(key => Array.isArray(report[key])) && /^[a-f0-9]{64}$/.test(report.sourceHash ?? "")
      && report.inventory.every(row => typeof row?.leaf === "string" && ["PASS", "FAIL"].includes(row.status))
      && [...report.sources, ...report.nativeOutputs].every(row => typeof row?.file === "string" && /^[a-f0-9]{64}$/.test(row.sha256 ?? ""))
      && report.sourceHash === createHash("sha256").update(JSON.stringify({ sources: report.sources, nativeOutputs: report.nativeOutputs })).digest("hex")
      && JSON.stringify(report.argv) === JSON.stringify(["node", "packages/designer/scripts/check-surface-source-identity.mjs", ...childArgs])
      && ((report.status === "PASS" && report.findings.length === 0 && status === 0) || (report.status === "FAIL" && report.findings.length > 0 && status === 1));
    const valid = verifiedHead === head && (gate.surface ? validSurface : report.gate === gate.nativeGate && Array.isArray(violations) && Array.isArray(unresolved)
      && (gate.id !== "PROC-1-components" || report.scope?.kind === "components"));
    const unverified = valid ? unresolved.length : 1;
    const exitStatus = !valid ? 2 : status === 0 && (unverified || violations.length) ? 1 : status;
    if (reportPath && !gate.surface) {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    }
    results.push({ gate: gate.gate, id, inputHead: verifiedHead ?? null, exitStatus, scope: report.scope, violations: violations?.length ?? 0, unverified, ...(report.counts ? { counts: report.counts } : {}), ...(reportPath ? { reportPath } : {}) });
  }
  const exitStatus = results.some(row => row.exitStatus === 2) ? 2 : results.some(row => row.exitStatus !== 0) ? 1 : 0;
  console.log(JSON.stringify({ gate: "designer-process", inputHead: head, ok: exitStatus === 0, exitStatus, gates: results }, null, 2));
  process.exitCode = exitStatus;
} catch (error) {
  console.log(JSON.stringify({ gate: "designer-process", ok: false, exitStatus: 2, unverified: [error.message] }));
  process.exitCode = 2;
}
