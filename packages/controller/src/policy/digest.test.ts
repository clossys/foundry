import { describe, it, expect } from "vitest";
import { computeDigest } from "./digest.js";
import type { DigestAlgorithm } from "./types.js";

describe("computeDigest", () => {
  it("matches the standard sha256 digest of the empty string", () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    // This is the well-known SHA-256 digest of zero input bytes (FIPS 180-4
    // test vector), verified independently with Python's hashlib before
    // being hardcoded here.
    expect(computeDigest("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the standard sha256 digest of the known input \"abc\"", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    // This is the canonical SHA-256 test vector for the 3-byte ASCII input
    // "abc" (FIPS 180-4 Appendix B.1), verified independently with Python's
    // hashlib before being hardcoded here.
    expect(computeDigest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("defaults to sha256 when no algorithm is passed", () => {
    expect(computeDigest("abc")).toBe(computeDigest("abc", "sha256"));
  });

  it("produces identical digests for a string and the equivalent UTF-8 Uint8Array", () => {
    const text = "policy documents are hashed, not read";
    const bytes = new TextEncoder().encode(text);
    expect(computeDigest(text)).toBe(computeDigest(bytes));
  });

  it("produces identical digests for empty string and empty Uint8Array", () => {
    expect(computeDigest("")).toBe(computeDigest(new Uint8Array()));
  });

  it("returns 64 lowercase hex characters", () => {
    const digest = computeDigest("anything");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different content produces different digests", () => {
    expect(computeDigest("content-a")).not.toBe(computeDigest("content-b"));
  });

  describe("algorithm allowlist is enforced at runtime, not just compile time", () => {
    // `DigestAlgorithm` is a compile-time-only type; it does not exist once
    // this code is running as plain JS. A JS caller, or a TS caller that
    // sourced the algorithm from config (an ordinary `string`, not narrowed
    // to the union), can call this with anything `createHash` accepts —
    // these tests use `as DigestAlgorithm` casts to simulate exactly that,
    // since real callers reach this same runtime path without a cast.

    it("rejects md5 even though node:crypto itself would happily produce one", () => {
      expect(() => computeDigest("hello", "md5" as DigestAlgorithm)).toThrow(/unsupported digest algorithm/i);
    });

    it("rejects sha1", () => {
      expect(() => computeDigest("hello", "sha1" as DigestAlgorithm)).toThrow(/unsupported digest algorithm/i);
    });

    it("rejects an algorithm name that isn't a real hash function at all", () => {
      expect(() => computeDigest("hello", "not-a-real-algorithm" as DigestAlgorithm)).toThrow(
        /unsupported digest algorithm/i,
      );
    });

    it("the thrown error names the rejected algorithm but not the content", () => {
      // Mirrors the anti-leak discipline elsewhere in this package: an error
      // about a bad *algorithm choice* is fine to be specific about, but it
      // must never echo back the content that was being digested.
      let message = "";
      try {
        computeDigest("super-secret-input-content", "md5" as DigestAlgorithm);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("md5");
      expect(message).not.toContain("super-secret-input-content");
    });

    it("still accepts sha256 explicitly", () => {
      expect(() => computeDigest("hello", "sha256")).not.toThrow();
    });
  });
});
