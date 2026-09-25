#!/usr/bin/env node
// write-release-pr-materials-manifest — writes release-pr.yml's
// `release-pr-materials/manifest.json` (issue #1439, defect 1). Extracted
// out of that workflow's own inline `node -e` step so its argv handling is
// directly testable by a real test, rather than only exercisable by an
// actual GitHub Actions run -- which is exactly how this bug shipped
// unnoticed until the workflow's first real dispatch.
//
//   node scripts/write-release-pr-materials-manifest.mjs <materialsDir> <branch> <base> <labels>
//
// `labels` is a single comma-separated string (e.g. "release:weekly" or
// "release:weekly,release:out-of-band") -- release-pr.yml's own
// `labels=...` step output, passed straight through unsplit; this script is
// the only place that splits it.
//
// THE INCIDENT THIS FIXES (issue #1439, defect 1; run 36024191110, which
// produced #1438)
// -----------------------------------------------------------------------
// The step this replaced ran `node -e '...'` with FOUR positional arguments
// after the inline script -- but under `node -e`, argv[0] is the node
// binary itself and argv[1] is the FIRST argument after the -e script;
// there is no script-path slot the way there is for `node file.js`
// (argv[1] = the script's own path, argv[2] = the first real argument).
// Destructuring as `[, , materialsDir, branchArg, baseArg, labelsArg]` (two
// leading placeholders, as a `node file.js` caller would need) shifted
// every real value one slot to the right, so `labelsArg` read as
// `undefined` and the step crashed with `TypeError: Cannot read properties
// of undefined (reading 'split')` before writing anything -- manifest.json,
// and therefore the whole `release-pr-materials` artifact, was never
// produced. A plain `node scripts/<this file>.mjs <args...>` invocation (as
// the workflow now uses) does not have this off-by-one at all: argv.slice(2)
// is exactly the real arguments, the same convention every other script in
// this directory already uses.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pure: the manifest.json object this script writes, given already-parsed arguments. */
export function buildMaterialsManifest({ branch, base, labels }) {
  return {
    branch,
    base,
    title: "Release: apply pending changesets",
    labels: labels.split(","),
    bodyFile: "body.txt",
  };
}

function main() {
  const [materialsDir, branch, base, labels] = process.argv.slice(2);
  if (!materialsDir || !branch || !base || labels === undefined || labels === "") {
    console.error("write-release-pr-materials-manifest: usage: <materialsDir> <branch> <base> <labels>");
    process.exit(2);
  }
  const manifest = buildMaterialsManifest({ branch, base, labels });
  writeFileSync(join(materialsDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
