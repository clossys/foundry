#!/usr/bin/env node
// select-unqualified-packages — which non-private packages on the active
// release target have NO retained qualification record for their current
// version, and would therefore benefit from an automatic qualify dispatch?
//
//   node scripts/select-unqualified-packages.mjs [--json]
//
// Exit 0 on a completed selection (even an empty one). Exit 1 if the
// registry or the release catalogue could not be resolved at all (the same
// failure scripts/plan-qualified-publish-set.mjs itself reports, since this
// reuses that script's own pipeline).
//
// WHY THIS EXISTS (issue #1256)
// -------------------------------
// .github/workflows/auto-qualify.yml runs this on every push to main and
// dispatches .github/workflows/qualify-candidate.yml once per package this
// prints, so a merged version bump gets its qualification record produced
// automatically instead of waiting for a human to notice and run
// `gh workflow run qualify-candidate.yml -f package=<pkg>` by hand.
//
// WHY "missing" ONLY, NEVER "stale"
// ------------------------------------
// scripts/plan-qualified-publish-set.mjs's own classifyPackagesForPublish()
// already distinguishes "qualification-record-missing" from
// "qualification-record-stale" as different, non-overlapping reasons (see
// that script's own header) -- the fix for each is different. A missing
// record can be produced by qualifying the CURRENT candidate as-is. A stale
// record means the package's tree already moved past what was retained for
// this version (docs/LIFECYCLE.md's "once retained, any change needs a new
// version" rule, from the @clossys/architect@0.1.7 incident) -- dispatching
// qualify-candidate.yml again for the SAME version would not fix that, it
// would just fail generate-qualification-record.mjs's own no-overwrite
// refusal (or, worse, prove nothing meaningful if it somehow didn't). Only
// a NEW version fixes a stale record, which is exactly what #1255's release
// PR produces -- this script deliberately leaves that case to a human (or a
// future scripts/check-release-pr-shape.mjs-adjacent gate), not to an
// automatic re-dispatch loop.
//
// This invents no new selection or qualification-presence logic of its own
// -- it is a thin filter over plan-qualified-publish-set.mjs's own report,
// the same shared eligibility computation scripts/publish-qualified-set.mjs
// already trusts.
//
// Design: https://github.com/clossys/foundry/issues/1256#issuecomment-5790113827
import { fileURLToPath } from "node:url";
import { planQualifiedPublishSet } from "./plan-qualified-publish-set.mjs";

function die(message, code = 1) {
  console.error(`select-unqualified-packages: ${message}`);
  process.exit(code);
}

/** Filters plan-qualified-publish-set.mjs's own report down to packages with a genuinely MISSING (never stale/indeterminate) qualification record. Pure, so it is testable with a hand-built report. */
export function selectMissingQualification(report) {
  return report.filter((row) => row.status === "qualification-record-missing").map((row) => ({ package: row.package, name: row.name, version: row.version }));
}

/** The full pipeline: reuses planQualifiedPublishSet()'s own registry probe and qualification-presence join, then filters. Throws exactly what that function throws on a fatal condition. */
export async function selectUnqualifiedPackages({ fetchImpl = fetch } = {}) {
  const { report } = await planQualifiedPublishSet({ fetchImpl });
  return selectMissingQualification(report);
}

const USAGE = `Usage: node scripts/select-unqualified-packages.mjs [--json]

  (no flag)  one "<package> -- <name>@<version>" line per package with no
             retained qualification record for its current version.
  --json     the same selection as JSON ({ package, name, version }[]).
  --help     print this message and exit 0.
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const json = argv.includes("--json");

  let selected;
  try {
    selected = await selectUnqualifiedPackages();
  } catch (error) {
    die(error.message);
    return;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(selected)}\n`);
  } else if (selected.length === 0) {
    console.log("select-unqualified-packages: every non-private package on the active release target has a retained qualification record.");
  } else {
    for (const s of selected) console.log(`${s.package} -- ${s.name}@${s.version}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
