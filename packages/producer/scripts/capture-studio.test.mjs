import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { JSDOM } from "jsdom";
import { DEFAULT_MAP, FAILING, contactSheet, decodePng, detectFindings, diffRatio, enumerateRoutes, idTokens, isSettled, pageProbe, parseArgs, severityOf } from "./capture-studio.mjs";

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
