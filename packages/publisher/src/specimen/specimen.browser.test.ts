/**
 * Specimen pages in a real headless Chrome: rendered output, console errors and the health
 * message the page posts to its parent. Skipped when no Chrome/Chromium is installed.
 */
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureSpecimen, createSpecimenHandler, directoryRecordSource, findChrome, specimenUrl, SPECIMEN_HEALTH_MESSAGE_TYPE } from "./index.js";
import { SPECIMEN_SIZE_SCRIPT } from "./render.js";

const records = fileURLToPath(new URL("./__fixtures__/records/", import.meta.url));
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const chrome = findChrome();
const HEALTH_FIELDS = ["errors", "loadMs", "lcpMs", "cls", "longTasks", "weight"] as const;

let server: Server;
let base = "";

beforeAll(async () => {
  if (!chrome) return;
  const handle = createSpecimenHandler({ source: directoryRecordSource({ roots: [records], defaultTheme: "neutral" }), workspace });
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/portal") {
      // A specimen whose open overlay is portalled to the body, outside the stage: a popover in the
      // page flow below the stage, or (toast=1) a toast fixed to the bottom of the viewport.
      const toast = url.searchParams.get("toast") === "1";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>portal</title><link rel="icon" href="data:,"><style>body{margin:0}</style><div id="specimen-stage" style="height:100px"><button>Open</button></div>`
        + (toast ? "" : `<div id="popover" style="position:absolute;top:300px;left:8px;width:200px;height:120px;max-height:120px;overflow:hidden;background:#fff;border:1px solid #ccc"><div style="height:240px">menu</div></div>`)
        + (toast ? `<ol style="position:fixed;bottom:24px;right:24px;margin:0;padding:0;height:0;width:240px"><li style="position:absolute;bottom:0;right:0;list-style:none;height:60px;width:240px;background:#fff;border:1px solid #ccc">Saved</li></ol>` : "")
        + `<script>${SPECIMEN_SIZE_SCRIPT}</script>`);
      return;
    }
    if (url.pathname === "/harness") {
      // A stand-in for the Studio card: frames the specimen and keeps what it posts.
      const src = url.searchParams.get("src") ?? "";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>harness</title><link rel="icon" href="data:,"><iframe id="frame" width="${url.searchParams.get("width") ?? 480}" height="400"></iframe><script>
        window.__framed = [];
        addEventListener("message", event => { if (event.source !== document.getElementById("frame").contentWindow) return; window.__framed.push(event.data); if (${url.searchParams.get("fit") === "1"} && event.data && event.data.type === "clossys:specimen-size") document.getElementById("frame").height = String(event.data.height); });
        document.getElementById("frame").src = ${JSON.stringify(src)};
      </script>`);
      return;
    }
    handle(request, response).then(handled => { if (!handled) response.writeHead(404).end(); }, error => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => { if (server) await new Promise(done => server.close(done)); });

function expectHealthShape(health: Record<string, any> | undefined, element: string) {
  expect(health).toBeDefined();
  expect(health!.type).toBe(SPECIMEN_HEALTH_MESSAGE_TYPE);
  expect(health!.version).toBe(1);
  expect(health!.element).toBe(element);
  for (const field of HEALTH_FIELDS) expect(health, field).toHaveProperty(field);
  expect(typeof health!.errors.count).toBe("number");
  expect(Array.isArray(health!.errors.items)).toBe(true);
  expect(health!.loadMs).toBeGreaterThan(0);
  expect(typeof health!.cls).toBe("number");
  expect(typeof health!.longTasks.count).toBe("number");
  expect(typeof health!.longTasks.totalMs).toBe("number");
  expect(typeof health!.weight.jsBytes).toBe("number");
  expect(typeof health!.weight.cssBytes).toBe("number");
}

describe.skipIf(!chrome)("specimen in Chrome", () => {
  it("renders a visual element with zero console errors and a full health report", async () => {
    const capture = await captureSpecimen(specimenUrl(base, { element: "sample-card", width: 480 }), {
      width: 480, height: 400, settleMs: 300,
      probe: `({ card: !!document.querySelector('[data-slot="card"]'), buttons: document.querySelectorAll('[data-slot="button"]').length, title: document.querySelector("h3")?.textContent, primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(), bg: getComputedStyle(document.querySelectorAll('[data-slot="button"]')[1]).backgroundColor })`,
    });
    expect(capture.consoleErrors).toEqual([]);
    expect(capture.probe).toMatchObject({ card: true, buttons: 2, title: "Weekly report ready", primary: "oklch(0.205 0 0)" });
    expect((capture.probe as { bg: string }).bg).not.toBe("rgba(0, 0, 0, 0)");
    expectHealthShape(capture.health, "sample-card");
    expect(capture.health!.kind).toBe("visual");
    expect((capture.health as any).errors.count).toBe(0);
    expect((capture.health as any).weight.jsBytes).toBeGreaterThan(0);
    expect((capture.health as any).weight.cssBytes).toBeGreaterThan(0);
  }, 90_000);

  it("renders a text element at its limits with zero console errors", async () => {
    const capture = await captureSpecimen(specimenUrl(base, { element: "hero-copy", theme: "neutral:dark", width: 768 }), {
      width: 768, height: 600,
      probe: `[...document.querySelectorAll(".specimen-copy")].map(row => ({ key: row.dataset.copyKey, lines: Number(row.dataset.lines || 0), over: row.dataset.over || null }))`,
    });
    expect(capture.consoleErrors).toEqual([]);
    const rows = capture.probe as { key: string; lines: number; over: string | null }[];
    expect(rows.map(row => row.key)).toEqual(["hero.title", "hero.subtitle", "hero.cta"]);
    for (const row of rows) expect(row.lines).toBeGreaterThan(0);
    expectHealthShape(capture.health, "hero-copy");
    expect(capture.health!.kind).toBe("text");
    expect(capture.health!.theme).toBe("neutral:dark");
    expect((capture.health as any).errors.count).toBe(0);
  }, 90_000);

  it("delivers the health message to a framing parent", async () => {
    const src = specimenUrl(base, { element: "sample-button", width: 320 });
    const capture = await captureSpecimen(`${base}/harness?width=320&src=${encodeURIComponent(src)}`, {
      width: 400, height: 500, settleMs: 300,
      probe: `window.__framed`,
    });
    expect(capture.consoleErrors).toEqual([]);
    // The frame also posts size messages on their own channel (measured below); health is its own type.
    const framed = (capture.probe as Record<string, any>[]).filter(message => message?.type === SPECIMEN_HEALTH_MESSAGE_TYPE);
    expect(framed.length).toBeGreaterThanOrEqual(1);
    expectHealthShape(framed[framed.length - 1], "sample-button");
    expect(framed[0]!.sequence).toBe(1);
  }, 90_000);

  it("measures overlays portalled outside the stage, and a fixed toast without growing the frame", async () => {
    const sizes = async (src: string) => {
      const capture = await captureSpecimen(`${base}/harness?width=320&fit=1&src=${encodeURIComponent(src)}`, { width: 400, height: 900, settleMs: 3200, probe: `window.__framed` });
      expect(capture.consoleErrors).toEqual([]);
      return (capture.probe as Record<string, any>[]).filter(message => message.type === "clossys:specimen-size");
    };
    const popover = await sizes(`${base}/portal`);
    expect(popover.length).toBeGreaterThanOrEqual(1);
    // The popover content (240px, inside a 1px border) counts, not its squeezed 120px box: 301 + 240 + 16.
    expect(popover[popover.length - 1]).toMatchObject({ layout: "reflow", height: 557, empty: false });
    const toast = await sizes(`${base}/portal?toast=1`);
    const heights = toast.map(message => message.height as number);
    // The toast list is a zero-height fixed box (as sonner renders it) whose toast hangs above its
    // bottom edge: the toast (60px + 1px border each side) needs its height plus its 24px gap each side, and
    // fitting the frame to that does not grow it again.
    expect(heights[heights.length - 1]).toBe(110);
    expect(new Set(heights.slice(-2)).size).toBe(1);
  }, 90_000);

  it("mutation: an element that throws reports errors >= 1", async () => {
    const capture = await captureSpecimen(specimenUrl(base, { element: "broken-card" }), {
      width: 480, height: 400, settleMs: 300,
      probe: `!!document.querySelector("[data-specimen-error]")`,
    });
    expect(capture.probe).toBe(true);
    expectHealthShape(capture.health, "broken-card");
    const errors = (capture.health as any).errors;
    expect(errors.count).toBeGreaterThanOrEqual(1);
    expect(errors.items.some((item: { message: string }) => /BrokenCard cannot render/.test(item.message))).toBe(true);
  }, 90_000);

  it("reports a missing record through the same channel", async () => {
    const capture = await captureSpecimen(specimenUrl(base, { element: "not-a-record" }), { width: 480, height: 300 });
    expect((capture.health as any).errors.count).toBeGreaterThanOrEqual(1);
    expect((capture.health as any).errors.items[0].source).toBe("record");
  }, 90_000);
});
