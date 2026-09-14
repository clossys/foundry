#!/usr/bin/env node

// Assembles the secret-scan section of @clossys/inspector's inputs
// document from the gitleaks run this same job's "gitleaks (full history)"
// step just performed.
//
// The split is the same one @clossys/inspector's own header describes: this
// script COLLECTS (translates a real, already-completed gitleaks run into
// the shape checkSecretScan reads) and the package DECIDES. Nothing here
// forms a verdict.
//
// The three inputs below are read from that earlier step's own outputs and
// environment, never invented:
//   - GITLEAKS_EXIT_CODE / GITLEAKS_REPORT_PATH — the "gitleaks (full
//     history)" step's own `$GITHUB_OUTPUT` values.
//   - GITLEAKS_VERSION — the exact, checksum-verified version that step
//     downloaded and ran.
//   - UNITS_SCANNED — a real count of this checkout's own history
//     (`git rev-list --all --count`), the same universe `--log-opts=--all`
//     asked gitleaks to walk.
//
// If any of those did not make it this far — the earlier step crashed
// before recording its own outcome, for instance a network failure during
// download — this reports `attempted: false` rather than guessing a clean
// run. That is the exact distinction @clossys/inspector's `secret-scan.ts`
// header exists to require of a caller: a scan that did not happen is not
// evidence of a clean repository.

import { readFileSync } from "node:fs";
import { attemptGitleaksScan } from "@clossys/inspector/secret-scan";

function main() {
  const toolVersion = process.env.GITLEAKS_VERSION;
  const exitCodeRaw = process.env.GITLEAKS_EXIT_CODE;
  const reportPath = process.env.GITLEAKS_REPORT_PATH;
  const unitsScannedRaw = process.env.UNITS_SCANNED;

  const attempted =
    typeof toolVersion === "string" &&
    toolVersion !== "" &&
    typeof exitCodeRaw === "string" &&
    exitCodeRaw !== "" &&
    typeof reportPath === "string" &&
    reportPath !== "";

  const observation = attempted
    ? attemptGitleaksScan({
        // The binary already ran, in the earlier step, outside this
        // process. This script never spawns it — it only translates the
        // outcome that step already recorded.
        binaryPath: "n/a (already executed by the gitleaks step)",
        toolVersion,
        scope: "full-history",
        unitsScanned: (() => {
          const parsed = Number(unitsScannedRaw);
          return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
        })(),
        args: [],
        execute: () => {
          let report;
          try {
            report = JSON.parse(readFileSync(reportPath, "utf8"));
          } catch {
            report = undefined;
          }
          return { exitCode: Number(exitCodeRaw), report };
        },
      })
    : { attempted: false };

  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, secretScan: { observation } }, null, 2)}\n`);
}

main();
