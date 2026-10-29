#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWriterRecordDrift } from "../dist/checks/record-drift.js";
import { compileWriterCells } from "../dist/cells/compile.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
let recordsRoot = resolve(packageRoot, "src/catalog/records");
let reportPath = resolve(packageRoot, "reports/record-drift.json");
let check = false;
let cellRoot;
try {
  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index];
    if (argument === "--check") check = true;
    else if ((argument === "--records" || argument === "--report" || argument === "--from-cells") && process.argv[index + 1]) {
      const value = resolve(process.argv[++index]);
      if (argument === "--records") recordsRoot = value;
      else if (argument === "--from-cells") cellRoot = value;
      else reportPath = value;
    } else throw new Error("Usage: check-record-drift.mjs [--check] [--records <directory>] [--from-cells <root>] [--report <file>]");
  }
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Record source symlinks are not supported");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
    }
  };
  if (!cellRoot) visit(recordsRoot);
  const sources = cellRoot ? Object.entries((await compileWriterCells(cellRoot)).files).map(([path, value]) => ({
    path, source: JSON.stringify(value, null, 2) + "\n", value,
  })) : files.map(file => {
    const source = readFileSync(file, "utf8");
    return { path: relative(recordsRoot, file).split("\\").join("/"), source, value: JSON.parse(source) };
  });
  const report = checkWriterRecordDrift(sources);
  const output = JSON.stringify(report, null, 2) + "\n";
  if (check) {
    if (readFileSync(reportPath, "utf8") !== output) {
      console.error("Writer record drift report is stale; regenerate it with check:records.");
      process.exitCode = 1;
    }
  } else {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, output);
  }
  for (const finding of report.findings) console.error(`${finding.code} ${finding.path}: ${finding.message}`);
  console.log(`Writer record drift: ${report.records} records, ${report.bundles.length} sources, ${report.findings.length} findings; approval not evaluated.`);
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Writer record drift refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
