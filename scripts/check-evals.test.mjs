// check-evals.test.mjs — companion regression suite for check-evals.mjs
// (picked up automatically by `npm run check:gates`'s scripts/*.test.mjs
// discovery, same as check-conversation-contract.test.mjs). Calls
// `runCheckEvals` directly rather than spawning a child process: it is a
// pure function of `root` (see its own doc comment), so this is both
// faster and a more direct assertion than parsing subprocess stdout.
//
// Regression coverage for review #1413's B3: every `--json` body must be
// exactly docs/contracts/check-output-envelope.json's shape, on the
// success path AND on the exit-2 (indeterminate) path, with no extra
// fields.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateCheckOutputEnvelope } from "./check-package-framework.mjs";
import { runCheckEvals } from "./check-evals.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENVELOPE_FIELDS = ["package", "version", "verdict", "summary", "findings"];
const ALL_ALLOWED_ENVELOPE_FIELDS = new Set([...ENVELOPE_FIELDS, "metric", "nextAction"]);

test("runCheckEvals: the real tree is satisfied, exit 0, with a valid, unwidened envelope", () => {
  const { envelope, exitCode } = runCheckEvals(repoRoot);
  assert.equal(exitCode, 0);
  assert.equal(envelope.verdict, "satisfied");
  assert.deepEqual(validateCheckOutputEnvelope(envelope, "test"), []);
  for (const key of Object.keys(envelope)) {
    assert.ok(ALL_ALLOWED_ENVELOPE_FIELDS.has(key), `envelope has an undocumented field: ${key}`);
  }
});

test("runCheckEvals: an unreadable root is indeterminate, exit 2, with a valid envelope (review #1413 B3)", () => {
  const { envelope, exitCode } = runCheckEvals("/nonexistent/path/for/sure");
  assert.equal(exitCode, 2);
  assert.equal(envelope.verdict, "indeterminate");
  assert.deepEqual(validateCheckOutputEnvelope(envelope, "test"), []);
  assert.ok(envelope.findings.length > 0, "a non-satisfied verdict must carry at least one finding");
  for (const key of Object.keys(envelope)) {
    assert.ok(ALL_ALLOWED_ENVELOPE_FIELDS.has(key), `envelope has an undocumented field: ${key}`);
  }
});

// Review #1413 item 7: zero loaded scenarios must be indeterminate/exit 2,
// never a silent "satisfied" with a pass rate of 1. Uses the real repoRoot
// (so buildCapabilityCatalogue and checkConversationContractStatics both
// succeed normally) with an empty scenariosDir override, so this isolates
// the zero-scenario path specifically rather than a missing-tree path.
test("runCheckEvals: zero scenario fixtures is indeterminate, exit 2, not a pass", () => {
  const emptyScenariosDir = mkdtempSync(join(tmpdir(), "check-evals-zero-scenarios-"));
  try {
    const { envelope, exitCode } = runCheckEvals(repoRoot, { scenariosDir: emptyScenariosDir });
    assert.equal(exitCode, 2);
    assert.equal(envelope.verdict, "indeterminate");
    assert.match(envelope.findings[0].message, /no scenario fixtures/);
    assert.deepEqual(validateCheckOutputEnvelope(envelope, "test"), []);
  } finally {
    rmSync(emptyScenariosDir, { recursive: true, force: true });
  }
});

test("runCheckEvals: --enforce-contract-statics is reflected in detail, not in the JSON envelope", () => {
  const { envelope, detail } = runCheckEvals(repoRoot, { enforceContractStatics: true });
  assert.equal(detail.enforceContractStatics, true);
  assert.ok(!("enforceContractStatics" in envelope));
  assert.ok(!("meanPrecision" in envelope));
  assert.ok(!("meanRecall" in envelope));
});
