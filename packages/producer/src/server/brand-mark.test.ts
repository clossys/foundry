import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ value: {} as { name?: string; mark?: { light: string; dark: string }; favicon?: string; appIcon?: string; lockup?: { light: string; dark: string } } }));
// The brand source is the consumer's pinned assets.* slots; only the routes are under test here.
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

it("never stands Foundry's own mark in for a consumer that pins no brand asset", async () => {
  server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)) });
  for (const path of ["/api/brand/mark.svg", "/api/brand/lockup.svg", "/api/brand/favicon.svg", "/api/brand/app-icon.svg"]) {
    const response = await get(path);
    expect(response.status, path).toBe(404); expect(response.headers.location, path).toBeUndefined();
  }
});

it("serves the favicon, app icon and lockup from the consumer brand", async () => {
  const svg = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" aria-label="${label}"><rect width="1" height="1"/></svg>`;
  brand.value = { name: "Example", favicon: svg("favicon"), appIcon: svg("app"), lockup: { light: svg("lockup"), dark: svg("lockup-dark") } } as typeof brand.value;
  server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)) });
  expect((await get("/api/brand/favicon.svg")).text).toBe(svg("favicon"));
  expect((await get("/api/brand/app-icon.svg")).text).toBe(svg("app"));
  expect((await get("/api/brand/lockup.svg?ground=dark")).text).toBe(svg("lockup-dark"));
  expect(JSON.parse((await get("/api/brand")).text)).toEqual({ name: "Example", mark: false, favicon: true, appIcon: true, lockup: true });
});
