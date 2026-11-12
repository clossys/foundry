import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { JSDOM } from "jsdom";
import { DEFAULT_MAP, FAILING, GATES_FILE, THEMES, WIDTHS, blocks, defaultServers, orderShots, planShards, runShards, shardTmpdir, summarize, readGates, seedShard, specimenCache, captureWithRetry, contactSheet, createBrowserPool, createCdpClient, decodePng, detectFindings, diffRatio, enumerateRoutes, idTokens, isSettled, pageProbe, parseArgs, severityOf } from "./capture-studio.mjs";

const FIXTURE = `<!doctype html><html><head><title>Studio</title></head><body>
<h1>Market size</h1>
<h2>sections.studio.home</h2>
<a href="/x">Visit clossys.com</a>
<p>Paragraph prose with e.g. an example and context.market.size in body text only.</p>
<button title="assets.icon-home">Open</button>
<div data-specimen-state="ready"><iframe src="/__specimen?a" srcdoc=""></iframe></div>
<span data-preview-status="unavailable">Unavailable</span>
<pre>Error: Studio copy is unresolved: studio.missing-key</pre>
</body></html>`;

/** jsdom has no layout: give every element one client rect and a fixed frame box. */
function probe(html, { scrollWidth = 375, clientWidth = 375 } = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.getClientRects = function () { return [{ width: 1, height: 1 }]; };
  window.HTMLIFrameElement.prototype.getBoundingClientRect = function () { return { width: 300, height: 200 }; };
  Object.defineProperty(window.document.documentElement, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(window.document.documentElement, "clientWidth", { value: clientWidth });
  return window.eval(`(${pageProbe.toString()})()`);
}

test("enumerateRoutes covers every page route and leaf in the generated Studio map, no hand list", async () => {
  const map = JSON.parse(await readFile(DEFAULT_MAP, "utf8"));
  const routes = enumerateRoutes(map);
  const pages = routes.filter(route => route.kind === "page");
  const leaves = routes.filter(route => route.kind === "leaf");
  assert.equal(pages.length, map.routes.length);
  assert.equal(leaves.length, new Set(map.leaves.map(leaf => leaf.path)).size);
  assert.deepEqual(new Set(routes.map(route => route.path)), new Set([...map.routes.map(r => r.path), ...map.leaves.map(l => l.path)]));
  assert.ok(routes.some(route => route.path === "/"));
});

test("enumerateRoutes dedupes and refuses a map without routes", () => {
  const routes = enumerateRoutes({ routes: [{ path: "/", label: "Home" }, { path: "/a" }, { path: "/a" }], leaves: [{ path: "/a/x.y", title: "X", page: "a", slug: "x.y" }, { path: "bad" }] });
  assert.deepEqual(routes.map(route => [route.path, route.kind]), [["/", "page"], ["/a", "page"], ["/a/x.y", "leaf"]]);
  assert.throws(() => enumerateRoutes({}), /no routes/);
});

test("idTokens finds ids, not domains, abbreviations or versions", () => {
  assert.deepEqual(idTokens("sections.studio.home and context.market.size"), ["sections.studio.home", "context.market.size"]);
  assert.deepEqual(idTokens("Visit clossys.com, e.g. now, version 1.2 or v.2"), []);
  assert.deepEqual(idTokens("Market size"), []);
});

test("detectors flag id labels, empty specimens, unresolved copy and overflow on the fixture", () => {
  const facts = probe(FIXTURE, { scrollWidth: 420, clientWidth: 375 });
  const findings = detectFindings(facts, {});
  const types = findings.map(finding => finding.type);
  assert.ok(findings.some(f => f.type === "id-label" && f.detail.includes("sections.studio.home")), "heading id is flagged");
  assert.ok(findings.some(f => f.type === "id-label" && f.detail.includes("assets.icon-home")), "title tooltip id is flagged");
  assert.ok(!findings.some(f => f.type === "id-label" && f.detail.includes("context.market.size")), "body prose is not a label");
  assert.ok(!findings.some(f => f.type === "id-label" && f.detail.includes("clossys.com")), "a domain is not an id");
  assert.equal(types.filter(type => type === "empty-specimen").length, 2, "unavailable badge and blank frame");
  assert.ok(types.includes("unresolved-copy"));
  assert.ok(types.includes("overflow"));
});

test("a clean page has no findings; console and network events become failing findings", () => {
  const facts = probe(`<!doctype html><title>Home</title><h1>Your agents</h1><p>Hello</p>`);
  assert.deepEqual(detectFindings(facts, {}), []);
  const findings = detectFindings(facts, { consoleErrors: ["boom"], failedRequests: [{ url: "/x.js", status: 404 }, { url: "/y", errorText: "net::ERR_FAILED" }] });
  assert.deepEqual(findings.map(f => f.type), ["console-error", "failed-request", "failed-request"]);
  assert.ok(findings.every(f => FAILING.includes(f.type)));
  assert.ok(severityOf(findings) > severityOf([{ type: "overflow", detail: "" }]));
});

test("isSettled waits for loading specimens and unloaded frames", () => {
  const base = { readyState: "complete", specimens: [], frames: [] };
  assert.equal(isSettled(base), true);
  assert.equal(isSettled({ ...base, specimens: [{ state: "loading" }] }), false);
  assert.equal(isSettled({ ...base, frames: [{ readyState: "loading", hidden: false }] }), false);
  assert.equal(isSettled({ ...base, frames: [{ readyState: "loading", hidden: true }] }), true);
  assert.equal(isSettled({ ...base, readyState: "interactive" }), false);
});

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("pixel diff ratio: identical is 0, a changed tenth is 0.1, a size change counts", () => {
  const white = decodePng(png(10, 10, () => [255, 255, 255, 255]));
  const stripe = decodePng(png(10, 10, (x) => x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.equal(diffRatio(white, white), 0);
  assert.equal(diffRatio(white, stripe), 0.1);
  assert.equal(diffRatio(white, decodePng(png(10, 20, () => [255, 255, 255, 255]))), 0.5);
});

test("parseArgs defaults --out to a temp dir and the port to 4620; contact sheet sorts worst route first", () => {
  assert.match(parseArgs([]).out, /capture-studio-\d+$/);
  assert.equal(parseArgs(["--out", "/tmp/x"]).out, "/tmp/x");
  assert.throws(() => parseArgs(["--port", "0", "--out", "/tmp/x"]), /--port/);
  assert.equal(parseArgs(["--out", "/tmp/x"]).port, 4620);
  const html = contactSheet({ routeCount: 2, shotCount: 2, exitCode: 1, findingsByType: { overflow: 1 }, shots: [
    { route: "/ok", file: "shots/ok.png", width: 375, theme: "light", findings: [], severity: 0 },
    { route: "/bad", file: "shots/bad.png", width: 375, theme: "light", findings: [{ type: "overflow", detail: "x" }], severity: 10 },
  ] });
  assert.ok(html.indexOf("/bad") < html.indexOf("/ok"));
});

test("a cross-origin frame no target probed, and a frame target the capture could not attach, fail the shot", () => {
  const facts = probe(`<!doctype html><title>Home</title><h1>Your agents</h1>`);
  const opaque = { ...facts, frames: [{ src: "/__specimen?a", readyState: "cross-origin", height: 200, width: 300, textLength: 0, media: 0, hidden: false }] };
  const unprobed = detectFindings(opaque, {});
  assert.deepEqual(unprobed.map(f => f.type), ["probe-error"]);
  assert.match(unprobed[0].detail, /__specimen\?a.*no frame target/);
  const swallowed = detectFindings(facts, { probeErrors: ["attach http://127.0.0.1/__specimen?a: Target closed"] });
  assert.deepEqual(swallowed.map(f => f.type), ["probe-error"]);
  assert.ok(FAILING.includes("probe-error"), "probe errors fail the run");
});

test("a cross-origin frame takes the paint its own target reported, so a blank one is an empty specimen", async () => {
  const { mergeFramePaint, framePaint } = await import("./capture-studio.mjs");
  assert.equal(typeof mergeFramePaint, "function");
  const facts = { readyState: "complete", scrollWidth: 375, clientWidth: 375, bodyText: "", labels: [], specimens: [], frames: [
    { src: "/__specimen?blank", readyState: "cross-origin", height: 200, width: 300, textLength: 0, media: 0, hidden: false },
    { src: "/__specimen?painted", readyState: "cross-origin", height: 200, width: 300, textLength: 0, media: 0, hidden: false },
    { src: "/__specimen?loading", readyState: "cross-origin", height: 200, width: 300, textLength: 0, media: 0, hidden: false },
  ] };
  const blankDom = new JSDOM(`<!doctype html><body></body>`, { url: "http://127.0.0.1:4620/__specimen?blank", runScripts: "outside-only" });
  // jsdom stays "loading" until its load event; the probe's own fields are what is under test.
  const blank = { ...blankDom.window.eval(`(${framePaint.toString()})()`), readyState: "complete" };
  assert.deepEqual(blank, { url: "http://127.0.0.1:4620/__specimen?blank", readyState: "complete", textLength: 0, media: 0 });
  const merged = mergeFramePaint(facts, [blank, { url: "http://127.0.0.1:4620/__specimen?painted", readyState: "complete", textLength: 12, media: 1 }, { url: "http://127.0.0.1:4620/__specimen?loading", readyState: "loading", textLength: 0, media: 0 }], "http://127.0.0.1:4620/designer");
  assert.equal(isSettled(merged), false, "a frame target still loading is not settled");
  const findings = detectFindings(merged, {});
  assert.deepEqual(findings.map(f => [f.type, f.detail]), [["empty-specimen", "frame /__specimen?blank painted nothing"]]);
});

// A DevTools socket that records what is sent and never answers.
const silentSocket = () => ({ sent: [], send(text) { this.sent.push(JSON.parse(text)); }, onmessage: null, onclose: null });
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms))]);

test("a DevTools call nobody answers rejects at its timeout instead of hanging", async () => {
  const socket = silentSocket();
  const client = createCdpClient(socket, { callTimeoutMs: 50 });
  const started = Date.now();
  await assert.rejects(within(client.send("Page.captureScreenshot", {}, "s1"), 2000), /Page\.captureScreenshot: no answer within 50ms/);
  assert.ok(Date.now() - started < 1000);
  assert.equal(client.pendingCount(), 0, "the stuck call is forgotten");
});

test("a detached session and a closed socket reject their pending calls; a late answer is ignored", async () => {
  const socket = silentSocket();
  const client = createCdpClient(socket, { callTimeoutMs: 10_000 });
  const onDetached = client.send("Runtime.evaluate", {}, "child");
  const other = client.send("Page.getLayoutMetrics", {}, "page");
  socket.onmessage({ data: JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId: "child" } }) });
  await assert.rejects(onDetached, /Runtime\.evaluate: target detached/);
  socket.onclose();
  await assert.rejects(other, /DevTools socket closed/);
  socket.onmessage({ data: JSON.stringify({ id: 2, result: {} }) });
  assert.equal(client.pendingCount(), 0);
});

test("a frame that attaches paused under a session nobody listens to is resumed", () => {
  const socket = silentSocket();
  createCdpClient(socket, { callTimeoutMs: 50 });
  socket.onmessage({ data: JSON.stringify({ method: "Target.attachedToTarget", sessionId: "gone", params: { sessionId: "orphan", waitingForDebugger: true, targetInfo: { type: "iframe" } } }) });
  assert.deepEqual(socket.sent.map(m => [m.method, m.sessionId]), [["Runtime.runIfWaitingForDebugger", "orphan"]]);
});

test("a stuck capture attempt is abandoned at its deadline, retried once, then reported as a failed shot", async () => {
  const socket = silentSocket();
  const client = createCdpClient(socket, { callTimeoutMs: 60_000 });
  const attempts = [];
  const abandoned = [];
  // Each attempt awaits a DevTools call that never answers, like the stalled /designer/themes shots.
  const result = await within(captureWithRetry((state, n) => { attempts.push(n); state.targetId = `t${n}`; return client.send("Page.captureScreenshot", {}, `s${n}`); },
    { deadlineMs: 50, abandon: state => abandoned.push(state.targetId) }), 2000);
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(abandoned, ["t1", "t2"]);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, "readiness-timeout");
  assert.match(result.findings[0].detail, /capture failed 2 times: attempt 1 did not finish within 50ms; attempt 2/);
  assert.ok(FAILING.includes(result.findings[0].type));
});

test("a capture attempt that fails once and then succeeds keeps the second result", async () => {
  let calls = 0;
  const result = await captureWithRetry(async () => { if (++calls === 1) throw new Error("Target closed"); return { findings: [], counts: { consoleErrors: 0, failedRequests: 0 } }; }, { deadlineMs: 1000 });
  assert.equal(calls, 2);
  assert.deepEqual(result.findings, []);
});

const fakeLauncher = () => {
  const browsers = [];
  const launch = async () => {
    const browser = { name: `b${browsers.length + 1}`, closed: false, close: async () => { browser.closed = true; } };
    browsers.push(browser);
    return { browser, contexts: {} };
  };
  return { browsers, launch };
};
const tick = () => new Promise(done => setImmediate(done));

test("the browser pool replaces a browser after its shot budget and closes it once its last lease is released", async () => {
  const { browsers, launch } = fakeLauncher();
  const pool = createBrowserPool(launch, { recycleEvery: 2 });
  const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
  assert.equal(browsers.length, 1, "concurrent first leases share one launch");
  const c = await pool.acquire();
  assert.equal(c.browser.name, "b2", "the third shot goes to a fresh browser");
  a.release(); await tick();
  assert.equal(browsers[0].closed, false, "an in-use browser is never closed under a worker");
  b.release(); await tick();
  assert.equal(browsers[0].closed, true);
  c.release();
  await pool.close();
  assert.equal(browsers[1].closed, true);
});

test("a stuck attempt retires its wedged browser and the retry runs on a fresh one", async () => {
  const { browsers, launch } = fakeLauncher();
  const pool = createBrowserPool(launch, { recycleEvery: 100 });
  const socket = silentSocket();
  const client = createCdpClient(socket, { callTimeoutMs: 60_000 });
  const used = [];
  // The first browser never answers its screenshot, like the wedged compositor; the second does.
  const result = await within(captureWithRetry(async state => {
    state.lease = await pool.acquire();
    used.push(state.lease.browser.name);
    if (state.lease.browser.name === "b1") return client.send("Page.captureScreenshot", {}, "s1");
    return { findings: [], counts: { consoleErrors: 0, failedRequests: 0 } };
  }, { deadlineMs: 50, settle: (state, error) => state.lease?.release(error) }), 2000);
  assert.deepEqual(used, ["b1", "b2"]);
  assert.deepEqual(result.findings, []);
  await tick();
  assert.equal(browsers[0].closed, true, "the wedged browser is closed");
  await pool.close();
});

test("a recycled browser is closed even when its last lease ends in a failure", async () => {
  const { browsers, launch } = fakeLauncher();
  const pool = createBrowserPool(launch, { recycleEvery: 2 });
  const a = await pool.acquire();
  const b = await pool.acquire(); // the shot budget is spent: b1 is retired while a and b still hold it
  a.release();
  b.release(new Error("Page.captureScreenshot: no answer within 30000ms"));
  await tick();
  assert.equal(browsers[0].closed, true, "the retired browser's last (failed) lease closes it");
  await pool.close();
});

test("closing the pool closes every browser it launched, recycled ones with leases still out included", async () => {
  const { browsers, launch } = fakeLauncher();
  const pool = createBrowserPool(launch, { recycleEvery: 1 });
  await pool.acquire(); // b1, retired at once and never released (a lost lease)
  await pool.acquire(); // b2, same
  const c = await pool.acquire();
  c.release();
  await pool.close();
  assert.deepEqual(browsers.map(b => b.closed), [true, true, true]);
});

test("the shipped gate config makes id-label and overflow reports, and every wiring type still blocks", async () => {
  const gates = readGates(await readFile(GATES_FILE, "utf8"));
  assert.equal(gates["id-label"].mode, "report");
  assert.equal(gates.overflow.mode, "report");
  assert.match(gates["id-label"].reason, /Only wiring blocks/);
  assert.equal(blocks({ type: "id-label" }, gates), false);
  assert.equal(blocks({ type: "overflow" }, gates), false);
  for (const type of ["console-error", "failed-request", "unresolved-copy", "empty-specimen", "readiness-timeout", "probe-error"]) assert.equal(blocks({ type }, gates), true, `${type} blocks`);
  assert.equal(blocks({ type: "id-label" }, {}), true, "with no gate a failing type blocks");
});

test("a gate on a wiring type, a duplicate, a bad mode or a missing reason fails setup", () => {
  const config = gates => JSON.stringify({ schema: "clossys.capture-studio-gates/1", gates });
  assert.throws(() => readGates(config([{ type: "empty-specimen", mode: "report", reason: "x" }])), /wiring or unknown/);
  assert.throws(() => readGates(config([{ type: "overflow", mode: "report", reason: "x" }, { type: "overflow", mode: "block", reason: "y" }])), /listed twice/);
  assert.throws(() => readGates(config([{ type: "overflow", mode: "skip", reason: "x" }])), /block or report/);
  assert.throws(() => readGates(config([{ type: "overflow", mode: "report", reason: " " }])), /needs a reason/);
  assert.throws(() => readGates(JSON.stringify({ schema: "other", gates: [] })), /schema/);
});

// ---------------------------------------------------------------- shards

const SHARD_ROUTES = enumerateRoutes({ routes: ["/", "/designer", "/writer", "/designer/themes", "/publisher"].map(path => ({ path, label: path })),
  leaves: ["a.one", "b.two", "c.three", "d.four", "e.five", "f.six", "g.seven"].map(slug => ({ path: `/designer/themes/${slug}`, title: slug, page: "designer-themes", slug })) });
const shardJobs = () => SHARD_ROUTES.flatMap(route => THEMES.flatMap(theme => WIDTHS.map(width => ({ ...route, route: route.path, width, theme, file: `shots/${route.path}-${width}-${theme}.png` }))));
/** A deterministic fake shot: findings depend only on the job, never on which server took it or when. */
function fakeShot(job) {
  const n = [...`${job.route}${job.width}${job.theme}`].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const findings = [];
  if (n % 5 === 0) findings.push({ type: "overflow", detail: "scrollWidth 400 > clientWidth 375" });
  if (n % 7 === 0) findings.push({ type: "console-error", detail: `boom ${job.route}` });
  if (n % 11 === 0) findings.push({ type: "id-label", detail: "h2 shows a.b" });
  return { route: job.route, kind: job.kind, label: job.label, width: job.width, theme: job.theme, file: job.file, consoleErrors: 0, failedRequests: 0, overflow: null, findings, severity: severityOf(findings) };
}
const GATES = { "id-label": { mode: "report", reason: "wording" }, overflow: { mode: "report", reason: "visual" } };
const pause = ms => new Promise(next => setTimeout(next, ms));

test("a capture sharded over K servers reports exactly what the serial capture reports, in the same order", async () => {
  const serial = summarize(await runShards(planShards(shardJobs(), 1), { concurrency: 1, capture: async job => fakeShot(job) }), { gates: GATES, routes: SHARD_ROUTES });
  // The serial report is worst first, then route, width, theme.
  assert.deepEqual(serial.shots.map(shot => [shot.severity, shot.route, shot.width, shot.theme]), orderShots(serial.shots).map(shot => [shot.severity, shot.route, shot.width, shot.theme]));
  assert.ok(serial.exitCode === 1 && serial.failingShots > 0 && serial.reportsByType.overflow > 0, "the fixture has failing and reported shots");
  for (const servers of [2, 3, 5]) {
    let seed = servers;
    // Out-of-order completion: every shot waits a pseudo-random time, so shards finish interleaved.
    const merged = summarize(await runShards(planShards(shardJobs(), servers), { concurrency: 4, capture: async job => { seed = (seed * 1103515245 + 12345) % 2 ** 31; await pause(seed % 7); return fakeShot(job); } }), { gates: GATES, routes: SHARD_ROUTES });
    assert.deepEqual(merged, serial, `${servers} servers`);
  }
});

test("the shard pool never runs more shots at once than --concurrency, keeps a route on one server and captures each shot once", async () => {
  for (const [servers, concurrency] of [[1, 4], [3, 4], [3, 1], [4, 2]]) {
    const inflight = Array(servers).fill(0);
    let total = 0, peakTotal = 0;
    const serverOf = new Map();
    const shots = await runShards(planShards(shardJobs(), servers), { concurrency, capture: async (job, server) => {
      inflight[server]++; total++;
      peakTotal = Math.max(peakTotal, total);
      assert.ok(total <= concurrency, `${total} shots in flight > ${concurrency}`);
      assert.equal(serverOf.get(job.route) ?? server, server, `${job.route} stays on one server`);
      serverOf.set(job.route, server);
      await pause(1 + (job.width % 3));
      inflight[server]--; total--;
      return fakeShot(job);
    } });
    assert.equal(peakTotal, concurrency, "the bound is reached, not just respected");
    assert.equal(shots.length, shardJobs().length);
    assert.equal(new Set(shots.map(shot => shot.file)).size, shots.length);
    assert.equal(new Set(serverOf.values()).size, Math.min(servers, concurrency), "every server a worker can reach takes routes");
  }
});

test("planShards deals whole routes in contiguous runs; an idle server steals a whole route", async () => {
  const queues = planShards(shardJobs(), 3);
  assert.equal(queues.length, 3);
  assert.deepEqual(queues.flat().map(group => group[0].route), SHARD_ROUTES.map(route => route.path));
  for (const group of queues.flat()) assert.ok(group.length === 6 && group.every(job => job.route === group[0].route));
  // Server 1's queue is empty: it takes route groups from the back of the others instead of idling.
  const lopsided = [planShards(shardJobs(), 1)[0], []];
  const ran = new Map();
  await runShards(lopsided, { concurrency: 2, capture: async (job, server) => { await pause(1); ran.set(job.route, server); return fakeShot(job); } });
  assert.ok([...ran.values()].includes(1));
});

test("--servers and CAPTURE_STUDIO_SERVERS pick the server count; the default leaves cores for browsers and builds", () => {
  assert.equal(parseArgs(["--out", "/tmp/x", "--servers", "2"]).servers, 2);
  assert.equal(parseArgs(["--out", "/tmp/x"], { CAPTURE_STUDIO_SERVERS: "1" }).servers, 1);
  assert.throws(() => parseArgs(["--out", "/tmp/x", "--servers", "0"]), /--servers/);
  assert.throws(() => parseArgs(["--out", "/tmp/x", "--port", "65535", "--servers", "2"]), /--port/);
  assert.deepEqual([2, 4, 6, 8, 16].map(cpus => defaultServers(cpus)), [1, 1, 2, 3, 3]);
  assert.equal(shardTmpdir(0, "/t"), undefined, "the first server shares the serial run's specimen cache");
  assert.equal(shardTmpdir(2, "/t"), "/t/shard-2");
});

test("a shard starts from the serial run's specimen cache, never cold", async () => {
  const { specimenSubstrate } = await import("../dist/server/specimen-substrate.js");
  assert.equal(specimenCache("/some/root"), dirname(specimenSubstrate("/some/root")), "the cache the producer reads for that root");
  const base = mkdtempSync(join(tmpdir(), "seed-shard-"));
  const source = join(base, "serial"), target = join(base, "run", "shard-1", "cache");
  assert.equal(seedShard(source, target), false, "a cold cache seeds nothing");
  assert.equal(existsSync(target), false);
  mkdirSync(join(source, "substrate", "node_modules", "font"), { recursive: true });
  writeFileSync(join(source, "substrate", "node_modules", "font", "index.css"), "a");
  mkdirSync(join(source, "dist-k1"));
  writeFileSync(join(source, "dist-k1", "index.html"), "<p>");
  writeFileSync(join(source, "site-k1.json"), "{}");
  assert.equal(seedShard(source, target), true);
  const tree = dir => readdirSync(dir, { recursive: true }).sort();
  assert.deepEqual(tree(target), tree(source));
  assert.equal(readFileSync(join(target, "substrate", "node_modules", "font", "index.css"), "utf8"), "a");
});
