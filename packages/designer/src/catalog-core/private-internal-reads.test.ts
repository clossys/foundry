/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import measurements from "../catalog/surface-consumption.data.json" with { type: "json" };
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { surfaceEntryOf } from "./surface-library.js";

// The private-import witness compensated for the scan reading a module path ("../internal/assets.js")
// as the asset id "assets.js". The scan no longer does, so the witness, its contract permission and
// its measurement fields are retired: none is emitted, declared, or accepted.
const document = () => structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.site-shell")!) as any;
const consumption = (doc: any) => doc.frames["site-shell"].consumption;

it("reads no module path as an asset in the 63-entry inventory and records no private witness", () => {
  expect(Object.keys(measurements)).toHaveLength(63);
  for (const [slot, row] of Object.entries(measurements as Record<string, any>)) {
    expect(row.consumption.scannedReads.assets, slot).not.toContain("assets.js");
    expect(Object.keys(row.consumption), slot).not.toContain("rawScannedReads");
    expect(Object.keys(row.consumption), slot).not.toContain("privateInternalReads");
  }
  const doc = document();
  expect(consumption(doc).scannedReads.assets).toEqual([]);
  expect(() => surfaceEntryOf(doc)).not.toThrow();
});

it("declares no private-internal read permission on any frame contract", () => {
  const frames = JSON.parse(readFileSync(new URL("../catalog/slots/frames.json", import.meta.url), "utf8")) as { id: string; contract: { allowedReads: object } }[];
  for (const frame of frames) expect(Object.keys(frame.contract.allowedReads), frame.id).toEqual(["themes", "assets"]);
});

it.each([
  (row: any) => { row.rawScannedReads = { ...row.scannedReads }; },
  (row: any) => { row.privateInternalReads = []; },
])("refuses a measurement carrying a retired private-witness field %#", mutate => {
  const doc = document(); mutate(consumption(doc));
  expect(() => surfaceEntryOf(doc)).toThrow();
});
