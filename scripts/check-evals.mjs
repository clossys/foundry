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
// Exit 0 = every composition scenario passed, and (with
//   --enforce-contract-statics) no contract-statics finding either.
// Exit 1 = a composition scenario regressed, or (with
//   --enforce-contract-statics) a contract-statics finding fired.
// Exit 2 = the tree could not be read, or this gate's own report failed
//   docs/contracts/check-output-envelope.json's shape check.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkConversationContractStatics } from "../evals/lib/conversation-contract-checks.mjs";
import { buildEnvelope } from "../evals/lib/output-envelope.mjs";
import { runCompositionScenarios } from "../evals/lib/scenario-runner.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const enforceContractStatics = args.includes("--enforce-contract-statics");
  const positional = args.filter((arg) => arg !== "--json" && arg !== "--enforce-contract-statics");
  const root = resolve(positional[0] ?? join(scriptDir, ".."));

  let scenarios;
  let contractStatics;
  try {
    scenarios = runCompositionScenarios(root);
    contractStatics = checkConversationContractStatics(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ verdict: "indeterminate", error: message }, null, 2));
    } else {
      console.error(`check-evals: cannot answer — ${message}`);
    }
    process.exit(2);
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

  const envelope = buildEnvelope({
    verdict,
    summary,
    findings,
    metric: { name: "composition-scenario-pass-rate", value: scenarioCount === 0 ? 1 : scenariosPassed / scenarioCount, direction: "increase" },
    ...(verdict !== "satisfied" ? { nextAction: "Fix the regressed composition scenario(s) in evals/scenarios/, or the catalogue/preset/skill change that caused them." } : {}),
  });

  if (json) {
    console.log(JSON.stringify({ ...envelope, meanPrecision: scenarios.meanPrecision, meanRecall: scenarios.meanRecall, contractStaticsEnforced: enforceContractStatics }, null, 2));
  } else {
    console.log(`check-evals: ${envelope.verdict} — ${envelope.summary}`);
    console.log(`  composition scenarios: ${scenariosPassed}/${scenarioCount} passed (mean precision ${scenarios.meanPrecision.toFixed(2)}, mean recall ${scenarios.meanRecall.toFixed(2)})`);
    console.log(`  conversation-contract statics: ${contractStatics.scannedPackages.length} skills scanned, ${contractStatics.findings.length} finding(s)${enforceContractStatics ? "" : " (report mode -- pass --enforce-contract-statics to block on these)"}`);
    for (const finding of findings) {
      console.error(`  [${finding.severity}] ${finding.rule} (${finding.path ?? "n/a"}): ${finding.message}`);
    }
  }

  process.exit(verdict === "satisfied" ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
