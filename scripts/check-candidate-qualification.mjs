import { readFileSync, readdirSync } from "node:fs";
import { currentQualificationJoins, parseStrictJson, qualificationIntroductionCommit, qualificationPath, validateCandidateQualification } from "./lib/candidate-qualification.mjs";

const directory = "governance/release-qualifications";
let paths;
try { paths = readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => directory + "/" + name); } catch (error) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — cannot read records"); process.exit(2); }
if (paths.length === 0) { console.error("CANDIDATE QUALIFICATION INDETERMINATE — no versioned records."); process.exit(2); }
let failed = false;
for (const path of paths) {
  try {
    const record = parseStrictJson(readFileSync(path, "utf8"));
    const introduction = qualificationIntroductionCommit(process.cwd(), record.candidate);
    const expected = { name: record.candidate?.name, version: record.candidate?.version, ...currentQualificationJoins(process.cwd(), record.candidate, introduction) };
    const findings = validateCandidateQualification(record, { expected });
    if (path !== qualificationPath(process.cwd(), record.candidate)) findings.push({ rule: "record-path", message: "record path does not match the policy record stem." });
    for (const finding of findings) console.error("[" + finding.rule + "] " + path + ": " + finding.message);
    failed ||= findings.length > 0;
  } catch (error) { console.error("Cannot read " + path + ": " + (error instanceof Error ? error.message : "unknown error")); failed = true; }
}
if (failed) process.exit(1);
console.log("CANDIDATE QUALIFICATION RECORD OK — retained evidence is not consumer adoption or sponsor authorization.");
