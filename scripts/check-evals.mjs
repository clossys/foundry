#!/usr/bin/env node
// check-evals — issue #1185's deterministic regression gate: composition
// accuracy and repeatability over evals/scenarios/*.json (scored against
// the real, generated capability catalogue -- see
// evals/lib/scenario-runner.mjs's own header), plus static
// conversation-contract checks over every packages/*/skill/SKILL.md's own
// role content (evals/lib/conversation-contract-checks.mjs).
//
//   node scripts/check-evals.mjs [--json] [--enforce-contract-statics] [<repoRoot>]
//
// No model calls, no network access, no randomness -- fully deterministic,
// same class as scripts/check-offering-kits.mjs and
// scripts/check-conversation-contract.mjs, both of which this script
// reuses rather than reimplements (see each module's own header for why).
// The separate, human-run, model-in-the-loop half of #1185 lives in
// evals/manual/ and is never invoked from here or from CI.
//
// Composition scenario findings (accuracy and repeatability) always fail
// this gate: they are load-bearing regression coverage over real,
// deterministic engine behavior, not a heuristic. Conversation-contract
// static findings are report-mode only by default -- printed and counted,
// never failing the gate -- because they are a heuristic text scan over
// prose (see evals/lib/conversation-contract-checks.mjs's own header for
// why); pass --enforce-contract-statics to promote them to blocking once
// their false-positive rate has been proven low over time, mirroring
// scripts/check-package-framework.mjs's own --enforce convention.
//
// Every `--json` body, on every path below, is exactly
// docs/contracts/check-output-envelope.json's shape -- validated by
// `buildEnvelope` (evals/lib/output-envelope.mjs) before it is ever
// printed, and never widened with extra fields afterward (review #1413,
// B3): the mean precision/recall and whether --enforce-contract-statics
// was passed are still shown, but only in the human-readable (non --json)
// form, never inside the JSON body.
//
// Exit 0 = every composition scenario passed, and (with
//   --enforce-contract-statics) no contract-statics finding either.
// Exit 1 = a composition scenario regressed, or (with
//   --enforce-contract-statics) a contract-statics finding fired.
// Exit 2 = the tree could not be read (including zero loaded scenarios --
//   see evals/lib/scenario-runner.mjs#loadScenarios), or this gate's own
//   report failed docs/contracts/check-output-envelope.json's shape check.
//   This is a real, reachable exit path for every envelope this script
//   builds: every `buildEnvelope` call here is inside a `try`, so a bug in
//   this gate's own report construction still exits 2, never an uncaught
//   exception (Node's default exit 1) and never a silently wrong exit 0/1.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkConversationContractStatics } from "../evals/lib/conversation-contract-checks.mjs";
import { buildEnvelope, EVALS_PACKAGE_NAME, EVALS_PACKAGE_VERSION } from "../evals/lib/output-envelope.mjs";
import { runCompositionScenarios } from "../evals/lib/scenario-runner.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * A valid indeterminate envelope for "this gate could not answer", built
 * through the same validated constructor as every other verdict. If
 * `buildEnvelope` itself throws (a bug in this gate's own report
 * construction, not in the tree it read), falls back to a literal built
 * from the same required fields `validateCheckOutputEnvelope` checks, so a
 * `--json` caller never receives anything other than the documented shape
 * on this path.
 */
function indeterminateEnvelope(message) {
  try {
    return buildEnvelope({
      verdict: "indeterminate",
      summary: "check-evals could not produce a report for the current tree.",
      findings: [{ rule: "cannot-answer", severity: "error", message }],
    });
  } catch {
    return {
      package: EVALS_PACKAGE_NAME,
      version: EVALS_PACKAGE_VERSION,
      verdict: "indeterminate",
      summary: "check-evals could not produce a report for the current tree.",
      findings: [{ rule: "cannot-answer", severity: "error", message }],
    };
  }
}

/**
 * Runs the gate against `root` and returns `{ envelope, exitCode, detail }`.
 * `envelope` is always docs/contracts/check-output-envelope.json's exact
 * shape -- the only thing a `--json` caller should ever print. `detail`
 * (never part of the JSON body) carries the human-readable extras: mean
 * precision/recall, per-category counts, and whether
 * `--enforce-contract-statics` was passed. Pure aside from the filesystem
 * reads `runCompositionScenarios`/`checkConversationContractStatics`
 * themselves perform; never exits the process itself, so it is directly
 * testable without spawning a child process. `scenariosDir` is forwarded to
 * `runCompositionScenarios` and exists only so check-evals.test.mjs can
 * point at a deliberately empty directory to test the zero-scenario path
 * (review #1413 item 7) without faking an entire repository tree; the CLI
 * itself never passes it.
 */
export function runCheckEvals(root, { enforceContractStatics = false, scenariosDir } = {}) {
  let scenarios;
  let contractStatics;
  try {
    scenarios = runCompositionScenarios(root, { ...(scenariosDir ? { scenariosDir } : {}) });
    contractStatics = checkConversationContractStatics(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { envelope: indeterminateEnvelope(message), exitCode: 2, detail: null };
  }

  const scenarioFindings = scenarios.findings.map((finding) => ({ ...finding, severity: "error" }));
  const contractFindings = contractStatics.findings.map((finding) => ({
    ...finding,
    severity: enforceContractStatics ? "error" : "warning",
  }));
  const findings = [...scenarioFindings, ...contractFindings];

  const scenarioCount = scenarios.results.length;
  const scenariosPassed = scenarios.results.filter((entry) => entry.accuracy.passed && entry.repeatability.passed).length;
  const blockingFindingCount = scenarioFindings.length + (enforceContractStatics ? contractFindings.length : 0);

  const verdict = blockingFindingCount > 0 ? "violated" : "satisfied";
  const summary = verdict === "satisfied"
    ? `All ${scenarioCount} composition scenarios passed accuracy and repeatability, and ${contractStatics.scannedPackages.length} skills were scanned for conversation-contract statics.`
    : `${scenarioCount - scenariosPassed} of ${scenarioCount} composition scenarios regressed, or a conversation-contract static finding fired under --enforce-contract-statics.`;

  let envelope;
  try {
    envelope = buildEnvelope({
      verdict,
      summary,
      findings,
      metric: { name: "composition-scenario-pass-rate", value: scenariosPassed / scenarioCount, direction: "increase" },
      ...(verdict !== "satisfied" ? { nextAction: "Fix the regressed composition scenario(s) in evals/scenarios/, or the catalogue/preset/skill change that caused them." } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { envelope: indeterminateEnvelope(`this gate's own report failed shape validation: ${message}`), exitCode: 2, detail: null };
  }

  return {
    envelope,
    exitCode: verdict === "satisfied" ? 0 : 1,
    detail: {
      scenarioCount,
      scenariosPassed,
      meanPrecision: scenarios.meanPrecision,
      meanRecall: scenarios.meanRecall,
      scannedPackages: contractStatics.scannedPackages.length,
      contractFindingCount: contractStatics.findings.length,
      enforceContractStatics,
    },
  };
}

function printHuman({ envelope, detail }) {
  console.log(`check-evals: ${envelope.verdict} — ${envelope.summary}`);
  if (detail) {
    console.log(`  composition scenarios: ${detail.scenariosPassed}/${detail.scenarioCount} passed (mean precision ${detail.meanPrecision.toFixed(2)}, mean recall ${detail.meanRecall.toFixed(2)} -- these are set-overlap scores against hand-authored fixtures, not an independent accuracy measurement; see evals/README.md)`);
    console.log(`  conversation-contract statics: ${detail.scannedPackages} skills scanned, ${detail.contractFindingCount} finding(s)${detail.enforceContractStatics ? "" : " (report mode -- pass --enforce-contract-statics to block on these)"}`);
  }
  for (const finding of envelope.findings) {
    console.error(`  [${finding.severity}] ${finding.rule} (${finding.path ?? "n/a"}): ${finding.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const enforceContractStatics = args.includes("--enforce-contract-statics");
  const positional = args.filter((arg) => arg !== "--json" && arg !== "--enforce-contract-statics");
  const root = resolve(positional[0] ?? join(scriptDir, ".."));

  const { envelope, exitCode, detail } = runCheckEvals(root, { enforceContractStatics });

  if (json) {
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    printHuman({ envelope, detail });
  }

  process.exit(exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
