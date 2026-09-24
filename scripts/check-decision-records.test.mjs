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
