// release-pr-workflow-shape.test — textual regression coverage for
// .github/workflows/release-pr.yml itself (issue #1439, defects 2/3/4).
// These are the properties that can ONLY be checked by reading the real
// YAML the workflow ships, the same precedent
// scripts/apply-release-changesets.test.mjs's own "release-pr.yml stages
// docs/changelogs/" test already set -- a unit test of some extracted
// function cannot prove what the ACTUAL workflow step text says.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "release-pr.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

// ---------------------------------------------------------------- defect 1: the materials-manifest step

test("release-pr.yml delegates manifest.json to the tested write-release-pr-materials-manifest.mjs script, not an inline `node -e`", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /node scripts\/write-release-pr-materials-manifest\.mjs "\$MATERIALS_DIR" "\$branch" "\$GITHUB_BASE_REF_OR_DEFAULT" "\$labels"/);
  // The old inline destructure must not reappear.
  assert.doesNotMatch(workflow, /materialsDir, branchArg, baseArg, labelsArg/);
});

// ---------------------------------------------------------------- defect 2: label descriptions + hidden failures

// GitHub's label description limit (gh label create returns 422 above this).
const GITHUB_LABEL_DESCRIPTION_LIMIT = 100;

test("every `gh label create --description \"...\"` in release-pr.yml stays within GitHub's 100-character limit", () => {
  const workflow = readWorkflow();
  const descriptionMatches = [...workflow.matchAll(/--description "([^"]*)"/g)];
  assert.ok(descriptionMatches.length >= 2, "expected at least the release:weekly and release:out-of-band label descriptions");
  for (const [, description] of descriptionMatches) {
    assert.ok(
      description.length <= GITHUB_LABEL_DESCRIPTION_LIMIT,
      `label description is ${description.length} chars (limit ${GITHUB_LABEL_DESCRIPTION_LIMIT}): ${JSON.stringify(description)}`,
    );
  }
});

test("`gh label create` calls in release-pr.yml use --force (create-or-update) and do not hide a real failure behind `|| true`", () => {
  const lines = readWorkflow().split("\n");
  // Only real shell invocations (line begins, after indentation, with `gh
  // label create`) -- never the unrelated comment mentioning the same words
  // (`issues: write # gh label create, for the release:weekly / ... labels`).
  const invocationStarts = [];
  lines.forEach((line, i) => {
    if (/^\s*gh label create\b/.test(line)) invocationStarts.push(i);
  });
  assert.ok(invocationStarts.length >= 2, "expected at least two real `gh label create` shell invocations");

  for (const startIndex of invocationStarts) {
    // A YAML `run: |` block's shell line continuation (trailing `\`) --
    // gather every physical line this one statement actually spans.
    const statementLines = [lines[startIndex]];
    let i = startIndex;
    while (statementLines[statementLines.length - 1].trimEnd().endsWith("\\")) {
      i += 1;
      statementLines.push(lines[i]);
    }
    const statement = statementLines.join("\n");
    assert.match(statement, /--force\b/, `gh label create is not idempotent (--force) in:\n${statement}`);
    assert.doesNotMatch(statement, /\|\|\s*true/, `gh label create still swallows a real failure with "|| true" in:\n${statement}`);
    assert.doesNotMatch(statement, />\s*\/dev\/null/, `gh label create still discards its own error output in:\n${statement}`);
  }
});

// ---------------------------------------------------------------- defect 3: the pinned release runtime

test("release-pr.yml's job pins the same release runtime (24.19.0) qualify-candidate.yml and publish.yml pin, not Node 20", () => {
  const workflow = readWorkflow();
  const setupNodeBlocks = [...workflow.matchAll(/uses:\s*actions\/setup-node@[^\n]+\n\s*with:\n\s*node-version:\s*"?([\d.]+)"?/g)];
  assert.equal(setupNodeBlocks.length, 1, "expected exactly one actions/setup-node step in release-pr.yml");
  assert.equal(setupNodeBlocks[0][1], "24.19.0", "release-pr.yml's npm ci / npm install --package-lock-only must run on the same pinned npm the release commit is validated against elsewhere, or a different npm rewrites unrelated package-lock.json metadata (issue #1439, defect 3)");
});

// ---------------------------------------------------------------- defect 4: "Refs:", not "Ref:"

test("release-pr.yml writes \"Refs:\" (not \"Ref:\") in both the release commit message and the PR body -- verify-standards only accepts Refs:/Closes:/Work item:", () => {
  const workflow = readWorkflow();
  // A bare "Ref: #..." (singular, no "s") must not appear anywhere in the
  // generated commit-message or body-file construction.
  assert.doesNotMatch(workflow, /"Ref: #/);
  assert.match(workflow, /"Refs: #1255, #1187"/g);
  const refsCount = (workflow.match(/"Refs: #1255, #1187"/g) ?? []).length;
  assert.equal(refsCount, 2, "expected \"Refs: #1255, #1187\" in both the commit message and the PR body construction");
});
