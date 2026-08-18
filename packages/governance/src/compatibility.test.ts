import { describe, expect, it } from "vitest";

/**
 * `@vespeneventures/governance` is now a deprecated compatibility package
 * (issue #282): every subpath below is a thin `export *` forwarding to the
 * matching `@vespeneventures/controller` subpath. This proves the forward
 * actually resolves and still carries the real callable API, the same
 * shape `@vespeneventures/controller`'s own
 * `src/compatibility.test.ts` proves for the five older compatibility
 * packages (`catalog`, `gates`, `release`, `repository`, `review`) that
 * depend on this package directly.
 */
describe("deprecated package compatibility: governance -> controller", () => {
  it("forwards every preserved subpath to its @vespeneventures/controller counterpart", async () => {
    const root = await import("./index.js");
    const catalog = await import("./catalog/index.js");
    const gates = await import("./gates/index.js");
    const release = await import("./release/index.js");
    const repository = await import("./repository/index.js");
    const review = await import("./review/index.js");
    const reviewGitHub = await import("./review/github.js");
    const artifacts = await import("./artifacts/index.js");
    const cleanup = await import("./cleanup/index.js");
    const composition = await import("./composition/index.js");

    expect(root.runGovernanceCheck).toEqual(expect.any(Function));
    expect(root.planNewPackage).toEqual(expect.any(Function));
    expect(catalog.buildCatalog).toEqual(expect.any(Function));
    expect(gates.runFoundationCheck).toEqual(expect.any(Function));
    expect(release.preflightPackage).toEqual(expect.any(Function));
    expect(repository.validateRepositoryProfile).toEqual(expect.any(Function));
    expect(review.validateReviewEvidence).toEqual(expect.any(Function));
    expect(reviewGitHub.normalizeGitHubReviewEvidence).toEqual(expect.any(Function));
    expect(artifacts.verifyGovernedArtifact).toEqual(expect.any(Function));
    expect(cleanup.classifyCleanupCandidate).toEqual(expect.any(Function));
    expect(composition.evaluateComposition).toEqual(expect.any(Function));
  });
});
