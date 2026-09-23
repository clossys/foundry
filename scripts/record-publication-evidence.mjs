#!/usr/bin/env node
// CI entry point for issue #1346's automatic publication-evidence follow-up
// workflow (.github/workflows/record-publication-evidence.yml). Builds one
// governance/release-publications/later/<key>-<version>.json record for a
// package this repository's publish.yml just uploaded, using only measured
// data — the public npm registry, the exact GitHub Actions run that
// published it, and the already-retained qualification record — via
// scripts/lib/publication-evidence-run.mjs's orchestration over
// scripts/record-later-publication.mjs's own exported functions.
//
// Deliberately narrow: this script only BUILDS and WRITES the record file
// into the working tree (via record-later-publication.mjs's own no-overwrite
// writer). It never touches git, never pushes, and never opens a pull
// request — the calling workflow does that, in a separate step, so a
// credential this script never needs (a version-control token) is kept out
// of the one path that must stay credential-free per
// scripts/lib/candidate-runner.mjs's assertCredentialFree().
//
// GITHUB_TOKEN, if present, is used ONLY to authenticate this script's own
// GitHub API reads (the workflow run's artifact list, and the replay
// fallback's artifact download) — never passed into
// createLaterPublicationRecord's `env`, which must stay credential-free.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseStrictJson } from "./lib/candidate-qualification.mjs";
import { buildPublicationEvidenceInput, buildPublicationRecordWithFallback, fetchPublishedAt } from "./lib/publication-evidence-run.mjs";

const USAGE = "Usage: --package <key> --run-id <n> --run-attempt <n> --source-sha <sha>";
const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA1 = /^[a-f0-9]{40}$/;

export function argsFrom(argv) {
  const result = {};
  const seen = new Set();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2);
    const value = argv[index + 1];
    if (!Object.hasOwn({ package: true, "run-id": true, "run-attempt": true, "source-sha": true }, key) || !value || seen.has(key)) throw new Error(USAGE);
    seen.add(key);
    result[key] = value;
  }
  if (!result.package || !result["run-id"] || !result["run-attempt"] || !result["source-sha"] || !KEY.test(result.package) || !SHA1.test(result["source-sha"])) throw new Error(USAGE);
  return result;
}

/** Add GitHub API auth only to api.github.com requests; every other fetch (the public npm registry) stays anonymous, unmodified. */
export function githubAuthenticatedFetch(token, fetchImpl = fetch) {
  return async (url, init = {}) => {
    const target = typeof url === "string" ? url : url?.url;
    if (typeof target === "string" && target.startsWith("https://api.github.com/")) {
      const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetchImpl(url, { ...init, headers });
    }
    return fetchImpl(url, init);
  };
}

export async function recordPublicationEvidence({
  root = process.cwd(),
  packageKey,
  runId,
  runAttempt,
  sourceSha,
  fetchImpl = fetch,
  githubToken = process.env.GITHUB_TOKEN,
  readManifest = (path) => parseStrictJson(readFileSync(path, "utf8")),
  writeOutput = writeFileSync,
  makeTempDir = () => mkdtempSync(join(tmpdir(), "foundry-publication-evidence-")),
  findArtifact,
  downloadZip,
  createRecord,
} = {}) {
  const absoluteRoot = resolve(root);
  const manifest = readManifest(join(absoluteRoot, "packages", packageKey, "package.json"));
  const { name, version } = manifest;
  if (typeof name !== "string" || typeof version !== "string") throw new Error(`packages/${packageKey}/package.json has no name/version`);

  const authenticatedFetch = githubAuthenticatedFetch(githubToken, fetchImpl);
  const publishedAt = await fetchPublishedAt({ fetchImpl: authenticatedFetch, name, version });
  const publication = buildPublicationEvidenceInput({ runId, runAttempt, sourceSha, publishedAt, name, version });

  const tempDir = makeTempDir();
  const publicationPath = join(tempDir, "publication-evidence.json");
  writeOutput(publicationPath, `${JSON.stringify(publication, null, 2)}\n`);

  const qualificationPath = `governance/release-qualifications/clossys-${packageKey}-${version}.json`;
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

  return buildPublicationRecordWithFallback({
    root: absoluteRoot, packageKey, qualificationPath, publicationPath, fetchImpl: authenticatedFetch, env, runId, tempDir, writeFile: writeOutput,
    ...(findArtifact ? { findArtifact } : {}), ...(downloadZip ? { downloadZip } : {}), ...(createRecord ? { createRecord } : {}),
  });
}

async function main() {
  const args = argsFrom(process.argv);
  const result = await recordPublicationEvidence({
    packageKey: args.package,
    runId: Number(args["run-id"]),
    runAttempt: Number(args["run-attempt"]),
    sourceSha: args["source-sha"],
  });
  const manifest = parseStrictJson(readFileSync(join(process.cwd(), "packages", args.package, "package.json"), "utf8"));
  process.stdout.write(`publication evidence recorded: ${result.path}\n`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `record-path=${result.path}\nname=${manifest.name}\nversion=${manifest.version}\n`, { flag: "a" });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await main();
  } catch (error) {
    console.error(`record-publication-evidence: ${error.message}`);
    process.exitCode = 1;
  }
}
