#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { AGGREGATE_CANARY_PATH, AGGREGATE_TRANSCRIPT_DIRECTORY, aggregateTranscriptPath, canonicalRedirectProjection, immutableRecordHistory, immutableRecordPaths, isAggregateClosurePath, publicationCandidate, sealedHistoricalRepository, validateAggregateClosure, validateSatisfiedAggregateTranscript, validateSatisfiedTranscriptHistory } from "./lib/public-npm-aggregate-canary.mjs";

const root = process.cwd();
const readHead = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const plan = JSON.parse(readHead(AGGREGATE_CANARY_PATH));
const records = immutableRecordPaths({ root, directory: AGGREGATE_TRANSCRIPT_DIRECTORY });
const files = records.introduced;
const findings = [];
for (const path of records.current) if (!records.introduced.includes(path)) findings.push({ rule: "transcript-introduction", message: `${path} has no exact A introduction in the closed immutable namespace` });
for (const path of files) {
  if (!records.current.includes(path)) { findings.push({ rule: "transcript-presence", message: `${path} was introduced as immutable satisfied evidence but is absent at HEAD` }); continue; }
  let transcript;
  try { transcript = JSON.parse(readHead(path)); }
  catch { findings.push({ rule: "json", message: `${path} is not JSON` }); continue; }
  if (path !== aggregateTranscriptPath(transcript.set, transcript.canonicalSha256)) findings.push({ rule: "transcript-path", message: `${path} is not content-addressed by its exact transcript canonical digest` });
  const history = immutableRecordHistory({ root, path });
  let closure = null;
  if (!transcript.plan || !isAggregateClosurePath(transcript.plan.closurePath)) findings.push({ rule: "closure-path", message: `${path} does not retain a closed immutable closure path` });
  else try { closure = JSON.parse(readHead(transcript.plan.closurePath)); }
  catch { findings.push({ rule: "closure", message: `${path} does not retain a readable immutable closure` }); }
  const qualificationContracts = {}, candidateContracts = {}, expectedRepositoryRedirects = [];
  try {
    if (validateAggregateClosure(plan, closure).length) throw new Error("closure references are not closed");
    const transition = JSON.parse(readHead("governance/package-identity-transition.json"));
    for (const entry of closure?.packages ?? []) {
      const qualification = JSON.parse(readHead(entry.qualification.path));
      qualificationContracts[`${entry.name}@${entry.version}`] = qualification.transcript;
      const publication = JSON.parse(readHead(entry.publication.path));
      candidateContracts[`${entry.name}@${entry.version}`] = { qualification: qualification.candidate, publication: publicationCandidate(publication, entry.publication.member) };
      const proof = publication.kind === "clossys-npmjs-trio-first-publication-v1" ? publication.members?.find((member) => member?.packageKey === entry.publication.member)?.registryProof : publication.registryProof;
      const historical = sealedHistoricalRepository({ entry, proof, transition });
      if (historical) expectedRepositoryRedirects.push({ ...historical, kind: "verified" });
    }
  } catch { findings.push({ rule: "evidence", message: `${path} cannot derive immutable qualification and repository redirect contracts` }); }
  findings.push(...validateAggregateClosure(plan, closure), ...validateSatisfiedAggregateTranscript(transcript, { plan, closure, qualificationContracts, candidateContracts, expectedRepositoryRedirects: canonicalRedirectProjection(expectedRepositoryRedirects) }), ...validateSatisfiedTranscriptHistory({ path, history }));
}
if (findings.length) {
  console.error("PUBLIC NPM AGGREGATE TRANSCRIPT INVALID");
  for (const item of findings) console.error(`- [${item.rule}] ${item.message}`);
  process.exitCode = 1;
} else console.log(`PUBLIC NPM AGGREGATE TRANSCRIPT RECORDS OK — ${files.length} immutable satisfied record(s).`);
