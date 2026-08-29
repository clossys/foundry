import { readFileSync, readdirSync } from "node:fs";
import { currentQualificationJoins, parseStrictJson, qualificationPath, validateCandidateQualification } from "./lib/candidate-qualification.mjs";
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
    const expected = historical ? undefined : { name: record.candidate?.name, version: record.candidate?.version, ...currentQualificationJoins(process.cwd(), record.candidate) };
    const findings = validateCandidateQualification(record, { expected });
    const expectedPath = historical
      ? `${directory}/${record.candidate.name.slice(record.candidate.name.indexOf("/") + 1)}-${record.candidate.version}.json`
      : qualificationPath(process.cwd(), record.candidate);
    if (path !== expectedPath) findings.push({ rule: "record-path", message: "record path does not match the policy record stem." });
    for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
    failed ||= findings.length > 0;
  } catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — bootstrap evidence is not pre-publication authorization.");
