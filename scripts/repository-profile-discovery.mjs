#!/usr/bin/env node
// repository-profile-discovery — prints the `--discovery` JSON that
// packages/controller's `repository-profile-check` CLI
// (`dist/repository/run-bin.js`) needs to evaluate THIS repository's own
// `governance/repository-profile.json` against real, observed facts.
//
//   node scripts/repository-profile-discovery.mjs > discovery.json
//   node packages/controller/dist/repository/run-bin.js . --discovery discovery.json
//
// WHY THIS EXISTS
// ----------------
// `repository-profile-check` performs no discovery of its own by design
// (see `packages/controller/src/repository/run-cli.ts`'s own header): every
// caller assembles its own `{ requirementObservations, rootObservedEntries,
// customAxes }` and hands it over as one JSON file. Omitting `--discovery`
// entirely is the same as `{}` -- every declared requirement and root entry
// then folds to `indeterminate`, which is what this repository's CLI
// invocation reported before this script existed (issue #414: a bin entry
// that ships is not the same as a bin entry that has ever been fed real
// input).
//
// `scripts/observation-bundle.mjs` already built this exact discovery to
// evaluate the SAME declaration in-process, for the observation bundle it
// publishes on push to main (`buildRepositoryProfileDiscovery`). This
// script is the second consumer of that one implementation, not a second
// copy of it -- see that function's own header comment.

import { buildRepositoryProfileDiscovery } from "./observation-bundle.mjs";

async function main() {
  const discovery = await buildRepositoryProfileDiscovery();
  process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
