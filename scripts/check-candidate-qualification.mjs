import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { currentQualificationJoins, parseStrictJson, qualificationPath, qualificationRecordHistory, validateCandidateQualification, validatePrepublicationPrTail, validateTrioPublicationClosure } from "./lib/candidate-qualification.mjs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";
import { TRIO_PUBLICATION_PATH, validateTrioFirstPublication } from "./lib/release-publication-cohort.mjs";
import { TRIO_COHORT_PATH, TRIO_QUARANTINE_PATH, validateTrioQualificationState } from "./lib/release-qualification-cohort.mjs";
import { TRIO_CONTROL_TAIL_AUTHORIZATION_PATH } from "./lib/release-qualification-trio.mjs";

const transition = loadTransitionPolicy("governance/package-identity-transition.json");
const sourceIdentity = JSON.parse(readFileSync("package-scope.json", "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function immutableIntroducedBytes(path) {
  const commits = execFileSync("git", ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) throw new Error("must have one immutable introduction commit");
  const introduced = execFileSync("git", ["show", `${commits[0]}:${path}`], { encoding: "utf8" });
  const retained = readFileSync(path, "utf8");
  if (sha256(introduced) !== sha256(retained)) throw new Error("retained bytes differ from their introduction blob");
  const laterTouches = execFileSync("git", ["log", "--full-history", "--format=%H", `${commits[0]}..HEAD`, "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
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
const records = [];
let failed = false;
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
const recordFindings = new Map();
for (const { path, record } of records) {
  try {
    const historical = historicalRecord(record);
    const expectedPath = historical
      ? `${directory}/${record.candidate.name.slice(record.candidate.name.indexOf("/") + 1)}-${record.candidate.version}.json`
      : qualificationPath(process.cwd(), record.candidate);
    const history = qualificationRecordHistory(process.cwd(), path, record.candidate, "HEAD", expectedPath);
    const joinCommit = record.timing === "pre-publication" ? record.reviewedCommit : history.introductionCommit;
    const expected = { name: record.candidate?.name, version: record.candidate?.version, ...currentQualificationJoins(process.cwd(), record.candidate, joinCommit) };
    const findings = validateCandidateQualification(record, { expected });
    if (history.introducedRecordSha256 !== history.retainedRecordSha256) findings.push({ rule: "record-history-join", message: "retained record bytes differ from their exact introduction blob." });
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
const sealedTrioRecords = Array.isArray(publication?.value?.members)
  ? publication.value.members.map((member) => recordMap.get(member?.qualification?.path)).filter(Boolean)
  : [];
const publicationClosureFindings = publication ? validateTrioPublicationClosure(publication.value, { trioRecords: sealedTrioRecords, cohortBytes: cohort?.bytes, controlTailAuthorization: controlTailAuthorization?.value }) : [];
for (const item of publicationClosureFindings) console.error("[" + item.rule + "] " + TRIO_PUBLICATION_PATH + ": " + item.message);
failed ||= publicationClosureFindings.length > 0;
const publicationStateValid = publication !== null && publicationFindings.length === 0 && publicationClosureFindings.length === 0;
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
for (const { path, record } of records) {
  const findings = recordFindings.get(path) ?? [];
  if (record.timing === "pre-publication" && record.candidate?.name?.startsWith("@clossys/")) findings.push(...validatePrepublicationPrTail(record, { trioRecords, cohort: cohort?.value, cohortBytes: cohort?.bytes, quarantine: quarantine?.value, controlTailAuthorization: controlTailAuthorization?.value, publication: publication?.value, publicationClosureValid: publicationStateValid }));
  for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
  failed ||= findings.length > 0;
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — retained evidence is not consumer adoption or sponsor authorization.");
