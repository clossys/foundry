import assert from "node:assert/strict";
import test from "node:test";

import { argsFrom, assertExactPublishedBytes, IndeterminateError } from "./verify-post-publish-public-npm-artifact.mjs";

test("post-publish anonymous verifier has a closed package/tarball CLI", () => {
  assert.deepEqual(
    argsFrom(["node", "script", "--package", "advisor", "--expected-tarball", "candidate.tgz"]),
    { package: "advisor", "expected-tarball": "candidate.tgz" },
  );
  for (const argv of [
    ["--package", "../advisor"],
    ["--expected-tarball", "again.tgz"],
    ["--unknown", "x"],
  ]) assert.throws(() => argsFrom(["node", "script", "--package", "advisor", "--expected-tarball", "candidate.tgz", ...argv]), /Usage:/);
});

test("post-publish anonymous verifier preserves missing and exact-byte failure distinctions", () => {
  assert.throws(() => assertExactPublishedBytes({ kind: "known", hasVersion: false }, Buffer.from("candidate")), /visibility did not complete within the observation window: known/);
  assert.throws(
    () => assertExactPublishedBytes({ kind: "verified", bytes: Buffer.from("registry"), evidence: {} }, Buffer.from("candidate")),
    /published tarball mismatch: registry sha1 differs/,
  );
  assert.deepEqual(
    assertExactPublishedBytes({ kind: "verified", bytes: Buffer.from("candidate"), evidence: { access: "anonymous" } }, Buffer.from("candidate")),
    { access: "anonymous" },
  );
});

test("an exhausted observation window is indeterminate; a real byte mismatch is still a failure (issue #790)", () => {
  // controller@0.9.2 and strategist@0.1.3 both published correctly on
  // 2026-09-03, then this exact call threw a plain Error when its anonymous
  // visibility window ran out on a slow CDN edge, aborting the `publish` job
  // on an upload that had already, immutably, succeeded, and skipping the
  // dedicated `verify-published` job downstream. Every non-"verified",
  // non-"mismatch" kind must raise IndeterminateError so the caller can tell
  // "could not confirm yet" apart from "confirmed and wrong".
  for (const kind of ["known", "denied", "unreachable"]) {
    assert.throws(() => assertExactPublishedBytes({ kind, hasVersion: false }, Buffer.from("candidate")), (error) => {
      assert.ok(error instanceof IndeterminateError, `kind "${kind}" must raise IndeterminateError, got ${error.constructor.name}`);
      return true;
    });
  }
  // A genuine mismatch — bytes the registry actually served, disagreeing
  // with the candidate — is a real finding and must NOT become
  // indeterminate. Collapsing the two would make a slow CDN edge
  // indistinguishable from a corrupted upload.
  assert.throws(
    () => assertExactPublishedBytes({ kind: "verified", bytes: Buffer.from("registry"), evidence: {} }, Buffer.from("candidate")),
    (error) => {
      assert.equal(error instanceof IndeterminateError, false, "a real byte mismatch must not be reported as indeterminate");
      assert.match(error.message, /published tarball mismatch/);
      return true;
    },
  );
});
