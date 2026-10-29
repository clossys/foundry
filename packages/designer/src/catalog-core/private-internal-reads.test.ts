/** @vitest-environment node */
import { expect, it } from "vitest";
import measurements from "../catalog/surface-consumption.data.json" with { type: "json" };
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { surfaceEntryOf } from "./surface-library.js";

const document = () => structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.site-shell")!) as any;
const consumption = (doc: any) => doc.frames["site-shell"].consumption;
it("emits real private runtime import witnesses and no assets.js consumer read in the 63-entry inventory", () => {
  expect(Object.keys(measurements)).toHaveLength(63);
  const doc = document(), measured = consumption(doc);
  expect(doc.frames["site-shell"].reads.assets).toEqual([]);
  expect(measured.scannedReads.assets).toEqual([]);
  expect(measured.rawScannedReads.assets).toEqual(["assets.js"]);
  expect(measured.privateInternalReads.map((row: any) => [row.file, row.line, row.specifier])).toEqual([
    ["packages/designer/src/frames/site-frame/internal/resolveShell.ts", 3, "../landing/internal/assets.js"],
    ["packages/designer/src/frames/site-frame/landing/core/content-asset.ts", 1, "../internal/assets.js"],
    ["packages/designer/src/frames/site-frame/landing/web/views/SectionedViewContent.tsx", 11, "../../internal/assets.js"],
  ]);
  expect(() => surfaceEntryOf(doc)).not.toThrow();
});
it("keeps historical measurements without private fields valid", () => {
  const doc = document(), measured = consumption(doc);
  delete measured.rawScannedReads; delete measured.privateInternalReads;
  expect(() => surfaceEntryOf(doc)).not.toThrow();
});
it.each([
  (row: any) => { row.privateInternalReads[0].hide = "assets.unrelated"; },
  (row: any) => { row.rawScannedReads.hide = []; },
  (row: any) => { row.privateInternalReads[0].target = "assets.js"; },
  (row: any) => { row.privateInternalReads[0].sourceSha256 = "0".repeat(64); },
  (row: any) => { row.privateInternalReads[0].targetSha256 = "0".repeat(64); },
  (row: any) => { row.privateInternalReads[0].specifier = "../internal/unrelated.js"; },
  (row: any) => { row.privateInternalReads[0].rawAssets = ["assets.unrelated"]; },
  (row: any) => { row.rawScannedReads.assets.push("assets.unrelated"); },
  (row: any) => { row.privateInternalReads = []; },
  (row: any) => { delete row.rawScannedReads; },
  (row: any) => { delete row.privateInternalReads; },
])("refuses malformed or inconsistent private measurement evidence %#", mutate => {
  const doc = document(); mutate(consumption(doc));
  expect(() => surfaceEntryOf(doc)).toThrow();
});
