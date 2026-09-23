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
