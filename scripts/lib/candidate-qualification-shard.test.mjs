import assert from "node:assert/strict";
import test from "node:test";

import { assignedToShard, resolveShardArgs } from "./candidate-qualification-shard.mjs";

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

test("assignedToShard partitions indices by index % shardCount === shardIndex", () => {
  const shardCount = 8;
  for (let index = 0; index < 40; index++) {
    const owners = [];
    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      if (assignedToShard(index, { shardIndex, shardCount })) owners.push(shardIndex);
    }
    // Exhaustive and deterministic: EXACTLY one shard owns each index, for
    // every index -- not "at least one", not "at most one".
    assert.deepEqual(owners, [index % shardCount], `index ${index} must be owned by exactly one shard`);
  }
});

test("assignedToShard's partition never drops an index regardless of shardCount", () => {
  for (const shardCount of [1, 2, 3, 5, 8, 17]) {
    const seen = new Set();
    for (let index = 0; index < shardCount * 4; index++) {
      for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
        if (assignedToShard(index, { shardIndex, shardCount })) seen.add(index);
      }
    }
    assert.equal(seen.size, shardCount * 4, `every index must be claimed by some shard when shardCount=${shardCount}`);
  }
});
