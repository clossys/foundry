#!/usr/bin/env node
// Atomic structured setter for Decision 18 W1D. It updates only package
// manifests, the workspace lock, release catalogue, and (last) the single
// scope declaration. Prose/current imports and exact historical-reference
// inventory remain review-owned work in the same W1D change; this command
// never guesses which prose is history.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlanAtomically, loadTransitionPolicy, planIdentityTransition } from "./lib/package-identity-transition.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const policy = loadTransitionPolicy(join(root, "governance", "package-identity-transition.json"));
const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0] !== "--to-candidate") {
  console.error("usage: node scripts/set-package-identity.mjs --to-candidate");
  process.exit(2);
}

try {
  const changes = planIdentityTransition({ root, policy, readFile: readFileSync });
  applyPlanAtomically(changes, (path, bytes) => writeFileSync(path, bytes));
  if (changes.length === 0) console.log("package identity: already in the complete candidate structured state");
  else {
    console.log(`package identity: wrote ${changes.length} structured file(s); complete the reviewed live-reference/history inventory before committing W1D:`);
    for (const change of changes) console.log(`  ${relative(root, change.path)}`);
  }
} catch (error) {
  console.error(`set-package-identity: ${error.message}`);
  process.exit(1);
}
