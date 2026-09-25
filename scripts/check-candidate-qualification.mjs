import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { blobOid, parseStrictJson, qualificationPath, realPathTouches, sealedQualificationPathsAtTransitionBase, validatePrepublicationPrTail, validateRetainedCandidateQualification, validateTrioPublicationClosure } from "./lib/candidate-qualification.mjs";
import { findUnrecognisedArgument, resolvePackageArgs, resolveShardArgs, selectedForRederivation } from "./lib/candidate-qualification-shard.mjs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";
import { TRIO_PUBLICATION_PATH, TRIO_PUBLICATION_TRANSITION_BASE, validateTrioFirstPublication } from "./lib/release-publication-cohort.mjs";
import { TRIO_COHORT_PATH, TRIO_QUARANTINE_PATH, validateTrioQualificationState } from "./lib/release-qualification-cohort.mjs";
import { TRIO_CONTROL_TAIL_AUTHORIZATION_PATH } from "./lib/release-qualification-trio.mjs";
import { readValidatedLaterPublishedPackages } from "./lib/release-later-publication.mjs";

// #1257: sharding support. See scripts/lib/candidate-qualification-shard.mjs's
// own header for the full reasoning -- this script's real cost is the
// per-record loop below, and that file's assignedToShard is what lets this
// script skip RE-DERIVING a record that belongs to a different shard while
// still counting it as present for the cross-record checks that need to see
// every record's path.
// An argument this script does not recognise is refused, never ignored: an
// ignored `--package=writer` (the equals form) would silently fall back to
// the full, unscoped walk.
const unrecognised = findUnrecognisedArgument(process.argv.slice(2));
if (unrecognised !== null) {
  console.error(`check-candidate-qualification: unrecognised argument ${JSON.stringify(unrecognised)} (accepted: --shard-index <n> --shard-count <n>, or --package <key> [--allow-missing-record])`);
  process.exit(2);
}
const shardResult = resolveShardArgs(process.argv.slice(2));
if (shardResult.error) {
  console.error("check-candidate-qualification: " + shardResult.error);
  process.exit(2);
}
const shard = shardResult.shard;
// `--package <key>` (publish.yml's `qualify` job): re-derive only that
// package's current-version record -- see resolvePackageArgs's own header in
// scripts/lib/candidate-qualification-shard.mjs for why that is everything
// the unscoped walk proved that is specific to one publication.
const packageResult = resolvePackageArgs(process.argv.slice(2));
if (packageResult.error) {
  console.error("check-candidate-qualification: " + packageResult.error);
  process.exit(2);
}
const packageScope = packageResult.packageScope;

const transition = loadTransitionPolicy("governance/package-identity-transition.json");
const sourceIdentity = JSON.parse(readFileSync("package-scope.json", "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function immutableIntroducedBytes(path) {
  const commits = execFileSync("git", ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) throw new Error("must have one immutable introduction commit");
  const introduced = execFileSync("git", ["show", `${commits[0]}:${path}`], { encoding: "utf8" });
  const retained = readFileSync(path, "utf8");
  if (sha256(introduced) !== sha256(retained)) throw new Error("retained bytes differ from their introduction blob");
  // Same pass-through-merge caveat the lib's `realPathTouches` documents: a
  // raw `--full-history` walk counts a merge that only carried this blob
  // through unchanged, so a branch merging `main` after the record landed
  // read as tampering. Measure against the introduction blob instead.
  const laterTouches = realPathTouches(process.cwd(), `${commits[0]}..HEAD`, path, blobOid(process.cwd(), commits[0], path));
  if (laterTouches.length > 0) throw new Error("retained path was touched after its introduction");
}
function historicalRecord(record) {
  return sourceIdentity.scope === transition.candidate.scope &&
    typeof record.candidate?.name === "string" &&
    record.candidate.name.startsWith(`${transition.current.scope}/`);
}
const directory = "governance/release-qualifications";
let paths;
try { paths = readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => directory + "/" + name); } catch (error) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — cannot read records"); process.exit(2); }
if (paths.length === 0) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — no versioned records."); process.exit(2); }
let packageRecordPath = null;
if (packageScope) {
  let candidate;
  try {
    const manifest = parseStrictJson(readFileSync(`packages/${packageScope.packageKey}/package.json`, "utf8"));
    candidate = { name: manifest?.name, version: manifest?.version };
    if (typeof candidate.name !== "string" || typeof candidate.version !== "string") throw new Error("manifest declares no name/version pair");
    packageRecordPath = qualificationPath(process.cwd(), candidate);
  } catch (error) {
    console.error(`CANDIDATE QUALIFICATION INDETERMINATE — cannot derive the record path for --package ${packageScope.packageKey}: ` + (error instanceof Error ? error.message : "unknown error"));
    process.exit(2);
  }
  console.log(`--package ${packageScope.packageKey}: re-deriving only ${packageRecordPath} (${candidate.name}@${candidate.version}) of ${paths.length} retained records; every other record's re-derivation is CI's \`candidate qualification records\` job's, on this commit or its nearest non-prose ancestor, which the required \`build and test\` check fans in. Cross-record checks run in full.`);
}
const records = [];
let failed = false;
if (packageScope && !paths.includes(packageRecordPath)) {
  if (packageScope.allowMissingRecord) {
    console.log(`[package-record-missing] ${packageRecordPath}: absent, allowed by --allow-missing-record (a dry run that produces this record).`);
  } else {
    console.error(`[package-record-missing] ${packageRecordPath}: no retained qualification record for --package ${packageScope.packageKey}'s current version.`);
    failed = true;
  }
}
for (const path of paths) {
  try { records.push({ path, bytes: readFileSync(path, "utf8"), record: parseStrictJson(readFileSync(path, "utf8")) }); }
  catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
}
let cohort = null;
try { cohort = { path: TRIO_COHORT_PATH, bytes: readFileSync(TRIO_COHORT_PATH, "utf8"), value: parseStrictJson(readFileSync(TRIO_COHORT_PATH, "utf8")) }; }
catch (error) { if (error?.code !== "ENOENT") { console.error("Cannot read " + TRIO_COHORT_PATH + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; } }
let quarantine = null;
try { quarantine = { path: TRIO_QUARANTINE_PATH, bytes: readFileSync(TRIO_QUARANTINE_PATH, "utf8"), value: parseStrictJson(readFileSync(TRIO_QUARANTINE_PATH, "utf8")) }; }
catch (error) { if (error?.code !== "ENOENT") { console.error("Cannot read " + TRIO_QUARANTINE_PATH + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; } }
let controlTailAuthorization = null;
try { controlTailAuthorization = { path: TRIO_CONTROL_TAIL_AUTHORIZATION_PATH, bytes: readFileSync(TRIO_CONTROL_TAIL_AUTHORIZATION_PATH, "utf8"), value: parseStrictJson(readFileSync(TRIO_CONTROL_TAIL_AUTHORIZATION_PATH, "utf8")) }; }
catch (error) { if (error?.code !== "ENOENT") { console.error("Cannot read " + TRIO_CONTROL_TAIL_AUTHORIZATION_PATH + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; } }
let publication = null;
try { publication = { path: TRIO_PUBLICATION_PATH, bytes: readFileSync(TRIO_PUBLICATION_PATH, "utf8"), value: parseStrictJson(readFileSync(TRIO_PUBLICATION_PATH, "utf8")) }; }
catch (error) { console.error("Cannot read " + TRIO_PUBLICATION_PATH + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
let sealedQualificationPaths = new Set();
try { sealedQualificationPaths = sealedQualificationPathsAtTransitionBase(process.cwd()); }
catch (error) { console.error("Cannot read sealed qualification paths: " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
for (const sealedPath of sealedQualificationPaths) {
  if (paths.includes(sealedPath)) continue;
  console.error("[sealed-record-set] " + sealedPath + ": transition-base predecessor record must remain present and readable.");
  failed = true;
}
const recordFindings = new Map();
for (const [index, { path, record }] of records.entries()) {
  if (!selectedForRederivation(index, path, { shard, packageRecordPath })) {
    // A DIFFERENT shard owns re-deriving this record for real (see the
    // header comment on assignedToShard above) -- or, under `--package`, the
    // required CI shards already did, on this commit or its nearest
    // non-prose ancestor. Recording `[]` -- not
    // skipping the map entry -- is deliberate: validatedRecordPaths below
    // reads recordFindings.get(path)?.length === 0 to decide whether a path
    // counts as validated for cross-record purposes, and an ABSENT entry
    // would read as "not validated" (`undefined?.length === 0` is false),
    // which would make every OTHER shard's cross-record checks (sealed-set
    // membership, cohort/quarantine consistency, prepublication tail
    // chaining) fail on records that are perfectly fine, just not THIS
    // shard's to re-derive.
    recordFindings.set(path, []);
    continue;
  }
  try {
    const historical = historicalRecord(record);
    const sealedBase = sealedQualificationPaths.has(path) ? TRIO_PUBLICATION_TRANSITION_BASE : null;
    const expectedPath = historical
      ? `${directory}/${record.candidate.name.slice(record.candidate.name.indexOf("/") + 1)}-${record.candidate.version}.json`
      : qualificationPath(process.cwd(), record.candidate);
    const findings = validateRetainedCandidateQualification(record, { root: process.cwd(), path, expectedPath, sealedBase });
    recordFindings.set(path, findings);
  } catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); recordFindings.set(path, [{ rule: "record-read", message: "record validation could not run." }]); failed = true; }
}
const validatedRecordPaths = new Set(records.filter((item) => recordFindings.get(item.path)?.length === 0).map((item) => item.path));
const recordMap = new Map(records.map((item) => [item.path, item.record]));
const recordBytes = new Map(records.map((item) => [item.path, item.bytes]));
const trioFindings = validateTrioQualificationState({ cohort: cohort?.value, cohortBytes: cohort?.bytes, quarantine: quarantine?.value, records: recordMap, recordBytes, validatedRecordPaths });
for (const item of trioFindings) console.error("[" + item.rule + "] " + (cohort?.path ?? quarantine?.path ?? TRIO_COHORT_PATH) + ": " + item.message);
failed ||= trioFindings.length > 0;
const publicationFindings = publication ? validateTrioFirstPublication(publication.value, { cohort: cohort?.value, cohortBytes: cohort?.bytes, records: recordMap, recordBytes, validatedRecordPaths }) : [];
for (const item of publicationFindings) console.error("[" + item.rule + "] " + TRIO_PUBLICATION_PATH + ": " + item.message);
failed ||= publicationFindings.length > 0;
const trioRecords = records.map((item) => item.record).filter((record) => record?.timing === "pre-publication" && /^@clossys\/(advisor|starter|controller)$/.test(record?.candidate?.name ?? ""));
const forwardRecords = records
  .filter((item) => item.record?.timing === "pre-publication" && item.record?.candidate?.name?.startsWith(`${sourceIdentity.scope}/`) && !sealedQualificationPaths.has(item.path))
  .map((item) => item.record);
const sealedTrioRecords = Array.isArray(publication?.value?.members)
  ? publication.value.members.map((member) => recordMap.get(member?.qualification?.path)).filter(Boolean)
  : [];
const publicationClosureFindings = publication ? validateTrioPublicationClosure(publication.value, { trioRecords: sealedTrioRecords, cohortBytes: cohort?.bytes, controlTailAuthorization: controlTailAuthorization?.value }) : [];
for (const item of publicationClosureFindings) console.error("[" + item.rule + "] " + TRIO_PUBLICATION_PATH + ": " + item.message);
failed ||= publicationClosureFindings.length > 0;
const publicationStateValid = publication !== null && publicationFindings.length === 0 && publicationClosureFindings.length === 0;
try { readValidatedLaterPublishedPackages(process.cwd()); }
catch (error) { console.error("[later-publication-records] " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
if (cohort) {
  try { immutableIntroducedBytes(cohort.path); } catch (error) { console.error("[trio-cohort-history] " + cohort.path + ": " + error.message); failed = true; }
}
if (quarantine) {
  try { immutableIntroducedBytes(quarantine.path); } catch (error) { console.error("[trio-quarantine-history] " + quarantine.path + ": " + error.message); failed = true; }
}
if (controlTailAuthorization) {
  try { immutableIntroducedBytes(controlTailAuthorization.path); } catch (error) { console.error("[trio-control-tail-history] " + controlTailAuthorization.path + ": " + error.message); failed = true; }
}
if (publication && publicationClosureFindings.length > 0) {
  try { immutableIntroducedBytes(publication.path); } catch (error) { console.error("[trio-publication-history] " + publication.path + ": " + error.message); failed = true; }
}
for (const [index, { path, record }] of records.entries()) {
  const findings = recordFindings.get(path) ?? [];
  if (selectedForRederivation(index, path, { shard, packageRecordPath }) && record.timing === "pre-publication" && record.candidate?.name?.startsWith(`${sourceIdentity.scope}/`)) findings.push(...validatePrepublicationPrTail(record, { recordPath: path, trioRecords, forwardRecords, cohort: cohort?.value, cohortBytes: cohort?.bytes, quarantine: quarantine?.value, controlTailAuthorization: controlTailAuthorization?.value, publication: publication?.value, publicationClosureValid: publicationStateValid }));
  for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
  failed ||= findings.length > 0;
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — retained evidence is not consumer adoption or sponsor authorization.");
