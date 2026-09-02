import type { PolicyBinding } from "./types.js";

/**
 * This subpath's own mechanism, demonstrated on itself: a binding to the
 * sha256 digest of `packages/controller/LICENSE` (the same LICENSE text
 * this subpath shipped as `packages/policy/LICENSE` before the `policy`
 * source moved into `@clossys/controller` — the two files are
 * byte-identical, so the digest below did not change) as it exists in this
 * repository right now. `policyId: "self:license"` marks it as
 * self-referential rather than a binding to any external document.
 *
 * The digest below was computed once, from the real file
 * (`shasum -a 256 LICENSE`), and hardcoded here exactly like any other
 * `PolicyBinding` would be committed — this package does not read its own
 * LICENSE at import time to produce it, because a `PolicyBinding` is a
 * static commitment, not a live computation. `src/self-host.test.ts` reads
 * the live file at test time and calls `verifyBinding` against it, so this
 * constant only stays correct as long as the file's bytes don't change out
 * from under it — which is exactly the property the whole package exists to
 * make checkable.
 */
export const OWN_LICENSE_BINDING: PolicyBinding = {
  policyId: "self:license",
  digestAlgorithm: "sha256",
  digest: "2fb06c60d79b0be483fd2dc0c907f58edb27afbc716e9d6c678384c38cf58544",
};
