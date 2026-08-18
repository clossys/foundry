import { describe, expect, it } from "vitest";
import { REVIEW_EVIDENCE_VERSION } from "@vespeneventures/governance/review";
import { VERIFY_STANDARDS_INPUTS_VERSION, verifyStandards } from "./verify.js";
import type { VerifyStandardsInputs } from "./verify.js";
import { STANDARDS_CHECKS } from "./types.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

/** An inputs document under which all four checks pass. Each test spoils one part. */
function goodInputs(): VerifyStandardsInputs {
  return {
    schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
    secretScan: {
      observation: {
        attempted: true,
        toolName: "example-scanner",
        toolVersion: "8.30.1",
        exitCode: 0,
        scope: "full-history",
        unitsScanned: 12,
        hits: [],
      },
    },
    taskRecord: {
      observation: {
        eventKind: "proposed-change",
        description: "Work item: #7",
        authorId: "a-person",
        headRef: "topic/thing",
        labels: [],
        trackerScope: "a-scope/a-project",
        item: { outcome: "resolved" },
      },
      policy: {
        applicableEventKinds: ["proposed-change"],
        exemptLabels: [],
        exemptAuthorSuffixes: ["[bot]"],
        exemptHeadRefPrefixes: [],
        recordLabels: ["Work item"],
        requireResolvedItem: true,
      },
    },
    reviewEvidence: {
      evidence: {
        schemaVersion: REVIEW_EVIDENCE_VERSION,
        headSha: HEAD,
        baseSha: BASE,
        paginationComplete: true,
        checks: [{ name: "verify", conclusion: "success", headSha: HEAD }],
        reviews: [
          {
            id: "REVIEW_1",
            reviewerId: "a-reviewer",
            instanceId: "SESSION_1",
            provider: "a-review-client",
            submittedAt: "2026-08-17T10:00:00Z",
            state: "approved",
            depth: "primary",
            headSha: HEAD,
          },
        ],
        threads: [],
      },
      policy: { requiredChecks: ["verify"], requireApproval: false, requireSecondaryReview: false, decisionUse: "advisory" },
      options: { requireReviewPresence: true, headShaUnderTest: HEAD },
    },
    policyDrift: {
      observation: {
        declaredRequirements: [{ id: "verify" }],
        liveRequirements: [{ id: "verify" }],
        liveComplete: true,
      },
      options: { allowUndeclaredLiveRequirements: false },
    },
  };
}

const currentBuild = { selectedChecks: STANDARDS_CHECKS, installedVersion: "9.9.9" };

describe("verifyStandards", () => {
  it("exits 0 when the floor and all four checks are satisfied", () => {
    const report = verifyStandards(goodInputs(), currentBuild);
    expect(report.exitCode).toBe(0);
    expect(report.overall.verdict).toBe("satisfied");
    expect(report.rows.map((row) => row.row)).toEqual(["version-floor", ...STANDARDS_CHECKS]);
  });

  it("exits 1 when a check found a real problem and nothing was unevaluable", () => {
    const inputs = goodInputs();
    const report = verifyStandards(
      { ...inputs, taskRecord: { ...inputs.taskRecord, observation: { ...inputs.taskRecord!.observation!, description: "no reference" } } },
      currentBuild,
    );
    expect(report.exitCode).toBe(1);
    if (report.overall.verdict !== "violated") throw new Error("expected violated");
    expect(report.overall.findings[0]).toMatchObject({ row: "task-record", rule: "task-record-missing" });
  });

  it("lets one indeterminate check dominate three satisfied ones", () => {
    const inputs = goodInputs();
    const report = verifyStandards(
      { ...inputs, secretScan: { observation: { ...inputs.secretScan!.observation!, attempted: false } } },
      currentBuild,
    );
    expect(report.exitCode).toBe(2);
    expect(report.overall.verdict).toBe("indeterminate");
  });

  it("lets an indeterminate check dominate even a violated one", () => {
    // Fail-closed ordering: the run cannot claim to know the full picture
    // while one part of it went unevaluated, even though another part failed.
    const inputs = goodInputs();
    const report = verifyStandards(
      {
        ...inputs,
        secretScan: { observation: { ...inputs.secretScan!.observation!, attempted: false } },
        taskRecord: { ...inputs.taskRecord, observation: { ...inputs.taskRecord!.observation!, description: "none" } },
      },
      currentBuild,
    );
    expect(report.exitCode).toBe(2);
  });

  it("exits 2 for an empty check selection rather than reporting a vacuous pass", () => {
    const report = verifyStandards(goodInputs(), { ...currentBuild, selectedChecks: [] });
    // The floor row alone is ordinarily satisfied, so without an explicit
    // selection row this run would fold to a green tick having examined nothing.
    expect(report.rows.map((row) => row.row)).toEqual(["version-floor", "check-selection"]);
    expect(report.exitCode).toBe(2);
    expect(report.overall).toMatchObject({ verdict: "indeterminate", reason: "no-checks-selected" });
  });

  it("exits 2 with a named reason when the inputs document is missing", () => {
    const report = verifyStandards(undefined, currentBuild);
    expect(report.exitCode).toBe(2);
    expect(report.rows.find((row) => row.row === "inputs")?.result).toMatchObject({
      verdict: "indeterminate",
      reason: "no-inputs-supplied",
    });
  });

  it.each([[null], [42], ["a-string"], [[]]])(
    "exits 2 with a named reason when the inputs document is %s rather than an object",
    (document) => {
      // `JSON.parse("null")` is `null`, and reading `.schemaVersion` off it
      // threw. A throw here never reaches the report at all — it ends the
      // process on Node's status `1`, which this contract reads as "violated".
      const report = verifyStandards(document as unknown as VerifyStandardsInputs, currentBuild);
      expect(report.exitCode).toBe(2);
      expect(report.rows.find((row) => row.row === "inputs")?.result).toMatchObject({
        verdict: "indeterminate",
        reason: "no-inputs-supplied",
      });
    },
  );

  it("exits 2 with a named reason for an inputs schema it cannot read", () => {
    const report = verifyStandards({ ...goodInputs(), schemaVersion: 99 as 1 }, currentBuild);
    expect(report.exitCode).toBe(2);
    expect(report.rows.find((row) => row.row === "inputs")?.result).toMatchObject({
      reason: "unsupported-inputs-schema-version",
    });
  });

  it("exits 2 on a stale build even when every check is satisfied", () => {
    const report = verifyStandards(goodInputs(), {
      ...currentBuild,
      installedVersion: "0.0.1",
      minimumVersion: "9.0.0",
    });
    expect(report.exitCode).toBe(2);
    expect(report.rows[0]?.result).toMatchObject({ verdict: "indeterminate", reason: "stale-installed-version" });
    // Every check still ran and still reported; the run is not abandoned.
    expect(report.rows.slice(1).every((row) => row.result.verdict === "satisfied")).toBe(true);
  });

  it("declines a check whose required options were not supplied", () => {
    const inputs = goodInputs();
    const report = verifyStandards({ ...inputs, policyDrift: { observation: inputs.policyDrift!.observation } }, currentBuild);
    expect(report.rows.find((row) => row.row === "policy-drift")?.result).toMatchObject({
      reason: "no-options-supplied",
    });
    expect(report.exitCode).toBe(2);
  });

  it.each([[null], [{}], [{ requireReviewPresence: "yes" }]])(
    "declines review-evidence when its options are %s rather than defaulting them",
    (broken) => {
      const inputs = goodInputs();
      const report = verifyStandards(
        { ...inputs, reviewEvidence: { ...inputs.reviewEvidence, options: broken as never } },
        currentBuild,
      );
      expect(report.rows.find((row) => row.row === "review-evidence")?.result).toMatchObject({
        reason: "no-options-supplied",
      });
      expect(report.exitCode).toBe(2);
    },
  );

  it("runs only the selected checks and reports exactly those rows", () => {
    const report = verifyStandards(goodInputs(), { ...currentBuild, selectedChecks: ["secret-scan"] });
    expect(report.rows.map((row) => row.row)).toEqual(["version-floor", "secret-scan"]);
    expect(report.exitCode).toBe(0);
  });

  it("surfaces a structural exemption as a visible note rather than a silent pass", () => {
    const inputs = goodInputs();
    const report = verifyStandards(
      {
        ...inputs,
        taskRecord: {
          ...inputs.taskRecord,
          observation: { ...inputs.taskRecord!.observation!, authorId: "updater[bot]", description: "none" },
        },
      },
      currentBuild,
    );
    expect(report.rows.find((row) => row.row === "task-record")?.note).toContain("structurally exempt");
  });
});
