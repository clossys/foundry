/**
 * The child environment a first-day assessment actually receives.
 *
 * Every other test in this directory substitutes `AssessmentInvoker` and
 * never touches `nodeAssessmentInvoker` for real, so nothing else in this
 * package exercises what a role executable is actually handed. This file
 * spawns a genuine child process — an obviously synthetic role script that
 * echoes `process.env` back as its assessment — and inspects what arrived.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assessmentInputPath, observeRoleAssessment } from "./invoke.js";
import type { AssessmentSurface } from "./types.js";

/** A stub role assessment whose entire job is to report its own environment. */
const ECHO_ENVIRONMENT_ROLE = `#!/usr/bin/env node
console.log(JSON.stringify({ state: "satisfied", environment: process.env }));
process.exit(0);
`;

let evidence = "";
let executable = "";
let binDirectory = "";
let surface: AssessmentSurface;

const CANARY_NAME = "SYNTHETIC_CONSUMER_SIDE_CHANNEL";
const CANARY_VALUE = "do-not-inherit-me";

beforeEach(() => {
  evidence = mkdtempSync(join(tmpdir(), "onboarding-invoke-evidence-"));
  binDirectory = mkdtempSync(join(tmpdir(), "onboarding-invoke-bin-"));
  executable = join(binDirectory, "echo-environment.js");
  writeFileSync(executable, ECHO_ENVIRONMENT_ROLE);
  chmodSync(executable, 0o755);
  surface = { role: "@clossys/advisor", version: "0.0.0-synthetic", bin: "role-assessment", invocation: "single-json-input", executable };
  writeFileSync(assessmentInputPath(evidence, surface.role), "{}\n");
  // Obviously synthetic: an arbitrary name in neither the old denylist nor
  // the new allowlist, standing in for "a secret this module never heard
  // of" -- a cloud provider's own token, an SSH agent socket, or anything
  // else a consumer's own shell happens to export.
  process.env[CANARY_NAME] = CANARY_VALUE;
});

afterEach(() => {
  delete process.env[CANARY_NAME];
  rmSync(evidence, { recursive: true, force: true });
  rmSync(binDirectory, { recursive: true, force: true });
});

describe("nodeAssessmentInvoker's child environment", () => {
  it("does not forward a variable outside the fixed allowlist", () => {
    const observation = observeRoleAssessment(surface, evidence);
    expect(observation.failure).toBeNull();
    const report = observation.assessment as { environment: Record<string, string | undefined> };
    expect(report.environment[CANARY_NAME]).toBeUndefined();
  });

  it("still forwards enough of a runtime for the child to actually run", () => {
    const observation = observeRoleAssessment(surface, evidence);
    expect(observation.failure).toBeNull();
    const report = observation.assessment as { environment: Record<string, string | undefined> };
    // PATH is on the allowlist and is set in this test's own process --
    // the point is not "PATH survives" in isolation, it is that the
    // allowlist is not simply empty and the child is not silently
    // unable to run.
    if (process.env.PATH !== undefined) expect(report.environment.PATH).toBe(process.env.PATH);
  });

  it("never forwards a registry credential, matching the module's stated guarantee", () => {
    process.env.NPM_TOKEN = "synthetic-token-value";
    try {
      const observation = observeRoleAssessment(surface, evidence);
      expect(observation.failure).toBeNull();
      const report = observation.assessment as { environment: Record<string, string | undefined> };
      expect(report.environment.NPM_TOKEN).toBeUndefined();
    } finally {
      delete process.env.NPM_TOKEN;
    }
  });
});
