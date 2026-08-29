import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { verifyBinding } from "./validate.js";
import { computeDigest } from "./digest.js";
import { OWN_LICENSE_BINDING } from "./self-license.js";

// This test file does file I/O — that is fine. The rule is that the
// package's own SOURCE (src/index.ts, src/validate.ts, ...) does none; a
// test reading its own LICENSE to prove self-hosting is not part of the
// published runtime and never ships in `dist`.
//
// This module lives at `src/policy/self-host.test.ts` — one level deeper
// than a package-root-level `src/self-host.test.ts` would be, since `policy`
// is now a subpath of `@clossys/controller` rather than its own
// package root — so it takes two hops up to reach the package root and its
// `LICENSE` file, not one.
const licensePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "LICENSE");

describe("self-hosting: this package binds to, and verifies, its own LICENSE", () => {
  it("verifyBinding(OWN_LICENSE_BINDING, <live LICENSE bytes>) passes today", () => {
    const liveContent = readFileSync(licensePath, "utf8");
    expect(verifyBinding(OWN_LICENSE_BINDING, liveContent)).toEqual([]);
  });

  it("would fail the moment the file's bytes changed", () => {
    const liveContent = readFileSync(licensePath, "utf8");
    const tampered = liveContent + "\n// not actually part of the license";
    const findings = verifyBinding(OWN_LICENSE_BINDING, tampered);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-mismatch");
  });

  it("OWN_LICENSE_BINDING's digest is the real sha256 of the committed LICENSE bytes", () => {
    // Independent check that the hardcoded constant was not fabricated:
    // recompute the digest from the live file and compare to the constant
    // directly, rather than only going through verifyBinding.
    const liveContent = readFileSync(licensePath, "utf8");
    expect(OWN_LICENSE_BINDING.digest).toBe(computeDigest(liveContent));
  });

  it("carries a self-referential policyId", () => {
    expect(OWN_LICENSE_BINDING.policyId).toBe("self:license");
    expect(OWN_LICENSE_BINDING.digestAlgorithm).toBe("sha256");
  });
});
