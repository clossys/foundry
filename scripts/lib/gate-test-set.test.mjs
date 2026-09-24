import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  allGateTestFiles,
  discoverGateTestFiles,
  GATE_TEST_EXCLUSIONS,
  GATE_TEST_SCAN_ROOTS,
  partitionFilesForShard,
  REPO_ROOT,
  resolveGateShardArgs,
  scanRootExists,
} from "./gate-test-set.mjs";

test("REPO_ROOT resolves to the real repository root", () => {
  assert.ok(scanRootExists(REPO_ROOT, "scripts"));
  assert.ok(scanRootExists(REPO_ROOT, ".github/scripts"));
  assert.equal(scanRootExists(REPO_ROOT, "definitely-not-a-real-directory"), false);
});

test("discoverGateTestFiles against the real tree returns only *.test.mjs files under the scan roots, sorted and deduplicated", () => {
  const files = discoverGateTestFiles();
  assert.ok(files.length > 0, "expected at least one discovered suite -- fixture drift?");
  for (const file of files) {
    assert.ok(file.endsWith(".test.mjs"), `${file} does not end in .test.mjs`);
    assert.ok(
      GATE_TEST_SCAN_ROOTS.some((root) => file === root || file.startsWith(`${root}/`)),
      `${file} is not under any of ${GATE_TEST_SCAN_ROOTS.join(", ")}`,
    );
  }
  assert.deepEqual(files, [...files].sort(), "expected a sorted result");
  assert.equal(new Set(files).size, files.length, "expected no duplicate entries");
});

test("no discovered suite is one of the documented exclusions", () => {
  const files = discoverGateTestFiles();
  for (const excluded of Object.keys(GATE_TEST_EXCLUSIONS)) {
    assert.ok(!files.includes(excluded), `${excluded} is both discovered and excluded -- filter is broken`);
  }
});

test("every exclusion names a real file, and every reason is a real sentence", () => {
  const raw = allGateTestFiles();
  for (const [file, reason] of Object.entries(GATE_TEST_EXCLUSIONS)) {
    assert.ok(raw.includes(file), `GATE_TEST_EXCLUSIONS names ${file}, which does not exist under any scan root -- stale entry (moved or deleted file)?`);
    assert.ok(typeof reason === "string" && reason.trim().length >= 20, `${file}'s exclusion reason is missing or too short to be a real reason: ${JSON.stringify(reason)}`);
  }
});

// A synthetic fixture tree proves the discovery/exclusion contract this
// module exists for, independent of whatever real files happen to be in
// scripts/ today: a newly added `*.test.mjs` file is picked up automatically
// (first case below), and an excluded one is not, while still being visible
// to `allGateTestFiles` so a stale exclusion is still catchable (second and
// third cases).
test("a newly added *.test.mjs file is picked up automatically; an excluded one is not, but remains visible unfiltered", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-test-set-fixture-"));
  try {
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    mkdirSync(join(root, ".github", "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "new-gate.test.mjs"), "// fixture\n");
    writeFileSync(join(root, "scripts", "lib", "nested-gate.test.mjs"), "// fixture\n");
    writeFileSync(join(root, ".github", "scripts", "workflow-gate.test.mjs"), "// fixture\n");
    writeFileSync(join(root, "scripts", "not-a-suite.mjs"), "// fixture, wrong extension\n");

    const unfiltered = allGateTestFiles({ root, scanRoots: GATE_TEST_SCAN_ROOTS });
    assert.deepEqual(unfiltered, [".github/scripts/workflow-gate.test.mjs", "scripts/lib/nested-gate.test.mjs", "scripts/new-gate.test.mjs"]);

    // Nothing excluded yet: every fixture file is picked up automatically.
    const discovered = discoverGateTestFiles({ root, scanRoots: GATE_TEST_SCAN_ROOTS, exclusions: {} });
    assert.deepEqual(discovered, unfiltered);

    // Excluding one drops it from the discovered set, but it is still
    // visible to the unfiltered scan -- so a stale exclusion (the excluded
    // file later deleted) stays catchable by the test above.
    const withExclusion = discoverGateTestFiles({
      root,
      scanRoots: GATE_TEST_SCAN_ROOTS,
      exclusions: { "scripts/new-gate.test.mjs": "fixture: deliberately excluded to prove the contract" },
    });
    assert.deepEqual(withExclusion, [".github/scripts/workflow-gate.test.mjs", "scripts/lib/nested-gate.test.mjs"]);
    assert.ok(allGateTestFiles({ root, scanRoots: GATE_TEST_SCAN_ROOTS }).includes("scripts/new-gate.test.mjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dotfile or dot-directory under a scan root is never discovered", () => {
  const root = mkdtempSync(join(tmpdir(), "gate-test-set-fixture-"));
  try {
    mkdirSync(join(root, "scripts", ".hidden"), { recursive: true });
    writeFileSync(join(root, "scripts", ".hidden", "sneaky.test.mjs"), "// fixture\n");
    writeFileSync(join(root, "scripts", ".dotfile.test.mjs"), "// fixture\n");
    mkdirSync(join(root, ".github", "scripts"), { recursive: true });

    assert.deepEqual(allGateTestFiles({ root, scanRoots: GATE_TEST_SCAN_ROOTS }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Refs #1324: `partitionFilesForShard`/`resolveGateShardArgs` back
// scripts/run-gate-suites.mjs's `--shard-index`/`--shard-count`, which
// ci.yml's `safety-gates-shard` matrix uses to split the 98-suite
// `node --test` invocation that made `publish safety / gate regression
// tests` this repository's single longest CI job (27 minutes measured, see
// that job's own header in ci.yml). THE failure mode this whole change
// exists to rule out is a shard that silently selects zero files -- a
// skipped or vacuous shard reports as passing, exactly like any other
// skipped required check. The tests below are the completeness proof: (a)
// the union of every shard's selected files equals the full discovered set,
// with no duplicates, for the real corpus and not just a synthetic one; (b)
// no shard, at the real GATE_TEST_SHARDS count ci.yml actually configures,
// is ever empty.
// ---------------------------------------------------------------------------

test("resolveGateShardArgs returns shard: null when neither flag is given (unsharded, the default)", () => {
  assert.deepEqual(resolveGateShardArgs([]), { shard: null });
  assert.deepEqual(resolveGateShardArgs(["--other-flag", "x"]), { shard: null });
});

test("resolveGateShardArgs requires both flags together, never just one", () => {
  const onlyIndex = resolveGateShardArgs(["--shard-index", "0"]);
  assert.equal(typeof onlyIndex.error, "string");
  assert.equal(onlyIndex.shard, undefined);

  const onlyCount = resolveGateShardArgs(["--shard-count", "4"]);
  assert.equal(typeof onlyCount.error, "string");
});

test("resolveGateShardArgs parses a well-formed pair, in either flag order", () => {
  assert.deepEqual(resolveGateShardArgs(["--shard-index", "2", "--shard-count", "4"]), {
    shard: { shardIndex: 2, shardCount: 4 },
  });
  assert.deepEqual(resolveGateShardArgs(["--shard-count", "4", "--shard-index", "0"]), {
    shard: { shardIndex: 0, shardCount: 4 },
  });
});

test("resolveGateShardArgs refuses a non-integer, negative, zero shard-count, or an out-of-range index", () => {
  for (const argv of [
    ["--shard-index", "abc", "--shard-count", "4"],
    ["--shard-index", "0", "--shard-count", "abc"],
    ["--shard-index", "1.5", "--shard-count", "4"],
    ["--shard-index", "0", "--shard-count", "0"],
    ["--shard-index", "-1", "--shard-count", "4"],
    ["--shard-index", "4", "--shard-count", "4"], // shardIndex must be < shardCount
    ["--shard-index", "4", "--shard-count", "1"],
  ]) {
    const result = resolveGateShardArgs(argv);
    assert.equal(typeof result.error, "string", `expected an error for ${JSON.stringify(argv)}`);
  }
});

test("partitionFilesForShard rejects an invalid shardCount or an out-of-range shardIndex", () => {
  const files = ["a", "b", "c"];
  assert.throws(() => partitionFilesForShard(files, 0, 0), RangeError);
  assert.throws(() => partitionFilesForShard(files, 0, -1), RangeError);
  assert.throws(() => partitionFilesForShard(files, 0, 1.5), RangeError);
  assert.throws(() => partitionFilesForShard(files, -1, 3), RangeError);
  assert.throws(() => partitionFilesForShard(files, 3, 3), RangeError); // shardIndex must be < shardCount
  assert.throws(() => partitionFilesForShard(files, 1.5, 3), RangeError);
});

// Parametrized over several shard counts, including 4 (today's actual
// GATE_TEST_SHARDS) and counts that do not divide the fixture list evenly,
// rather than asserting against one literal -- the same shape
// candidate-qualification-shard.test.mjs already proves for its own
// (structurally identical) partition.
test("partitionFilesForShard's round-robin is exhaustive, non-overlapping, and deterministic for any shardCount", () => {
  const files = Array.from({ length: 23 }, (_, i) => `file-${String(i).padStart(2, "0")}.test.mjs`);
  for (const shardCount of [1, 2, 3, 4, 5, 8, 17]) {
    const shards = Array.from({ length: shardCount }, (_, shardIndex) => partitionFilesForShard(files, shardIndex, shardCount));

    // (b) no shard is empty -- true here because shardCount <= files.length
    // for every value under test, the same relationship GATE_TEST_SHARDS: 4
    // has to the 98 real discovered files.
    for (const [shardIndex, shard] of shards.entries()) {
      assert.ok(shard.length > 0, `shard ${shardIndex}/${shardCount} must not be empty`);
    }

    // (a) the union of every shard equals the full input, with no file
    // assigned to more than one shard.
    const union = shards.flat();
    assert.equal(union.length, files.length, `shard union must have exactly ${files.length} entries for shardCount=${shardCount}, got ${union.length}`);
    assert.deepEqual([...new Set(union)].sort(), [...files].sort(), `shard union must equal the full input set for shardCount=${shardCount}`);

    // Deterministic: re-running the same partition produces byte-identical
    // shard assignments, never a re-shuffle.
    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      assert.deepEqual(partitionFilesForShard(files, shardIndex, shardCount), shards[shardIndex]);
    }
  }
});

// The completeness proof against the REAL corpus, not a synthetic one --
// this is what actually stands behind ci.yml's `safety-gates-shard` matrix.
// GATE_TEST_SHARDS is read directly out of ci.yml rather than hard-coded a
// second time here, so a future change to that env var's value is proven
// against automatically, the same reason
// check-workflow-references.test.mjs's own tests read ci.yml's env vars
// live instead of duplicating the number.
function readGateTestShardsFromCiYml() {
  const ciYmlPath = join(REPO_ROOT, ".github", "workflows", "ci.yml");
  const text = readFileSync(ciYmlPath, "utf8");
  const match = text.match(/^ {2}GATE_TEST_SHARDS: (\d+)$/m);
  assert.ok(match, "expected a workflow-level GATE_TEST_SHARDS: <N> in ci.yml");
  return Number(match[1]);
}

test("partitioning the REAL discovered suite list at ci.yml's actual GATE_TEST_SHARDS count is complete and leaves no shard empty", () => {
  const shardCount = readGateTestShardsFromCiYml();
  const allFiles = discoverGateTestFiles();
  assert.ok(allFiles.length > 0, "expected at least one discovered suite -- fixture drift?");
  assert.ok(
    shardCount <= allFiles.length,
    `GATE_TEST_SHARDS (${shardCount}) exceeds the discovered file count (${allFiles.length}) -- a shard would be forced empty; lower GATE_TEST_SHARDS or add suites`,
  );

  const shards = Array.from({ length: shardCount }, (_, shardIndex) => partitionFilesForShard(allFiles, shardIndex, shardCount));

  // (b) no shard is empty.
  for (const [shardIndex, shard] of shards.entries()) {
    assert.ok(shard.length > 0, `real shard ${shardIndex}/${shardCount} selected zero files -- exactly the silent-pass failure mode this change exists to rule out`);
  }

  // (a) the union of every shard's files equals discoverGateTestFiles()'s
  // own full output, exactly -- no file dropped, none duplicated across
  // shards.
  const union = shards.flat();
  assert.equal(new Set(union).size, union.length, "a file was assigned to more than one shard");
  assert.deepEqual([...union].sort(), [...allFiles].sort(), "the union of every shard's files must equal the full discovered set");

  // Every shard reasonably sized -- catches a shardCount misconfiguration
  // (e.g. accidentally sharding a tiny fixture-only subset) even though the
  // exhaustiveness assertions above would already catch a genuinely empty
  // or lopsided-to-zero shard.
  const smallest = Math.min(...shards.map((s) => s.length));
  const largest = Math.max(...shards.map((s) => s.length));
  assert.ok(largest - smallest <= 1, `round-robin over a sorted list must keep every shard within one file of every other shard's count, got sizes ${shards.map((s) => s.length).join(", ")}`);
});
