import { describe, it, expect } from "vitest";
import { computeDigest } from "./digest.js";
import { validateBindingShape, verifyBinding } from "./validate.js";
import type { PolicyBinding } from "./types.js";

const VALID_DIGEST = "a".repeat(64);

function validBinding(overrides: Partial<PolicyBinding> = {}): PolicyBinding {
  return {
    policyId: "example-policy",
    digestAlgorithm: "sha256",
    digest: VALID_DIGEST,
    ...overrides,
  };
}

describe("validateBindingShape", () => {
  it("returns no findings for a well-formed binding", () => {
    expect(validateBindingShape(validBinding())).toEqual([]);
  });

  describe("binding-present", () => {
    it("flags null", () => {
      const findings = validateBindingShape(null);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("binding-present");
      expect(findings[0]?.severity).toBe("error");
    });

    it("flags a number", () => {
      const findings = validateBindingShape(42);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("binding-present");
    });

    it("flags an array", () => {
      const findings = validateBindingShape([]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("binding-present");
    });

    it("flags a string", () => {
      const findings = validateBindingShape("x");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("binding-present");
    });

    it("flags undefined", () => {
      const findings = validateBindingShape(undefined);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("binding-present");
    });

    it("short-circuits: no other rules run once binding-present fails", () => {
      // Every other rule needs an object to read fields off of; a
      // non-object input must produce exactly the one finding, not attempt
      // (and fail) to also check policyId/digestAlgorithm/digest.
      expect(validateBindingShape("x")).toHaveLength(1);
    });
  });

  describe("policy-id-shape", () => {
    it("flags a missing policyId", () => {
      const { policyId, ...rest } = validBinding();
      const findings = validateBindingShape(rest);
      expect(findings.map((f) => f.rule)).toContain("policy-id-shape");
    });

    it("flags an empty-string policyId", () => {
      const findings = validateBindingShape(validBinding({ policyId: "" }));
      expect(findings.map((f) => f.rule)).toContain("policy-id-shape");
    });

    it("flags a non-string policyId", () => {
      const findings = validateBindingShape({ ...validBinding(), policyId: 7 });
      expect(findings.map((f) => f.rule)).toContain("policy-id-shape");
    });
  });

  describe("digest-algorithm-known", () => {
    it("flags a missing digestAlgorithm", () => {
      const { digestAlgorithm, ...rest } = validBinding();
      const findings = validateBindingShape(rest);
      expect(findings.map((f) => f.rule)).toContain("digest-algorithm-known");
    });

    it("flags an unknown algorithm (md5)", () => {
      const findings = validateBindingShape({ ...validBinding(), digestAlgorithm: "md5" });
      expect(findings.map((f) => f.rule)).toContain("digest-algorithm-known");
    });
  });

  describe("digest-shape", () => {
    it("flags a missing digest", () => {
      const { digest, ...rest } = validBinding();
      const findings = validateBindingShape(rest);
      expect(findings.map((f) => f.rule)).toContain("digest-shape");
    });

    it("flags uppercase hex", () => {
      const findings = validateBindingShape(validBinding({ digest: "A".repeat(64) }));
      expect(findings.map((f) => f.rule)).toContain("digest-shape");
    });

    it("flags a digest that is too short", () => {
      const findings = validateBindingShape(validBinding({ digest: "a".repeat(63) }));
      expect(findings.map((f) => f.rule)).toContain("digest-shape");
    });

    it("flags a digest that is too long", () => {
      const findings = validateBindingShape(validBinding({ digest: "a".repeat(65) }));
      expect(findings.map((f) => f.rule)).toContain("digest-shape");
    });

    it("flags non-hex characters", () => {
      const findings = validateBindingShape(validBinding({ digest: "g".repeat(64) }));
      expect(findings.map((f) => f.rule)).toContain("digest-shape");
    });

    it("is skipped when digestAlgorithm is unknown — there is no expected length to check against", () => {
      const findings = validateBindingShape({ ...validBinding(), digestAlgorithm: "md5", digest: "not-hex-at-all" });
      expect(findings.map((f) => f.rule)).not.toContain("digest-shape");
      expect(findings.map((f) => f.rule)).toContain("digest-algorithm-known");
    });
  });

  it("reports one finding per broken field, not just the first", () => {
    const findings = validateBindingShape({ policyId: "", digestAlgorithm: "md5", digest: "nope" });
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["digest-algorithm-known", "policy-id-shape"].sort());
  });

  it("never throws on any malformed input", () => {
    for (const bad of [null, undefined, 42, [], "x", {}, { policyId: 1, digestAlgorithm: 2, digest: 3 }]) {
      expect(() => validateBindingShape(bad)).not.toThrow();
    }
  });
});

describe("verifyBinding", () => {
  it("returns an empty array when materialized content matches the bound digest exactly", () => {
    const content = "the exact bytes this binding commits to";
    const binding = validBinding({ digest: computeDigest(content) });
    expect(verifyBinding(binding, content)).toEqual([]);
  });

  it("returns one digest-mismatch finding when content does not match, and the message names neither digest", () => {
    const bound = computeDigest("the bound content");
    const binding = validBinding({ digest: bound });
    const findings = verifyBinding(binding, "different content entirely");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-mismatch");
    expect(findings[0]?.severity).toBe("error");

    const actual = computeDigest("different content entirely");
    const message = findings[0]?.message ?? "";
    expect(message).not.toContain(bound);
    expect(message).not.toContain(actual);
    // and it doesn't just leak the raw materialized content into the message either
    expect(message).not.toContain("different content entirely");
  });

  it("on a malformed binding, returns exactly validateBindingShape's findings without attempting a digest comparison", () => {
    const malformed = { policyId: "", digestAlgorithm: "md5", digest: "nope" } as unknown as PolicyBinding;
    const shapeFindings = validateBindingShape(malformed);
    const verifyFindings = verifyBinding(malformed, "anything at all");
    expect(verifyFindings).toEqual(shapeFindings);
  });

  it("never throws even when passed a completely malformed binding", () => {
    const malformed = null as unknown as PolicyBinding;
    expect(() => verifyBinding(malformed, "content")).not.toThrow();
  });
});

describe("TOCTOU hardening: verifyBinding snapshots binding fields exactly once", () => {
  it("a getter-based hostile binding cannot be made to pass verification for non-matching content", () => {
    // The attack: `digest` is a getter. It returns a well-formed-but-bogus
    // 64-hex string on the FIRST read (the one shape validation uses), and
    // the real digest of the decoy content on every later read (the one a
    // vulnerable comparison would use) — so that if `verifyBinding` re-reads
    // `digest` for its comparison, the decoy content appears to match
    // something it was never actually bound to.
    const decoyContent = "content that was never actually bound to this binding";
    const wellFormedButBogusDigest = "b".repeat(64);
    const digestOfDecoyContent = computeDigest(decoyContent);
    // Sanity: the two digests really are different, or this test proves nothing.
    expect(wellFormedButBogusDigest).not.toBe(digestOfDecoyContent);

    let digestReadCount = 0;
    const hostileBinding = {
      policyId: "example-policy",
      digestAlgorithm: "sha256",
      get digest() {
        digestReadCount += 1;
        return digestReadCount === 1 ? wellFormedButBogusDigest : digestOfDecoyContent;
      },
    } as unknown as PolicyBinding;

    const findings = verifyBinding(hostileBinding, decoyContent);

    // Must NOT be a clean pass: decoyContent does not match the digest that
    // was actually bound (wellFormedButBogusDigest, from the one read this
    // function is allowed to make).
    expect(findings).not.toEqual([]);
    expect(findings[0]?.rule).toBe("digest-mismatch");
  });

  it("field-read-count: digest and digestAlgorithm are each read from the raw binding exactly once per verifyBinding call", () => {
    const content = "some content that matches the bound digest";
    let digestReads = 0;
    let algorithmReads = 0;
    let policyIdReads = 0;
    const binding = {
      get policyId() {
        policyIdReads += 1;
        return "example-policy";
      },
      get digestAlgorithm() {
        algorithmReads += 1;
        return "sha256" as const;
      },
      get digest() {
        digestReads += 1;
        return computeDigest(content);
      },
    } as unknown as PolicyBinding;

    const findings = verifyBinding(binding, content);

    expect(findings).toEqual([]); // matching content still verifies correctly
    expect(digestReads).toBe(1);
    expect(algorithmReads).toBe(1);
    expect(policyIdReads).toBe(1);
  });

  it("field-read-count: validateBindingShape called directly also reads each field exactly once, even on a hostile object", () => {
    let digestReads = 0;
    let algorithmReads = 0;
    const hostile = {
      policyId: "example-policy",
      get digestAlgorithm() {
        algorithmReads += 1;
        return "sha256";
      },
      get digest() {
        digestReads += 1;
        return VALID_DIGEST;
      },
    };

    validateBindingShape(hostile);

    expect(digestReads).toBe(1);
    expect(algorithmReads).toBe(1);
  });
});

/**
 * The motivating scenario, as a test: two sibling repositories each require
 * their own denylist-shaped configuration file — different content, same
 * purpose. A CI secret was refreshed from the wrong local file, silently,
 * because nothing verified "the content about to be materialized actually
 * matches what this repository is bound to." A content-addressed binding is
 * exactly the check that was missing.
 *
 * The contents below are synthetic and short — standing in for "some
 * repository's real configuration file" without being one.
 */
describe("incident scenario: materializing the wrong sibling repository's configuration file", () => {
  const REPO_A_DENYLIST = "denylist-fixture: repo-a-term-1, repo-a-term-2";
  const REPO_B_DENYLIST = "denylist-fixture: repo-b-term-1, repo-b-term-2, repo-b-term-3";

  const repoABinding: PolicyBinding = {
    policyId: "example-denylist",
    digestAlgorithm: "sha256",
    digest: computeDigest(REPO_A_DENYLIST),
  };

  it("catches materializing repo B's file where repo A's was bound", () => {
    const findings = verifyBinding(repoABinding, REPO_B_DENYLIST);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-mismatch");
    expect(findings[0]?.severity).toBe("error");
  });

  it("passes once the correct sibling's content is materialized", () => {
    expect(verifyBinding(repoABinding, REPO_A_DENYLIST)).toEqual([]);
  });
});
