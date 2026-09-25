// candidate-qualification-shard — the pure partition logic behind
// check-candidate-qualification.mjs's `--shard-index`/`--shard-count`
// (#1257).
//
// WHY THIS IS ITS OWN FILE
// ------------------------
// scripts/check-candidate-qualification.mjs is a script, not a library: its
// top level reads governance/release-qualifications/*.json and
// package-scope.json off disk, validates them, and can call process.exit --
// all as a side effect of being imported, since it has no `main()` guard
// (unlike scripts/collect-review-evidence.mjs, which does). Importing it
// directly from a test would run the whole gate. This file holds only the
// two pure decisions that logic needs -- parsing the two shard flags, and
// deciding whether one record's index belongs to this run -- so they can be
// tested (scripts/lib/candidate-qualification-shard.test.mjs) without
// executing anything else.
//
// WHY A RECORD NOT IN THIS SHARD IS STILL "THIS RUN'S TO SEE", JUST NOT
// "THIS RUN'S TO RE-DERIVE"
// -----------------------------------------------------------------------
// check-candidate-qualification.mjs's real cost is per-record -- each
// record's own validateRetainedCandidateQualification call does its own
// `git archive` / `npm pack --dry-run` / `git log --full-history` work
// (scripts/lib/candidate-qualification.mjs), which is what "serial over
// packages, ~16 minutes" (#1257) measured. Everything ELSE the script does
// -- cohort/quarantine/publication consistency, the sealed-record-set check,
// prepublication-tail chaining -- reads the FULL set of records together and
// does not scale with record count the way the per-record loop does, so it
// is cheap enough to repeat, unsharded, in every shard. Splitting only the
// per-record loop, while every shard still sees every record's path (just
// not re-deriving records outside its own assignment -- see
// assignedToShard's own doc comment), is what makes the split correct
// rather than merely fast: as long as the partition below is exhaustive and
// every shard in the CI matrix actually runs and passes, every record really
// was independently, actually validated by exactly one shard.
export function resolveShardArgs(argv) {
  const shardIndexIdx = argv.indexOf("--shard-index");
  const shardCountIdx = argv.indexOf("--shard-count");
  if (shardIndexIdx === -1 && shardCountIdx === -1) return { shard: null };
  if (shardIndexIdx === -1 || shardCountIdx === -1) {
    return { error: "--shard-index and --shard-count must both be given, or neither" };
  }
  const shardIndexRaw = argv[shardIndexIdx + 1];
  const shardCountRaw = argv[shardCountIdx + 1];
  const shardIndex = Number(shardIndexRaw);
  const shardCount = Number(shardCountRaw);
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
    return {
      error: `--shard-index/--shard-count must be integers with 0 <= shard-index < shard-count (got ${JSON.stringify(shardIndexRaw)}/${JSON.stringify(shardCountRaw)})`,
    };
  }
  return { shard: { shardIndex, shardCount } };
}

/**
 * Whether the record at this (stable, sorted-path) index is THIS run's own
 * responsibility to actually, really validate. With no shard given (the
 * default, unsharded invocation -- `npm run check:candidate-qualification`),
 * every record belongs to the one and only run, so behaviour is unchanged.
 * The partition (`index % shardCount === shardIndex`) is deterministic and
 * exhaustive across `0..shardCount-1`: every non-negative index is assigned
 * to exactly one shard.
 */
export function assignedToShard(recordIndex, shard) {
  if (!shard) return true;
  return recordIndex % shard.shardCount === shard.shardIndex;
}

// --package <key> [--allow-missing-record] -- the publish-time selection.
//
// publish.yml's `qualify` job used to run this script UNSCOPED: every
// retained record re-derived from git history, ~25 minutes per dispatch
// (writer run 36038887231: 18:09:03 -> 18:34:27), to re-prove on a
// merge-queue commit what the `candidate qualification records` shards
// (ci.yml, `merge_group`, fanned in to the required `build and test`) had
// already proved, on this commit or its nearest non-prose ancestor.
// Nothing in that walk depends on the dispatched package, the dispatch
// input, or the time of the run: its inputs are the git history at HEAD,
// the tracked tree, and the git/npm toolchain. `--package` keeps the one
// part that IS about this publication -- the dispatched package's own
// current-version record, re-derived in full on the pinned publish runtime
// -- and, like a shard, counts every other record as present-and-validated
// for the cross-record checks, which still run in full.
//
// A missing record for that version is refused (exit 1) unless
// `--allow-missing-record` is given. The workflow passes it only on a
// `dry_run: true` dispatch, because a dry run is how a new version's record
// gets produced in the first place (the #777 regression the discover
// preflight's own comment describes).
//
// `--package` and the shard flags are mutually exclusive: a shard is CI's
// partition of the whole set, `--package` is one record out of it, and a
// combination has no meaning either caller needs.
const PACKAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALUE_FLAGS = new Set(["--shard-index", "--shard-count", "--package"]);
const BOOLEAN_FLAGS = new Set(["--allow-missing-record"]);

/**
 * The first argument that is neither one of this script's flags nor the
 * value directly after a value-taking flag, or null. The equals form
 * (`--package=writer`) is deliberately not a flag: accepting only one
 * spelling keeps every caller's invocation greppable, and refusing the other
 * means it can never be silently ignored into a full, unscoped walk. A
 * missing or malformed VALUE is left to resolveShardArgs/resolvePackageArgs.
 */
export function findUnrecognisedArgument(argv) {
  for (let index = 0; index < argv.length; index++) {
    if (VALUE_FLAGS.has(argv[index])) { index++; continue; }
    if (BOOLEAN_FLAGS.has(argv[index])) continue;
    return argv[index];
  }
  return null;
}
export function resolvePackageArgs(argv) {
  const packageIdx = argv.indexOf("--package");
  const allowMissingRecord = argv.includes("--allow-missing-record");
  if (packageIdx === -1) {
    if (allowMissingRecord) return { error: "--allow-missing-record is only meaningful with --package" };
    return { packageScope: null };
  }
  if (argv.lastIndexOf("--package") !== packageIdx) return { error: "--package may be given only once" };
  if (argv.includes("--shard-index") || argv.includes("--shard-count")) {
    return { error: "--package and --shard-index/--shard-count are mutually exclusive" };
  }
  const packageKey = argv[packageIdx + 1];
  if (typeof packageKey !== "string" || !PACKAGE_KEY.test(packageKey)) {
    return { error: `--package must name a package directory key matching ${PACKAGE_KEY} (got ${JSON.stringify(packageKey ?? null)})` };
  }
  return { packageScope: { packageKey, allowMissingRecord } };
}

/**
 * Whether the record at `path` (sorted index `recordIndex`) is THIS run's to
 * re-derive: its shard's (see assignedToShard) and, under `--package`, the
 * dispatched package's own current-version record path and nothing else.
 */
export function selectedForRederivation(recordIndex, path, { shard = null, packageRecordPath = null } = {}) {
  if (!assignedToShard(recordIndex, shard)) return false;
  return packageRecordPath === null || path === packageRecordPath;
}
