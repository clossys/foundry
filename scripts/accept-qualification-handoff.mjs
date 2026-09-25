#!/usr/bin/env node
// accept-qualification-handoff — the trusted half of
// .github/workflows/qualify-candidate.yml's job split (issue #948).
//
//   node scripts/accept-qualification-handoff.mjs \
//     --package <package-dir> --version <version> --handoff-dir <dir> \
//     --reviewed-commit <sha> --review-reference <string>
//
// Exit codes (this repository's convention):
//   0  the hand-off was accepted: the record was written to its one
//      expected path under governance/release-qualifications/, and that
//      repository-relative path is the only thing printed to stdout.
//   1  the hand-off was refused — anything about it differs from what the
//      trusted checkout says it must be. Nothing was written.
//   2  usage error, or the trusted checkout itself could not answer (git or
//      policy lookup failed). Nothing was written.
//
// WHY THIS EXISTS
// ---------------
// qualify-candidate.yml's `qualify` job executes the candidate package and
// its third-party dependency closure. No job that executes candidate code
// holds a write-scoped token, so that job runs with `contents: read` only
// and hands its one product — the generated qualification record — to a
// separate job, which holds the write token and never executes anything the
// first job produced. The hand-off crosses that boundary as an uploaded
// artifact, and everything in it is attacker-influenceable: code running in
// the first job can upload any bytes under any artifact name.
//
// So this script treats the artifact as UNTRUSTED DATA and accepts it only
// if every property the trusted checkout can derive on its own agrees:
//
//   * the hand-off directory holds exactly one entry, a regular file named
//     qualification-record.json (never a symlink or directory), no larger
//     than MAX_RECORD_BYTES;
//   * its bytes are valid UTF-8, parse as strict JSON (no duplicate keys),
//     and are byte-identical to the canonical serialization
//     generate-qualification-record.mjs writes — so no stray bytes ride
//     along with a record that otherwise validates;
//   * the checkout is clean and its HEAD is --reviewed-commit;
//   * the record names the package's own name at that commit and exactly
//     --version, is the schema generate-qualification-record.mjs produces,
//     is `pre-publication`, binds reviewedCommit/candidateReview.headSha to
//     that commit and candidateReview.reference to --review-reference;
//   * its destination is derived here, from qualificationPath() at that
//     commit — never from anything in the artifact — and does not already
//     exist;
//   * validateCandidateQualification(), the same validator every retained
//     record is held to, returns no findings against joins recomputed here
//     by currentQualificationJoins() at that commit.
//
// Deliberately, nothing here runs npm or any package script: the accepted
// schema's joins are pure git and sha computations over the trusted tree.
// The worst a malicious qualify job can still achieve is a pull request
// carrying a record that passes every one of those checks, which still
// needs human review and this repository's required CI before it can merge.
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { currentQualificationJoins, parseStrictJson, qualificationPath, validateCandidateQualification } from "./lib/candidate-qualification.mjs";

export const HANDOFF_FILE = "qualification-record.json";
// The largest retained record today is under 40 KB; this bound leaves ample
// headroom for growth while refusing an arbitrarily large upload outright.
export const MAX_RECORD_BYTES = 262_144;
// The one schema generate-qualification-record.mjs writes (its own
// RECORD_SCHEMA_VERSION). accept-qualification-handoff.test.mjs accepts a
// record that generator really produced, so the two cannot drift silently.
export const ACCEPTED_SCHEMA_VERSION = 2;

const USAGE = "Usage: --package <package-dir> --version <version> --handoff-dir <dir> --reviewed-commit <sha> --review-reference <string>";
const FLAGS = ["package", "version", "handoff-dir", "reviewed-commit", "review-reference"];
const PACKAGE_KEY = /^[a-zA-Z0-9_-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA1 = /^[a-f0-9]{40}$/;
const RECORD_PATH = /^governance\/release-qualifications\/[A-Za-z0-9._@-]+\.json$/;

/**
 * Quote an attacker-influenced value for a log line: JSON-escaped (so no raw
 * newline can start a new line, and so no `::` workflow command can ever sit
 * at the start of one), with the two JSON-legal line separators escaped too,
 * and length-bounded.
 */
export function quote(value) {
  let text;
  try { text = JSON.stringify(value) ?? String(value); } catch { text = "[unserializable]"; }
  if (text.length > 200) text = `${text.slice(0, 200)}...`;
  return text.replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

/** Last-line defense at the sink: escape every control character in a message before it is printed. */
function oneLine(message) {
  return String(message).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export class UsageError extends Error {}
export class HandoffRefused extends Error {}
export class IndeterminateError extends Error {}

export function argsFrom(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index]?.startsWith("--") ? argv[index].slice(2) : undefined;
    const value = argv[index + 1];
    if (!flag || !FLAGS.includes(flag) || value === undefined || args[flag] !== undefined) throw new UsageError(USAGE);
    args[flag] = value;
  }
  for (const flag of FLAGS) if (typeof args[flag] !== "string" || args[flag].trim() === "") throw new UsageError(USAGE);
  if (!PACKAGE_KEY.test(args.package) || !VERSION.test(args.version) || !SHA1.test(args["reviewed-commit"])) throw new UsageError(USAGE);
  return args;
}

function git(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { throw new IndeterminateError(`git ${args[0]} failed in the trusted checkout: ${error instanceof Error ? error.message : "unknown error"}`); }
}

function gitPathExists(root, ref, path) {
  try { execFileSync("git", ["cat-file", "-e", `${ref}:${path}`], { cwd: root, stdio: "ignore" }); return true; }
  catch { return false; }
}

function exists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

/** Read the one hand-off file, refusing every shape but the expected one. */
function readHandoffBytes(handoffDir) {
  let dirStat;
  try { dirStat = lstatSync(handoffDir); } catch { throw new HandoffRefused(`hand-off directory ${handoffDir} does not exist.`); }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new HandoffRefused(`hand-off path ${handoffDir} is not a plain directory.`);

  const entries = readdirSync(handoffDir).sort();
  if (entries.length !== 1 || entries[0] !== HANDOFF_FILE) {
    throw new HandoffRefused(`hand-off directory must contain exactly ${HANDOFF_FILE} and nothing else (found: ${entries.length === 0 ? "nothing" : entries.slice(0, 10).map(quote).join(", ")}${entries.length > 10 ? `, and ${entries.length - 10} more` : ""}).`);
  }
  const file = join(handoffDir, HANDOFF_FILE);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new HandoffRefused(`${HANDOFF_FILE} must be a regular file.`);
  if (stat.size === 0 || stat.size > MAX_RECORD_BYTES) throw new HandoffRefused(`${HANDOFF_FILE} is ${stat.size} bytes; it must be between 1 and ${MAX_RECORD_BYTES}.`);

  const bytes = readFileSync(file);
  if (bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) throw new HandoffRefused(`${HANDOFF_FILE} changed size while being read.`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new HandoffRefused(`${HANDOFF_FILE} is not valid UTF-8.`);
  return text;
}

/**
 * Validate an untrusted hand-off against the trusted checkout at `root`.
 * Pure with respect to the filesystem outside `handoffDir`: it writes
 * nothing, and returns the bytes and the destination for main() to write.
 */
export function acceptQualificationHandoff({ root = process.cwd(), packageKey, version, handoffDir, reviewedCommit, reviewReference }) {
  if (!PACKAGE_KEY.test(packageKey ?? "") || !VERSION.test(version ?? "") || !SHA1.test(reviewedCommit ?? "") || typeof reviewReference !== "string" || reviewReference.trim() === "") {
    throw new UsageError(USAGE);
  }

  // --- the trusted side: a clean checkout of exactly the reviewed commit ---
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (head !== reviewedCommit) throw new HandoffRefused(`trusted checkout HEAD ${head} is not the reviewed commit ${reviewedCommit}.`);
  const dirty = git(root, ["status", "--porcelain", "--untracked-files=all"]).trim();
  if (dirty !== "") throw new HandoffRefused("trusted checkout is not clean; refusing to accept a hand-off into a modified tree.");

  let manifest;
  try { manifest = parseStrictJson(git(root, ["show", `${reviewedCommit}:packages/${packageKey}/package.json`])); }
  catch (error) { throw new IndeterminateError(`packages/${packageKey}/package.json could not be read at ${reviewedCommit}: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (manifest?.version !== version) throw new HandoffRefused(`packages/${packageKey}/package.json declares ${quote(manifest?.version)} at ${reviewedCommit}, not ${quote(version)}.`);
  const candidate = { name: manifest?.name, version };
  if (typeof candidate.name !== "string" || candidate.name === "") throw new IndeterminateError(`packages/${packageKey}/package.json declares no name at ${reviewedCommit}.`);

  let recordPath;
  try { recordPath = qualificationPath(root, candidate, reviewedCommit); }
  catch (error) { throw new IndeterminateError(`qualification record path could not be derived: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (!RECORD_PATH.test(recordPath)) throw new IndeterminateError(`derived qualification record path ${recordPath} is not under governance/release-qualifications/.`);
  if (gitPathExists(root, reviewedCommit, recordPath) || exists(resolve(root, recordPath))) throw new HandoffRefused(`${recordPath} already exists; a retained record is never overwritten.`);

  // --- the untrusted side: the artifact bytes ---
  const text = readHandoffBytes(handoffDir);
  let record;
  try { record = parseStrictJson(text); }
  catch (error) { throw new HandoffRefused(`${HANDOFF_FILE} is not strict JSON: ${quote(error instanceof Error ? error.message : "parse error")}`); }
  if (`${JSON.stringify(record, null, 2)}\n` !== text) throw new HandoffRefused(`${HANDOFF_FILE} is not in the canonical serialization generate-qualification-record.mjs writes.`);

  if (record?.schemaVersion !== ACCEPTED_SCHEMA_VERSION) throw new HandoffRefused(`record schemaVersion must be ${ACCEPTED_SCHEMA_VERSION}.`);
  if (record.timing !== "pre-publication") throw new HandoffRefused("record timing must be pre-publication.");
  if (record.candidate?.name !== candidate.name || record.candidate?.version !== candidate.version) {
    throw new HandoffRefused(`record names ${quote(record.candidate?.name)}@${quote(record.candidate?.version)}, not ${quote(candidate.name)}@${quote(candidate.version)}.`);
  }
  if (record.reviewedCommit !== reviewedCommit || record.candidateReview?.headSha !== reviewedCommit) throw new HandoffRefused(`record is not bound to reviewed commit ${reviewedCommit}.`);
  if (record.candidateReview?.reference !== reviewReference) throw new HandoffRefused("record candidateReview.reference does not match this run's review reference.");
  if (!isDeepStrictEqual(record.findings, [])) throw new HandoffRefused("a generated record carries no findings; this one does.");

  let joins;
  try { joins = currentQualificationJoins(root, candidate, reviewedCommit, { schemaVersion: ACCEPTED_SCHEMA_VERSION }); }
  catch (error) { throw new IndeterminateError(`qualification joins could not be recomputed at ${reviewedCommit}: ${error instanceof Error ? error.message : "unknown error"}`); }
  const findings = validateCandidateQualification(record, { expected: { name: candidate.name, version: candidate.version, ...joins } });
  if (findings.length > 0) throw new HandoffRefused(`record fails validation: ${findings.map((finding) => `${quote(finding.rule)} (${quote(finding.message)})`).join("; ")}.`);

  return { recordPath, text, candidate };
}

function main() {
  let args;
  try { args = argsFrom(process.argv); }
  catch (error) { console.error(error.message); process.exit(2); }

  let result;
  try {
    result = acceptQualificationHandoff({
      packageKey: args.package,
      version: args.version,
      handoffDir: resolve(args["handoff-dir"]),
      reviewedCommit: args["reviewed-commit"],
      reviewReference: args["review-reference"],
    });
  } catch (error) {
    if (error instanceof HandoffRefused) { console.error(`HAND-OFF REFUSED — ${oneLine(error.message)}`); process.exit(1); }
    console.error(`INDETERMINATE — ${oneLine(error instanceof Error ? error.message : "unknown error")}`);
    process.exit(2);
  }

  try {
    const destination = resolve(process.cwd(), result.recordPath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, result.text, { flag: "wx" });
  } catch (error) {
    console.error(`INDETERMINATE — record could not be written: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(2);
  }
  console.error(`HAND-OFF ACCEPTED — ${result.candidate.name}@${result.candidate.version} written to ${result.recordPath}`);
  console.log(result.recordPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
