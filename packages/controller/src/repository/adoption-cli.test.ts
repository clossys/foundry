import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./adoption-cli.js";

const roots: string[] = [];
const adoption = {
  schemaVersion: 1,
  id: "cli-repository-package-adoption",
  package: { name: "@example/repository-adoption", version: "1.2.3", integrity: "sha512-rHXzLwYAzn3wjxDgVsSGvPZDaXpAsyzOWAT7oyygM/gA2eBA+MWUgdRXTo3emEtHsPx4vB6rqoRxvVU8ZJ6oDw==" },
  stableProfile: { path: "governance/repository-profile.json", sha256: "5c65a57eadea456e72af0c30b07b7b23f41e65a4f907cb394e8d4b6b9ac1c1df", requiredCoverage: ["declaration", "commands", "protected-paths", "requirements", "root-entries"] },
  events: [{
    kind: "foundation",
    candidate: { name: "@example/repository-adoption", version: "1.2.3", integrity: "sha512-rHXzLwYAzn3wjxDgVsSGvPZDaXpAsyzOWAT7oyygM/gA2eBA+MWUgdRXTo3emEtHsPx4vB6rqoRxvVU8ZJ6oDw==", headSha: "0123456789abcdef0123456789abcdef01234567", baseSha: "76543210fedcba9876543210fedcba9876543210", mainSha: "89abcdef0123456789abcdef0123456789abcdef" },
    manifestRef: "urn:example:manifest", lockfileRef: "urn:example:lockfile", cleanInstallRef: "urn:example:install", reviewRef: "urn:example:review",
  }],
};
const profile = { value: { schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [], requirements: [], rootEntries: [] }, path: "governance/repository-profile.json", sha256: "5c65a57eadea456e72af0c30b07b7b23f41e65a4f907cb394e8d4b6b9ac1c1df" };
const coverage = ["declaration", "commands", "protected-paths", "requirements", "root-entries"].map((name) => ({ name, result: { verdict: "satisfied", evaluated: 1 } }));
const review = { policy: { requiredChecks: ["repository-package-adoption"], requireApproval: false, requireSecondaryReview: false, decisionUse: "authoritative" }, evidence: { schemaVersion: 3, headSha: adoption.events[0].candidate.headSha, baseSha: adoption.events[0].candidate.baseSha, paginationComplete: true, checks: [{ name: "repository-package-adoption", conclusion: "success", headSha: adoption.events[0].candidate.headSha, completedAt: "2026-08-26T23:58:00.000Z" }], reviews: [], threads: [] } };

afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

function invoke(evaluation: unknown): { readonly code: 0 | 1 | 2; readonly output: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), "repository-package-adoption-cli-"));
  roots.push(root);
  const adoptionPath = join(root, "adoption.json");
  const evaluationPath = join(root, "evaluation.json");
  writeFileSync(adoptionPath, JSON.stringify(adoption));
  writeFileSync(evaluationPath, JSON.stringify(evaluation));
  const output: string[] = [];
  return { code: main([adoptionPath, evaluationPath], (line) => output.push(line)), output };
}

describe("repository-package-adoption-check", () => {
  it("maps phase-local satisfaction, violation, and indeterminacy to 0/1/2", () => {
    const satisfied = invoke({ repositoryProfile: profile, stableProfileCoverage: coverage, foundationReview: review });
    expect(satisfied.code).toBe(0);
    expect(satisfied.output[0]).toBe("foundation-ready (foundation; phase-local)");
    const violatedReview = structuredClone(review);
    violatedReview.evidence.headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const violated = invoke({ repositoryProfile: profile, stableProfileCoverage: coverage, foundationReview: violatedReview });
    expect(violated.code).toBe(1);
    expect(violated.output[0]).toBe("violated (foundation; phase-local)");
    const indeterminate = invoke({ repositoryProfile: profile, stableProfileCoverage: [], foundationReview: review });
    expect(indeterminate.code).toBe(2);
    expect(indeterminate.output[0]).toBe("indeterminate (foundation; phase-local)");
  });
});
