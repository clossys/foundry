import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// check-workflow-references — a future `check:*` script added only to the
// local `npm run check` aggregate, and to no workflow, is exactly issue
// #414: this repository measured six job-shaped packages shipping eleven
// bin entry points with two ever invoked by a workflow, and separately
// found `check:neutrality` and `check:root-entry` sitting in `npm run
// check` with no workflow reference at all -- the structural half of
// publish safety, unenforced in CI, on a public repository, for a gate that
// existed and simply never ran. This test makes the SAME class of gap fail
// loudly the next time a `check:*` script is added without a workflow to
// run it, rather than being found again by hand.
//
// DETECTION IS DELIBERATELY SHALLOW: a `check:*` script's own npm name (the
// `npm run check:x` form some workflow steps use), OR any `scripts/*.mjs`
// file it invokes, OR any `packages/*/dist/*.js` compiled entry point it
// invokes (this repository's gates are invoked by dist path, not bin name —
// see AGENTS.md-adjacent memory on that trap, and `check:package-governance`
// / `check:repository-profile` below for the pattern) is searched for as a
// plain substring across every workflow file's raw text. This is a coarse
// net on purpose: it does not parse YAML `run:` blocks or shell, so it
// cannot verify a script is invoked CORRECTLY (right arguments, right job,
// right condition) — it can only catch total absence, the specific failure
// mode #414 found. A script referenced only in a comment would also pass;
// that false-negative is an accepted, documented trade for staying a few
// lines instead of a shell parser.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

const MJS_PATTERN = /scripts\/[A-Za-z0-9._-]+\.mjs\b/g;
const DIST_JS_PATTERN = /packages\/[A-Za-z0-9._/-]+\.js\b/g;

function candidateTokensFor(scriptName, scriptValue) {
  const tokens = new Set([scriptName]);
  for (const match of scriptValue.matchAll(MJS_PATTERN)) tokens.add(match[0]);
  for (const match of scriptValue.matchAll(DIST_JS_PATTERN)) tokens.add(match[0]);
  return tokens;
}

test("every check:* script in the root manifest is referenced by at least one workflow", () => {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const checkScripts = Object.entries(rootManifest.scripts ?? {}).filter(([name]) => name.startsWith("check:"));
  assert.ok(checkScripts.length > 0, "expected at least one check:* script in the root manifest — fixture drift?");

  const workflowFiles = readdirSync(workflowsDir).filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"));
  assert.ok(workflowFiles.length > 0, "expected at least one workflow file under .github/workflows");
  const workflowText = workflowFiles.map((file) => readFileSync(join(workflowsDir, file), "utf8")).join("\n");

  const unreferenced = checkScripts
    .filter(([name, value]) => {
      const tokens = candidateTokensFor(name, value);
      return ![...tokens].some((token) => workflowText.includes(token));
    })
    .map(([name]) => name);

  assert.deepEqual(
    unreferenced,
    [],
    `check:* script(s) in package.json with no workflow reference (npm run name, scripts/*.mjs, or packages/*/dist/*.js all absent from every .github/workflows/*.yml): ${unreferenced.join(", ")}. ` +
      "A script that is only ever in the local `npm run check` aggregate and never a workflow is a gate that never runs in CI (#414) — wire it into a workflow, or if it genuinely cannot run there, keep it out of `check:*` and document why.",
  );
});
