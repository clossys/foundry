import assert from "node:assert/strict";
import test from "node:test";

import { argsFrom, assertExactPublishedBytes } from "./verify-post-publish-public-npm-artifact.mjs";

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
  assert.throws(() => assertExactPublishedBytes({ kind: "known", hasVersion: false }, Buffer.from("candidate")), /visibility did not complete: known/);
  assert.throws(
    () => assertExactPublishedBytes({ kind: "verified", bytes: Buffer.from("registry"), evidence: {} }, Buffer.from("candidate")),
    /published tarball mismatch: registry sha1 differs/,
  );
  assert.deepEqual(
    assertExactPublishedBytes({ kind: "verified", bytes: Buffer.from("candidate"), evidence: { access: "anonymous" } }, Buffer.from("candidate")),
    { access: "anonymous" },
  );
});
