import { describe, expect, it } from "vitest";
import { computeDigest } from "@vespeneventures/policy";
import { verifyPublishedArtifact } from "./verify-artifact.js";

// Synthetic content only — short fake strings, never anything resembling
// this repository's real denylist or any credential. The "expected" digest
// is always computed from computeDigest here, never hardcoded as a literal
// hex string, so each test is self-consistent regardless of which hash
// algorithm computeDigest defaults to.
describe("verifyPublishedArtifact", () => {
  it("passes when published content matches the expected digest exactly", () => {
    const publishedContent = "synthetic-tarball-bytes-for-testing-only";
    const expectedDigest = computeDigest(publishedContent);

    expect(verifyPublishedArtifact(expectedDigest, publishedContent)).toEqual([]);
  });

  it("reports exactly one finding when published content does not match", () => {
    const expectedDigest = computeDigest("synthetic-expected-content");
    const findings = verifyPublishedArtifact(expectedDigest, "synthetic-different-content");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-mismatch");
    expect(findings[0]?.severity).toBe("error");
  });
});
