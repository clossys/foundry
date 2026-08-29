#!/usr/bin/env node
// check-gate-efficacy — report what this repository's own gates actually did,
// computed by @clossys/observer from GitHub Actions run history.
//
//   node scripts/check-gate-efficacy.mjs [--runs 100] [--json]
//
// This is the first caller of `computeGateEfficacy` anywhere in this fleet.
// The package ships the port and no implementation of it, by design; before
// this file existed the port had no supplier, so every close condition that
// says "closes when observer reports a number" depended on a number nobody
// computed. `docs/LIFECYCLE.md`'s `grounded` state is that dependency, named.
//
// WHAT THIS DOES AND DOES NOT CLOSE
// ----------------------------------
// It supplies the RUN-HISTORY half: for each gate, how many times it ran, how
// many times it was skipped, and a verbatim tally of its own verdicts. Those
// are real numbers from a source outside the gates being measured.
//
// It does NOT supply the ESCAPE-RATE half, and says so in its output rather
// than implying otherwise. `LandedChangeOutcome.violation` must be an
// independent judgment that a landed change really did violate the rule --
// a later audit, an incident report, a downstream detector -- and explicitly
// never the gate's own verdict, because that would measure whether a gate
// agrees with itself. Nothing in this repository produces such a judgment
// yet. Every landed change therefore reports `could-not-read`, which makes
// `couldNotReadCount` equal `landedCount` and the rate a LOWER BOUND of zero.
//
// A zero printed under those conditions is not good news, and this command
// refuses to present it as such: an all-green gate with unreadable ground
// truth is either perfectly effective or completely broken, and its history
// looks identical either way. Naming that is the point.
//
// EXIT CONTRACT — 0/1/2, the same ternary every gate here uses
//   0  every gate observed, at least one real run each, no confirmed escape
//   1  a confirmed escape, or a gate that exists and never actually executes
//   2  the run history could not be read -- no token, an API error, a rate
//      limit, a changed response shape. A report that could not read is not a
//      report, and must never exit 0.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { computeGateEfficacy, isCouldNotRead } from "@clossys/observer";

import { collectJobs, createGateRunHistoryReader, gatesSeen, unsourcedOutcomes, toRunRecords } from "./gate-run-history.mjs";

/** `gh api` as an injected fetcher: it already holds the credential and the host. */
export function ghFetchJson(path) {
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/**
 * Grade one gate's efficacy report.
 *
 * ONLY a confirmed escape is a finding. That is a deliberately narrow bar,
 * and the reason is a false positive this grader produced on its first real
 * run: it flagged `visibility` as a dead gate on the evidence that it was
 * present in 42 runs and executed in none. `visibility` is
 * `if: github.event_name == 'workflow_dispatch' && inputs.visibility_only` --
 * a report-only job that is SUPPOSED to be skipped on every ordinary run.
 *
 * Nothing in run history distinguishes "skipped because it is deliberately
 * conditional" from "skipped because it is broken". Asserting the second from
 * evidence that supports either is the same defect this whole package exists
 * to refuse, pointed at a gate instead of a package. So an always-skipped
 * gate is reported prominently and NOT graded: it is the shape a dead gate
 * hides in, and a human can tell in seconds which one it is.
 *
 * Grading it needs a declaration of which gates are expected to run on an
 * ordinary change. That does not exist yet and is not invented here.
 */
export function gradeReport(report) {
  if (report.state === "could-not-read") return { level: "error", why: report.note ?? "history unreadable" };
  if (report.escapeRate.escapedCount > 0) {
    return { level: "finding", why: `${report.escapeRate.escapedCount} confirmed escape(s) — a change this gate should have stopped reached the default branch` };
  }
  if (report.ranCount === 0 && report.didNotRunCount > 0) {
    return {
      level: "note",
      why: `present in ${report.didNotRunCount} run(s) and executed in none of them — either deliberately conditional or dead, and run history cannot tell those apart`,
    };
  }
  return { level: "ok", why: "" };
}

/** True when the rate is arithmetically zero only because nothing could be read. */
export function rateIsUnsourced(metric) {
  return metric.landedCount > 0 && metric.couldNotReadCount === metric.landedCount;
}

export async function run({ fetchJson, owner, repo, runLimit }) {
  const collected = await collectJobs({ fetchJson, owner, repo, runLimit });
  const reader = createGateRunHistoryReader(collected);
  const gates = collected.ok ? gatesSeen(collected.jobs) : [];

  if (!collected.ok) {
    const probe = await computeGateEfficacy("(any)", reader, []);
    return { code: 2, reason: collected.reason, reports: [], unreadable: isCouldNotRead(probe) };
  }

  const reports = [];
  for (const gate of gates) {
    const records = toRunRecords(collected.jobs, gate);
    reports.push(await computeGateEfficacy(gate, reader, unsourcedOutcomes(records, gate)));
  }
  const graded = reports.map((report) => ({ report, ...gradeReport(report) }));
  const code = graded.some((g) => g.level === "error") ? 2 : graded.some((g) => g.level === "finding") ? 1 : 0;
  return { code, reports, graded };
}

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  return {
    json: argv.includes("--json"),
    runLimit: Number(get("--runs", "100")),
  };
}

async function main() {
  const { json, runLimit } = parseArgs(process.argv.slice(2));
  let owner;
  let repo;
  try {
    const nwo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim();
    [owner, repo] = nwo.split("/");
  } catch (error) {
    console.error(`check-gate-efficacy: could not resolve this repository: ${error?.message ?? error}`);
    process.exit(2);
  }

  const result = await run({ fetchJson: ghFetchJson, owner, repo, runLimit });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.code);
  }

  if (result.code === 2 && result.reports.length === 0) {
    console.error(`GATE EFFICACY ERROR — ${result.reason}`);
    console.error("This is not a pass. A report that could not read its own source reports nothing.");
    process.exit(2);
  }

  let unsourced = 0;
  for (const { report, level, why } of result.graded) {
    const verdicts = Object.entries(report.verdictCounts).map(([v, n]) => `${v}=${n}`).join(" ") || "(none)";
    console.log(`  [${level === "ok" ? "OK  " : level === "finding" ? "FIND" : level === "note" ? "NOTE" : "ERR "}] ${report.gate}`);
    console.log(`         ran=${report.ranCount} skipped=${report.didNotRunCount}  verdicts: ${verdicts}`);
    if (rateIsUnsourced(report.escapeRate)) {
      unsourced += 1;
      console.log(`         escape rate: LOWER BOUND 0 — ${report.escapeRate.couldNotReadCount}/${report.escapeRate.landedCount} landed changes have no independent violation source`);
    } else {
      console.log(`         escape rate: ${report.escapeRate.rate ?? "n/a"} (${report.escapeRate.escapedCount} escaped / ${report.escapeRate.landedCount} landed)`);
    }
    if (why) console.log(`         ${why}`);
  }

  console.log("");
  if (unsourced > 0) {
    console.log(
      `GROUND TRUTH MISSING — ${unsourced} of ${result.reports.length} gate(s) report an escape rate of zero solely because no landed change's ` +
        "violation status can be read. That zero is a lower bound, not a clean record: an all-green gate with unreadable ground truth is either " +
        "perfectly effective or completely broken, and its history looks identical either way. Until an independent violation source exists, " +
        "docs/LIFECYCLE.md's `grounded` state is unreached for every package here.",
    );
  }
  console.log(
    result.code === 0
      ? `GATE EFFICACY OK — ${result.reports.length} gate(s) observed across this repository's own pull_request and push runs, no confirmed escape, and ${result.graded.filter((g) => g.level === "note").length} gate(s) that never executed in the window (see NOTE lines) — reported rather than graded, because run history cannot tell a deliberately conditional gate from a dead one.`
      : result.code === 1
        ? "GATE EFFICACY FAIL — see FIND lines above."
        : "GATE EFFICACY ERROR — at least one gate's history could not be read. Not a pass.",
  );
  process.exit(result.code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`check-gate-efficacy: unexpected error: ${error?.stack ?? error}`);
    process.exit(2);
  });
}
