#!/usr/bin/env node
// @clossys/planner status probe, scaffolded (issue #1203). Contract: the repository's
// docs/contracts/package-framework.json `fields.status` (not shipped): read-only,
// exactly one check-output envelope on stdout, exit code folded from its verdict.
// Replace the body once this role has real capability content to measure.
import { readFileSync } from "node:fs";
import { buildCheckOutputEnvelope, envelopeToExitCode } from "./generated/check-output-envelope.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };

const envelope = buildCheckOutputEnvelope({
  package: manifest.name,
  version: manifest.version,
  verdict: "indeterminate",
  summary: "This role has no capability content yet, so there is nothing to measure.",
  findings: [{ rule: "no-capability-content", severity: "warning", message: "@clossys/planner is a scaffolded skeleton: no capability has built or partial maturity yet." }],
  nextAction: "Author this role's first real capability, then make this probe measure it.",
});

process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
process.exitCode = envelopeToExitCode(envelope);
