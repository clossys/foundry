import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRIO, TRIO_COHORT_PATH, isTrioCandidate } from "./release-qualification-trio.mjs";

export const ARCHETYPES = ["current-direct", "prior-minor", "oldest-supported", "control-plane"];
const DIMENSIONS = ["position", "completion", "rollback", "duplicate", "cadence", "closeWindow"];
const SHA1 = /^[a-f0-9]{40}$/, SHA256 = /^[a-f0-9]{64}$/, SHA512 = /^[a-f0-9]{128}$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOKENIZED_PATH = /^\$TEMP(?:\/[A-Za-z0-9@._-]+)+$/;
const REAL_TEMP_PATH = /(?:\/private)?\/(?:var\/folders|tmp)\/[A-Za-z0-9._/-]*foundry-candidate-|[A-Za-z]:\\[^\r\n]*\\(?:Temp|TMP)\\/i;
const RAW_MAX_FILES = 64, RAW_MAX_FILE_BYTES = 65_536, RAW_MAX_TOTAL_BYTES = 524_288, RAW_MAX_STREAM_BYTES = 65_536;
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const digest = (v) => createHash("sha256").update(v).digest("hex");
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (a, rule, message) => a.push({ rule, message });
function closed(a, v, allowed, path) { if (!object(v)) { fail(a, "shape", path); return; } for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(a, "unknown-field", path + "." + k); }
function stable(v) { if (Array.isArray(v)) return v.map(stable); if (object(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); return v; }
function canonicalInstant(value) { return typeof value === "string" && CANONICAL_INSTANT.test(value) && new Date(value).toISOString() === value; }
function containsUnsafeRaw(value) { return typeof value !== "string" || value.includes("\0") || REAL_TEMP_PATH.test(value); }
function normalizeFixtureInstant(value, instant) {
  if (typeof value === "string") return value.split(instant).join("$FIXTURE_MATERIALIZED_AT");
  if (Array.isArray(value)) return value.map((item) => normalizeFixtureInstant(item, instant));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeFixtureInstant(item, instant)]));
  return value;
}
function comparableTranscript(transcript) {
  const copy = structuredClone(transcript);
  delete copy.canonicalSha256;
  if (!transcript?.fixtureMaterializedAt) return copy;
  const normalized = normalizeFixtureInstant(copy, transcript.fixtureMaterializedAt);
  for (const observation of normalized.observations ?? []) {
    if (!object(observation.rawCaseEvidence)) continue;
    for (const input of observation.rawCaseEvidence.materializedInputs ?? []) input.sha256 = digest(input.bytes);
    observation.stdoutSha256 = digest(observation.rawCaseEvidence.stdout);
    observation.stderrSha256 = digest(observation.rawCaseEvidence.stderr);
  }
  return normalized;
}
function occurrences(value, needle) { return typeof value === "string" ? value.split(needle).length - 1 : 0; }
function checkRawCaseEvidence(a, observation, fixtureMaterializedAt) {
  const raw = observation?.rawCaseEvidence;
  closed(a, raw, ["argv", "materializedInputs", "exitCode", "stdout", "stderr"], "transcript.observation.rawCaseEvidence");
  const argv = raw?.argv;
  const fixtureArgs = Array.isArray(argv) ? argv.slice(3) : [];
  if (!Array.isArray(argv) || argv.length < 4 || argv.length > 12 || argv[0] !== "$NODE" || !TOKENIZED_PATH.test(argv[1] ?? "") || !argv[1].startsWith("$TEMP/node_modules/@clossys/starter/") || argv[2] !== "decide" || fixtureArgs.some((item) => !TOKENIZED_PATH.test(item ?? "") || !item.startsWith("$TEMP/fixtures/")) || argv.some(containsUnsafeRaw)) fail(a, "raw-case-argv", "raw Starter case argv must be bounded and tokenized.");
  const inputs = raw?.materializedInputs;
  let instantOccurrences = occurrences(raw?.stdout, fixtureMaterializedAt) + occurrences(raw?.stderr, fixtureMaterializedAt);
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > RAW_MAX_FILES) fail(a, "raw-case-inputs", "raw Starter case inputs must be bounded.");
  else {
    let total = 0; const paths = new Set();
    for (const input of inputs) {
      closed(a, input, ["path", "sha256", "bytes"], "transcript.observation.rawCaseEvidence.materializedInput");
      const size = typeof input?.bytes === "string" ? Buffer.byteLength(input.bytes) : -1;
      total += Math.max(size, 0); instantOccurrences += occurrences(input?.bytes, fixtureMaterializedAt);
      const joinedToArgument = fixtureArgs.some((argument) => input?.path === argument || input?.path?.startsWith(`${argument}/`));
      if (!TOKENIZED_PATH.test(input?.path ?? "") || !input.path.startsWith("$TEMP/fixtures/") || !joinedToArgument || paths.has(input.path) || size < 1 || size > RAW_MAX_FILE_BYTES || containsUnsafeRaw(input.bytes) || digest(input.bytes ?? "") !== input?.sha256) fail(a, "raw-case-input", "raw Starter case input must retain unique bounded tokenized bytes and its hash.");
      paths.add(input?.path);
    }
    const everyArgumentMaterialized = fixtureArgs.every((argument) => [...paths].some((path) => path === argument || path.startsWith(`${argument}/`)));
    if (total > RAW_MAX_TOTAL_BYTES || !everyArgumentMaterialized || JSON.stringify([...paths]) !== JSON.stringify([...paths].sort())) fail(a, "raw-case-inputs", "raw Starter case inputs must exactly cover the sorted argv inputs within the aggregate bound.");
  }
  if (![0, 1, 2].includes(raw?.exitCode) || raw.exitCode !== observation.observedExitCode || containsUnsafeRaw(raw?.stdout) || containsUnsafeRaw(raw?.stderr) || Buffer.byteLength(raw?.stdout ?? "") > RAW_MAX_STREAM_BYTES || Buffer.byteLength(raw?.stderr ?? "") > RAW_MAX_STREAM_BYTES || digest(raw?.stdout ?? "") !== observation.stdoutSha256 || digest(raw?.stderr ?? "") !== observation.stderrSha256) fail(a, "raw-case-result", "raw Starter case exit and output must match the hashed observation.");
  return instantOccurrences;
}

export function parseStrictJson(input) {
  const s = String(input); let i = 0;
  const ws = () => { while (/\s/.test(s[i] || "")) i += 1; };
  const str = () => { const start = i++; let esc = false; while (i < s.length) { const c = s[i++]; if (!esc && c === '"') return JSON.parse(s.slice(start, i)); esc = !esc && c === "\\"; if (c !== "\\") esc = false; } throw new SyntaxError("unterminated string"); };
  const val = () => { ws(); if (s[i] === "{") { i++; const seen = new Set(); ws(); while (s[i] !== "}") { if (s[i] !== '"') throw new SyntaxError("object key"); const k = str(); if (seen.has(k)) throw new SyntaxError("duplicate JSON key: " + k); seen.add(k); ws(); if (s[i++] !== ":") throw new SyntaxError("object colon"); val(); ws(); if (s[i] === ",") { i++; ws(); } else if (s[i] !== "}") throw new SyntaxError("object separator"); } i++; return; } if (s[i] === "[") { i++; ws(); while (s[i] !== "]") { val(); ws(); if (s[i] === ",") { i++; ws(); } else if (s[i] !== "]") throw new SyntaxError("array separator"); } i++; return; } if (s[i] === '"') { str(); return; } while (i < s.length && !/[\s,}\]]/.test(s[i])) i++; };
  val(); ws(); if (i !== s.length) throw new SyntaxError("trailing JSON"); return JSON.parse(s);
}
const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const blob = (root, ref, path) => execFileSync("git", ["show", ref + ":" + path], { cwd: root, encoding: "utf8" });
const content = (root, ref, path) => ref === "WORKTREE" ? readFileSync(join(root, path)) : blob(root, ref, path);
const POLICY_PATH = "governance/release-qualification-policy.json";
function selectedPolicy(root, candidate, ref) {
  const policy = parseStrictJson(content(root, ref, POLICY_PATH));
  const entry = policy.packages?.[candidate.name];
  if (!entry || typeof entry.recordStem !== "string" || typeof entry.packageDir !== "string" || typeof entry.adapterPath !== "string" || typeof entry.fixturePath !== "string") throw new Error("selected policy package entry");
  return entry;
}
export function qualificationPath(root, candidate, ref = "WORKTREE") {
  const entry = selectedPolicy(root, candidate, ref);
  return `governance/release-qualifications/${entry.recordStem}-${candidate.version}.json`;
}
export function qualificationIntroductionCommit(root, candidate, head = "HEAD", recordPath = qualificationPath(root, candidate)) {
  const path = recordPath;
  const commits = git(root, ["log", "--full-history", "--diff-filter=A", "--format=%H", head, "--", path]).split("\n").filter(Boolean);
  if (commits.length !== 1 || !SHA1.test(commits[0])) throw new Error("qualification record must have one introduction commit");
  return commits[0];
}
export function qualificationRecordHistory(root, path, candidate, head = "HEAD", expectedPath = qualificationPath(root, candidate)) {
  if (path !== expectedPath) throw new Error("qualification record path does not match its candidate");
  const introductionCommit = qualificationIntroductionCommit(root, candidate, head, expectedPath);
  return {
    introductionCommit,
    introducedRecordSha256: digest(content(root, introductionCommit, path)),
    retainedRecordSha256: digest(readFileSync(join(root, path))),
  };
}
function fixtureDigest(root, ref, adapterPath, fixturePath) { const adapter = parseStrictJson(content(root, ref, adapterPath)); if (!Array.isArray(adapter.fixtures)) throw new Error("adapter fixtures"); return digest(JSON.stringify(adapter.fixtures.slice().sort().map((name) => ({ path: fixturePath + "/" + name, sha256: digest(content(root, ref, fixturePath + "/" + name)) })))); }
export function currentQualificationJoins(root, candidate, ref = "WORKTREE") {
  const selected = selectedPolicy(root, candidate, ref), treeRef = ref === "WORKTREE" ? "HEAD" : ref;
  const adapter = parseStrictJson(content(root, ref, selected.adapterPath));
  const duplicateGroup = adapter.dimensionEvidence?.duplicate;
  const duplicateEvidence = Array.isArray(adapter.cases) ? adapter.cases.filter((item) => item.group === duplicateGroup && [0, 1].includes(item.exitCode)).map((item) => `case:${item.id}`) : [];
  const dimensions = DIMENSIONS.map((dimension) => {
    const rule = selected.dimensions?.[dimension];
    if (rule?.status === "unsupported") return { dimension, status: "unsupported", reason: rule.reason };
    if (dimension === "rollback") return { dimension, status: "supported", evidence: ["uninstall", "reinstall"] };
    if (dimension === "duplicate") return { dimension, status: "supported", evidence: duplicateEvidence };
    throw new Error("unsupported required dimension");
  });
  return { packageTreeSha1: git(root, ["rev-parse", treeRef + ":" + selected.packageDir]), packageManifestSha256: digest(content(root, ref, selected.packageDir + "/package.json")), rootPackageJsonSha256: digest(content(root, ref, "package.json")), rootPackageLockSha256: digest(content(root, ref, "package-lock.json")), policySha256: digest(JSON.stringify(stable(selected))), adapterSha256: digest(content(root, ref, selected.adapterPath)), fixtureSetSha256: fixtureDigest(root, ref, selected.adapterPath, selected.fixturePath), archetypes: ARCHETYPES.map((kind) => ({ kind, status: selected?.archetypes?.[kind]?.status === "required" ? "qualified" : "unsupported" })), dimensions };
}
function checkTranscript(a, t) {
  const v1 = t?.schema === "foundry-candidate-qualification-transcript-v1" && t?.version === 1;
  const v2 = t?.schema === "foundry-candidate-qualification-transcript-v2" && t?.version === 2;
  closed(a, t, ["schema", "version", "candidate", "archetype", "tarball", "peerInstall", "consumer", "coverage", "observations", "dimensions", "restoration", "mismatches", "ok", "canonicalSha256", ...(v2 ? ["fixtureMaterializedAt"] : [])], "transcript");
  if ((!v1 && !v2) || !object(t?.candidate) || !NAME.test(t.candidate.name) || !VERSION.test(t.candidate.version) || !ARCHETYPES.includes(t.archetype) || t.ok !== true || !SHA256.test(t.canonicalSha256)) fail(a, "transcript", "generic transcript");
  const rawStarter = v2 && t?.candidate?.name === "@clossys/starter";
  if (rawStarter ? !canonicalInstant(t?.fixtureMaterializedAt) : own(t ?? {}, "fixtureMaterializedAt")) fail(a, "fixture-materialized-at", "only a v2 @clossys/starter transcript must bind one canonical fixture materialization instant.");
  closed(a, t?.candidate, ["name", "version"], "transcript.candidate"); closed(a, t?.tarball, ["sha1", "sha256", "sha512"], "transcript.tarball"); closed(a, t?.consumer, ["manifestSha256", "lockfileSha256"], "transcript.consumer");
  if (!SHA1.test(t?.tarball?.sha1) || !SHA256.test(t?.tarball?.sha256) || !SHA512.test(t?.tarball?.sha512) || !SHA256.test(t?.consumer?.manifestSha256) || !SHA256.test(t?.consumer?.lockfileSha256)) fail(a, "transcript", "bytes");
  closed(a, t?.coverage, ["declaredExportKeys", "concreteTargets", "runtimeImports", "staticTargets", "failed", "installedManifestSha256", "bins", "lifecycleScriptsDisabled"], "transcript.coverage");
  if (!object(t?.coverage) || !["declaredExportKeys", "concreteTargets", "runtimeImports", "staticTargets", "failed", "bins"].every((k) => Number.isSafeInteger(t.coverage[k]) && t.coverage[k] >= 0) || t.coverage.concreteTargets !== t.coverage.runtimeImports + t.coverage.staticTargets || t.coverage.failed !== 0 || !SHA256.test(t.coverage.installedManifestSha256) || t.coverage.lifecycleScriptsDisabled !== true) fail(a, "coverage", "coverage");
  if (!Array.isArray(t?.observations) || t.observations.length < 1 || t.observations.length > 128) fail(a, "observations", "observations"); else { const ids = new Set(), count = Object.fromEntries(["install", "uninstall", "reinstall", "import", "help", "case"].map((k) => [k, 0])); let instantOccurrences = 0; for (const o of t.observations) { const allowsRaw = rawStarter && o?.kind === "case"; closed(a, o, ["id", "kind", "launch", "expectedExitCode", "observedExitCode", "signal", "launchError", "stdoutSha256", "stderrSha256", ...(allowsRaw ? ["rawCaseEvidence"] : [])], "transcript.observation"); count[o?.kind] = (count[o?.kind] || 0) + 1; if (ids.has(o?.id)) fail(a, "observation", "duplicate id"); ids.add(o?.id); const launch = ["install", "uninstall", "reinstall"].includes(o?.kind) ? "npm-fixed" : "node-direct"; if (!text(o?.id) || !text(o?.kind) || o.launch !== launch || ![0, 1, 2].includes(o.expectedExitCode) || o.observedExitCode !== o.expectedExitCode || o.signal !== null || o.launchError !== false || !SHA256.test(o.stdoutSha256) || !SHA256.test(o.stderrSha256)) fail(a, "observation", "observation");
      if (allowsRaw) instantOccurrences += checkRawCaseEvidence(a, o, t.fixtureMaterializedAt);
      else if (own(o ?? {}, "rawCaseEvidence")) fail(a, "raw-case-scope", "raw case evidence is allowed only on v2 @clossys/starter case observations.");
    } if (count.install !== 1 || count.uninstall !== 1 || count.reinstall !== 1 || count.import !== t.coverage?.runtimeImports || count.help !== t.coverage?.bins || ![0, 1, 2].every((exit) => t.observations.some((o) => o.kind === "case" && o.observedExitCode === exit && (!rawStarter || object(o.rawCaseEvidence)))) || (rawStarter && instantOccurrences < 1)) fail(a, "observations", "operation coverage"); }
  if (!Array.isArray(t?.dimensions) || JSON.stringify(t.dimensions.map((d) => d?.dimension)) !== JSON.stringify(DIMENSIONS)) fail(a, "dimensions", "dimensions"); else for (const d of t.dimensions) { closed(a, d, ["dimension", "status", "reason", "evidence"], "transcript.dimension"); if (!["supported", "unsupported"].includes(d.status) || (d.status === "unsupported" && (!text(d.reason) || own(d, "evidence"))) || (d.status === "supported" && own(d, "reason"))) fail(a, "dimensions", "dimension"); if (d.dimension === "rollback" && d.status === "supported" && JSON.stringify(d.evidence) !== JSON.stringify(["uninstall", "reinstall"])) fail(a, "dimensions", "rollback evidence"); if (d.dimension === "duplicate" && d.status === "supported" && (!Array.isArray(d.evidence) || d.evidence.length !== 2 || !d.evidence.every((id) => /^case:/.test(id)))) fail(a, "dimensions", "duplicate evidence"); }
  closed(a, t?.restoration, ["manifestRestored", "lockfileRestored", "packageAbsentAfterUninstall"], "transcript.restoration"); if (t?.restoration?.manifestRestored !== true || t?.restoration?.lockfileRestored !== true || t?.restoration?.packageAbsentAfterUninstall !== true || !Array.isArray(t?.mismatches) || t.mismatches.length !== 0) fail(a, "restoration", "restoration");
  const copy = { ...t }; delete copy.canonicalSha256; if (digest(JSON.stringify(copy)) !== t?.canonicalSha256) fail(a, "transcript-digest", "canonical digest");
}
export function validateCandidateQualification(r, { mode = "offline", expected, freshTranscript } = {}) {
  const a = []; if (!object(r) || r.schemaVersion !== 2) { fail(a, "record-shape", "schema v2"); return a; }
  const pre = r.timing === "pre-publication", post = r.timing === "post-publication-bootstrap"; closed(a, r, pre ? ["schemaVersion", "timing", "candidate", "archetypes", "reviewedCommit", "rootPackageJsonSha256", "rootPackageLockSha256", "transcript", "candidateReview", "findings"] : ["schemaVersion", "timing", "candidate", "archetypes", "publishedCommit", "transcript", "registry", "findings"], "record");
  if (!pre && !post) fail(a, "timing", "timing"); if (mode === "prepublish" && !pre) fail(a, "bootstrap-timing", "bootstrap is not authorization");
  if (mode === "prepublish" && (!object(expected) || !object(freshTranscript) || !["name", "version", "packageTreeSha1", "packageManifestSha256", "rootPackageJsonSha256", "rootPackageLockSha256", "policySha256", "adapterSha256", "fixtureSetSha256", "archetypes", "dimensions"].every((key) => expected[key] !== undefined))) fail(a, "prepublish-evidence", "complete current joins and a fresh transcript are required.");
  const c = r.candidate; closed(a, c, ["name", "version", "packageTreeSha1", "packageManifestSha256", "policySha256", "adapterSha256", "fixtureSetSha256", "tarball"], "candidate"); closed(a, c?.tarball, ["sha1", "sha256", "sha512"], "candidate.tarball");
  if (!Array.isArray(r.archetypes) || JSON.stringify(r.archetypes.map((x) => x?.kind)) !== JSON.stringify(ARCHETYPES) || !r.archetypes.every((x) => object(x) && ["qualified", "unsupported"].includes(x.status) && Object.keys(x).every((k) => ["kind", "status"].includes(k)))) fail(a, "archetypes", "ordered policy-derived archetypes required.");
  if (expected?.archetypes && JSON.stringify(r.archetypes) !== JSON.stringify(expected.archetypes)) fail(a, "archetypes", "archetypes differ from policy.");
  if (!NAME.test(c?.name) || !VERSION.test(c?.version) || !SHA1.test(c?.packageTreeSha1) || !["packageManifestSha256", "policySha256", "adapterSha256", "fixtureSetSha256"].every((k) => SHA256.test(c?.[k])) || !SHA1.test(c?.tarball?.sha1) || !SHA256.test(c?.tarball?.sha256) || !SHA512.test(c?.tarball?.sha512)) fail(a, "candidate", "candidate joins");
  if (expected) { for (const k of ["packageTreeSha1", "packageManifestSha256", "policySha256", "adapterSha256", "fixtureSetSha256", ...(pre ? ["rootPackageJsonSha256", "rootPackageLockSha256"] : [])]) if (expected[k] !== undefined && (r[k] ?? c?.[k]) !== expected[k]) fail(a, "content-join", k); if ((expected.name && c?.name !== expected.name) || (expected.version && c?.version !== expected.version)) fail(a, "identity-join", "identity"); }
  checkTranscript(a, r.transcript); if (r.transcript?.candidate?.name !== c?.name || r.transcript?.candidate?.version !== c?.version || ["sha1", "sha256", "sha512"].some((k) => r.transcript?.tarball?.[k] !== c?.tarball?.[k]) || r.transcript?.coverage?.installedManifestSha256 !== c?.packageManifestSha256) fail(a, "transcript-join", "transcript joins");
  if (expected?.dimensions && JSON.stringify(r.transcript?.dimensions) !== JSON.stringify(expected.dimensions)) fail(a, "dimensions", "dimensions differ from policy and adapter evidence.");
  if (freshTranscript) {
    const freshFindings = []; checkTranscript(freshFindings, freshTranscript);
    for (const finding of freshFindings) fail(a, "fresh-transcript-" + finding.rule, "fresh transcript is invalid before replay comparison");
    if (freshFindings.length === 0 && JSON.stringify(stable(comparableTranscript(r.transcript))) !== JSON.stringify(stable(comparableTranscript(freshTranscript)))) fail(a, "fresh-transcript", "fresh transcript");
  }
  if (pre) { if (!SHA1.test(r.reviewedCommit) || !SHA256.test(r.rootPackageJsonSha256) || !SHA256.test(r.rootPackageLockSha256)) fail(a, "prepublication-join", "pre joins"); closed(a, r.candidateReview, ["headSha", "reference"], "candidateReview"); if (r.candidateReview?.headSha !== r.reviewedCommit || !text(r.candidateReview?.reference)) fail(a, "candidate-review", "review"); }
  if (post) { if (!SHA1.test(r.publishedCommit)) fail(a, "published-commit", "published"); closed(a, r.registry, ["reference", "sha1", "sha256", "sha512"], "registry"); if (!text(r.registry?.reference) || ["sha1", "sha256", "sha512"].some((k) => r.registry?.[k] !== c?.tarball?.[k])) fail(a, "registry", "registry"); }
  if (!Array.isArray(r.findings) || r.findings.length > 64) fail(a, "findings", "findings"); else for (const f of r.findings) { closed(a, f, ["classification", "status", "reference"], "finding"); if (!["producer-package", "consumer-integration", "control-plane", "sponsor-authorization", "external-observation"].includes(f?.classification) || !["resolved", "open"].includes(f?.status) || !text(f?.reference)) fail(a, "finding", "finding"); else if (f.classification === "producer-package" && f.status !== "resolved") fail(a, "unresolved-producer-defect", "producer"); }
  return a;
}
export function validatePrepublicationPrTail(r, { root = process.cwd(), head = "HEAD", trioRecords = [], cohort = null } = {}) {
  const a = []; if (r?.timing !== "pre-publication") return a; try { execFileSync("git", ["merge-base", "--is-ancestor", r.reviewedCommit, head], { cwd: root, stdio: "ignore" }); } catch { fail(a, "reviewed-ancestor", "not ancestor"); return a; }
  const changed = git(root, ["diff", "--name-only", r.reviewedCommit + ".." + head]).split("\n").filter(Boolean).sort();
  let allowed = [qualificationPath(root, r.candidate, r.reviewedCommit)];
  if (isTrioCandidate(r.candidate) && trioRecords.length > 0) {
    const exact = TRIO.map((key) => trioRecords.find((record) => record?.candidate?.name === `@clossys/${key}`));
    if (exact.some((record) => !record) || exact.some((record) => record.timing !== "pre-publication" || record.reviewedCommit !== r.reviewedCommit)) {
      fail(a, "trio-tail", "Trio qualification requires all three pre-publication records at one reviewed commit.");
    } else if (!cohort || cohort.id !== "clossys-npmjs-trio") {
      fail(a, "trio-cohort", "Trio qualification requires its exact immutable cohort record.");
    } else {
      allowed = [...exact.map((record) => qualificationPath(root, record.candidate, r.reviewedCommit)), TRIO_COHORT_PATH].sort();
    }
  }
  if (JSON.stringify(changed) !== JSON.stringify(allowed)) fail(a, "pr-tail", "tail");
  try { const base = currentQualificationJoins(root, r.candidate, r.reviewedCommit), now = currentQualificationJoins(root, r.candidate, head); for (const k of Object.keys(base).filter((key) => !["archetypes", "dimensions"].includes(key))) if (base[k] !== now[k] || base[k] !== (r[k] ?? r.candidate[k])) fail(a, "git-content-join", k); if (JSON.stringify(base.archetypes) !== JSON.stringify(now.archetypes) || JSON.stringify(base.archetypes) !== JSON.stringify(r.archetypes) || JSON.stringify(base.dimensions) !== JSON.stringify(now.dimensions) || JSON.stringify(base.dimensions) !== JSON.stringify(r.transcript?.dimensions)) fail(a, "git-content-join", "policy derivation"); } catch (e) { fail(a, "git-content-join", e instanceof Error ? e.message : "git"); }
  return a;
}
