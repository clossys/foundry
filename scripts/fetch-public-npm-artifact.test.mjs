import assert from "node:assert/strict";
import test from "node:test";
import { argsFrom as fetchArgs } from "./fetch-public-npm-artifact.mjs";
import { argsFrom as proofArgs } from "./validate-public-npm-registry-proof.mjs";

test("anonymous npm artifact commands have closed traversal-free CLIs", () => {
  assert.deepEqual(fetchArgs(["node", "script", "--package", "advisor", "--output", "out"]), { package: "advisor", output: "out" });
  assert.deepEqual(proofArgs(["node", "script", "--package", "advisor", "--tarball", "candidate.tgz", "--proof", "proof.json"]), { package: "advisor", tarball: "candidate.tgz", proof: "proof.json" });
  for (const args of [["--package", "../advisor"], ["--unknown", "x"], ["--output", "again"]]) assert.throws(() => fetchArgs(["node", "script", "--package", "advisor", "--output", "out", ...args]), /Usage:/);
});
