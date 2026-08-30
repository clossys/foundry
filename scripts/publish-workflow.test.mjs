import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import "./check-public-npm-provenance.test.mjs";

const workflow = readFileSync(".github/workflows/publish.yml", "utf8");

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/m);
  return workflow.slice(start, next === -1 ? workflow.length : start + 1 + next);
}

test("trusted publication is manual, reviewed, and never triggered by a push", () => {
  assert.doesNotMatch(workflow, /^\s+push:/m);
  const publish = job("publish");
  assert.match(publish, /if: \$\{\{ always\(\) && needs\.discover\.result == 'success' && needs\.qualify\.result == 'success' && github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && !inputs\.dry_run && !inputs\.verify_only/);
  assert.match(publish, /environment: npm-publish/);
  assert.doesNotMatch(publish, /if: \$\{\{ false \}\}|github\.event_name == 'push'/);
});

test("publish evaluates after a skipped verify-only fetch but requires successful qualification", () => {
  const qualify = job("qualify");
  const publish = job("publish");

  assert.match(qualify, /if: \$\{\{ always\(\) && needs\.discover\.outputs\.packages != '\[\]' && \(!inputs\.verify_only \|\| needs\.fetch-published\.result == 'success'\) \}\}/);
  assert.match(publish, /if: \$\{\{ always\(\) && needs\.discover\.result == 'success' && needs\.qualify\.result == 'success' &&/);
  assert.doesNotMatch(publish, /if: \$\{\{ always\(\) && needs\.discover\.outputs\.packages/);
});

test("every package-capable execution job checks the closed release catalogue", () => {
  assert.equal((workflow.match(/node scripts\/check-release-catalog\.mjs --package "\$PKG"/g) ?? []).length, 2);
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
  assert.match(qualify, /run-candidate-qualification\.mjs --package "\$PKG" --tarball "\$TARBALL"/);
  assert.match(qualify, /npm publish "\$TARBALL" --dry-run --access public --ignore-scripts --registry "\$registry"/);
  assert.match(qualify, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(qualify, /candidate\.tgz/);
  assert.match(qualify, /transcript\.json/);
});

test("OIDC publish consumes the exact handoff with upload-only trust and no token", () => {
  const publish = job("publish");
  assert.match(publish, /needs: \[discover, qualify\]/);
  assert.match(publish, /permissions:\n      contents: read\n      id-token: write/);
  assert.match(publish, /environment: npm-publish/);
  assert.match(publish, /node-version: 24/);
  assert.doesNotMatch(publish, /^\s+cache:/m);
  assert.match(publish, /trusted-publishing floor 22\.14/);
  assert.match(publish, /trusted-publishing floor 11\.5\.1/);
  assert.match(publish, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/);
  assert.match(publish, /check-artifact-safety\.mjs/);
  assert.match(publish, /validate-candidate-publish\.mjs/);
  assert.doesNotMatch(publish, /\n\s+(?:result=.*)?npm pack|run-candidate-qualification/);
  assert.doesNotMatch(publish, /NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|secrets\.GITHUB_TOKEN|secrets\.NPM_TOKEN/);
  assert.match(publish, /name: Verify exact tarball is unchanged/);
  assert.match(publish, /transcript\.json/);
  assert.match(publish, /npm publish "\$TARBALL" --provenance --access public --ignore-scripts --registry "\$REGISTRY"/);
  assert.match(publish, /name: Fetch and compare published tarball/);
  assert.match(publish, /npm pack "\$\{package_name\}@\$\{package_version\}" --ignore-scripts --registry "\$REGISTRY"/);
  assert.match(publish, /for algorithm in sha1 sha256 sha512/);

  const verification = job("verify-published");
  assert.match(verification, /needs: \[discover, publish\]/);
  assert.match(verification, /needs\.publish\.result == 'success'/);
  assert.match(verification, /check-registry-parity\.mjs --package "\$PKG"/);
  assert.match(verification, /npm audit signatures --json --include-attestations/);
  assert.match(verification, /check-public-npm-provenance\.mjs/);
  assert.match(verification, /--source-sha "\$SOURCE_SHA"/);
  assert.doesNotMatch(verification, /packages:|id-token:|NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|environment:/);
});

test("no predecessor registry token or visibility mode remains in the public npm workflow", () => {
  assert.doesNotMatch(workflow, /visibility_only|GH_PACKAGES_TOKEN|check-package-visibility\.mjs/);
  assert.equal((workflow.match(/id-token:\s*write/g) ?? []).length, 1);
  assert.equal((workflow.match(/\bnpm publish "\$TARBALL"(?! --dry-run)/g) ?? []).length, 1);
});
