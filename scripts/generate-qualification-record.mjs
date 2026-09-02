#!/usr/bin/env node
// Generate a retained pre-publication qualification record
// (`governance/release-qualifications/<recordStem>-<version>.json`) from the
// artifact of a successful `qualify` CI job: its `candidate.tgz` and its
// `transcript.json`.
//
// Usage:
//   node scripts/generate-qualification-record.mjs \
//     --package <policy-key> --tarball <candidate.tgz> --transcript <transcript.json> \
//     --review-reference <string> [--out <path>]
//
// Exit codes (the convention used across this repository's gates):
//   0  the record was derived and written.
//   1  the record could not be produced from this input — the tarball,
//      transcript, package key, policy and/or the current git HEAD disagree
//      with one another, or the target path already holds a file.
//   2  indeterminate — an input could not be read or parsed, the release
//      qualification policy is missing or invalid for this package key, or a
//      required git/policy lookup itself failed. Nothing was concluded about
//      the candidate one way or the other.
//
// ---------------------------------------------------------------------------
// What is DERIVED (computed from the real inputs, never hand-copied):
// ---------------------------------------------------------------------------
//   * `transcript`                       — the `--transcript` file, parsed
//                                           and re-embedded verbatim (same
//                                           keys, same values, same order).
//   * `candidate.name` / `.version`      — read from `package/package.json`
//                                           inside the real `--tarball`.
//   * `candidate.tarball.{sha1,sha256,sha512}`
//                                         — computed from the real tarball
//                                           bytes on disk.
//   * `candidate.packageTreeSha1`,
//     `candidate.packageManifestSha256`,
//     `candidate.policySha256`,
//     `candidate.adapterSha256`,
//     `candidate.fixtureSetSha256`,
//     `archetypes`,
//     `rootPackageJsonSha256`,
//     `rootPackageLockSha256`             — from `currentQualificationJoins()`
//                                           in `scripts/lib/candidate-qualification.mjs`,
//                                           called at `reviewedCommit`. This
//                                           script never recomputes or
//                                           hand-copies these; every
//                                           validator recomputes the same
//                                           joins independently, so a second
//                                           implementation here would drift.
//   * the record's file path             — from `qualificationPath()` in the
//                                           same library, not a hand-built
//                                           string.
//   * `reviewedCommit` / `candidateReview.headSha`
//                                         — the current `git rev-parse HEAD`
//                                           of the repository this script
//                                           runs in, but only ONCE
//                                           CORROBORATED: this script reads
//                                           the package manifest at that
//                                           commit and refuses (exit 1) unless
//                                           its sha256 matches BOTH the
//                                           manifest packed inside the
//                                           tarball and the transcript's own
//                                           `coverage.installedManifestSha256`.
//                                           There is no `--commit` flag —
//                                           this script intentionally does
//                                           not let a caller assert which
//                                           commit was reviewed. Run it with
//                                           the working tree checked out at
//                                           the exact commit whose `qualify`
//                                           run produced this artifact; if it
//                                           is checked out anywhere else, the
//                                           manifest digests will not agree
//                                           and generation fails loudly
//                                           instead of guessing.
//
// ---------------------------------------------------------------------------
// What is NOT derived (PR #770 identified exactly three; every one of them is
// either an explicit CLI input or a documented fixed constant below):
// ---------------------------------------------------------------------------
//   * `candidateReview.reference`  — an explicit CLI input, `--review-reference`.
//     Its string format (e.g. "github-pull:<n>;main-merge:<sha>") records how
//     a human traced the reviewed commit back to its merged pull request;
//     nothing in the artifact or the git history encodes that lookup.
//   * `findings: []`               — a documented fixed constant. Findings
//     record open or resolved governance exceptions from a separate review
//     process; a `qualify` artifact carries no such exceptions, so this
//     script always emits the empty list rather than guessing at one.
//   * serialisation style          — a documented fixed constant: the record
//     is written as `JSON.stringify(record, null, 2)` plus one trailing
//     newline, matching every hand-authored record already retained under
//     `governance/release-qualifications/`.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { currentQualificationJoins, parseStrictJson, qualificationPath } from "./lib/candidate-qualification.mjs";
import { selectPolicyPackage, validateReleaseQualificationPolicy } from "./lib/release-qualification-contract.mjs";

const USAGE = "Usage: --package <policy-key> --tarball <candidate.tgz> --transcript <transcript.json> --review-reference <string> [--out <path>]";
const PACKAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const REQUIRED = ["package", "tarball", "transcript", "review-reference"];
const OPTIONAL = ["out"];

class UsageError extends Error {}
class IndeterminateError extends Error {}
class UnproducibleError extends Error {}

function argsFrom(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i]?.startsWith("--") ? argv[i].slice(2) : undefined;
    const value = argv[i + 1];
    if (!flag || ![...REQUIRED, ...OPTIONAL].includes(flag) || value === undefined || args[flag] !== undefined) throw new UsageError(USAGE);
    args[flag] = value;
  }
  for (const flag of REQUIRED) if (args[flag] === undefined) throw new UsageError(USAGE);
  if (!PACKAGE_KEY.test(args.package)) throw new UsageError(USAGE);
  if (args["review-reference"].trim().length === 0) throw new UsageError(USAGE);
  return args;
}

function regularFile(path, label) {
  let file;
  try { file = resolve(path); } catch { throw new IndeterminateError(`${label} path could not be resolved.`); }
  let stat;
  try { stat = lstatSync(file); } catch { throw new IndeterminateError(`${label} could not be read: ${path}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new IndeterminateError(`${label} must be a regular file: ${path}`);
  return file;
}

function sha(algorithm, bytes) { return createHash(algorithm).update(bytes).digest("hex"); }

function gitRoot() {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); }
  catch { throw new IndeterminateError("this script must run inside a git working tree."); }
}

function gitHead(root) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { throw new IndeterminateError("git HEAD could not be resolved."); }
}

function gitBlob(root, ref, path) {
  try { return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" }); }
  catch { return null; }
}

function packedManifestBytes(tarballPath) {
  try { return execFileSync("tar", ["-xOf", tarballPath, "package/package.json"]); }
  catch { throw new IndeterminateError("candidate tarball does not contain a readable package/package.json."); }
}

export function generateQualificationRecord({ root = gitRoot(), args }) {
  // --- policy: resolve the package key against the release qualification policy ---
  const policyPath = `governance/release-qualification-policy.json`;
  const policyBytes = gitBlob(root, "HEAD", policyPath) ?? (() => { throw new IndeterminateError("release qualification policy could not be read."); })();
  let policy;
  try { policy = parseStrictJson(policyBytes); } catch (error) { throw new IndeterminateError(`release qualification policy is not valid JSON: ${error.message}`); }
  if (validateReleaseQualificationPolicy(policy).length > 0) throw new IndeterminateError("release qualification policy failed its own shape validation.");
  const selected = selectPolicyPackage(policy, args.package);
  if (!selected) throw new IndeterminateError(`no unique release qualification policy entry for package key "${args.package}".`);
  if (selected.entry.archetypes?.["current-direct"]?.status !== "required") throw new UnproducibleError(`${selected.name} current-direct qualification is blocked by policy.`);

  // --- read the artifact: transcript and tarball ---
  const transcriptFile = regularFile(args.transcript, "transcript");
  let transcript;
  try { transcript = parseStrictJson(readFileSync(transcriptFile, "utf8")); } catch (error) { throw new IndeterminateError(`transcript is not valid JSON: ${error.message}`); }
  if (transcript?.candidate?.name !== selected.name) throw new UnproducibleError(`transcript candidate name "${transcript?.candidate?.name}" does not match policy key "${args.package}" (${selected.name}).`);
  if (!VERSION.test(transcript?.candidate?.version)) throw new UnproducibleError("transcript candidate version is missing or invalid.");
  const declaredTarball = transcript?.tarball;
  if (!declaredTarball || typeof transcript?.coverage?.installedManifestSha256 !== "string") throw new UnproducibleError("transcript does not carry a candidate tarball or installed manifest digest to join against.");

  const tarballFile = regularFile(args.tarball, "tarball");
  const tarballBytes = readFileSync(tarballFile);
  const tarballHashes = { sha1: sha("sha1", tarballBytes), sha256: sha("sha256", tarballBytes), sha512: sha("sha512", tarballBytes) };
  if (["sha1", "sha256", "sha512"].some((key) => tarballHashes[key] !== declaredTarball[key])) throw new UnproducibleError("candidate tarball bytes do not match the digests recorded in the transcript.");

  const manifestBytes = packedManifestBytes(tarballFile);
  let manifest;
  try { manifest = parseStrictJson(manifestBytes); } catch (error) { throw new IndeterminateError(`packed package.json is not valid JSON: ${error.message}`); }
  if (!NAME.test(manifest?.name) || !VERSION.test(manifest?.version)) throw new UnproducibleError("packed package.json name or version is invalid.");
  if (manifest.name !== selected.name || manifest.version !== transcript.candidate.version) throw new UnproducibleError("packed package.json identity does not match the policy key or the transcript candidate.");
  const manifestSha256 = sha("sha256", manifestBytes);
  if (manifestSha256 !== transcript.coverage.installedManifestSha256) throw new UnproducibleError("packed package.json digest does not match the transcript's installed manifest digest.");

  const candidate = { name: manifest.name, version: manifest.version };

  // --- corroborate reviewedCommit: it is git HEAD, never an assumed or supplied value ---
  const reviewedCommit = gitHead(root);
  const reviewedManifestBytes = gitBlob(root, reviewedCommit, `${selected.entry.packageDir}/package.json`);
  if (reviewedManifestBytes === null) throw new IndeterminateError(`package manifest could not be read at HEAD (${reviewedCommit}).`);
  if (sha("sha256", reviewedManifestBytes) !== manifestSha256) {
    throw new UnproducibleError(
      `reviewedCommit could not be corroborated: the package manifest at the current git HEAD (${reviewedCommit}) does not match ` +
      "the transcript's installed manifest digest. Run this tool with the working tree checked out at the exact commit whose " +
      "qualify run produced this artifact — this tool never guesses which commit was reviewed.",
    );
  }

  // --- policy-derived joins, pinned at the corroborated reviewed commit ---
  let joins;
  try { joins = currentQualificationJoins(root, candidate, reviewedCommit); }
  catch (error) { throw new IndeterminateError(`policy-derived joins could not be computed at ${reviewedCommit}: ${error instanceof Error ? error.message : "unknown error"}`); }

  let recordPath;
  try { recordPath = qualificationPath(root, candidate, reviewedCommit); }
  catch (error) { throw new IndeterminateError(`qualification record path could not be derived: ${error instanceof Error ? error.message : "unknown error"}`); }

  const record = {
    schemaVersion: 2,
    timing: "pre-publication",
    candidate: {
      name: candidate.name,
      version: candidate.version,
      packageTreeSha1: joins.packageTreeSha1,
      packageManifestSha256: joins.packageManifestSha256,
      policySha256: joins.policySha256,
      adapterSha256: joins.adapterSha256,
      fixtureSetSha256: joins.fixtureSetSha256,
      tarball: tarballHashes,
    },
    archetypes: joins.archetypes,
    reviewedCommit,
    rootPackageJsonSha256: joins.rootPackageJsonSha256,
    rootPackageLockSha256: joins.rootPackageLockSha256,
    transcript,
    candidateReview: { headSha: reviewedCommit, reference: args["review-reference"] },
    findings: [],
  };

  const outPath = args.out ? resolve(args.out) : resolve(root, recordPath);
  if (existsSync(outPath)) throw new UnproducibleError(`refusing to overwrite an existing file at ${outPath}.`);

  return { record, outPath, recordPath };
}

function main() {
  let args;
  try { args = argsFrom(process.argv); }
  catch (error) { console.error(error.message); process.exit(2); }

  let result;
  try {
    result = generateQualificationRecord({ args });
  } catch (error) {
    if (error instanceof UnproducibleError) { console.error(`RECORD NOT PRODUCIBLE — ${error.message}`); process.exit(1); }
    if (error instanceof IndeterminateError) { console.error(`INDETERMINATE — ${error.message}`); process.exit(2); }
    console.error("INDETERMINATE — " + (error instanceof Error ? error.message : "unknown error"));
    process.exit(2);
  }

  try {
    mkdirSync(dirname(result.outPath), { recursive: true });
    writeFileSync(result.outPath, `${JSON.stringify(result.record, null, 2)}\n`);
  } catch (error) {
    console.error("INDETERMINATE — record could not be written: " + (error instanceof Error ? error.message : "unknown error"));
    process.exit(2);
  }
  console.log(`QUALIFICATION RECORD WRITTEN — ${result.outPath}`);
  process.exit(0);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
export { argsFrom, UnproducibleError, IndeterminateError, UsageError };
