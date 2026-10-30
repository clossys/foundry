import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertFixtureExcluded, probeMarketing, captureManifest, probeHtml, rehearse } from "./marketing-reference-rehearsal.mjs";
import { serve } from "../packages/publisher/test-fixtures/marketing-reference/serve.mjs";

test("packing refuses consumer fixtures in the shipped file inventory", () => {
  assert.doesNotThrow(() => assertFixtureExcluded({ files: [{ path: "dist/web/index.js" }] }));
  assert.throws(() => assertFixtureExcluded({ files: [{ path: "test-fixtures/marketing-reference/build.mjs" }] }), /must not ship/);
  assert.throws(() => assertFixtureExcluded({ files: [] }), /list its contents/);
});

test("the real fixture server preserves route statuses, redirects and unknown-path 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "marketing-server-test-"));
  let server;
  try {
    await writeFile(join(directory, "routes.json"), JSON.stringify({ routes: [{ path: "/", file: "home.html", type: "text/html", status: 200 }], redirects: [{ source: "/welcome", destination: "/", permanent: true }] }));
    await writeFile(join(directory, "home.html"), "<h1>Example Co.</h1>");
    await writeFile(join(directory, "not-found.html"), "<h1>404</h1>");
    server = await serve({ directory: pathToFileURL(`${directory}/`) });
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(origin)).status, 200);
    const redirect = await fetch(`${origin}/welcome`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/");
    const missing = await fetch(`${origin}/unknown`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<h1>404<\/h1>/);
    assert.equal((await fetch(origin, { method: "HEAD" })).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [name, status, body] of [
  ["missing required page", 404, "<h1>Missing</h1>"],
  ["duplicate primary heading", 200, "<h1>Example</h1><h1>Extra</h1>"],
  ["absent primary heading", 200, "<h2>Example</h2>"],
]) test(`rehearsal rejects ${name} over HTTP`, async () => {
  const server = createServer((_request, response) => { response.writeHead(status, { "content-type": "text/html" }); response.end(body); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(probeMarketing(`http://127.0.0.1:${server.address().port}`, [{ path: "/", title: "Example" }]));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("enumerates every route and all 24 explicit capture dimensions", () => {
  const manifest = captureManifest([{ path: "/", family: "hero" }, { path: "/proof", family: "proof" }], ["article"]);
  assert.equal(manifest.cases.length, 48);
  assert.equal(new Set(manifest.cases.map(item => item.id)).size, 48);
  for (const route of manifest.routes) for (const theme of ["light", "dark", "inverse"]) for (const width of [1440, 390]) for (const dir of ["ltr", "rtl"]) for (const reducedMotion of [false, true]) {
    assert.equal(manifest.cases.filter(item => item.route === route.path && item.theme === theme && item.width === width && item.dir === dir && item.reducedMotion === reducedMotion).length, 1);
  }
  assert.deepEqual(manifest.gaps, ["article"]);
  assert.throws(() => captureManifest([{ path: "/", family: "hero" }, { path: "/", family: "hero" }]), /unique/);
});

test("checks native headings, decorative backdrops, text and accessible names against Writer resolutions", () => {
  const html = '<h1>Example Co.</h1><div data-backdrop aria-hidden="true"></div><a aria-label="Find out more">Explore</a>';
  const writer = ["Example Co.", "Find out more", "Explore"];
  assert.deepEqual(probeHtml(html, writer), []);
  assert.ok(probeHtml(html.replace("<h1>", "<h2>").replace("</h1>", "</h2>"), writer).some(finding => finding.code === "heading-count"));
  assert.ok(probeHtml(html.replace('aria-hidden="true"', ''), writer).some(finding => finding.code === "backdrop-visible"));
  assert.ok(probeHtml(html + '<p>Handwritten fallback</p>', writer).some(finding => finding.code === "unresolved-copy"));
  assert.ok(probeHtml(html.replace("Find out more", "Unbound accessible label"), writer).some(finding => finding.location === "aria-label"));
});

test("writes real rendered HTML and reports captures not run without a driver", async () => {
  const out = await mkdtemp(join(tmpdir(), "reference-rehearsal-"));
  try {
    const result = await rehearse({ fixture: { routes: [{ path: "/", family: "hero" }], gaps: ["article"], render: item => ({ html: `<html dir="${item.dir}"><body><h1>Example Co.</h1></body></html>`, writerValues: ["Example Co."] }) }, out });
    assert.equal(result.ok, true);
    assert.equal(result.report.captureStatus, "not-run");
    assert.ok(result.report.cases.every(item => item.capture === "not-run"));
    assert.match(await readFile(join(out, "home-dark-390-rtl-reduce.html"), "utf8"), /dir="rtl"/);
  } finally { await rm(out, { recursive: true, force: true }); }
});
