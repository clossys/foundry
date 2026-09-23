import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { allGateTestFiles, discoverGateTestFiles, GATE_TEST_EXCLUSIONS, GATE_TEST_SCAN_ROOTS, REPO_ROOT, scanRootExists } from "./gate-test-set.mjs";

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
