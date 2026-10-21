import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

async function loadSweep() {
  const url = new URL("./state-sweep.mjs", import.meta.url);
  assert.ok(existsSync(fileURLToPath(url)), "state-sweep implementation exists");
  return import(url.href);
}

test("state sweep requires an explicit HTTP(S) URL and rejects unknown options", async () => {
  const { parseArgs } = await loadSweep();
  assert.throws(() => parseArgs([]), /--url/);
  assert.throws(() => parseArgs(["--url"]), /--url/);
  assert.throws(() => parseArgs(["--url", "file:///tmp/fixture.html"]), /https?/i);
  assert.throws(() => parseArgs(["--url", "https://example.invalid", "--skip-checks"]), /unknown/i);
  assert.deepEqual(parseArgs(["--url", "http://127.0.0.1:4501/fixture"]), {
    url: "http://127.0.0.1:4501/fixture",
    widths: [320, 390, 640, 768],
  });
});

test("report preserves measured findings without converting unverified observations into passes", async () => {
  const { buildReport } = await loadSweep();
  const observations = [
    { width: 320, check: "overflow", status: "pass", details: { scrollWidth: 320, clientWidth: 320 } },
    { width: 390, check: "tap-target", status: "finding", details: { inlineSize: 32, blockSize: 44 } },
    { width: 640, check: "pending-layout-shift", status: "unverified", details: { reason: "No pending control was observed" } },
  ];
  const report = buildReport({ url: "http://127.0.0.1:4501/fixture", observations });
  assert.equal(report.url, "http://127.0.0.1:4501/fixture");
  assert.equal(report.status, "finding");
  assert.ok(Number.isFinite(Date.parse(report.measuredAt)));
  assert.deepEqual(report.widths, [320, 390, 640, 768]);
  assert.deepEqual(report.observations, observations);
  assert.deepEqual(report.counts, { pass: 1, finding: 1, unverified: 1 });
});

test("empty or incomplete measurements never claim a passing sweep", async () => {
  const { buildReport } = await loadSweep();
  const empty = buildReport({ url: "https://example.invalid/fixture", observations: [] });
  assert.equal(empty.status, "unverified");
  const incomplete = buildReport({ url: "https://example.invalid/fixture", observations: [
    { width: 320, check: "overflow", status: "pass", details: {} },
  ] });
  assert.equal(incomplete.status, "unverified");
});

test("missing Chromium is reported explicitly as SKIPPED rather than a pass", async () => {
  const { buildReport } = await loadSweep();
  const report = buildReport({ url: "https://example.invalid/fixture", observations: [], skippedReason: "No Chromium executable available" });
  assert.equal(report.status, "skipped");
  assert.equal(report.reason, "No Chromium executable available");
  assert.deepEqual(report.observations, []);
  assert.deepEqual(report.counts, { pass: 0, finding: 0, unverified: 0 });
});
