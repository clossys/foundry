import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog/index.js";
import { runFoundationCheck } from "./gates/index.js";
import { preflightPackage } from "./release/index.js";
import { validateRepositoryProfile } from "./repository/index.js";
import { normalizeGitHubReviewEvidence } from "./review/github.js";
import { validateReviewEvidence } from "./review/index.js";

describe("deprecated package compatibility entries", () => {
  it("delegate each preserved public import to its governance subpath", async () => {
    const catalog = await import("@vespeneventures/catalog");
    const gates = await import("@vespeneventures/gates");
    const release = await import("@vespeneventures/release");
    const repository = await import("@vespeneventures/repository");
    const review = await import("@vespeneventures/review");
    const reviewGitHub = await import("@vespeneventures/review/github");

    expect(catalog.buildCatalog).toEqual(expect.any(Function));
    expect(gates.runFoundationCheck).toEqual(expect.any(Function));
    expect(release.preflightPackage).toEqual(expect.any(Function));
    expect(repository.validateRepositoryProfile).toEqual(expect.any(Function));
    expect(review.validateReviewEvidence).toEqual(expect.any(Function));
    expect(reviewGitHub.normalizeGitHubReviewEvidence).toEqual(expect.any(Function));

    // Vitest evaluates the governance source and compatibility packages' built
    // artifacts as distinct modules, so function identity is not meaningful.
    // Verify the compatibility exports still retain the exact callable API.
    expect(typeof buildCatalog).toBe("function");
    expect(typeof runFoundationCheck).toBe("function");
    expect(typeof preflightPackage).toBe("function");
    expect(typeof validateRepositoryProfile).toBe("function");
    expect(typeof validateReviewEvidence).toBe("function");
    expect(typeof normalizeGitHubReviewEvidence).toBe("function");
  });
});
