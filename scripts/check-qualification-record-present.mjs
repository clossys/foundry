#!/usr/bin/env node
// check-qualification-record-present — does the candidate this run would
// publish already have its retained qualification record on the tree, and
// does that record still describe the candidate as it stands right now?
//
//   node scripts/check-qualification-record-present.mjs --package <key>
//
// Exit 0 = the record exists and still matches. Exit 1 = it does not exist,
// or it exists but no longer matches (stale). Exit 2 = the question could
// not be answered (an unreadable manifest or policy), the same three-way
// split every gate in this repo uses.
//
// WHY THIS EXISTS
// ---------------
// Publishing requires three things in order: qualify the candidate, RETAIN
// its record on the default branch, then publish. `validate-candidate-publish`
// enforces that join — but it runs inside the `publish` job, which sits behind
// the `npm-publish` environment. By the time it spoke, a human had already
// approved the deployment, and a missing record surfaced as a raw ENOENT from
// `lstat` rather than a sentence saying what was wrong (issue #769).
//
// The cost of that ordering is not the wasted minutes, it is the spent
// approval: the operator must be asked a second time for the same release.
// This check answers the identical question from `discover`, which runs
// before the environment gate, so the run stops while it is still free.
//
// It deliberately duplicates no logic: the record path comes from
// `qualificationPath`, the same function the publish-time validator uses, so
// the two cannot disagree about where a record lives. Likewise, "does the
// record still match?" reuses `currentQualificationJoins()` — the same
// function `generate-qualification-record.mjs` calls to corroborate its own
// `reviewedCommit` — rather than inventing a second notion of freshness.
//
// A record binds a candidate on TWO axes, and both are checked because
// neither alone covers what actually ships: `candidate.packageManifestSha256`
// is a digest derived from `package.json` (the whole file's bytes under
// schema 2, only the fields that ship under schema 3 — issue #879), while
// `candidate.packageTreeSha1` is derived from the package directory (the
// whole git tree under schema 2, the `npm pack`-selected file set under
// schema 3). Neither axis, under EITHER schema, can see `dist/`: it is
// gitignored, so nothing computed from git content — `git rev-parse`, same as
// a schema-3 `git archive` — ever sees it, at any commit. A real publish
// dispatch of `@clossys/writer@0.3.7` measured this directly: its (schema-2)
// `packageTreeSha1` matched `git rev-parse HEAD:packages/writer` exactly, yet
// a freshly packed tarball from that same tree did not match the record's
// `candidate.tarball.sha256` — because `dist` ships first in writer's
// `files` and had drifted with no git-visible cause. That mismatch is
// real and was caught, just not here: `validate-candidate-publish.mjs`
// independently reverifies the exact tarball bytes immediately before
// upload, and refused the publish before anything reached the registry. This
// check's two axes are a cheap, git-only, PR-time early warning for what they
// CAN see — a devDependency bump or a tracked-file edit moving one axis
// without the other, exactly as designed below — not a claim to catch
// everything a build can change. A later merge to an unrelated file in that
// package can move either digest without ever touching the record itself
// (designer 0.3.1 qualified at one manifest digest, then a routine dependabot
// bump landed 29 minutes later and changed it — the publish failed hours
// afterwards with a raw ENOENT, after a human approval had already been
// spent). A real case measured on this repository's own tree: `@clossys/starter`
// held a record whose `packageManifestSha256` still matched — `package.json`
// was untouched — while its `packageTreeSha1` had drifted, because something
// else inside `packages/starter/` had changed. A manifest-only comparison
// would have reported that as `present` and let it reach the publish job on a
// spent approval. Comparing only `packageTreeSha1` and dropping the manifest
// digest would not be safe either: nothing about this check should silently
// stop noticing a `package.json` edit just because the tree digest happens to
// be the coarser of the two. So both are compared, and a `stale` result says
// which one (or both) diverged, because "stale in the tree but not the
// manifest" and "stale in both" are different diagnoses for the operator.
// Nothing short of recomputing the join would notice either kind of drift.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentQualificationJoins, qualificationPath } from "./lib/candidate-qualification.mjs";

export function qualificationRecordPresence({ root = process.cwd(), packageKey } = {}) {
  if (typeof packageKey !== "string" || packageKey === "") return { state: "indeterminate", reason: "no package key was given" };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(root, `packages/${packageKey}/package.json`), "utf8"));
  } catch {
    return { state: "indeterminate", reason: `packages/${packageKey}/package.json could not be read` };
  }
  const candidate = { name: manifest?.name, version: manifest?.version };
  if (typeof candidate.name !== "string" || typeof candidate.version !== "string") {
    return { state: "indeterminate", reason: `packages/${packageKey}/package.json declares no name/version pair` };
  }
  return qualificationRecordPresenceForCandidate({ root, candidate });
}

// The candidate-parameterized core of qualificationRecordPresence() above,
// split out so a caller that already HAS a {name, version} pair in hand —
// scripts/check-qualification-record-required.mjs asking about a version an
// acknowledged exception names, which may not be the version the manifest
// currently declares (the manifest can have moved on since the exception
// was written) — can ask the identical present/missing/stale question
// without first reading it back out of a package.json on disk. This is the
// same "one join, two callers" discipline this script's own header comment
// describes for qualificationPath/currentQualificationJoins: the exception
// mechanism must not invent a second, looser notion of "does the record for
// THIS candidate still hold."
export function qualificationRecordPresenceForCandidate({ root = process.cwd(), candidate } = {}) {
  if (typeof candidate?.name !== "string" || typeof candidate?.version !== "string") {
    return { state: "indeterminate", reason: "no candidate {name, version} pair was given" };
  }
  let path;
  try {
    path = qualificationPath(root, candidate);
  } catch (error) {
    return { state: "indeterminate", reason: error instanceof Error ? error.message : "qualification path could not be derived" };
  }
  if (!existsSync(resolve(root, path))) return { state: "missing", candidate, path };

  let record;
  try {
    record = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    return { state: "indeterminate", reason: `${path} could not be read as JSON: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  const recordedManifestDigest = record?.candidate?.packageManifestSha256;
  if (typeof recordedManifestDigest !== "string" || recordedManifestDigest === "") {
    return { state: "indeterminate", reason: `${path} carries no candidate.packageManifestSha256 to join against` };
  }
  const recordedTreeDigest = record?.candidate?.packageTreeSha1;
  if (typeof recordedTreeDigest !== "string" || recordedTreeDigest === "") {
    return { state: "indeterminate", reason: `${path} carries no candidate.packageTreeSha1 to join against` };
  }

  // The retained record's own `schemaVersion` selects which formula "current"
  // is recomputed with — schema 2 (legacy, whole-manifest/whole-tree) or
  // schema 3 (artifact-scoped, issue #879). A schema-2 record is still
  // compared against a schema-2 recomputation, so this remains exactly as
  // sensitive to a devDependency-only or non-shipped-file change as it always
  // was; only a schema-3 record is immune to that class of change, because it
  // is qualifying an artifact-scoped digest in the first place.
  let current;
  try {
    current = currentQualificationJoins(root, candidate, "WORKTREE", { schemaVersion: record?.schemaVersion });
  } catch (error) {
    return { state: "indeterminate", reason: `current package digests could not be recomputed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  const currentManifestDigest = current.packageManifestSha256;
  const currentTreeDigest = current.packageTreeSha1;

  const staleFields = [];
  if (recordedManifestDigest !== currentManifestDigest) staleFields.push("packageManifestSha256");
  if (recordedTreeDigest !== currentTreeDigest) staleFields.push("packageTreeSha1");

  if (staleFields.length > 0) {
    return {
      state: "stale",
      candidate,
      path,
      staleFields,
      recordedManifestDigest,
      currentManifestDigest,
      recordedTreeDigest,
      currentTreeDigest,
    };
  }
  return { state: "present", candidate, path };
}

// Answers a DIFFERENT question from qualificationRecordPresenceForCandidate()
// above: not "does the record for this candidate still match what's on disk
// RIGHT NOW", but "was a qualification record ever retained for this EXACT
// package@version, full stop." The two diverge precisely when `candidate`
// names an OLD version the package has since moved past — which is exactly
// what a deferral names (issue #1187, item 4; four real cases the same
// night). qualificationRecordPresenceForCandidate() recomputes "current"
// digests from the live WORKTREE via currentQualificationJoins(), which is
// the right question for "is the candidate about to be published still
// good" but the wrong one for "was this historical version qualified": the
// package's package.json has long since bumped past that old version, so
// its worktree digests describe a DIFFERENT candidate entirely, and the
// comparison reports "stale" — never "present" — for every deferred version
// except the one that happens to still equal the package's current version.
// That is the exact gap that let a satisfied deferral for an old version
// sit unremoved: scripts/check-qualification-record-required.mjs's
// checkStaleDeferrals() re-checks EVERY declared deferral, independent of
// whether its version is part of the current diff, but until this function
// existed it asked qualificationRecordPresenceForCandidate() the wrong
// question and could only ever answer "present" for the current version.
//
// The record for an old version does not need to be "still correct against
// today's tree" to prove the deferral is satisfied — it only needs to
// exist, at the expected path, and actually describe the deferral's own
// candidate name+version (guarding against a stray or misnamed file sitting
// at that path by coincidence). No WORKTREE recomputation is performed at
// all.
export function qualificationRecordRetainedForVersion({ root = process.cwd(), candidate } = {}) {
  if (typeof candidate?.name !== "string" || typeof candidate?.version !== "string") {
    return { state: "indeterminate", reason: "no candidate {name, version} pair was given" };
  }
  let path;
  try {
    path = qualificationPath(root, candidate);
  } catch (error) {
    return { state: "indeterminate", reason: error instanceof Error ? error.message : "qualification path could not be derived" };
  }
  if (!existsSync(resolve(root, path))) return { state: "missing", candidate, path };

  let record;
  try {
    record = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    return { state: "indeterminate", reason: `${path} could not be read as JSON: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  if (record?.candidate?.name !== candidate.name || record?.candidate?.version !== candidate.version) {
    return {
      state: "indeterminate",
      reason: `${path} exists but its own candidate (${record?.candidate?.name ?? "?"}@${record?.candidate?.version ?? "?"}) does not match ${candidate.name}@${candidate.version}`,
    };
  }
  return { state: "present", candidate, path };
}

if (process.argv[1] && process.argv[1].endsWith("check-qualification-record-present.mjs")) {
  const index = process.argv.indexOf("--package");
  const packageKey = index === -1 ? undefined : process.argv[index + 1];
  const result = qualificationRecordPresence({ packageKey });
  if (result.state === "indeterminate") {
    console.error(`QUALIFICATION RECORD INDETERMINATE — ${result.reason}`);
    process.exit(2);
  }
  if (result.state === "missing") {
    console.error(`QUALIFICATION RECORD MISSING — ${result.candidate.name}@${result.candidate.version} has no retained record at ${result.path}.`);
    console.error("Qualify the candidate and retain its record on the default branch before dispatching a publish.");
    console.error("Stopping here rather than inside the publish job, so the npm-publish approval is not spent on a run that cannot succeed.");
    process.exit(1);
  }
  if (result.state === "stale") {
    const diagnoses = [];
    if (result.staleFields.includes("packageManifestSha256")) {
      diagnoses.push(`its package.json has changed (recorded candidate.packageManifestSha256 ${result.recordedManifestDigest}, current ${result.currentManifestDigest})`);
    }
    if (result.staleFields.includes("packageTreeSha1")) {
      diagnoses.push(`its package directory has changed (recorded candidate.packageTreeSha1 ${result.recordedTreeDigest}, current ${result.currentTreeDigest})`);
    }
    console.error(`QUALIFICATION RECORD STALE — ${result.candidate.name}@${result.candidate.version} at ${result.path} was qualified against a candidate that has since changed: ${diagnoses.join("; ")}.`);
    console.error("Re-qualify the candidate and retain a fresh record before dispatching a publish — this one no longer describes it.");
    console.error("Stopping here rather than inside the publish job, so the npm-publish approval is not spent on a run that cannot succeed.");
    process.exit(1);
  }
  console.log(`QUALIFICATION RECORD PRESENT — ${result.candidate.name}@${result.candidate.version} at ${result.path}`);
}
