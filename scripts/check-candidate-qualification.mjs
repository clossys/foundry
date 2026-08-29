import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { currentQualificationJoins, parseStrictJson, qualificationPath, qualificationRecordHistory, validateCandidateQualification, validatePrepublicationPrTail } from "./lib/candidate-qualification.mjs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";
import { TRIO_COHORT_PATH, TRIO_QUARANTINE_PATH, validateTrioPartialFailureQuarantine, validateTrioPrepublicationCohort } from "./lib/release-qualification-cohort.mjs";

const transition = loadTransitionPolicy("governance/package-identity-transition.json");
const sourceIdentity = JSON.parse(readFileSync("package-scope.json", "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function immutableIntroducedBytes(path) {
  const commits = execFileSync("git", ["log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) throw new Error("must have one immutable introduction commit");
  const introduced = execFileSync("git", ["show", `${commits[0]}:${path}`], { encoding: "utf8" });
  const retained = readFileSync(path, "utf8");
  if (sha256(introduced) !== sha256(retained)) throw new Error("retained bytes differ from their introduction blob");
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
const trioRecords = records.map((item) => item.record).filter((record) => record?.timing === "pre-publication" && /^@clossys\/(advisor|starter|controller)$/.test(record?.candidate?.name ?? ""));
if (trioRecords.length > 0) {
  if (!cohort) { console.error("[trio-cohort] " + TRIO_COHORT_PATH + ": exact Trio pre-publication records require one cohort record."); failed = true; }
  else {
    const findings = validateTrioPrepublicationCohort(cohort.value, { records: new Map(records.map((item) => [item.path, item.record])), recordBytes: new Map(records.map((item) => [item.path, item.bytes])) });
    for (const item of findings) console.error("[" + item.rule + "] " + cohort.path + ": " + item.message);
    failed ||= findings.length > 0;
    try { immutableIntroducedBytes(cohort.path); } catch (error) { console.error("[trio-cohort-history] " + cohort.path + ": " + error.message); failed = true; }
  }
}
if (quarantine) {
  if (!cohort) { console.error("[trio-quarantine] " + quarantine.path + ": a partial-failure quarantine requires its exact cohort record."); failed = true; }
  else {
    const findings = validateTrioPartialFailureQuarantine(quarantine.value, { cohortBytes: cohort.bytes });
    for (const item of findings) console.error("[" + item.rule + "] " + quarantine.path + ": " + item.message);
    failed ||= findings.length > 0;
    try { immutableIntroducedBytes(quarantine.path); } catch (error) { console.error("[trio-quarantine-history] " + quarantine.path + ": " + error.message); failed = true; }
  }
}
for (const { path, record } of records) {
  try {
    const historical = historicalRecord(record);
    const expectedPath = historical
      ? `${directory}/${record.candidate.name.slice(record.candidate.name.indexOf("/") + 1)}-${record.candidate.version}.json`
      : qualificationPath(process.cwd(), record.candidate);
    const history = qualificationRecordHistory(process.cwd(), path, record.candidate, "HEAD", expectedPath);
    const expected = { name: record.candidate?.name, version: record.candidate?.version, ...currentQualificationJoins(process.cwd(), record.candidate, history.introductionCommit) };
    const findings = validateCandidateQualification(record, { expected });
    if (record.timing === "pre-publication" && record.candidate?.name?.startsWith("@clossys/")) {
      findings.push(...validatePrepublicationPrTail(record, { trioRecords, cohort: cohort?.value }));
    }
    if (history.introducedRecordSha256 !== history.retainedRecordSha256) findings.push({ rule: "record-history-join", message: "retained record bytes differ from their exact introduction blob." });
    for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
    failed ||= findings.length > 0;
  } catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — retained evidence is not consumer adoption or sponsor authorization.");
