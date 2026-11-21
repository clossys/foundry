/**
 * The CONTAM-U3 codemod: nothing is left to rewrite in the five agent packages, and its guards name what no rule
 * may rewrite (CONTAM-U3 fix r1: a templated `node packages/${...}` command line).
 *
 *   node --test scripts/codemod-contam-u3.test.mjs
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { rewriteText, run } from "./codemod-contam-u3.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATED = "  const usage = `Usage: node packages/${agent}/recipes/stage-check.mjs brief|diverge|draft <slot> <file> [--root <dir>]\\n`;";

test("the five agent packages hold no recipe command line left to rewrite", () => {
  const result = run(REPO, { check: true });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.text, "codemod-contam-u3 --check: nothing to rewrite\n");
});

test("a templated stage check command in the agent's shared stage check becomes the recipe verb", () => {
  for (const rel of ["recipes/stage-core.mjs", "recipes/stage-check.mjs"]) {
    const result = rewriteText(REPO, "writer", rel, TEMPLATED);
    assert.deepEqual(result.failures, []);
    assert.equal(result.text, "  const usage = `Usage: clossys recipe check <recipe-id> brief|diverge|draft <slot> <file> [--root <dir>]\\n`;");
  }
});

test("a templated command line no rule rewrites fails, naming the file and line", () => {
  const outside = rewriteText(REPO, "writer", "recipes/create.copy/craft.md", "one\nRun `node packages/${agent}/recipes/stage-check.mjs brief s b.json`.");
  assert.equal(outside.text, "one\nRun `node packages/${agent}/recipes/stage-check.mjs brief s b.json`.");
  assert.ok(outside.failures.some(line => line.startsWith("packages/writer/recipes/create.copy/craft.md:2: packages/${agent}/recipes/stage-check.mjs is a templated command line outside the agent's shared stage check")), outside.failures.join("\n"));
  assert.ok(outside.failures.some(line => line.startsWith("packages/writer/recipes/create.copy/craft.md:2: packages/${agent}/recipes/stage-check.mjs is a templated command line no rule rewrites")), outside.failures.join("\n"));
  const other = rewriteText(REPO, "director", "recipes/stage-core.mjs", "const run = `node --test packages/${agent}/recipes/recipes.test.mjs`;");
  assert.deepEqual(other.failures, ["packages/director/recipes/stage-core.mjs:1: packages/${agent}/recipes/recipes.test.mjs`; is a templated command line no rule rewrites"]);
});
