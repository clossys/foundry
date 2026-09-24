// mirror-parity.test.mjs — review #1413, reviewer B's non-blocking N1,
// promoted to a must-fix by the coordinator's round-1 list (item 6).
//
// evals/lib/scenario-runner.mjs tests scripts/lib/capability-catalogue.mjs
// (the repository-root MIRROR of packages/advisor/src/composition.ts), not
// the shipped, published Advisor package. The mirror's own header says
// "Keep both in step; a change to the composition rules here belongs in
// the gate's copy too, and vice versa" -- but nothing checked that
// `composeKitFromProblems` specifically (the one-primary guard, the
// problem-to-role mapping, and the first-engagement role cap) actually
// agrees between the two copies, over real input. This test closes that
// gap for exactly the inputs the eval scenarios use:
// `evals/scenarios/*.json`'s `confirmedProblems`, run through both
// implementations against the SAME real catalogue, asserting identical
// results.
//
// packages/advisor is NOT edited to make this possible, and this file does
// not live under packages/ (per review round 1's instructions). Instead:
//
//   - The mirror side imports scripts/lib/capability-catalogue.mjs
//     directly, same as evals/lib/scenario-runner.mjs -- no build needed.
//   - The shipped side needs packages/advisor's real, published
//     composition.ts. An existing parity test in that package,
//     catalogue-contract-shape.test.ts, imports it with no build step at
//     all, because it runs under vitest (a devDependency of
//     packages/advisor), which transpiles TypeScript on the fly. This test
//     runs under plain `node --test` from OUTSIDE packages/advisor, where
//     nothing transpiles TypeScript on import -- so, unlike that test, this
//     one imports the COMPILED packages/advisor/dist/composition.js
//     instead, exactly as this repository's own build-dependent gates
//     already do (see, for example, check:launcher-help and
//     check:locksmith-catalog in package.json, which invoke a package's
//     dist path after `npm run build`). packages/advisor/dist/ is
//     gitignored build output, not a source edit.
//
// THIS TEST IS NOT WIRED INTO check:evals, npm run check, or any workflow
// step -- unlike the rest of this harness, it needs a build, which would
// break check:evals's own "no build needed" property (see evals/README.md
// and scripts/check-evals.mjs's own header). That is also why this file
// lives in evals/manual/ next to model-in-the-loop-eval.mjs, rather than in
// evals/lib/ where check:evals's `node --test evals/lib/*.test.mjs` would
// pick it up automatically. Run it by hand, after building Advisor once:
//
//   npm run build --workspace=packages/advisor
//   node --test evals/manual/mirror-parity.test.mjs
//
// If packages/advisor has not been built, every test below is skipped
// (not failed) with a message naming the exact command above -- this test
// file must never force a build as a side effect of an ordinary
// `node --test evals/lib/*.test.mjs` run, which check:evals does wire in.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildCapabilityCatalogue, composeKitFromProblems as mirrorComposeKitFromProblems } from "../../scripts/lib/capability-catalogue.mjs";
import { loadScenarios } from "../lib/scenario-runner.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shippedCompositionPath = join(repoRoot, "packages", "advisor", "dist", "composition.js");
const shippedBuilt = existsSync(shippedCompositionPath);

if (!shippedBuilt) {
  test(
    "mirror parity (SKIPPED: packages/advisor is not built)",
    { skip: "run `npm run build --workspace=packages/advisor` first, then re-run node --test evals/lib/mirror-parity.test.mjs" },
    () => {},
  );
} else {
  const { composeKitFromProblems: shippedComposeKitFromProblems } = await import(shippedCompositionPath);
  const catalogue = buildCapabilityCatalogue(repoRoot);
  const scenarios = loadScenarios();

  for (const scenario of scenarios) {
    test(`mirror parity: ${scenario.id}`, () => {
      const mirrorResult = mirrorComposeKitFromProblems({ confirmedProblems: scenario.confirmedProblems, catalogue });
      const shippedResult = shippedComposeKitFromProblems({ confirmedProblems: scenario.confirmedProblems, catalogue });
      assert.deepEqual(
        JSON.parse(JSON.stringify(shippedResult)),
        JSON.parse(JSON.stringify(mirrorResult)),
        `scripts/lib/capability-catalogue.mjs and packages/advisor/src/composition.ts disagree on scenario "${scenario.id}"`,
      );
    });
  }
}
