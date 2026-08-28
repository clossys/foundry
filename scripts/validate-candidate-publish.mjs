import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { currentQualificationJoins, parseStrictJson, qualificationPath, validateCandidateQualification } from "./lib/candidate-qualification.mjs";
import { selectPolicyPackage, validateReleaseQualificationPolicy } from "./lib/release-qualification-contract.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const usage = "Usage: --package <package-key> --tarball <file> --transcript <file> --mode <prepublish|bootstrap>";
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function argsFrom(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i]?.slice(2), value = argv[i + 1];
    if (!Object.hasOwn({ package: true, tarball: true, transcript: true, mode: true }, flag) || !value || args[flag] !== undefined) throw new Error(usage);
    args[flag] = value;
  }
  if (Object.keys(args).length !== 4 || !KEY.test(args.package) || !["prepublish", "bootstrap"].includes(args.mode)) throw new Error(usage);
  return args;
}
function regular(path, label) { const file = resolve(path), stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`); return file; }
export function freezeTarball(path) {
  const source = regular(path, "tarball"), bytes = readFileSync(source), root = mkdtempSync(join(tmpdir(), "foundry-publish-validation-")), tarball = join(root, "candidate.tgz");
  writeFileSync(tarball, bytes);
  return { bytes, tarball, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function validateCandidatePublish({ root = process.cwd(), args }) {
  const policy = parseStrictJson(readFileSync(resolve(root, "governance/release-qualification-policy.json"), "utf8"));
  const policyFindings = validateReleaseQualificationPolicy(policy);
  if (policyFindings.length) throw new Error("invalid qualification policy");
  const selected = selectPolicyPackage(policy, args.package);
  if (!selected) throw new Error("package key has no unique policy entry");
  const transcriptPath = regular(args.transcript, "transcript"), frozen = freezeTarball(args.tarball);
  try {
    const manifest = parseStrictJson(execFileSync("tar", ["-xOf", frozen.tarball, "package/package.json"], { encoding: "utf8" }));
    if (!NAME.test(manifest?.name) || !VERSION.test(manifest?.version) || manifest.name !== selected.name) throw new Error("packed manifest identity is invalid");
    const candidate = { name: manifest.name, version: manifest.version };
    const recordPath = resolve(root, qualificationPath(root, candidate));
    const record = parseStrictJson(readFileSync(regular(recordPath, "qualification record"), "utf8"));
    const transcript = parseStrictJson(readFileSync(transcriptPath, "utf8"));
    const expected = { name: manifest.name, version: manifest.version, ...currentQualificationJoins(root, candidate) };
    const hashes = { sha1: sha("sha1", frozen.bytes), sha256: sha("sha256", frozen.bytes), sha512: sha("sha512", frozen.bytes) };
    const findings = validateCandidateQualification(record, { mode: args.mode === "prepublish" ? "prepublish" : "offline", expected, freshTranscript: transcript });
    if (args.mode === "bootstrap" && record.timing !== "post-publication-bootstrap") findings.push({ rule: "bootstrap-timing", message: "bootstrap validation requires a bootstrap record." });
    if (["sha1", "sha256", "sha512"].some((key) => record.candidate?.tarball?.[key] !== hashes[key])) findings.push({ rule: "tarball", message: "exact tarball differs from record." });
    return findings;
  } finally { frozen.cleanup(); }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = argsFrom(process.argv);
  const findings = validateCandidatePublish({ args });
  for (const finding of findings) console.error(`[${finding.rule}] ${finding.message}`);
  if (findings.length) process.exitCode = 1;
}
export { argsFrom };
