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

function step(selected, name) {
  const start = selected.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `workflow is missing ${name} step`);
  const rest = selected.slice(start + 1);
  const next = rest.search(/^      - name: /m);
  return selected.slice(start, next === -1 ? selected.length : start + 1 + next);
}

function assertPostPublishVisibilityStep(selected) {
  const exactLines = selected.split("\n");
  const count = (line) => exactLines.filter((candidate) => candidate === line).length;
  assert.equal(
    count("          PKG: ${{ matrix.package }}"),
    1,
    "post-publish verifier must bind exactly one matrix package",
  );
  assert.equal(
    count("          PUBLISH_RELEASE_TARGET: ${{ inputs.release_target }}"),
    1,
    "post-publish verifier must bind exactly one release target",
  );
  assert.equal(
    count("          EXPECTED_TARBALL: ${{ runner.temp }}/qualification/${{ matrix.package }}/candidate.tgz"),
    1,
    "post-publish verifier must bind exactly one qualified tarball",
  );
  assert.equal(
    count('          node scripts/verify-post-publish-public-npm-artifact.mjs --package "$PKG" --expected-tarball "$EXPECTED_TARBALL"'),
    1,
    "post-publish verifier must use its closed exact command",
  );
}

function position(text, needle) {
  const index = text.indexOf(needle);
  assert.notEqual(index, -1, `missing workflow assertion: ${needle}`);
  return index;
}

function assertPinnedReplayRuntime(selected, name, firstNpmOperation) {
  const setup = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
  const assertion = "- name: Assert replay toolchain";
  assert.equal((selected.match(new RegExp(setup, "g")) ?? []).length, 1);
  assert.match(selected, /node-version: 24\.19\.0/);
  assert.match(selected, /test "\$\(node --version\)" = 'v24\.19\.0'/);
  assert.match(selected, /test "\$\(npm --version\)" = '11\.17\.0'/);
  assert.match(selected, /test "\$\(node -p 'process\.versions\.zlib'\)" = '1\.3\.2\.1-motley-3246f1b'/);
  assert.ok(position(selected, setup) < position(selected, assertion), `${name} must set up Node before asserting it`);
  assert.ok(position(selected, assertion) < position(selected, firstNpmOperation), `${name} must assert the replay runtime before npm work`);
}

test("trusted publication is manual, reviewed, and never triggered by a push", () => {
  assert.doesNotMatch(workflow, /^\s+push:/m);
  const publish = job("publish");
  assert.match(publish, /if: \$\{\{ always\(\) && !cancelled\(\) && needs\.discover\.result == 'success' && needs\.qualify\.result == 'success' && github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && !inputs\.dry_run && !inputs\.verify_only/);
  assert.match(publish, /environment: npm-publish/);
  assert.doesNotMatch(publish, /if: \$\{\{ false \}\}|github\.event_name == 'push'/);
});

test("publish evaluates after a skipped verify-only fetch but requires successful qualification", () => {
  const qualify = job("qualify");
  const publish = job("publish");

  assert.match(qualify, /if: \$\{\{ always\(\) && needs\.discover\.outputs\.packages != '\[\]' && \(!inputs\.verify_only \|\| needs\.fetch-published\.result == 'success'\) \}\}/);
  assert.match(publish, /if: \$\{\{ always\(\) && !cancelled\(\) && needs\.discover\.result == 'success' && needs\.qualify\.result == 'success' &&/);
  assert.doesNotMatch(publish, /if: \$\{\{ always\(\) && needs\.discover\.outputs\.packages/);
});

test("every package-capable execution job checks the closed release catalogue", () => {
  assert.equal((workflow.match(/node scripts\/check-release-catalog\.mjs --package "\$PKG"/g) ?? []).length, 2);
  assert.equal((workflow.match(/node scripts\/check-release-catalog\.mjs --package "\$MANUAL_PACKAGE"/g) ?? []).length, 1);
  assert.match(workflow, /current exact all-19 @clossys public-npm launch target/);
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
  assert.match(qualify, /npm publish \. --dry-run --provenance --access public --ignore-scripts --registry "\$registry"/);
  assert.match(qualify, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(qualify, /candidate\.tgz/);
  assert.match(qualify, /transcript\.json/);
  assertPinnedReplayRuntime(qualify, "qualify", "npm ci --ignore-scripts");
});

test("directory-form publish dry-run fails closed on npm manifest auto-correction", () => {
  const qualify = job("qualify");
  const dryRun = step(qualify, "Exercise directory-form OIDC publish command without upload credentials");
  assert.match(dryRun, /set -euo pipefail/);
  assert.match(dryRun, /2>&1/);
  assert.match(dryRun, /status=0/);
  assert.match(dryRun, /if \[ "\$status" -ne 0 \]; then/);
  assert.match(dryRun, /npm auto-corrected/);
  assert.ok(dryRun.includes("bin\\[[^]]+\\].*(invalid|removed)"), "the dry-run guard must catch invalid or removed bin entries");
  assert.ok(dryRun.indexOf('npm publish . --dry-run') < dryRun.indexOf('npm auto-corrected'), "the dry-run must be executed before its output is inspected");
});

test("OIDC publish consumes the exact handoff through the clean-directory wrapper with upload-only trust and no token", () => {
  const publish = job("publish");
  assert.match(publish, /needs: \[discover, qualify\]/);
  assert.match(publish, /permissions:\n      contents: read\n      id-token: write/);
  assert.match(publish, /environment: npm-publish/);
  assertPinnedReplayRuntime(publish, "publish", "node scripts/publish-qualified-directory.mjs");
  assert.doesNotMatch(publish, /^\s+cache:/m);
  assert.match(publish, /actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/);
  assert.match(publish, /check-artifact-safety\.mjs/);
  assert.match(publish, /validate-candidate-publish\.mjs/);
  assert.doesNotMatch(publish, /\n\s+(?:result=.*)?npm pack|run-candidate-qualification/);
  assert.doesNotMatch(publish, /NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|secrets\.GITHUB_TOKEN|secrets\.NPM_TOKEN/);
  assert.match(publish, /name: Verify exact tarball is unchanged/);
  assert.match(publish, /transcript\.json/);
  assert.match(publish, /node scripts\/publish-qualified-directory\.mjs --package "\$PKG" --candidate "\$TARBALL" --record "\$record" --mode oidc/);
  assert.doesNotMatch(workflow, /npm publish "\$TARBALL"/);
  assert.ok(position(publish, "node scripts/publish-qualified-directory.mjs") < position(publish, "- name: Redact denylist"), "the staged OIDC scan must run before denylist redaction");
  const postPublishVisibility = step(publish, "Verify anonymous public npm visibility and exact bytes");
  assertPostPublishVisibilityStep(postPublishVisibility);
  for (const [label, search, replacement] of [
    ["package", "          PKG: ${{ matrix.package }}\n", ""],
    ["release target", "          PUBLISH_RELEASE_TARGET: ${{ inputs.release_target }}\n", ""],
    ["qualified tarball", "          EXPECTED_TARBALL: ${{ runner.temp }}/qualification/${{ matrix.package }}/candidate.tgz\n", ""],
    ["verifier command", '          node scripts/verify-post-publish-public-npm-artifact.mjs --package "$PKG" --expected-tarball "$EXPECTED_TARBALL"', '          node scripts/verify-post-publish-public-npm-artifact.mjs --package "$PKG"'],
  ]) {
    const mutated = postPublishVisibility.replace(search, replacement);
    assert.throws(() => assertPostPublishVisibilityStep(mutated), `must reject deleted or substituted ${label} binding`);
  }
  assert.doesNotMatch(publish, /for attempt in 1 2 3 4 5|sleep 3|npm pack "\$\{package_name\}@\$\{package_version\}"/);

  const verification = job("verify-published");
  assert.match(verification, /needs: \[discover, publish\]/);
  assert.match(verification, /needs\.publish\.result == 'success'/);
  assert.match(verification, /check-registry-parity\.mjs --package "\$PKG"/);
  assert.match(verification, /npm audit signatures --json --include-attestations/);
  assert.match(verification, /check-public-npm-provenance\.mjs/);
  assert.match(verification, /--source-sha "\$SOURCE_SHA"/);
  assert.doesNotMatch(verification, /packages:|id-token:|NODE_AUTH_TOKEN|NPM_TOKEN|GH_PACKAGES_TOKEN|GITHUB_TOKEN|environment:/);
});

test("replay jobs reject runtime mutation instead of accepting a version floor", () => {
  for (const [name, firstNpmOperation] of [["qualify", "npm ci --ignore-scripts"], ["publish", "node scripts/publish-qualified-directory.mjs"]]) {
    const mutated = job(name)
      .replaceAll("v24.19.0", "v24.19.1")
      .replaceAll("11.17.0", "11.17.1")
      .replaceAll("1.3.2.1-motley-3246f1b", "1.3.2.2-motley-3246f1b");
    assert.throws(() => assertPinnedReplayRuntime(mutated, name, firstNpmOperation));
  }
});

test("no predecessor registry token or visibility mode remains in the public npm workflow", () => {
  assert.doesNotMatch(workflow, /visibility_only|GH_PACKAGES_TOKEN|check-package-visibility\.mjs/);
  assert.equal((workflow.match(/id-token:\s*write/g) ?? []).length, 1);
  assert.equal((workflow.match(/\bnpm publish "\$TARBALL"/g) ?? []).length, 0);
});
