/** @vitest-environment node */
import { expect, it } from "vitest";
import measurements from "../catalog/surface-consumption.data.json" with { type: "json" };
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { surfaceEntryOf } from "./surface-library.js";

const document = () => structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.site-shell")!) as any;
const consumption = (doc: any) => doc.frames["site-shell"].consumption;
const file = "packages/designer/src/frames/site-frame/internal/resolveShell.ts", target = "packages/designer/src/frames/site-frame/landing/internal/assets.ts";
/** Historical private-import evidence, bound to the real measured source hashes; the current scan never reads a module path. */
const witnessed = () => {
  const doc = document(), measured = consumption(doc), sha = (path: string) => measured.sourceFiles.find((row: any) => row.path === path).sha256;
  measured.rawScannedReads = { ...measured.scannedReads, assets: [...measured.scannedReads.assets, "assets.js"] };
  measured.privateInternalReads = [{ file, line: 4, specifier: "../landing/internal/assets.js", target, sourceSha256: sha(file), targetSha256: sha(target), rawAssets: ["assets.js"] }];
  return doc;
};
it("reads no assets.js module path as an asset in the 63-entry inventory, so no private witness is needed", () => {
  expect(Object.keys(measurements)).toHaveLength(63);
  for (const [slot, row] of Object.entries(measurements as Record<string, any>)) {
    expect(row.consumption.scannedReads.assets, slot).not.toContain("assets.js");
    expect(row.consumption.rawScannedReads, slot).toBeUndefined();
  }
  const doc = document(), measured = consumption(doc);
  expect(doc.frames["site-shell"].reads.assets).toEqual([]);
  expect(measured.scannedReads.assets).toEqual([]);
  expect(() => surfaceEntryOf(doc)).not.toThrow();
  expect(() => surfaceEntryOf(witnessed())).not.toThrow();
});
it("keeps historical measurements without private fields valid", () => {
  const doc = witnessed(), measured = consumption(doc);
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
  const doc = witnessed(); mutate(consumption(doc));
  expect(() => surfaceEntryOf(doc)).toThrow();
});
