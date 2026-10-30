import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertFixtureExcluded, probeMarketing } from "./marketing-reference-rehearsal.mjs";
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
