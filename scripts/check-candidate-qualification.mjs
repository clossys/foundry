import { readFileSync, readdirSync } from "node:fs";
import { currentQualificationJoins, parseStrictJson, qualificationPath, qualificationRecordHistory, validateCandidateQualification } from "./lib/candidate-qualification.mjs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";

const transition = loadTransitionPolicy("governance/package-identity-transition.json");
const sourceIdentity = JSON.parse(readFileSync("package-scope.json", "utf8"));
function historicalRecord(record) {
  return sourceIdentity.scope === transition.candidate.scope &&
    typeof record.candidate?.name === "string" &&
    record.candidate.name.startsWith(`${transition.current.scope}/`);
}
const directory = "governance/release-qualifications";
let paths;
try { paths = readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => directory + "/" + name); } catch (error) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — cannot read records"); process.exit(2); }
if (paths.length === 0) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — no versioned records."); process.exit(2); }
let failed = false;
for (const path of paths) {
  try {
    const record = parseStrictJson(readFileSync(path, "utf8"));
    const historical = historicalRecord(record);
    const expectedPath = historical
      ? `${directory}/${record.candidate.name.slice(record.candidate.name.indexOf("/") + 1)}-${record.candidate.version}.json`
      : qualificationPath(process.cwd(), record.candidate);
    const history = qualificationRecordHistory(process.cwd(), path, record.candidate, "HEAD", expectedPath);
    const expected = { name: record.candidate?.name, version: record.candidate?.version, ...currentQualificationJoins(process.cwd(), record.candidate, history.introductionCommit) };
    const findings = validateCandidateQualification(record, { expected });
    if (history.introducedRecordSha256 !== history.retainedRecordSha256) findings.push({ rule: "record-history-join", message: "retained record bytes differ from their exact introduction blob." });
    for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
    failed ||= findings.length > 0;
  } catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — retained evidence is not consumer adoption or sponsor authorization.");
