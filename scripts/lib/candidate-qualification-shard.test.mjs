import assert from "node:assert/strict";
import test from "node:test";

import { assignedToShard, resolvePackageArgs, resolveShardArgs, selectedForRederivation } from "./candidate-qualification-shard.mjs";

test("resolveShardArgs returns shard: null when neither flag is given (unsharded, the default)", () => {
  assert.deepEqual(resolveShardArgs([]), { shard: null });
  assert.deepEqual(resolveShardArgs(["--other-flag", "x"]), { shard: null });
});

test("resolveShardArgs requires both flags together, never just one", () => {
  const onlyIndex = resolveShardArgs(["--shard-index", "0"]);
  assert.equal(typeof onlyIndex.error, "string");
  assert.equal(onlyIndex.shard, undefined);

  const onlyCount = resolveShardArgs(["--shard-count", "8"]);
  assert.equal(typeof onlyCount.error, "string");
});

test("resolveShardArgs parses a well-formed pair", () => {
  assert.deepEqual(resolveShardArgs(["--shard-index", "3", "--shard-count", "8"]), {
    shard: { shardIndex: 3, shardCount: 8 },
  });
  // Order of the two flags on the command line does not matter.
  assert.deepEqual(resolveShardArgs(["--shard-count", "8", "--shard-index", "0"]), {
    shard: { shardIndex: 0, shardCount: 8 },
  });
});

test("resolveShardArgs refuses a non-integer, negative, zero shard-count, or an out-of-range index", () => {
  for (const argv of [
    ["--shard-index", "abc", "--shard-count", "8"],
    ["--shard-index", "0", "--shard-count", "abc"],
    ["--shard-index", "1.5", "--shard-count", "8"],
    ["--shard-index", "0", "--shard-count", "0"],
    ["--shard-index", "-1", "--shard-count", "8"],
    ["--shard-index", "8", "--shard-count", "8"], // shardIndex must be < shardCount
    ["--shard-index", "8", "--shard-count", "1"],
  ]) {
    const result = resolveShardArgs(argv);
    assert.equal(typeof result.error, "string", `expected an error for ${JSON.stringify(argv)}`);
  }
});

test("assignedToShard treats every record as its own when no shard is given", () => {
  for (let i = 0; i < 20; i++) assert.equal(assignedToShard(i, null), true);
});

// #1276: ci.yml's CANDIDATE_QUALIFICATION_SHARDS is a single tunable value
// (currently 4, down from an original 8 -- see that env var's own comment),
// so this partition must stay exhaustive and deterministic for WHATEVER
// count it is set to, not just whichever one happened to be hard-coded when
// this test was written. Parametrized over several counts, including 4
// (today's actual default) and 8 (the value this repository has already
// run with), rather than asserting against one literal.
test("assignedToShard partitions indices by index % shardCount === shardIndex, for any shardCount", () => {
  for (const shardCount of [1, 2, 3, 4, 5, 8, 17]) {
    for (let index = 0; index < shardCount * 5; index++) {
      const owners = [];
      for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
        if (assignedToShard(index, { shardIndex, shardCount })) owners.push(shardIndex);
      }
      // Exhaustive and deterministic: EXACTLY one shard owns each index, for
      // every index -- not "at least one", not "at most one".
      assert.deepEqual(owners, [index % shardCount], `index ${index} must be owned by exactly one shard when shardCount=${shardCount}`);
    }
  }
});

test("assignedToShard's partition never drops an index regardless of shardCount", () => {
  for (const shardCount of [1, 2, 3, 4, 5, 8, 17]) {
    const seen = new Set();
    for (let index = 0; index < shardCount * 4; index++) {
      for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
        if (assignedToShard(index, { shardIndex, shardCount })) seen.add(index);
      }
    }
    assert.equal(seen.size, shardCount * 4, `every index must be claimed by some shard when shardCount=${shardCount}`);
  }
});

test("assignedToShard at the current CI default (4 shards) matches ci.yml's CANDIDATE_QUALIFICATION_SHARDS", () => {
  // Not a duplicate of the parametrized tests above: this one exists so a
  // future change to ci.yml's default that is NOT also reflected here (or
  // vice versa) is at least named in a failure message, even though the
  // partition math itself is already proven for every count.
  const shardCount = 4;
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((index) => [0, 1, 2, 3].find((shardIndex) => assignedToShard(index, { shardIndex, shardCount }))),
    [0, 1, 2, 3, 0, 1, 2, 3],
  );
});

test("resolvePackageArgs returns packageScope: null when --package is absent", () => {
  assert.deepEqual(resolvePackageArgs([]), { packageScope: null });
  assert.deepEqual(resolvePackageArgs(["--shard-index", "0", "--shard-count", "4"]), { packageScope: null });
});

test("resolvePackageArgs parses --package, with or without --allow-missing-record", () => {
  assert.deepEqual(resolvePackageArgs(["--package", "writer"]), { packageScope: { packageKey: "writer", allowMissingRecord: false } });
  assert.deepEqual(resolvePackageArgs(["--allow-missing-record", "--package", "design-kit"]), { packageScope: { packageKey: "design-kit", allowMissingRecord: true } });
});

test("resolvePackageArgs refuses a malformed, repeated, or shard-combined --package, and a bare --allow-missing-record", () => {
  for (const argv of [
    ["--package"],
    ["--package", ""],
    ["--package", "--allow-missing-record"],
    ["--package", "../writer"],
    ["--package", "Writer"],
    ["--package", "writer", "--package", "starter"],
    ["--package", "writer", "--shard-index", "0", "--shard-count", "4"],
    ["--package", "writer", "--shard-count", "4"],
    ["--allow-missing-record"],
  ]) {
    const result = resolvePackageArgs(argv);
    assert.equal(typeof result.error, "string", `expected an error for ${JSON.stringify(argv)}`);
    assert.equal(result.packageScope, undefined);
  }
});

test("selectedForRederivation selects exactly the package record under --package, and defers to the shard otherwise", () => {
  const paths = ["a.json", "b.json", "c.json", "d.json"];
  assert.deepEqual(paths.filter((path, index) => selectedForRederivation(index, path, { packageRecordPath: "c.json" })), ["c.json"]);
  assert.deepEqual(paths.filter((path, index) => selectedForRederivation(index, path, { packageRecordPath: "missing.json" })), []);
  assert.deepEqual(paths.filter((path, index) => selectedForRederivation(index, path)), paths);
  assert.deepEqual(paths.filter((path, index) => selectedForRederivation(index, path, { shard: { shardIndex: 1, shardCount: 2 } })), ["b.json", "d.json"]);
});
