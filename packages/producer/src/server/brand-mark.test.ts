import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ value: {} as { name?: string; mark?: { light: string; dark: string } } }));
// The brand source is the Designer mark cell; only the route's caching is under test here.
vi.mock("./designer-globals.js", async original => ({ ...(await original<typeof import("./designer-globals.js")>()), consumerBrand: async () => brand.value }));
const { startProducerServer } = await import("./index.js");

let root: string;
let server: Awaited<ReturnType<typeof startProducerServer>> | undefined;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-brand-mark-")); await mkdir(join(root, "clossys")); });
afterEach(async () => { await server?.close(); server = undefined; brand.value = {}; await rm(root, { recursive: true, force: true }); });
function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; headers: Record<string, any> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server!.port, path, headers }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", value => { text += value; }); response.on("end", () => resolve({ status: response.statusCode!, text, headers: response.headers }));
    }); req.on("error", reject); req.end();
  });
}

it("serves the brand mark with a short private cache and a content ETag, answering 304 when unchanged", async () => {
  const light = '<svg xmlns="http://www.w3.org/2000/svg" aria-label="Example"><rect width="1" height="1"/></svg>';
  const dark = '<svg xmlns="http://www.w3.org/2000/svg" aria-label="Example"><circle r="1"/></svg>';
  brand.value = { name: "Example", mark: { light, dark } };
  server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)) });
  const first = await get("/api/brand/mark.svg");
  expect(first.status).toBe(200); expect(first.text).toBe(light);
  expect(first.headers["cache-control"]).toBe("private, max-age=60, stale-while-revalidate=300");
  expect(first.headers.etag).toBe(`"${createHash("sha256").update(light).digest("base64url")}"`);
  expect(first.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
  const again = await get("/api/brand/mark.svg", { "If-None-Match": first.headers.etag });
  expect(again.status).toBe(304); expect(again.text).toBe(""); expect(again.headers.etag).toBe(first.headers.etag);
  const reversed = await get("/api/brand/mark.svg?ground=dark", { "If-None-Match": first.headers.etag });
  expect(reversed.status).toBe(200); expect(reversed.text).toBe(dark); expect(reversed.headers.etag).not.toBe(first.headers.etag);
  brand.value = { name: "Example", mark: { light: dark, dark } };
  expect((await get("/api/brand/mark.svg", { "If-None-Match": first.headers.etag })).status).toBe(200);
});

it("redirects to Studio's own mark with the same short cache when the consumer has none", async () => {
  server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)) });
  const response = await get("/api/brand/mark.svg");
  expect(response.status).toBe(302); expect(response.headers.location).toBe("/studio-mark.svg");
  expect(response.headers["cache-control"]).toBe("private, max-age=60, stale-while-revalidate=300");
});
