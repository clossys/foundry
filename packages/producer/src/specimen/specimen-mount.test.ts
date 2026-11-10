/**
 * The canonical Designer specimens that crashed in Studio, each built through the same source and
 * builder `/__specimen` uses and mounted in a DOM: the bundle builds, the element renders and the
 * page reports no build, render or runtime error.
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSpecimenBuilder, renderSpecimenPage } from "@clossys/publisher/specimen";
import { libraryRecordSource } from "./library-source.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: new (html: string, options: object) => { window: any } };
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const consumer = fileURLToPath(new URL("../../../../clossys", import.meta.url));
const registryBase = dirname(require.resolve("@clossys/designer-ui"));
const source = libraryRecordSource({ roots: [consumer], registryBase });
const builder = createSpecimenBuilder({ workspace });

/** slot/element@version: each candidate Studio showed crashing (R2F-17a dry run, every option card). */
const SPECIMENS: readonly [string, number][] = [
  ["components.chart-area/chart-area", 1],
  ["components.chart-sparkline/chart-sparkline", 1],
  ["components.chart-status-strip/chart-status-strip", 1],
  ["components.chart-scatter/chart-scatter", 1],
  ["components.chart-range/chart-range", 1],
  ["components.chart-waterfall/chart-waterfall", 1],
  ["components.chart-heatmap/chart-heatmap", 1],
  ["components.rich-text/rich-text", 1],
  ["components.icon/icon", 1],
  ["components.studio.text-link/text-link", 1],
  ["components.studio.card-grid/card-grid", 1],
  ["components.studio.specimen-frame/specimen-frame", 1],
  ["components.studio.sidebar-static-row/sidebar-static-row", 2],
  ["components.flow.canvas/canvas", 1],
  ["components.resize-handle/resize-handle", 1],
  ["sections.wizard/wizard", 1],
  ["sections.column-mapper/column-mapper", 1],
];

/** Browser APIs layout-measuring libraries read on mount that jsdom does not ship. */
const BROWSER_STUBS = `
const SIZE = { width: 480, height: 240 };
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { setTimeout(() => this.callback([{ target, contentRect: { ...SIZE, x: 0, y: 0, top: 0, left: 0, right: SIZE.width, bottom: SIZE.height }, borderBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }], contentBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }] }], this), 0); }
  unobserve() {} disconnect() {}
};
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: SIZE.width, bottom: SIZE.height, ...SIZE, toJSON() {} }; };
for (const name of ["offsetWidth", "clientWidth", "scrollWidth"]) Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get() { return SIZE.width; } });
for (const name of ["offsetHeight", "clientHeight", "scrollHeight"]) Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get() { return SIZE.height; } });
window.matchMedia = query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
window.CSS = window.CSS || { supports: () => false, escape: value => String(value) };
if (!window.performance.getEntriesByType) window.performance.getEntriesByType = () => [];
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class { constructor(transform) { const scale = /scale\\(([\\d.]+)\\)/.exec(transform || ""); this.m22 = this.a = this.d = scale ? Number(scale[1]) : 1; } };
window.DOMRect = window.DOMRect || class { constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }); } };
`;

async function mount(id: string, version: number) {
  const record = await source.read(id, version);
  if (!record) throw new Error(`${id}@v${version} not found`);
  const theme = await source.theme(record.preview.theme);
  const build = await builder.build(record, source);
  const html = renderSpecimenPage({ query: { element: record.id, version }, record, ...(theme ? { theme } : {}), build, mode: "light", assetBase: "/assets/", nonce: "test" });
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const thrown: string[] = [];
  dom.window.addEventListener("error", (event: { error?: Error; message?: string }) => thrown.push(event.error?.message ?? event.message ?? "error"));
  try {
    dom.window.eval(BROWSER_STUBS);
    dom.window.eval(dom.window.document.querySelector("head script")!.textContent!);
    if (build.js) {
      try { dom.window.eval(build.js.replace(/^export\s*\{[^}]*\};?\s*$/m, "").replace(/\bimport\.meta\b/g, '({ url: "http://localhost/specimen.js" })')); } catch (error) { thrown.push(error instanceof Error ? error.message : String(error)); }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const health = dom.window.__clossysSpecimen.health() as { errors: { items: { source: string; message: string }[] } };
    const root = dom.window.document.getElementById("specimen-root");
    return {
      buildErrors: build.errors,
      errors: [...health.errors.items.map(item => `${item.source}: ${item.message}`), ...thrown],
      fallback: root?.querySelector("[data-specimen-error]")?.textContent ?? null,
      empty: !root || !root.innerHTML.trim(),
    };
  } finally { dom.window.close(); }
}

describe("canonical specimens mount without runtime errors", () => {
  for (const [id, version] of SPECIMENS) {
    it(`${id}@v${version}`, async () => {
      const result = await mount(id, version);
      expect(result).toEqual({ buildErrors: [], errors: [], fallback: null, empty: false });
    }, 60_000);
  }
});
