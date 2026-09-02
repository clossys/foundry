import assert from "node:assert/strict";
import test from "node:test";

import { assertReleaseRuntime, RELEASE_RUNTIME } from "./release-runtime.mjs";

function probe(observed) {
  return (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: `${file === process.execPath ? observed.node : observed.npm}\n`, stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: `${observed.zlib}\n`, stderr: "" };
    throw new Error("unexpected runtime probe");
  };
}

test("release runtime accepts the exact Node/npm/zlib tuple", () => {
  assert.deepEqual(assertReleaseRuntime({ run: probe(RELEASE_RUNTIME) }), RELEASE_RUNTIME);
});

for (const key of ["node", "npm", "zlib"]) {
  test(`release runtime rejects a ${key} mismatch before qualification can proceed`, () => {
    const observed = { ...RELEASE_RUNTIME, [key]: `wrong-${key}` };
    assert.throws(
      () => assertReleaseRuntime({ run: probe(observed) }),
      new RegExp(`release qualification requires[\\s\\S]*observed ${key} wrong-${key}`),
    );
  });
}

test("release runtime rejects a failed version probe closed", () => {
  assert.throws(() => assertReleaseRuntime({ run: () => ({ status: 1, stdout: "", stderr: "" }) }), /version probe failed/);
});
