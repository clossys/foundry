#!/usr/bin/env node
// Verify one exact public npm package's provenance after publication.
//
// npm itself performs the cryptographic Sigstore verification and writes its
// `npm audit signatures --json --include-attestations` result to a private
// temporary file. This checker then closes the package-specific join that a
// bare successful audit cannot express: the verified SLSA statement must name
// the exact package/version, the public packument's SHA-512 tarball digest,
// this repository, this workflow, and the source commit supplied by the
// protected release job.
//
// Exit 0 = exact provenance verified. Exit 1 = a concrete mismatch. Exit 2 =
// malformed input or an unreadable registry answer; uncertainty never passes.
//
// THE JOIN ITSELF LIVES IN scripts/lib/provenance-join.mjs, not here.
// `integrator-provenance-check` (issue #885) needs exactly this same
// subject/digest/repository/workflow join to verify an already-installed
// package from the public attestations endpoint directly (pnpm has no `npm
// audit signatures` to read instead). The canonical, richly-typed
// implementation lives in `packages/integrator/src/provenance.ts` -- that
// package's own published source -- and `scripts/lib/provenance-join.mjs` is
// a dependency-free plain-JS mirror of it, kept in lockstep by
// `packages/integrator/src/provenance-join-parity.test.ts`. This script
// cannot import `provenance.ts` directly: this script runs inside
// `check:gates`, which the `safety`/`publish safety` CI job pins to Node 20
// (`.github/workflows/ci.yml`), and Node 20 has no native TypeScript
// stripping at all (that landed experimentally at 22.6, stable/unflagged at
// 23.6; see https://nodejs.org/api/typescript.html) -- so importing a `.ts`
// file there throws before any test body runs. `scripts/lib/provenance-
// join.mjs` has no such requirement: it is plain JavaScript.
//
// This import works with NO build step and NO `npm install` in between,
// which matters: `publish.yml`'s `verify-published` job deliberately runs
// this script with nothing but a checkout -- no install, no build -- to keep
// anonymous post-publish verification cheap.
import { readFileSync } from "node:fs";
import { inspectPublicNpmProvenance } from "./lib/provenance-join.mjs";

export { inspectPublicNpmProvenance };

const PUBLIC_REGISTRY = "https://registry.npmjs.org";

async function main() {
  const argv = process.argv.slice(2);
  let packageDirectory;
  let auditResultPath;
  let sourceSha;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--package" && index + 1 < argv.length) packageDirectory = argv[++index];
    else if (argv[index] === "--audit-result" && index + 1 < argv.length) auditResultPath = argv[++index];
    else if (argv[index] === "--source-sha" && index + 1 < argv.length) sourceSha = argv[++index];
    else {
      console.error("usage: check-public-npm-provenance.mjs --package <directory> --audit-result <path> --source-sha <40-hex>");
      process.exit(2);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(packageDirectory ?? "") || typeof auditResultPath !== "string") {
    console.error("check-public-npm-provenance: exact package directory and audit result path are required");
    process.exit(2);
  }

  let manifest;
  let audit;
  try {
    manifest = JSON.parse(readFileSync(`packages/${packageDirectory}/package.json`, "utf8"));
    audit = JSON.parse(readFileSync(auditResultPath, "utf8"));
  } catch (error) {
    console.error(`check-public-npm-provenance: could not read local evidence: ${error.message}`);
    process.exit(2);
  }

  let response;
  let packument;
  try {
    response = await fetch(`${PUBLIC_REGISTRY}/${encodeURIComponent(manifest.name)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    packument = await response.json();
  } catch (error) {
    console.error(`check-public-npm-provenance: public npm packument is unreadable: ${error.message}`);
    process.exit(2);
  }

  const result = inspectPublicNpmProvenance({ name: manifest.name, version: manifest.version, sourceSha, audit, packument });
  if (result.code === 0) {
    console.log(`check-public-npm-provenance: ${manifest.name}@${manifest.version} exact Sigstore/SLSA provenance verified.`);
  } else {
    for (const failure of result.failures) console.error(`check-public-npm-provenance: ${failure}`);
  }
  process.exit(result.code);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
