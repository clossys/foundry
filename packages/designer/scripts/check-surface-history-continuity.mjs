#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSourceEsm } from "./lib/surface-source-runtime.mjs";
import { checkSurfaceHistoryContinuity } from "./lib/surface-history-continuity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
try {
  const report = await runSourceEsm(root, sourceModule => checkSurfaceHistoryContinuity(root, sourceModule));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.findings.length ? 1 : 0;
} catch (error) {
  console.log(JSON.stringify({ findings: [{ code: "surface-history-continuity-unavailable", detail: error instanceof Error ? error.message : String(error) }], rows: [] }, null, 2));
  process.exitCode = 1;
}
