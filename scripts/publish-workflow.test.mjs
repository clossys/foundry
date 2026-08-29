import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/publish.yml", "utf8");

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/m);
  return workflow.slice(start, next === -1 ? workflow.length : start + 1 + next);
}

test("W1D keeps upload disabled and has no automatic publication trigger", () => {
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.match(job("publish"), /^  publish:\n[\s\S]*?\n    if: \$\{\{ false \}\}/m);
  assert.match(job("publish"), /W1D prepares source only/);
});

test("every package-capable job checks the closed release catalogue", () => {
  assert.equal((workflow.match(/node scripts\/check-release-catalog\.mjs --package "\$PKG"/g) ?? []).length, 3);
  assert.equal((workflow.match(/node scripts\/check-release-catalog\.mjs --package "\$MANUAL_PACKAGE"/g) ?? []).length, 1);
  assert.match(workflow, /current exact Advisor, Starter, Controller public-npm launch target/);
});

test("publish packs one candidate and hands off exact bytes", () => {
  assert.equal((workflow.match(/npm pack --ignore-scripts --json --pack-destination/g) ?? []).length, 1);
  assert.equal(workflow.includes("packRoundTrip"), false);
  assert.equal(workflow.includes("steps.pack.outputs"), false);
  for (const text of [
    "node scripts/check-artifact-safety.mjs \"packages/$PKG\"",
    "--tarball \"$TARBALL\"",
    "--sha1 \"$TARBALL_SHA1\"",
    "--sha256 \"$TARBALL_SHA256\"",
    "--sha512 \"$TARBALL_SHA512\"",
    "run-candidate-qualification.mjs --package \"$PKG\" --tarball \"$TARBALL\"",
    "validate-candidate-publish.mjs --package \"$PKG\" --tarball \"$TARBALL\"",
    "name: qualified-candidate-${{ matrix.package }}",
    "name: Download exact qualified candidate",
  ]) assert.ok(workflow.includes(text), `missing workflow assertion: ${text}`);
});

test("published verification fetch is anonymous, isolated, and read-only", () => {
  const fetch = job("fetch-published");
  assert.match(fetch, /if:.*inputs\.verify_only/);
  assert.match(fetch, /permissions:\n      contents: read/);
  assert.doesNotMatch(fetch, /packages:|NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|id-token:/);
  assert.match(fetch, /fetch-public-npm-artifact\.mjs --package "\$PKG" --output "\$destination"/);
  assert.match(fetch, /registry-proof\.json/);
  assert.match(fetch, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.doesNotMatch(fetch, /run-candidate-qualification|import\(/);
});

test("qualification is least privilege and owns candidate execution", () => {
  const qualify = job("qualify");
  assert.match(qualify, /needs: \[discover, fetch-published\]/);
  assert.match(qualify, /permissions:\n      contents: read/);
  assert.doesNotMatch(qualify, /packages:|id-token:|environment:|NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|PUBLIC_SAFETY_DENYLIST|denylist/);
  assert.match(qualify, /persist-credentials: false/);
  assert.match(qualify, /npm ci --ignore-scripts/);
  assert.match(qualify, /npm pack --ignore-scripts --json --pack-destination/);
  assert.match(qualify, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/);
  assert.match(qualify, /validate-public-npm-registry-proof\.mjs --package "\$PKG" --tarball "\$TARBALL" --proof "\$PROOF"/);
  assert.match(qualify, /run-candidate-qualification\.mjs --package \"\$PKG\" --tarball \"\$TARBALL\"/);
  assert.match(qualify, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(qualify, /candidate\.tgz/);
  assert.match(qualify, /transcript\.json/);
});

test("privileged publish consumes handoff and does not repack or execute candidate", () => {
  const publish = job("publish");
  assert.match(publish, /needs: \[discover, qualify\]/);
  assert.match(publish, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/);
  assert.match(publish, /check-artifact-safety\.mjs/);
  assert.match(publish, /validate-candidate-publish\.mjs/);
  assert.doesNotMatch(publish, /\n\s+(?:result=.*)?npm pack|run-candidate-qualification/);
  assert.doesNotMatch(publish, /VISIBILITY_ONLY:/);
  assert.match(publish, /name: Verify exact tarball is unchanged/);
  assert.match(publish, /transcript\.json/);
  assert.match(publish, /name: Fetch and compare published tarball/);
  assert.match(publish, /npm pack "\$\{package_name\}@\$\{package_version\}" --ignore-scripts/);
  assert.match(publish, /for algorithm in sha1 sha256 sha512/);

  const visibility = job("visibility-check");
  assert.match(visibility, /needs: \[discover, publish\]/);
  assert.match(visibility, /if: \$\{\{ always\(\)/);
  assert.doesNotMatch(visibility, /needs\.publish\.result == 'success'|verify-published/);
});
