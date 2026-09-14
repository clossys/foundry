import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { normalize, discoverPeerVersionFiles, run, EXIT_CODES, CANONICAL_PATH } from "./check-peer-version-assert.mjs";

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
    // so run()'s hardcoded CANONICAL_PATH resolves inside this temp root.
    writePeerVersionPackage(root, "bouncer", "internal/peer-version.ts", BODY_A);
    writePeerVersionPackage(root, "sibling-agrees", "internal/peer-version.ts", BODY_A_REWRAPPED);
    writePeerVersionPackage(root, "sibling-diverges", "web/internal/peer-version.ts", BODY_B_DIVERGED);

    const divergedResult = await run({ repoRoot: root });
    assert.equal(divergedResult.verdict, "violated", "PASS 1 (planted divergence): the gate must FAIL here");
    assert.ok(divergedResult.reasons.some((r) => r.includes("sibling-diverges")));
    assert.ok(!divergedResult.reasons.some((r) => r.includes("sibling-agrees")), "the agreeing sibling must not be reported as diverging");

    // Mutate the SAME fixture back into agreement and re-run — both directions verified.
    writePeerVersionPackage(root, "sibling-diverges", "web/internal/peer-version.ts", BODY_A);
    const fixedResult = await run({ repoRoot: root });
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

test("REAL TREE: reports the actual current divergence — butler and keeper violate canonical, controller/designer/publisher agree", async () => {
  const result = await run({ repoRoot: REPO_ROOT });
  assert.equal(result.files.length, 6, `expected 6 real peer-version.ts files (nine minus the three retired in #536), found ${result.files.length}`);
  assert.equal(result.verdict, "violated");

  const byFile = Object.fromEntries(result.files.map((f) => [f.file, f.verdict]));
  assert.equal(byFile["packages/butler/src/web/internal/peer-version.ts"], "violated");
  assert.equal(byFile["packages/keeper/src/web/internal/peer-version.ts"], "violated");
  assert.equal(byFile["packages/controller/src/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/designer/src/internal/peer-version.ts"], "satisfied");
  assert.equal(byFile["packages/publisher/src/internal/peer-version.ts"], "satisfied");
});
