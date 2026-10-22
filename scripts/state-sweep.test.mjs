import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { EXIT_NO_WEBSOCKET } from "./state-sweep.mjs";
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

// Real-browser hit-testing: the sweep must only credit a 44px target when the
// TOPMOST element at each probe point is the target (or inside it).
const CANDIDATES = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(path => path && existsSync(path));

// Pick the first installed browser that can really start headless here. When
// none can, the browser tests are SKIPPED with the stated reason (never a pass).
let browserProbe;
function findBrowser() {
  browserProbe ??= (() => {
    if (!CANDIDATES.length) return { reason: "no Chromium executable is installed" };
    const failures = [];
    for (const path of CANDIDATES) {
      const probe = spawnSync(path, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--dump-dom", "about:blank"],
        { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
      if (probe.status === 0) return { path };
      failures.push(`${path}: exit ${probe.status ?? probe.signal ?? probe.error?.message} ${String(probe.stderr ?? "").trim().slice(-300)}`);
    }
    return { reason: `no installed Chromium could start headless (${failures.join("; ")})` };
  })();
  return browserProbe;
}

async function sweepFixture(browser, body) {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0">${body}</body>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/fixture`;
    const script = fileURLToPath(new URL("./state-sweep.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, "--url", url], {
      env: { ...process.env, CHROME_PATH: browser }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise(resolve => child.once("exit", resolve));
    if (code === EXIT_NO_WEBSOCKET) return { unavailable: stderr.trim().split("\n").pop() };
    let report;
    try { report = JSON.parse(stdout); } catch {
      assert.fail(`state-sweep printed no JSON report (exit ${code}); stderr: ${stderr.trim().slice(-800) || "(empty)"}; stdout: ${stdout.slice(0, 200) || "(empty)"}`);
    }
    return { observations: report.observations.filter(item => item.check === "tap-target") };
  } finally {
    server.close();
  }
}

const SIZED = "display:block;width:60px;height:60px;padding:0;border:0";

test("tap-target probe passes when the target is topmost or the topmost hit is its descendant", { timeout: 240000 }, async t => {
  const browser = findBrowser();
  if (!browser.path) return t.skip(`SKIPPED: ${browser.reason}`);
  const plain = await sweepFixture(browser.path, `<button id="target" style="${SIZED}">go</button>`);
  if (plain.unavailable) return t.skip(`SKIPPED: ${plain.unavailable}`);
  assert.ok(plain.observations.length > 0);
  for (const item of plain.observations) assert.equal(item.status, "pass", JSON.stringify(item));
  const nested = await sweepFixture(browser.path,
    `<button id="target" style="${SIZED};position:relative"><span style="position:absolute;inset:0"></span></button>`);
  assert.ok(nested.observations.length > 0);
  for (const item of nested.observations) assert.equal(item.status, "pass", JSON.stringify(item));
});

test("OCCLUSION NEGATIVE: a covering element over the probe points is never reported as a verified 44px target", { timeout: 240000 }, async t => {
  const browser = findBrowser();
  if (!browser.path) return t.skip(`SKIPPED: ${browser.reason}`);
  const covered = await sweepFixture(browser.path,
    `<button id="target" style="${SIZED}">go</button><div id="cover" style="position:fixed;top:0;left:0;width:100%;height:100%"></div>`);
  if (covered.unavailable) return t.skip(`SKIPPED: ${covered.unavailable}`);
  assert.ok(covered.observations.length > 0);
  for (const item of covered.observations) {
    assert.equal(item.status, "finding", JSON.stringify(item));
    assert.equal(item.details.measured.length, 0);
    assert.match(item.details.small[0].reason, /No verified 44px hit area/);
  }
});
