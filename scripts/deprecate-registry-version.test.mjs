import assert from "node:assert/strict";
import test from "node:test";

import {
  IndeterminateError,
  argsFrom,
  assertApplyCredentialPresent,
  assertDistTagOptIn,
  assertMessage,
  assertPackageInScope,
  assertPublicRegistry,
  assertResolvedVersions,
  assertVersionSpec,
  assertVersionsPresentInPackument,
  deprecateRegistryVersion,
  deprecationMismatches,
  distTagsOver,
  hasControlCharacter,
  resolvedVersionsFrom,
  runNpmDeprecate,
  verifyDeprecationState,
} from "./deprecate-registry-version.mjs";

const IDENTITY = { scope: "@clossys", registry: "https://registry.npmjs.org" };
const NAME = "@clossys/publisher";
// Version literals live in constants so no `name@version` adjacency appears in
// this file: check-foreign-references.mjs reads that shape as a bare scope.
const V = "0.4.3";
const V_PRERELEASE = "1.0.0-rc.1";

function argv(...pairs) {
  return ["node", "script", ...pairs];
}

// ---------------------------------------------------------------- arguments

test("argsFrom accepts the four required arguments", () => {
  const args = argsFrom(argv("--package", NAME, "--versions", "0.4.3", "--message", "broken", "--mode", "dry-run"));
  assert.deepEqual(args, { package: NAME, versions: "0.4.3", message: "broken", mode: "dry-run" });
});

test("argsFrom accepts an empty --message as the documented clear form, but not an empty --versions", () => {
  const cleared = argsFrom(argv("--package", NAME, "--versions", "0.4.3", "--message", "", "--mode", "apply"));
  assert.equal(cleared.message, "");
  assert.throws(
    () => argsFrom(argv("--package", NAME, "--versions", "", "--message", "m", "--mode", "apply")),
    IndeterminateError,
  );
});

test("argsFrom refuses unknown keys, duplicates, missing arguments, and an unknown mode", () => {
  assert.throws(() => argsFrom(argv("--package", NAME, "--versions", "1.0.0", "--message", "m", "--other", "x")), IndeterminateError);
  assert.throws(() => argsFrom(argv("--package", NAME, "--package", NAME, "--versions", "1.0.0", "--message", "m")), IndeterminateError);
  assert.throws(() => argsFrom(argv("--package", NAME, "--versions", "1.0.0")), IndeterminateError);
  assert.throws(() => argsFrom(argv("--package", NAME, "--versions", "1.0.0", "--message", "m", "--mode", "force")), IndeterminateError);
});

// ------------------------------------------------------------------ guards

test("assertVersionSpec refuses anything that is not shaped like a version spec", () => {
  assert.doesNotThrow(() => assertVersionSpec("0.4.3"));
  assert.doesNotThrow(() => assertVersionSpec(">=0.4.3 <0.4.5"));
  assert.doesNotThrow(() => assertVersionSpec("^1.2.3"));
  for (const bad of ["--force", "../etc", "0.4.3 && rm", "", " 0.4.3", "a".repeat(129), "@clossys/other@1.0.0"]) {
    assert.throws(() => assertVersionSpec(bad), IndeterminateError, `expected refusal for ${JSON.stringify(bad)}`);
  }
});

test("hasControlCharacter and assertMessage refuse a notice carrying terminal-escape-shaped bytes", () => {
  assert.equal(hasControlCharacter("plain message"), false);
  assert.equal(hasControlCharacter(`bell${String.fromCharCode(7)}`), true);
  assert.equal(hasControlCharacter(`esc${String.fromCharCode(27)}[31m`), true);
  assert.equal(hasControlCharacter(`del${String.fromCharCode(127)}`), true);
  assert.doesNotThrow(() => assertMessage(""));
  assert.doesNotThrow(() => assertMessage("Broken: use 0.4.4 instead."));
  assert.throws(() => assertMessage(`x${String.fromCharCode(27)}`), IndeterminateError);
  assert.throws(() => assertMessage("m".repeat(513)), IndeterminateError);
  assert.throws(() => assertMessage(undefined), IndeterminateError);
});

test("assertPackageInScope refuses a package this repository does not publish", () => {
  assert.doesNotThrow(() => assertPackageInScope(NAME, "@clossys"));
  // The prefix check must be delimiter-aware: a scope that merely starts with
  // ours is a different account, and deprecating in it is the exact mistake
  // this guard exists to stop.
  assert.throws(() => assertPackageInScope(`${IDENTITY.scope}-other/thing`, IDENTITY.scope), IndeterminateError);
  assert.throws(() => assertPackageInScope("@other-scope/thing", IDENTITY.scope), IndeterminateError);
  assert.throws(() => assertPackageInScope("unscoped", "@clossys"), IndeterminateError);
});

test("assertPublicRegistry refuses any registry but the declared public one", () => {
  assert.doesNotThrow(() => assertPublicRegistry("https://registry.npmjs.org"));
  assert.throws(() => assertPublicRegistry("https://registry.example.com"), IndeterminateError);
});

// -------------------------------------------------------------- resolution

test("resolvedVersionsFrom reads npm's own resolution notices, exactly and deduplicated", () => {
  const output = [
    "npm notice deprecating @clossys/publisher@0.4.3 with message \"broken\"",
    "npm notice deprecating @clossys/publisher@0.4.4 with message \"broken\"",
    "npm notice deprecating @clossys/publisher@0.4.3 with message \"broken\"",
    "npm notice deprecating @clossys/other@9.9.9 with message \"broken\"",
    "npm notice New major version of npm available!",
  ].join("\n");
  assert.deepEqual(resolvedVersionsFrom(output, NAME), ["0.4.3", "0.4.4"]);
});

test("resolvedVersionsFrom reads an undeprecating notice and a prerelease version", () => {
  assert.deepEqual(resolvedVersionsFrom(`npm notice undeprecating ${NAME}@${V_PRERELEASE}`, NAME), [V_PRERELEASE]);
});

// This is the measured hazard the whole preflight exists for: npm exits 0 for
// a spec matching nothing, so "no notices" is the only available signal.
test("resolvedVersionsFrom returns nothing for npm's no-match warning, and the assertion refuses it", () => {
  const output = "npm warn deprecate No version found for 9.9.9";
  assert.deepEqual(resolvedVersionsFrom(output, NAME), []);
  assert.throws(
    () => assertResolvedVersions({ versions: [], packageName: NAME, spec: "9.9.9" }),
    (error) => error instanceof IndeterminateError && /refusing to write a deprecation notice against nothing/.test(error.message),
  );
});

test("assertVersionsPresentInPackument refuses a version the anonymous edge does not serve", () => {
  const document = { versions: { "0.4.3": {} } };
  assert.doesNotThrow(() => assertVersionsPresentInPackument({ document, versions: ["0.4.3"], packageName: NAME }));
  assert.throws(() => assertVersionsPresentInPackument({ document, versions: ["0.4.3", "0.4.4"], packageName: NAME }), IndeterminateError);
});

test("distTagsOver names only the targeted versions that carry a tag", () => {
  const document = { "dist-tags": { latest: "0.4.4", next: "0.5.0" } };
  assert.deepEqual(distTagsOver({ document, versions: ["0.4.3"] }), []);
  assert.deepEqual(distTagsOver({ document, versions: ["0.4.4"] }), [{ tag: "latest", version: "0.4.4" }]);
  assert.deepEqual(distTagsOver({ document, versions: ["0.4.4", "0.5.0"] }), [
    { tag: "latest", version: "0.4.4" },
    { tag: "next", version: "0.5.0" },
  ]);
});

// ------------------------------------------------------------ verification

test("deprecationMismatches requires the exact message, not merely 'deprecated at all'", () => {
  const document = { versions: { "0.4.3": { deprecated: "an older, different notice" } } };
  assert.deepEqual(deprecationMismatches({ document, versions: ["0.4.3"], message: "the new notice" }), [
    { version: "0.4.3", expected: "the new notice", observed: "an older, different notice" },
  ]);
  assert.deepEqual(deprecationMismatches({ document, versions: ["0.4.3"], message: "an older, different notice" }), []);
});

test("deprecationMismatches inverts for the clear form: an empty message must leave no field", () => {
  const still = { versions: { "0.4.3": { deprecated: "notice" } } };
  const cleared = { versions: { "0.4.3": {} } };
  assert.equal(deprecationMismatches({ document: still, versions: ["0.4.3"], message: "" }).length, 1);
  assert.deepEqual(deprecationMismatches({ document: cleared, versions: ["0.4.3"], message: "" }), []);
});

test("deprecationMismatches reports a version that never received the notice", () => {
  const document = { versions: { "0.4.3": {} } };
  assert.deepEqual(deprecationMismatches({ document, versions: ["0.4.3"], message: "notice" }), [
    { version: "0.4.3", expected: "notice", observed: "(no notice)" },
  ]);
});

function packumentFetch(sequence) {
  let call = 0;
  return async () => {
    const body = sequence[Math.min(call++, sequence.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  };
}

const VERIFY_DELAYS = [0, 0, 0];

/** An edge that never yields a readable packument, as distinct from one that yields the wrong answer. */
function unreadableFetch() {
  return async () => ({ ok: false, status: 503, json: async () => ({}) });
}

test("verifyDeprecationState settles once the anonymous edge shows the notice", async () => {
  const stale = { name: NAME, versions: { "0.4.3": {} } };
  const fresh = { name: NAME, versions: { "0.4.3": { deprecated: "notice" } } };
  const result = await verifyDeprecationState({
    registry: IDENTITY.registry,
    name: NAME,
    versions: ["0.4.3"],
    message: "notice",
    fetchImpl: packumentFetch([stale, fresh]),
    delays: VERIFY_DELAYS,
    wait: async () => {},
  });
  assert.equal(result.kind, "verified");
});

// The two closed-window outcomes must stay apart. An edge we could never read
// is an absence of evidence; an edge we read repeatedly that disagrees is a
// finding about a document we DID observe.
test("verifyDeprecationState reports indeterminate when the edge was never readable", async () => {
  const result = await verifyDeprecationState({
    registry: IDENTITY.registry,
    name: NAME,
    versions: ["0.4.3"],
    message: "notice",
    fetchImpl: unreadableFetch(),
    delays: VERIFY_DELAYS,
    wait: async () => {},
  });
  assert.equal(result.kind, "indeterminate");
  assert.equal(result.detail.kind, "unreadable");
});

test("verifyDeprecationState reports a stable readable disagreement as a mismatch, not indeterminate", async () => {
  const stale = { name: NAME, versions: { "0.4.3": {} } };
  const result = await verifyDeprecationState({
    registry: IDENTITY.registry,
    name: NAME,
    versions: ["0.4.3"],
    message: "notice",
    fetchImpl: packumentFetch([stale]),
    delays: VERIFY_DELAYS,
    wait: async () => {},
  });
  assert.equal(result.kind, "mismatch");
  assert.deepEqual(result.mismatches, [{ version: "0.4.3", expected: "notice", observed: "(no notice)" }]);
});

// Retrying THROUGH a mismatch is still right — only the last observation counts.
test("verifyDeprecationState still settles when a stale edge catches up mid-window", async () => {
  const stale = { name: NAME, versions: { "0.4.3": { deprecated: "an older notice" } } };
  const fresh = { name: NAME, versions: { "0.4.3": { deprecated: "notice" } } };
  const result = await verifyDeprecationState({
    registry: IDENTITY.registry,
    name: NAME,
    versions: ["0.4.3"],
    message: "notice",
    fetchImpl: packumentFetch([stale, stale, fresh]),
    delays: VERIFY_DELAYS,
    wait: async () => {},
  });
  assert.equal(result.kind, "verified");
});

// ------------------------------------------------------------- credentials

test("assertApplyCredentialPresent refuses an absent, empty, or whitespace token", () => {
  for (const env of [{}, { NODE_AUTH_TOKEN: "" }, { NODE_AUTH_TOKEN: "   " }, { NODE_AUTH_TOKEN: 7 }]) {
    assert.throws(() => assertApplyCredentialPresent(env), IndeterminateError);
  }
  assert.doesNotThrow(() => assertApplyCredentialPresent({ NODE_AUTH_TOKEN: "a-token-value" }));
});

test("the missing-credential refusal names OIDC as the reason there is no credential-free path", () => {
  assert.throws(
    () => assertApplyCredentialPresent({}),
    (error) => /OIDC/.test(error.message) && /npm publish/.test(error.message) && /cannot authorize/.test(error.message),
  );
});

// ----------------------------------------------------------- npm invocation

test("runNpmDeprecate builds an exact argument vector and adds --dry-run only when asked", () => {
  const seen = [];
  const spawn = (file, args) => { seen.push([file, args]); return { status: 0, stdout: "out", stderr: "err" }; };
  runNpmDeprecate({ name: NAME, spec: "0.4.3", message: "m", registry: IDENTITY.registry, dryRun: true, env: {}, spawn });
  runNpmDeprecate({ name: NAME, spec: "0.4.3", message: "m", registry: IDENTITY.registry, dryRun: false, env: {}, spawn });
  assert.deepEqual(seen[0], ["npm", ["deprecate", `${NAME}@${V}`, "m", `--registry=${IDENTITY.registry}`, "--dry-run"]]);
  assert.deepEqual(seen[1], ["npm", ["deprecate", `${NAME}@${V}`, "m", `--registry=${IDENTITY.registry}`]]);
});

// npm writes its resolution notices to stderr, so a stdout-only capture would
// read as "no versions resolved" on a run that in fact resolved several.
test("runNpmDeprecate returns stderr as well as stdout", () => {
  const spawn = () => ({ status: 0, stdout: "", stderr: `npm notice deprecating ${NAME}@${V} with message "m"` });
  const output = runNpmDeprecate({ name: NAME, spec: "0.4.3", message: "m", registry: IDENTITY.registry, dryRun: true, env: {}, spawn });
  assert.deepEqual(resolvedVersionsFrom(output, NAME), ["0.4.3"]);
});

test("runNpmDeprecate turns a non-zero exit and a spawn failure into a refusal", () => {
  assert.throws(
    () => runNpmDeprecate({ name: NAME, spec: "0.4.3", message: "m", registry: IDENTITY.registry, dryRun: false, env: {}, spawn: () => ({ status: 1, stdout: "", stderr: "E401" }) }),
    (error) => error instanceof IndeterminateError && /E401/.test(error.message),
  );
  assert.throws(
    () => runNpmDeprecate({ name: NAME, spec: "0.4.3", message: "m", registry: IDENTITY.registry, dryRun: false, env: {}, spawn: () => ({ error: new Error("ENOENT") }) }),
    IndeterminateError,
  );
});

// ------------------------------------------------------------- end to end

function harness({ resolved = ["0.4.3"], packuments, message = "notice" }) {
  const calls = [];
  const npmRun = ({ dryRun }) => {
    calls.push(dryRun ? "dry-run" : "apply");
    return resolved.map((version) => `npm notice deprecating ${NAME}@${version} with message "${message}"`).join("\n");
  };
  return { calls, npmRun, fetchImpl: packumentFetch(packuments) };
}

test("dry-run mode resolves and reports without ever invoking the mutating call", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} }, "dist-tags": { latest: "0.4.4" } };
  const { calls, npmRun, fetchImpl } = harness({ packuments: [before] });
  const lines = [];
  const result = await deprecateRegistryVersion({
    packageName: NAME, spec: "0.4.3", message: "notice", mode: "dry-run",
    identity: IDENTITY, env: {}, npmRun, fetchImpl, log: (line) => lines.push(line),
  });
  assert.equal(result.kind, "planned");
  assert.deepEqual(calls, ["dry-run"]);
  assert.match(lines.join("\n"), /no credential was used/);
});

// The whole point of the credential guard: an apply without a token must stop
// BEFORE the mutation, not fail somewhere downstream having half-acted.
test("apply mode without a credential refuses after preflight and before any mutation", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} } };
  const { calls, npmRun, fetchImpl } = harness({ packuments: [before] });
  await assert.rejects(
    deprecateRegistryVersion({
      packageName: NAME, spec: "0.4.3", message: "notice", mode: "apply",
      identity: IDENTITY, env: {}, npmRun, fetchImpl, log: () => {},
    }),
    IndeterminateError,
  );
  assert.deepEqual(calls, ["dry-run"], "the mutating npm call must never have run");
});

test("apply mode with a credential mutates once and then verifies anonymously", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} } };
  const after = { name: NAME, versions: { "0.4.3": { deprecated: "notice" } } };
  const { calls, npmRun, fetchImpl } = harness({ packuments: [before, after] });
  const result = await deprecateRegistryVersion({
    packageName: NAME, spec: "0.4.3", message: "notice", mode: "apply",
    identity: IDENTITY, env: { NODE_AUTH_TOKEN: "a-token-value" },
    npmRun, fetchImpl, log: () => {}, delays: VERIFY_DELAYS,
  });
  assert.equal(result.kind, "verified");
  assert.deepEqual(calls, ["dry-run", "apply"]);
});

test("a spec matching nothing refuses before any mutation, even in apply mode with a credential", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} } };
  const calls = [];
  const npmRun = ({ dryRun }) => { calls.push(dryRun ? "dry-run" : "apply"); return "npm warn deprecate No version found for 9.9.9"; };
  await assert.rejects(
    deprecateRegistryVersion({
      packageName: NAME, spec: "9.9.9", message: "notice", mode: "apply",
      identity: IDENTITY, env: { NODE_AUTH_TOKEN: "a-token-value" },
      npmRun, fetchImpl: packumentFetch([before]), log: () => {},
    }),
    (error) => error instanceof IndeterminateError && /against nothing/.test(error.message),
  );
  assert.deepEqual(calls, ["dry-run"]);
});

// Exit 2 — could not establish. The header promises this and the code reaches it.
test("an apply whose notice never becomes publicly readable is indeterminate, not a silent success", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} } };
  let call = 0;
  // Readable for the preflight, then unreadable for every verification attempt.
  const fetchImpl = async () => {
    if (call++ === 0) return { ok: true, status: 200, json: async () => before };
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const { npmRun } = harness({ packuments: [before] });
  await assert.rejects(
    deprecateRegistryVersion({
      packageName: NAME, spec: "0.4.3", message: "notice", mode: "apply",
      identity: IDENTITY, env: { NODE_AUTH_TOKEN: "a-token-value" },
      npmRun, fetchImpl, log: () => {}, delays: VERIFY_DELAYS,
    }),
    (error) => error instanceof IndeterminateError && /indeterminate, not a failed write/.test(error.message),
  );
});

// Exit 1 — a concrete mismatch. This is the path the header promised and the
// code could not previously reach at all: every throw was Indeterminate, so a
// stable disagreement exited 2. A stated contract with no path to it is the
// defect this repository keeps finding.
test("an apply the edge stably disagrees with fails as a mismatch, NOT as indeterminate", async () => {
  const before = { name: NAME, versions: { "0.4.3": {} } };
  const { npmRun, fetchImpl } = harness({ packuments: [before] });
  await assert.rejects(
    deprecateRegistryVersion({
      packageName: NAME, spec: "0.4.3", message: "notice", mode: "apply",
      identity: IDENTITY, env: { NODE_AUTH_TOKEN: "a-token-value" },
      npmRun, fetchImpl, log: () => {}, delays: VERIFY_DELAYS,
    }),
    (error) => !(error instanceof IndeterminateError) && /still disagrees with the intended state/.test(error.message),
  );
});

test("a non-public registry is refused before anything else happens", async () => {
  await assert.rejects(
    deprecateRegistryVersion({
      packageName: NAME, spec: "0.4.3", message: "n", mode: "dry-run",
      identity: { scope: "@clossys", registry: "https://registry.example.com" },
      env: {}, npmRun: () => assert.fail("must not reach npm"), fetchImpl: () => assert.fail("must not fetch"), log: () => {},
    }),
    IndeterminateError,
  );
});

// ------------------------------------------------------- dist-tag opt-in

test("assertDistTagOptIn refuses a dist-tagged target unless it was asked for", () => {
  const tagged = [{ tag: "latest", version: "0.4.4" }];
  assert.throws(
    () => assertDistTagOptIn({ tagged, allowDistTagged: false, packageName: NAME }),
    (error) => error instanceof IndeterminateError && /every default install prints/.test(error.message),
  );
  assert.doesNotThrow(() => assertDistTagOptIn({ tagged, allowDistTagged: true, packageName: NAME }));
  assert.doesNotThrow(() => assertDistTagOptIn({ tagged: [], allowDistTagged: false, packageName: NAME }));
});

// The gate keys on blast radius, not count: bulk-deprecating superseded
// versions stays unguarded, which is the normal, low-risk case.
test("many untagged versions need no opt-in, but one tagged version does", async () => {
  const document = {
    name: NAME,
    versions: { "0.1.0": {}, "0.2.0": {}, "0.3.0": {}, "0.4.3": {}, "0.4.4": {} },
    "dist-tags": { latest: "0.4.4" },
  };
  const untagged = ["0.1.0", "0.2.0", "0.3.0", "0.4.3"];
  const run = (resolved, allowDistTagged) => deprecateRegistryVersion({
    packageName: NAME, spec: "<0.5.0", message: "notice", mode: "dry-run",
    identity: IDENTITY, env: {}, allowDistTagged, log: () => {},
    fetchImpl: packumentFetch([document]),
    npmRun: () => resolved.map((v) => `npm notice deprecating ${NAME}@${v} with message "notice"`).join("\n"),
  });
  const ok = await run(untagged, false);
  assert.equal(ok.kind, "planned");
  assert.equal(ok.versions.length, 4);
  await assert.rejects(run([...untagged, "0.4.4"], false), IndeterminateError);
  const opted = await run([...untagged, "0.4.4"], true);
  assert.equal(opted.versions.length, 5);
});

test("argsFrom accepts the optional opt-in and rejects a non-boolean one", () => {
  const base = ["--package", NAME, "--versions", "*", "--message", "m", "--mode", "dry-run"];
  assert.equal(argsFrom(argv(...base))["allow-dist-tagged"], undefined);
  assert.equal(argsFrom(argv(...base, "--allow-dist-tagged", "true"))["allow-dist-tagged"], "true");
  assert.throws(() => argsFrom(argv(...base, "--allow-dist-tagged", "yes")), IndeterminateError);
});
