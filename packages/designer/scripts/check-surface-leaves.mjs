#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkSurfaceLeaves } from "./lib/surface-leaf-check.mjs";
const rootFlag = process.argv.indexOf("--root");
const root = rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
try {
  const report = checkSurfaceLeaves(root);
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else {
    console.log(`Surface component leaves: ${report.coverage.fills} fills, ${report.coverage.files} source files, ${report.findings.length} findings`);
    for (const finding of report.findings) console.log(`${finding.file}:${finding.line} ${finding.rule} ${finding.fill} ${finding.detail}`);
  }
  process.exitCode = report.findings.length ? 1 : 0;
} catch (error) { console.error(error); process.exitCode=2; }
