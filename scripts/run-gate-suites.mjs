#!/usr/bin/env node
// The second half of `npm run check:gates` (the first is
// `node scripts/test-gates.mjs`, the fixture-driven gate regression suite).
// Discovers every `scripts/**/*.test.mjs` and `.github/scripts/**/*.test.mjs`
// file except the documented exclusions in scripts/lib/gate-test-set.mjs,
// and runs them under one `node --test` invocation -- see that module's own
// header for why this replaced a hand-listed path array in package.json
// (issue #907, issue #1187's merge-train conflict history).
import { spawnSync } from "node:child_process";

import { discoverGateTestFiles, GATE_TEST_SCAN_ROOTS, REPO_ROOT, scanRootExists } from "./lib/gate-test-set.mjs";

function main() {
  for (const scanRoot of GATE_TEST_SCAN_ROOTS) {
    if (!scanRootExists(REPO_ROOT, scanRoot)) {
      console.error(`run-gate-suites: scan root "${scanRoot}" does not exist under ${REPO_ROOT} -- fixture drift in scripts/lib/gate-test-set.mjs?`);
      process.exit(1);
    }
  }

  const files = discoverGateTestFiles();
  if (files.length === 0) {
    console.error("run-gate-suites: discovered zero check:gates suites under scripts/ or .github/scripts/ -- fixture drift?");
    process.exit(1);
  }

  console.log(`run-gate-suites: running ${files.length} discovered suite(s).`);
  const result = spawnSync(process.execPath, ["--test", ...files], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

main();
