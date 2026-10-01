import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDir } from "./tmp-fixture.mjs";

// makeTmpDir is the async twin of makeTmpDirSync. Its cleanup is registered
// on the test context, so it must run once the test that asked for the
// directory ends. The subtest below is that test; its context is the one
// makeTmpDir hooks into.

test("makeTmpDir removes its directory when the test ends", async (t) => {
  let dir;
  await t.test("creates and fills the directory", async (st) => {
    dir = await makeTmpDir(st, "tmp-fixture-async-");
    await writeFile(join(dir, "marker.txt"), "x\n");
    assert.ok(existsSync(join(dir, "marker.txt")), "the directory must exist while its test runs");
  });
  assert.ok(dir, "the subtest must have created a directory");
  assert.equal(existsSync(dir), false, `${dir} must be gone once its test has ended`);
});
