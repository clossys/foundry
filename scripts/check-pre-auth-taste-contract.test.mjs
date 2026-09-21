// Regression tests for check-pre-auth-taste-contract.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluatePreAuthTasteContract,
  scanPreAuthTasteContract,
} from "./check-pre-auth-taste-contract.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "check-pre-auth-taste-contract.mjs");
const repoRoot = resolve(scriptDir, "..");

const fixture = {
  floorGateClis: ["designer-hero-css-check", "designer-fold-check", "writer-check --live"],
  tasteStartsAfterFoldCheckGreen: true,
  inhabitRoundCap: 3,
  wallClockMinutesCap: 45,
  requiresScreenshots: true,
  separateSessionFromDoer: true,
  doerMustNotSelfCertifyKeep: true,
};

test("missing bounded section fails", () => {
  const result = evaluatePreAuthTasteContract("# Pre-auth\n\nNo taste section.\n", fixture);
  assert.equal(result.exitCode, 1);
  assert.ok(result.findings.some((f) => f.rule === "bounded-taste-heading"));
});

test("live PRE-AUTH-QUALITY passes taste contract", () => {
  const result = scanPreAuthTasteContract(repoRoot);
  assert.equal(result.exitCode, 0, result.findings.map((f) => f.rule).join(", "));
});

test("CLI exits 0 on this repository", () => {
  const proc = spawnSync(process.execPath, [scriptPath, repoRoot], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
});
