import { describe, expect, it } from "vitest";

/**
 * `@vespeneventures/policy` is now a deprecated compatibility package
 * (issue #282): `src/index.ts` is a single
 * `export * from "@vespeneventures/controller/policy"`. This proves the
 * forward actually resolves and still carries the real callable API.
 */
describe("deprecated package compatibility: policy -> controller/policy", () => {
  it("forwards the full PolicyBinding API to @vespeneventures/controller/policy", async () => {
    const policy = await import("./index.js");

    expect(policy.computeDigest).toEqual(expect.any(Function));
    expect(policy.validateBindingShape).toEqual(expect.any(Function));
    expect(policy.verifyBinding).toEqual(expect.any(Function));
    expect(policy.DIGEST_ALGORITHMS).toEqual(["sha256"]);
    expect(policy.OWN_LICENSE_BINDING).toEqual({
      policyId: "self:license",
      digestAlgorithm: "sha256",
      digest: expect.any(String),
    });

    expect(policy.computeDigest("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(policy.verifyBinding(policy.OWN_LICENSE_BINDING, "not the license")).not.toEqual([]);
  });
});
