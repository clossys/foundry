import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { renderStudioRoute, startStudio } from "./studio.js";

it("checks the shipped static asset without starting a slow dynamic root render", async () => {
  const root = await mkdtemp(join(tmpdir(), "producer-studio-ready-"));
  const entry = join(root, "studio.mjs");
  await writeFile(entry, `import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
const server = createServer(async (request, response) => {
  if (request.url === "/studio-mark.svg") { response.end("<svg/>"); return; }
  await writeFile(new URL("./dynamic-root-requested", import.meta.url), "requested");
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
`);
  const aborter = new AbortController();
  try {
    const child = await startStudio(entry, "http://127.0.0.1:4300", aborter.signal, 2_000);
    try {
      expect(child.process.exitCode).toBeNull();
      await expect(readFile(join(root, "dynamic-root-requested"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await child.stop(); }
  } finally { aborter.abort(); await rm(root, { recursive: true, force: true }); }
});

it("renders a page that lands on its first tab by following the same-origin redirect", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/director/context") { response.writeHead(307, { Location: "/director/context/market" }); response.end(); return; }
    if (request.url === "/loop") { response.writeHead(307, { Location: "/loop" }); response.end(); return; }
    if (request.url === "/away") { response.writeHead(307, { Location: "http://example.com/director" }); response.end(); return; }
    if (request.url === "/director/context/market") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<h1>Market</h1>"); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  try {
    expect(await renderStudioRoute(port, "/director/context")).toBe("<h1>Market</h1>");
    // A redirect loop or a redirect off the child is not a render.
    expect(await renderStudioRoute(port, "/loop")).toBeUndefined();
    expect(await renderStudioRoute(port, "/away")).toBeUndefined();
    expect(await renderStudioRoute(port, "/missing")).toBeUndefined();
  } finally { await new Promise(done => server.close(done)); }
});
