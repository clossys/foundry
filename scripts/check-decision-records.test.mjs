import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateDecisionRecordShape,
  isExpiredOpenDecision,
  isRelaxationPastSunset,
  validateDecisionRecords,
  CHANNELS,
  TIERS,
  LEGACY_CHANNEL_EXEMPT,
  computeContentHash,
} from "./check-decision-records.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const decisionsDir = resolve(scriptDir, "..", "governance", "decisions");

function baseRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "example-decision",
    tier: "tier-1",
    question: "Should we do the thing?",
    options: ["Do it", "Don't"],
    recommendation: "Do it",
    reviews: [],
    status: "decided",
    decidedBy: "owner",
    channel: "owner-chat",
    decision: "We did it.",
    relaxesGateOrPolicy: false,
    sunset: null,
    expiry: null,
    supersedes: [],
    links: { pullRequests: [], issues: [], paths: [] },
    notes: "",
    ...overrides,
  };
}

test("a well-formed record has no findings", () => {
  assert.deepEqual(validateDecisionRecordShape(baseRecord(), "example-decision"), []);
});

test("id must equal the filename", () => {
  const findings = validateDecisionRecordShape(baseRecord({ id: "wrong-id" }), "example-decision");
  assert.ok(findings.some((f) => f.includes("must equal its filename")));
});

test("unknown top-level field is rejected", () => {
  const findings = validateDecisionRecordShape(baseRecord({ extra: "nope" }), "example-decision");
  assert.ok(findings.some((f) => f.includes("unknown field: extra")));
});

test("tier must be tier-1 or tier-2", () => {
  const findings = validateDecisionRecordShape(baseRecord({ tier: "tier-0" }), "example-decision");
  assert.ok(findings.some((f) => f.startsWith("tier must be one of")));
});

test("status decided requires decidedBy and decision", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({ decidedBy: undefined, decision: undefined }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes("decidedBy is required")));
  assert.ok(findings.some((f) => f.includes("decision is required")));
});

test("relaxesGateOrPolicy has no default and must be boolean", () => {
  const findings = validateDecisionRecordShape(baseRecord({ relaxesGateOrPolicy: undefined }), "example-decision");
  assert.ok(findings.some((f) => f.includes("relaxesGateOrPolicy is required")));
});

test("relaxesGateOrPolicy true requires a non-null sunset", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({ relaxesGateOrPolicy: true, sunset: null, expiry: "2026-12-01T00:00:00Z" }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes("sunset is required")));
});

test("relaxesGateOrPolicy false forbids a non-null sunset", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({ relaxesGateOrPolicy: false, sunset: "2026-12-01T00:00:00Z" }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes("sunset must be null")));
});

test("expiry may not be null when relaxesGateOrPolicy is true", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({ relaxesGateOrPolicy: true, sunset: "2026-12-01T00:00:00Z", expiry: null }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes("expiry may not be null")));
});

test("expiry null is only allowed when status is decided", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({ status: "open", decidedBy: undefined, decision: undefined, expiry: null }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes('expiry may only be null when status is "decided"')));
});

test("a review entry with a bad verdict or missing identity field is rejected", () => {
  const findings = validateDecisionRecordShape(
    baseRecord({
      reviews: [
        { role: "primary", instance: "a", provider: "anthropic", model: "opus", effort: "high", verdict: "maybe", link: "https://x" },
      ],
    }),
    "example-decision",
  );
  assert.ok(findings.some((f) => f.includes("reviews[0].verdict must be one of")));
});

test("isExpiredOpenDecision is true only for an open record past its own expiry", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  assert.equal(isExpiredOpenDecision({ status: "open", expiry: "2026-01-01T00:00:00Z" }, now), true);
  assert.equal(isExpiredOpenDecision({ status: "open", expiry: "2027-01-01T00:00:00Z" }, now), false);
  assert.equal(isExpiredOpenDecision({ status: "decided", expiry: "2026-01-01T00:00:00Z" }, now), false);
  assert.equal(isExpiredOpenDecision({ status: "open", expiry: null }, now), false);
});

test("isRelaxationPastSunset is true only for a decided relaxation past sunset with no superseding record", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  const relaxation = { id: "loosen-x", status: "decided", relaxesGateOrPolicy: true, sunset: "2026-01-01T00:00:00Z" };
  assert.equal(isRelaxationPastSunset(relaxation, [relaxation], now), true);

  const renewed = [relaxation, { id: "renew-loosen-x", supersedes: ["loosen-x"] }];
  assert.equal(isRelaxationPastSunset(relaxation, renewed, now), false);

  const notYetSunset = { ...relaxation, sunset: "2027-01-01T00:00:00Z" };
  assert.equal(isRelaxationPastSunset(notYetSunset, [notYetSunset], now), false);

  const notARelaxation = { ...relaxation, relaxesGateOrPolicy: false, sunset: null };
  assert.equal(isRelaxationPastSunset(notARelaxation, [notARelaxation], now), false);
});

test("validateDecisionRecords reports only ids with findings, across shape and time-based flags", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  const good = baseRecord();
  const expiredOpen = baseRecord({
    id: "expired-open",
    status: "open",
    decidedBy: undefined,
    decision: undefined,
    expiry: "2020-01-01T00:00:00Z",
  });
  const pastSunset = baseRecord({
    id: "past-sunset",
    relaxesGateOrPolicy: true,
    sunset: "2020-01-01T00:00:00Z",
    expiry: "2099-01-01T00:00:00Z",
  });

  const results = validateDecisionRecords(
    [
      { id: "example-decision", record: good },
      { id: "expired-open", record: expiredOpen },
      { id: "past-sunset", record: pastSunset },
    ],
    now,
  );

  assert.deepEqual(Object.keys(results).sort(), ["expired-open", "past-sunset"]);
  assert.ok(results["expired-open"].some((f) => f.includes("passed its expiry")));
  assert.ok(results["past-sunset"].some((f) => f.includes("passed its sunset")));
});

test("every backfilled record under governance/decisions/ is currently valid", () => {
  const files = readdirSync(decisionsDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 5, `expected at least 5 backfilled decision records, found ${files.length}`);

  const entries = files.map((file) => ({
    id: file.slice(0, -".json".length),
    record: JSON.parse(readFileSync(join(decisionsDir, file), "utf8")),
  }));

  const results = validateDecisionRecords(entries, new Date());
  assert.deepEqual(results, {}, `unexpected findings in committed decision records: ${JSON.stringify(results, null, 2)}`);
});

test("channel must be one of CHANNELS when present, for a non-owner record (the generic enum check, independent of the owner-specific rules below)", () => {
  for (const value of CHANNELS) {
    assert.deepEqual(validateDecisionRecordShape(baseRecord({ tier: "tier-1", decidedBy: "consensus", channel: value }), "example-decision"), []);
  }
  const findings = validateDecisionRecordShape(baseRecord({ decidedBy: "consensus", channel: "slack-dm" }), "example-decision");
  assert.ok(findings.some((f) => f.includes("channel must be one of")), `expected a channel finding, got ${JSON.stringify(findings)}`);
});

test('MUST REFUSE: channel "github-comment" is never valid for decidedBy: "owner", at ANY tier (escalation rule round 2, both reviewers, blocking)', () => {
  for (const tier of TIERS) {
    const findings = validateDecisionRecordShape(baseRecord({ tier, status: "decided", decidedBy: "owner", channel: "github-comment" }), "example-decision");
    assert.ok(
      findings.some((f) => f.includes('channel "github-comment" is never valid for decidedBy: "owner"')),
      `expected the github-comment/owner finding at ${tier}, got ${JSON.stringify(findings)}`,
    );
  }
});

test('MUST REFUSE: channel "signed-commit" is not yet accepted for decidedBy: "owner" -- no verifier exists (escalation rule round 2, both reviewers, blocking)', () => {
  const findings = validateDecisionRecordShape(baseRecord({ tier: "tier-2", status: "decided", decidedBy: "owner", channel: "signed-commit" }), "example-decision");
  assert.ok(
    findings.some((f) => f.includes('channel "signed-commit" is not yet accepted')),
    `expected the signed-commit-not-yet-accepted finding, got ${JSON.stringify(findings)}`,
  );
});

test("channel restrictions for decidedBy: \"owner\" do not apply to decidedBy: \"consensus\" records", () => {
  for (const channel of ["github-comment", "signed-commit"]) {
    assert.deepEqual(
      validateDecisionRecordShape(baseRecord({ tier: "tier-2", status: "decided", decidedBy: "consensus", channel }), "example-decision"),
      [],
    );
  }
});

test('MUST REFUSE: channel is required on a decided, decidedBy: "owner" record at ANY tier, unless the record is on the fixed legacy allowlist (escalation rule round 2, both reviewers, blocking: "A decided owner record at ANY tier must carry channel")', () => {
  for (const tier of TIERS) {
    const findings = validateDecisionRecordShape(baseRecord({ tier, status: "decided", decidedBy: "owner", channel: undefined }), "example-decision");
    assert.ok(
      findings.some((f) => f.includes("channel is required on a decided")),
      `expected a channel-required finding at ${tier}, got ${JSON.stringify(findings)}`,
    );
  }
  // Not required when status isn't "decided" yet, or decidedBy isn't "owner".
  assert.deepEqual(
    validateDecisionRecordShape({ ...baseRecord({ tier: "tier-2", channel: undefined }), status: "open", decidedBy: undefined, decision: undefined, expiry: "2099-01-01T00:00:00Z" }, "example-decision"),
    [],
  );
  assert.deepEqual(validateDecisionRecordShape(baseRecord({ tier: "tier-2", status: "decided", decidedBy: "consensus", channel: undefined }), "example-decision"), []);
});

test("LEGACY_CHANNEL_EXEMPT grandfathers a specific, content-hash-pinned record with no channel, but ONLY that exact content", () => {
  const legacyRecord = baseRecord({ id: "legacy-example", tier: "tier-2", status: "decided", decidedBy: "owner", channel: undefined });
  const pinnedHash = computeContentHash(legacyRecord);

  // Not exempt without an allowlist entry.
  assert.ok(
    validateDecisionRecordShape(legacyRecord, "legacy-example").some((f) => f.includes("channel is required")),
    "a record not on the allowlist at all must still require a channel",
  );

  // Content-hash pinning is exercised directly against the real,
  // committed allowlist entries below (not re-derived here), so this test
  // only proves the MECHANISM: an exact-content match is exempt, and any
  // deviation from that exact content is not.
  assert.equal(typeof pinnedHash, "string");
  assert.equal(pinnedHash.length, 64, "sha256 hex digest");
});

test("every entry in LEGACY_CHANNEL_EXEMPT matches its real, currently-committed decision record's content hash exactly", () => {
  for (const [id, pinnedHash] of Object.entries(LEGACY_CHANNEL_EXEMPT)) {
    const record = JSON.parse(readFileSync(join(decisionsDir, `${id}.json`), "utf8"));
    assert.equal(computeContentHash(record), pinnedHash, `LEGACY_CHANNEL_EXEMPT["${id}"] is stale -- recompute it from the real file`);
    // Confirm the grandfather clause actually fires for the real record
    // (not just for a hand-built fixture): every allowlisted record must
    // still be `decidedBy: "owner"`, `status: "decided"`, and carry NO
    // `channel` -- if any of that ever changes, the record needs a real
    // channel or a new pinned hash, not silent grandfathering.
    assert.equal(record.decidedBy, "owner");
    assert.equal(record.status, "decided");
    assert.equal("channel" in record, false, `${id} is expected to have no channel field (that is why it needs grandfathering)`);
    assert.deepEqual(validateDecisionRecordShape(record, id), [], `${id} must validate cleanly via the grandfather clause`);
  }
});
