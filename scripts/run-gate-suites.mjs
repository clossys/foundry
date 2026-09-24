#!/usr/bin/env node
// The second half of `npm run check:gates` (the first is
// `node scripts/test-gates.mjs`, the fixture-driven gate regression suite).
// Discovers every `scripts/**/*.test.mjs` and `.github/scripts/**/*.test.mjs`
// file except the documented exclusions in scripts/lib/gate-test-set.mjs,
// and runs them under one `node --test` invocation -- see that module's own
// header for why this replaced a hand-listed path array in package.json
// (issue #907, issue #1187's merge-train conflict history).
//
// CI throughput (Refs: #1324): that one `node --test` invocation over the
// full discovered list is ci.yml's own long pole -- 26m37s measured on a
// 4-vCPU runner (run 35957368169, job 107498450966), dominating
// `publish safety`'s ~27 minute wall time.
// `--shard-index <n> --shard-count <n>` (both or neither; omitted entirely
// by local `npm run check`/`check:gates`, which must keep running every
// suite in one process same as always) selects this invocation's slice of
// the SAME discovered, sorted list via `partitionFilesForShard` -- a pure,
// order-preserving round-robin, not Node's own `--test-shard` flag,
// precisely so the partition is something this repository's own tests can
// assert on without spawning a child `node --test` (see
// scripts/lib/gate-test-set.mjs's own header and gate-test-set.test.mjs's
// completeness-proof tests). ci.yml's `safety-gates-shard` matrix job passes
// these flags; its `safety-gates` fan-in (same #1240 shape
// `candidate-qualification` already uses) proves every shard succeeded
// before the `safety` required context can pass.
import { spawnSync } from "node:child_process";

import { discoverGateTestFiles, GATE_TEST_SCAN_ROOTS, partitionFilesForShard, REPO_ROOT, resolveGateShardArgs, scanRootExists } from "./lib/gate-test-set.mjs";

function main() {
  for (const scanRoot of GATE_TEST_SCAN_ROOTS) {
    if (!scanRootExists(REPO_ROOT, scanRoot)) {
      console.error(`run-gate-suites: scan root "${scanRoot}" does not exist under ${REPO_ROOT} -- fixture drift in scripts/lib/gate-test-set.mjs?`);
      process.exit(1);
    }
  }

  const allFiles = discoverGateTestFiles();
  if (allFiles.length === 0) {
    console.error("run-gate-suites: discovered zero check:gates suites under scripts/ or .github/scripts/ -- fixture drift?");
    process.exit(1);
  }

  const { shard, error } = resolveGateShardArgs(process.argv.slice(2));
  if (error) {
    console.error(`run-gate-suites: ${error}`);
    process.exit(1);
  }

  const files = shard ? partitionFilesForShard(allFiles, shard.shardIndex, shard.shardCount) : allFiles;
  if (files.length === 0) {
    // Should be unreachable whenever shardCount <= allFiles.length (true for
    // every shard count this repository configures), but a shard that
    // selects zero files is exactly the silent-pass failure mode this whole
    // change exists to rule out -- fail loudly rather than let `node --test`
    // with no file arguments report a vacuous success.
    console.error(
      `run-gate-suites: shard ${shard.shardIndex}/${shard.shardCount} selected zero of ${allFiles.length} discovered file(s) -- shardCount is larger than the discovered file count, or partitionFilesForShard is broken.`,
    );
    process.exit(1);
  }

  console.log(
    shard
      ? `run-gate-suites: shard ${shard.shardIndex}/${shard.shardCount} running ${files.length} of ${allFiles.length} discovered suite(s).`
      : `run-gate-suites: running ${files.length} discovered suite(s).`,
  );
  const result = spawnSync(process.execPath, ["--test", ...files], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// No file imports this script (confirmed: nothing under scripts/ or
// .github/scripts/ references "run-gate-suites.mjs" except this file
// itself), so there is no importer for an entry-point guard to protect
// against re-running main() as a side effect. An earlier version of this
// file guarded the call anyway with
// `import.meta.url === \`file://${process.argv[1]}\``, which is broken:
// `import.meta.url` is percent-encoded and symlink-resolved by Node, while
// `process.argv[1]` is neither, so the comparison is false -- and main()
// silently skipped, exiting 0 having run nothing -- whenever this script is
// reached through a symlinked directory or a path containing a space, `%`,
// `#`, or a non-ASCII character. That is exactly the vacuous-pass failure
// mode `--shard-index`/`--shard-count` above exist to rule out, just one
// layer up: a shard that never even calls main() also reports success.
// Always running main() removes the hazard outright. If this file ever
// gains a real importer, guard with
// `import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href`
// (both realpath-resolved AND percent-encoded), never a bare string
// comparison against the raw argv path.
main();
