import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { normalize, discoverPeerVersionFiles, run, EXIT_CODES, CANONICAL_PATH, ACKNOWLEDGED_EXCEPTIONS, hash as hashOf } from "./check-peer-version-assert.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function withRepoFixture(build) {
  const root = mkdtempSync(join(tmpdir(), "peer-version-assert-test-"));
  try {
    return await build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A minimal but real assertPeerVersion body, standing in for the canonical one. */
const BODY_A = `
export function assertPeerVersion(input) {
  // [@scope/pkg-name] this package names itself right here, in a comment.
  const { peer, declaredRange, foundVersion } = input;
  if (foundVersion === undefined) {
    throw new Error(
      \`\${peer} is required but is not installed. Install \${peer}@"\${declaredRange}" \` +
      \`— see this package's README.\`,
    );
  }
  console.warn(
    \`[@scope/pkg-name] could not verify \${peer}@\${foundVersion} against the declared range \` +
    \`"\${declaredRange}": treated as indeterminate, not a violation.\`,
  );
}
`;

/** Same body, wrapped at a DIFFERENT word inside the same joined string — a pure formatting artifact. */
const BODY_A_REWRAPPED = `
export function assertPeerVersion(input) {
  // [@scope/pkg-name] this package names itself right here, in a comment.
  const { peer, declaredRange, foundVersion } = input;
  if (foundVersion === undefined) {
    throw new Error(
      \`\${peer} is required but is not installed. Install \${peer}@"\${declaredRange}" — see \` +
      \`this package's README.\`,
    );
  }
  console.warn(
    \`[@scope/pkg-name] could not verify \${peer}@\${foundVersion} against the declared \` +
    \`range "\${declaredRange}": treated as indeterminate, not a violation.\`,
  );
}
`;

/** A REAL divergence: the warn-and-continue path is gone, replaced by a throw. */
const BODY_B_DIVERGED = `
export function assertPeerVersion(input) {
  const { peer, declaredRange, foundVersion } = input;
  if (foundVersion === undefined) {
    throw new Error(
      \`\${peer} is required but is not installed. Install \${peer}@"\${declaredRange}" \` +
      \`— see this package's README.\`,
    );
  }
  throw new Error(\`could not verify \${peer}@\${foundVersion} against "\${declaredRange}"\`);
}
`;

function writePeerVersionPackage(root, pkgName, relativeSrcPath, body) {
  const pkgDir = join(root, "packages", pkgName);
  const fileDir = join(pkgDir, "src", ...relativeSrcPath.split("/").slice(0, -1));
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `@scope/${pkgName}`, version: "0.1.0" }, null, 2));
  writeFileSync(join(fileDir, "peer-version.ts"), body);
}

// --- normalize(): the control from #518 itself ---------------------------

test("CONTROL: normalize() meaningfully shrinks a real file — the #518 bug was a strip that silently matched nothing", () => {
  const raw = readFileSync(join(REPO_ROOT, CANONICAL_PATH), "utf8");
  const normalized = normalize(raw, "@clossys/bouncer");
  assert.ok(normalized.length < raw.length * 0.6, `expected meaningful shrinkage, got ${raw.length} -> ${normalized.length}`);
  // and it isn't merely whitespace collapse on otherwise-unstripped prose —
  // the doc-comment banner text must actually be gone.
  assert.ok(!normalized.includes("REUSE, NOT SILENT DUPLICATION"), "a block-comment banner survived stripping");
});

test("normalize() blanks out a package's own name wherever it appears in code, not just comments", () => {
  const withName = normalize(BODY_A, "@scope/pkg-name");
  assert.ok(!withName.includes("@scope/pkg-name"), "own name should be fully blanked");
  assert.ok(withName.includes("__OWN_PACKAGE_NAME__"), "own name should be replaced with a placeholder token");
});

test("normalize() folds a template-literal concatenation re-wrapped at a different word to the SAME text", () => {
  const a = normalize(BODY_A, "@scope/pkg-name");
  const b = normalize(BODY_A_REWRAPPED, "@scope/pkg-name");
  assert.equal(a, b, "re-wrapping a joined template literal must not register as divergence");
});

test("SANITY: normalize() is not simply blind to all difference — a real code change still changes the output", () => {
  const a = normalize(BODY_A, "@scope/pkg-name");
  const b = normalize(BODY_B_DIVERGED, "@scope/pkg-name");
  assert.notEqual(a, b, "a genuine behavioural change must still be visible after normalization");
});

// --- discoverPeerVersionFiles(): finds copies without a hardcoded roster --

test("discoverPeerVersionFiles() finds peer-version.ts under nested src paths and ignores dist/node_modules", () => {
  const found = withSyncFixture((root) => {
    writePeerVersionPackage(root, "flat-pkg", "internal/peer-version.ts", BODY_A);
    writePeerVersionPackage(root, "nested-pkg", "web/internal/peer-version.ts", BODY_A);
    // decoys that must NOT be picked up
    mkdirSync(join(root, "packages", "flat-pkg", "dist", "internal"), { recursive: true });
    writeFileSync(join(root, "packages", "flat-pkg", "dist", "internal", "peer-version.ts"), BODY_B_DIVERGED);
    mkdirSync(join(root, "packages", "flat-pkg", "node_modules", "somedep"), { recursive: true });
    writeFileSync(join(root, "packages", "flat-pkg", "node_modules", "somedep", "peer-version.ts"), BODY_B_DIVERGED);
    return discoverPeerVersionFiles(root);
  });
  assert.deepEqual(
    found.sort(),
    ["packages/flat-pkg/src/internal/peer-version.ts", "packages/nested-pkg/src/web/internal/peer-version.ts"].sort(),
  );
});

function withSyncFixture(build) {
  const root = mkdtempSync(join(tmpdir(), "peer-version-assert-test-"));
  try {
    return build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("EMPTY/SHORT SCAN CONTROL: fewer than the expected minimum is indeterminate, never a silent pass", async () => {
  await withRepoFixture(async (root) => {
    writePeerVersionPackage(root, "only-one", "internal/peer-version.ts", BODY_A);
    const result = await run({ repoRoot: root });
    assert.equal(result.verdict, "indeterminate");
    assert.ok(result.reasons[0].includes("expected at least"));
  });
});

// --- run(): the actual verdicts, MUTATION-VERIFIED both ways -------------

test("MUTATION-VERIFY: agreement passes, and a planted divergence in the SAME fixture is caught (fails), then fixing it passes again", async () => {
  await withRepoFixture(async (root) => {
    // Mirror the real gate's canonical path exactly (packages/bouncer/src/internal/peer-version.ts),
    // so run()'s hardcoded CANONICAL_PATH resolves inside this temp root. `exceptions: []` — this
    // fixture deliberately carries none of the real butler/keeper paths the default
    // ACKNOWLEDGED_EXCEPTIONS names, and an exception naming an undiscovered file is itself a
    // (correct) finding, so the default roster must not leak into a fixture that isn't the real tree.
    writePeerVersionPackage(root, "bouncer", "internal/peer-version.ts", BODY_A);
    writePeerVersionPackage(root, "sibling-agrees", "internal/peer-version.ts", BODY_A_REWRAPPED);
    writePeerVersionPackage(root, "sibling-diverges", "web/internal/peer-version.ts", BODY_B_DIVERGED);

    const divergedResult = await run({ repoRoot: root, exceptions: [] });
    assert.equal(divergedResult.verdict, "violated", "PASS 1 (planted divergence): the gate must FAIL here");
    assert.ok(divergedResult.reasons.some((r) => r.includes("sibling-diverges")));
    assert.ok(!divergedResult.reasons.some((r) => r.includes("sibling-agrees")), "the agreeing sibling must not be reported as diverging");

    // Mutate the SAME fixture back into agreement and re-run — both directions verified.
    writePeerVersionPackage(root, "sibling-diverges", "web/internal/peer-version.ts", BODY_A);
    const fixedResult = await run({ repoRoot: root, exceptions: [] });
    assert.equal(fixedResult.verdict, "satisfied", "PASS 2 (agreement restored): the gate must PASS here");
    assert.equal(fixedResult.reasons.length, 0);
  });
});

test("indeterminate when the canonical file itself is missing", async () => {
  await withRepoFixture(async (root) => {
    writePeerVersionPackage(root, "not-canonical-a", "internal/peer-version.ts", BODY_A);
    writePeerVersionPackage(root, "not-canonical-b", "internal/peer-version.ts", BODY_A);
    const result = await run({ repoRoot: root });
    assert.equal(result.verdict, "indeterminate");
    assert.ok(result.reasons[0].includes("canonical file"));
  });
});

test("EXIT_CODES follow the repo's satisfied=0 / violated=1 / indeterminate=2 convention", () => {
  assert.deepEqual(EXIT_CODES, { satisfied: 0, violated: 1, indeterminate: 2 });
});

// --- Against the REAL repository tree: locks in the state this gate found ---

test("REAL TREE (no exceptions): #847 landed — butler and keeper now agree with canonical, same as controller/designer/messenger/publisher", async () => {
  // exceptions: [] — this asserts what the RAW comparison finds, independent of the acknowledged-
  // exception mechanism. #847 ported the #389 fix into butler and keeper and emptied
  // ACKNOWLEDGED_EXCEPTIONS (see "REAL ROSTER" below), so the raw comparison and the gate's actual
  // default-configuration behaviour now agree: every discovered file is satisfied.
  const result = await run({ repoRoot: REPO_ROOT, exceptions: [] });
  // Nine at #518, minus the three retired in #536, plus messenger's own
  // copy added in #886 — so seven. This count is deliberately hardcoded
  // rather than derived: #886's plan read the gate's tree-walking
  // discovery as meaning there was "no roster to edit" anywhere, which is
  // true of the gate SCRIPT and false of this line. A new copy landing
  // without anyone noticing is precisely what this assertion is for, so
  // it must be updated deliberately — that friction is the feature.
  assert.equal(result.files.length, 7, `expected 7 real peer-version.ts files (nine minus the three retired in #536, plus messenger's added in #886), found ${result.files.length}`);
  assert.equal(result.verdict, "satisfied");

  const byFile = Object.fromEntries(result.files.map((f) => [f.file, f.verdict]));
  assert.equal(byFile["packages/butler/src/web/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/keeper/src/web/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/controller/src/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/designer/src/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/messenger/src/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/publisher/src/internal/peer-version.ts"], "satisfied");
});

// --- ACKNOWLEDGED_EXCEPTIONS: the check-package-evidence.mjs "gaps" shape ---
//
// Same reasoning as check-package-evidence.mjs's `stale-gap`: an
// acknowledgement is a countdown, not a standing exemption. Three outcomes,
// each mutation-verified below: the acknowledged divergence PASSES, a
// planted THIRD state (neither canonical nor the acknowledged hash) still
// FAILS loudly, and once the file matches canonical the acknowledgement
// itself becomes the failure ("stale-exception").

function buildExceptionFixtureFiles(root) {
  // Mirrors the real gate's canonical path and layout: packages/bouncer is
  // canonical, packages/sibling-acked is the file an exception will name.
  writePeerVersionPackage(root, "bouncer", "internal/peer-version.ts", BODY_A);
  writePeerVersionPackage(root, "sibling-acked", "internal/peer-version.ts", BODY_B_DIVERGED);
}

test("ACKNOWLEDGED: a divergence pinned by file AND hash passes, without being reported as violated", async () => {
  await withRepoFixture(async (root) => {
    buildExceptionFixtureFiles(root);
    const canonicalHash = hashOf(normalize(BODY_A, "@scope/bouncer"));
    const divergedHash = hashOf(normalize(BODY_B_DIVERGED, "@scope/sibling-acked"));
    assert.notEqual(canonicalHash, divergedHash, "fixture sanity: the acknowledged file must actually diverge from canonical");

    const exceptions = [
      { file: "packages/sibling-acked/src/internal/peer-version.ts", acknowledgedHash: divergedHash, reason: "known, tracked divergence used only by this test suite", issue: 1 },
    ];
    const result = await run({ repoRoot: root, exceptions });
    assert.equal(result.verdict, "satisfied", `expected acknowledged divergence to pass, got: ${JSON.stringify(result.reasons)}`);
    const acked = result.files.find((f) => f.file === "packages/sibling-acked/src/internal/peer-version.ts");
    assert.equal(acked.verdict, "acknowledged");
    assert.equal(acked.issue, 1);
  });
});

test("NOT A GENERAL AMNESTY: a THIRD state in the acknowledged file (neither canonical nor the acknowledged hash) still fails loudly", async () => {
  await withRepoFixture(async (root) => {
    buildExceptionFixtureFiles(root);
    const divergedHash = hashOf(normalize(BODY_B_DIVERGED, "@scope/sibling-acked"));
    const exceptions = [
      { file: "packages/sibling-acked/src/internal/peer-version.ts", acknowledgedHash: divergedHash, reason: "known, tracked divergence used only by this test suite", issue: 1 },
    ];

    // Mutate the acknowledged file to a THIRD body — not canonical, not the
    // acknowledged divergence. A file-path-only exception would wrongly pass
    // this; a hash-pinned one must not.
    const THIRD_BODY = BODY_B_DIVERGED.replace("could not verify", "COULD NOT VERIFY AT ALL");
    writePeerVersionPackage(root, "sibling-acked", "internal/peer-version.ts", THIRD_BODY);

    const result = await run({ repoRoot: root, exceptions });
    assert.equal(result.verdict, "violated", "a new divergence not covered by the pinned exception must still fail");
    const entry = result.files.find((f) => f.file === "packages/sibling-acked/src/internal/peer-version.ts");
    assert.equal(entry.verdict, "violated");
    assert.ok(
      result.reasons.some((r) => r.includes("sibling-acked") && r.includes("does not cover this")),
      `expected a reason explaining the exception does not cover this new state, got: ${result.reasons.join(" | ")}`,
    );
  });
});

test("STALE EXCEPTION: once the acknowledged file matches canonical, the acknowledgement itself becomes the failure", async () => {
  await withRepoFixture(async (root) => {
    buildExceptionFixtureFiles(root);
    const divergedHash = hashOf(normalize(BODY_B_DIVERGED, "@scope/sibling-acked"));
    const exceptions = [
      { file: "packages/sibling-acked/src/internal/peer-version.ts", acknowledgedHash: divergedHash, reason: "known, tracked divergence used only by this test suite", issue: 1 },
    ];

    // PASS 1: the divergence is still real — acknowledged, satisfied overall.
    const beforeFix = await run({ repoRoot: root, exceptions });
    assert.equal(beforeFix.verdict, "satisfied");

    // Bring the file into line with canonical (the real-world equivalent of
    // landing the #847 port) — SAME exceptions array, unmodified.
    writePeerVersionPackage(root, "sibling-acked", "internal/peer-version.ts", BODY_A);
    const afterFix = await run({ repoRoot: root, exceptions });
    assert.equal(afterFix.verdict, "violated", "an exception that has outlived its reason must fail, not silently keep passing");
    assert.ok(
      afterFix.reasons.some((r) => r.includes("STALE") && r.includes("issue #1")),
      `expected a stale-exception finding, got: ${afterFix.reasons.join(" | ")}`,
    );
    const entry = afterFix.files.find((f) => f.file === "packages/sibling-acked/src/internal/peer-version.ts");
    assert.equal(entry.verdict, "stale-exception");
  });
});

test("a divergence in a file NOT named by any exception still fails — the exception is scoped, not blanket", async () => {
  await withRepoFixture(async (root) => {
    buildExceptionFixtureFiles(root);
    writePeerVersionPackage(root, "unrelated-sibling", "internal/peer-version.ts", BODY_B_DIVERGED);
    const divergedHash = hashOf(normalize(BODY_B_DIVERGED, "@scope/sibling-acked"));
    const exceptions = [
      { file: "packages/sibling-acked/src/internal/peer-version.ts", acknowledgedHash: divergedHash, reason: "known, tracked divergence used only by this test suite", issue: 1 },
    ];
    const result = await run({ repoRoot: root, exceptions });
    assert.equal(result.verdict, "violated");
    assert.ok(result.reasons.some((r) => r.includes("unrelated-sibling")), "the unacknowledged sibling's divergence must be reported");
    assert.ok(!result.reasons.some((r) => r.includes("sibling-acked:")), "the acknowledged file must not be reported as a plain violation");
  });
});

test("MALFORMED EXCEPTION VALIDATION: missing reason, missing issue, missing acknowledgedHash, and unknown file all fail closed", async () => {
  await withRepoFixture(async (root) => {
    buildExceptionFixtureFiles(root);
    const target = "packages/sibling-acked/src/internal/peer-version.ts";

    const noReason = await run({ repoRoot: root, exceptions: [{ file: target, acknowledgedHash: "x", issue: 1 }] });
    assert.equal(noReason.verdict, "violated");
    assert.ok(noReason.reasons.some((r) => r.includes("reason of at least 20 characters")));

    const noIssue = await run({ repoRoot: root, exceptions: [{ file: target, acknowledgedHash: "x", reason: "a reason at least twenty characters long" }] });
    assert.equal(noIssue.verdict, "violated");
    assert.ok(noIssue.reasons.some((r) => r.includes("integer `issue`")));

    const noHash = await run({ repoRoot: root, exceptions: [{ file: target, reason: "a reason at least twenty characters long", issue: 1 }] });
    assert.equal(noHash.verdict, "violated");
    assert.ok(noHash.reasons.some((r) => r.includes("acknowledgedHash")));

    const unknownFile = await run({
      repoRoot: root,
      exceptions: [{ file: "packages/does-not-exist/src/internal/peer-version.ts", acknowledgedHash: "x", reason: "a reason at least twenty characters long", issue: 1 }],
    });
    assert.equal(unknownFile.verdict, "violated");
    assert.ok(unknownFile.reasons.some((r) => r.includes("was not discovered")));
  });
});

// --- The REAL ACKNOWLEDGED_EXCEPTIONS roster, validated as data ---

test("REAL ROSTER: ACKNOWLEDGED_EXCEPTIONS is empty now that #847 closed the butler/keeper gap, and the real tree is satisfied outright", async () => {
  // #847 ported the #389 fix into butler and keeper, so their exception entries are now STALE by
  // this gate's own rule (see the module header's "THREE OUTCOMES") and had to be removed rather
  // than left in place. An empty roster here is the expected end state, not an oversight.
  assert.equal(ACKNOWLEDGED_EXCEPTIONS.length, 0, "expected no acknowledged exceptions now that #847 is closed");
  const result = await run({ repoRoot: REPO_ROOT });
  assert.equal(result.verdict, "satisfied", `real tree should be satisfied outright, with no acknowledged exceptions needed, got: ${JSON.stringify(result.reasons)}`);
  const ackedFiles = result.files.filter((f) => f.verdict === "acknowledged").map((f) => f.file).sort();
  assert.deepEqual(ackedFiles, []);
});
