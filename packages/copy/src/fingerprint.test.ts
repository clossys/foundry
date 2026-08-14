import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "./fingerprint.js";

describe("computeCopyFingerprint", () => {
  it("is deterministic — the same text always produces the same fingerprint", () => {
    const text = "Structural placeholder sentence one.";
    expect(computeCopyFingerprint(text)).toBe(computeCopyFingerprint(text));
  });

  it("produces a different fingerprint for different text — even a single-character edit", () => {
    const a = computeCopyFingerprint("Structural placeholder sentence one.");
    const b = computeCopyFingerprint("Structural placeholder sentence two.");
    expect(a).not.toBe(b);
  });

  it("folds in nothing but the text itself — two unrelated calls with equal text produce equal output", () => {
    expect(computeCopyFingerprint("same text")).toBe(computeCopyFingerprint("same text"));
  });

  it("matches a directly-computed sha256 hex digest of the same text — pins the algorithm, not just 'some hash'", () => {
    const text = "Structural placeholder sentence.";
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    expect(computeCopyFingerprint(text)).toBe(expected);
  });

  it("exports the algorithm name used, for a caller recording CopyTranslationProvenance.fingerprintAlgorithm", () => {
    expect(COPY_FINGERPRINT_ALGORITHM).toBe("sha256");
  });

  it("treats an empty string as valid input — never throws", () => {
    expect(() => computeCopyFingerprint("")).not.toThrow();
  });
});
