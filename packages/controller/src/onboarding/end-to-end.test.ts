/**
 * End-to-end exercise against a synthetic consumer fixture.
 *
 * Every identifier here is obviously synthetic and every role executable is a
 * stub written by this test — the point is to run the real discovery, the
 * real child-process invocation and the real join across two materially
 * different consumer topologies, including one where a selected role exposes
 * nothing to invoke.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateInstalledPositionLedger } from "../positions/index.js";
import { activeRolesFromContract, runFirstDayOnboarding } from "./index.js";
import { assessmentInputPath } from "./invoke.js";
import { authorizeMutation, onboardingRunDigest, proposeInstalledPositionLedger } from "./ledger.js";

const roles = activeRolesFromContract();
let fixture = "";
let installRoot = "";
let evidence = "";

/** A stub role assessment. It reads the consumer's evidence file and writes its own answer — the orchestration writes none of it. */
const ASSESSING_ROLE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const positions = (input.surfaces ?? []).map((surface, index) => ({
  id: input.role.replace("@", "").split("/").join("-") + "-" + String(index + 1),
  package: input.role,
  businessMetricPath: { l1: input.l1, l2: input.l2, l3: surface },
  causalHypothesis: "Assessed by " + input.role + " against " + surface + ".",
  baseline: { value: 0.25, observedAt: input.observedAt, evidenceRefs: [input.evidenceRef] },
  setpoint: { value: 0.9, evidenceRefs: [input.evidenceRef] },
  operatingScope: { description: "Scope observed by " + input.role + ".", included: [surface], excluded: ["provider mutation"] },
  authority: { decisionOwner: input.decisionOwner, actionAuthority: "synthetic-automation" },
  evidenceSource: { description: "Consumer-retained synthetic evidence.", locator: input.evidenceRef },
  cadence: { measure: "weekly", review: "monthly" },
  budget: { amount: 0, unit: "currency", period: "month" },
  guardrails: ["No live action in the synthetic fixture."],
  escalationPath: ["Escalate to " + input.decisionOwner + "."],
  workerComponents: [{ kind: "deterministic", responsibility: "Re-read the retained evidence." }],
  stageBindings: { sense: "Read evidence.", judge: "Compare against setpoint.", act: "Report.", verify: "Re-read evidence.", learnOrEscalate: "Escalate." },
  firstDayAssessment: { gaps: ["No independent outcome observed yet."], target: "Reach the declared setpoint.", openQuestions: ["Who retains the evidence?"], criticalPath: ["Retain evidence", "Install position"], deferredWork: [], recommendation: "install", evidenceRefs: [input.evidenceRef] },
}));
console.log(JSON.stringify({ state: "satisfied", baseline: "written by " + input.role, proposedPositions: positions }));
process.exit(0);
`;

/** A stub role assessment that ran and could not conclude. */
const INDETERMINATE_ROLE = `#!/usr/bin/env node
console.log(JSON.stringify({ state: "indeterminate", reason: "the consumer evidence did not establish a baseline" }));
process.exit(2);
`;

function installRole(role: string, script: string | null, declare: boolean): void {
  const directory = join(installRoot, ...role.split("/"));
  mkdirSync(join(directory, "dist"), { recursive: true });
  const manifest: Record<string, unknown> = { name: role, version: "0.0.0-synthetic", type: "module", bin: { "role-assessment": "dist/assessment.js" } };
  if (declare) manifest.foundry = { assessment: { bin: "role-assessment", invocation: "single-json-input" } };
  writeFileSync(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (script !== null) { writeFileSync(join(directory, "dist", "assessment.js"), script); chmodSync(join(directory, "dist", "assessment.js"), 0o755); }
}

function writeEvidence(role: string, surfaces: readonly string[]): void {
  writeFileSync(assessmentInputPath(evidence, role), `${JSON.stringify({
    role, surfaces, l1: "synthetic-value-formula", l2: "synthetic-northstar",
    observedAt: "2026-08-17T00:00:00.000Z", evidenceRef: "synthetic-evidence-record",
    decisionOwner: "decision-owner-alpha",
  }, null, 2)}\n`);
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "synthetic-consumer-"));
  installRoot = join(fixture, "node_modules");
  evidence = join(fixture, "evidence");
  mkdirSync(evidence, { recursive: true });
  // Two roles expose a declared, working assessment surface.
  installRole("@clossys/advisor", ASSESSING_ROLE, true);
  installRole("@clossys/observer", ASSESSING_ROLE, true);
  // One is installed and ships a CLI but declares no assessment surface at all.
  installRole("@clossys/strategist", ASSESSING_ROLE, false);
  // One declares a surface, runs, and cannot conclude.
  installRole("@clossys/architect", INDETERMINATE_ROLE, true);
  for (const role of ["@clossys/advisor", "@clossys/observer", "@clossys/strategist", "@clossys/architect"]) writeEvidence(role, ["synthetic-operating-surface"]);
});
afterEach(() => { rmSync(fixture, { recursive: true, force: true }); });

const topologyA = { schemaVersion: 1 as const, engagement: { id: "engagement-topology-a", decisionOwner: "decision-owner-alpha" }, unresolved: [], unmapped: [], candidateRoles: [] };
const topologyB = { schemaVersion: 1 as const, engagement: { id: "engagement-topology-b", decisionOwner: "decision-owner-alpha" }, unresolved: ["business-model" as const, "causal-metric-tree" as const], unmapped: ["ontology" as const, "repository-topology" as const], candidateRoles: [] };

describe("first-day onboarding, end to end, against a synthetic consumer", () => {
  it("topology A: every selected role has a surface, and the approved ledger validates", { timeout: 30_000 }, () => {
    const run = runFirstDayOnboarding(topologyA, { installRoot, evidenceDirectory: evidence });
    expect(run.selection.filter((item) => item.outcome === "selected").map((item) => item.role)).toEqual(["@clossys/advisor", "@clossys/observer"]);
    expect(run.gaps).toEqual([]);
    expect(run.state).toBe("satisfied");
    expect(run.assessments.every((item) => item.outcome === "assessment-returned")).toBe(true);
    // The baseline in the report was written by the role, not by the join.
    expect((run.assessments[0]?.assessment as { baseline: string }).baseline).toBe("written by @clossys/advisor");

    const proposal = proposeInstalledPositionLedger(run, roles);
    expect(proposal.findings).toEqual([]);
    const report = validateInstalledPositionLedger(proposal.ledger);
    expect(report.findings).toEqual([]);
    expect(report.openRoles).toBe(2);
    expect(report.positions).toBe(2);

    const approval = { decisionOwner: "decision-owner-alpha", approvedRunDigest: onboardingRunDigest(run), approvedAt: "2026-08-18T00:00:00.000Z" };
    expect(authorizeMutation(run, proposal.ledger, approval).authorized).toBe(true);
  });

  it("topology B: a role with no assessment surface is named in the output and blocks the ledger", { timeout: 30_000 }, () => {
    const run = runFirstDayOnboarding(topologyB, { installRoot, evidenceDirectory: evidence });
    expect(run.selection.filter((item) => item.outcome === "selected").map((item) => item.role)).toEqual(["@clossys/advisor", "@clossys/architect", "@clossys/observer", "@clossys/strategist"]);
    expect(run.gaps).toEqual([{ role: "@clossys/strategist", reason: "no-assessment-declaration" }]);
    expect(run.assessments.find((item) => item.role === "@clossys/strategist")?.outcome).toBe("no-assessment-surface");
    expect(run.assessments.find((item) => item.role === "@clossys/architect")?.outcome).toBe("assessment-indeterminate");
    expect(run.state).toBe("indeterminate");

    const proposal = proposeInstalledPositionLedger(run, roles);
    expect(proposal.ledger).toBeNull();
    const approval = { decisionOwner: "decision-owner-alpha", approvedRunDigest: onboardingRunDigest(run), approvedAt: "2026-08-18T00:00:00.000Z" };
    expect(authorizeMutation(run, proposal.ledger, approval).authorized).toBe(false);
  });

  it("names a missing consumer evidence file rather than assessing without it", { timeout: 30_000 }, () => {
    rmSync(assessmentInputPath(evidence, "@clossys/observer"));
    const run = runFirstDayOnboarding(topologyA, { installRoot, evidenceDirectory: evidence });
    expect(run.gaps).toEqual([{ role: "@clossys/observer", reason: "assessment-input-missing" }]);
    expect(run.state).toBe("indeterminate");
  });

  it("refuses a role whose printed state disagrees with its exit code", { timeout: 30_000 }, () => {
    installRole("@clossys/observer", "#!/usr/bin/env node\nconsole.log(JSON.stringify({ state: \"satisfied\" }));\nprocess.exit(1);\n", true);
    const run = runFirstDayOnboarding(topologyA, { installRoot, evidenceDirectory: evidence });
    expect(run.gaps).toEqual([{ role: "@clossys/observer", reason: "assessment-exit-inconsistent" }]);
  });

  it("refuses unparseable role output rather than treating it as an empty assessment", { timeout: 30_000 }, () => {
    installRole("@clossys/observer", "#!/usr/bin/env node\nconsole.log(\"assessment complete\");\n", true);
    const run = runFirstDayOnboarding(topologyA, { installRoot, evidenceDirectory: evidence });
    expect(run.gaps).toEqual([{ role: "@clossys/observer", reason: "assessment-output-unreadable" }]);
  });
});
