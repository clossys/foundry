#!/usr/bin/env node
import { createRequire } from "node:module";
import { buildCheckOutputEnvelope, type CheckFinding } from "../generated/check-output-envelope.js";
import { runCli } from "./main.js";

const argv = process.argv.slice(2);
const result = await runCli(argv);
if (result.printed) {
  // The command wrote its own stdout and stderr.
} else if (argv.includes("--json") && result.output !== undefined) {
  console.log(JSON.stringify(result.output, null, 2));
} else if (argv.includes("--json")) {
  if (argv[0] === "check") {
    const findings: CheckFinding[] = [...(result.slots?.findings ?? [])];
    if (result.report) for (const finding of result.report.findings) findings.push({
      rule: finding.rule, severity: "error", message: finding.message, ...(finding.url ? { path: finding.url } : {}),
    });
    for (const suite of result.suites?.suites ?? []) {
      if (suite.suite !== "ref-verbatim" && !result.suites?.strict) continue;
      for (const finding of suite.findings) findings.push({ rule: finding.code,
        severity: finding.severity === "error" ? "error" : "warning", message: finding.message, path: finding.where });
      if (suite.status === "error") findings.push({ rule: suite.suite, severity: "error", message: suite.error ?? "Check could not complete." });
    }
    if (result.exitCode !== 0 && findings.length === 0) findings.push({ rule: "check", severity: "error", message: result.message });
    const envelope = buildCheckOutputEnvelope({
      package: result.slots?.package ?? "@clossys/producer",
      version: result.slots?.version ?? createRequire(import.meta.url)("../../package.json").version,
      verdict: result.exitCode === 0 ? "satisfied" : result.exitCode === 1 ? "violated" : "indeterminate",
      summary: result.exitCode === 0 ? "Workspace checks passed." : `Workspace checks reported ${findings.length} findings.`, findings,
    });
    console.log(JSON.stringify({ ...result, ...envelope }));
  } else console.log(JSON.stringify(result));
} else if (result.exitCode === 0) {
  console.log(result.message);
} else {
  console.error(result.message);
}
process.exitCode = result.exitCode;
