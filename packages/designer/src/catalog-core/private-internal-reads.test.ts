/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import measurements from "../catalog/surface-consumption.data.json" with { type: "json" };
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { surfaceEntryOf } from "./surface-library.js";

const document = () => structuredClone(importFoundryFrames().fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "frames.site-shell")!) as any;
const consumption = (doc: any) => doc.frames["site-shell"].consumption;
const repo = new URL("../../../../", import.meta.url);
const SOURCE = "packages/designer/src/frames/site-frame/internal/resolveShell.ts";
const TARGET = "packages/designer/src/frames/site-frame/landing/internal/assets.ts";
const SPECIFIER = "../landing/internal/assets.js";
const source = readFileSync(new URL(SOURCE, repo), "utf8");
const sha = (path: string) => createHash("sha256").update(readFileSync(new URL(path, repo))).digest("hex");

/**
 * The measured site-shell no longer reads `assets.js` from its private import path: the asset scan
 * stopped matching a module path segment (866750fe4), so the producer emits no witness. The validator
 * still accepts the producer's witness shape, so the refusals below run on that shape, built from the
 * real import and the real source hashes.
 */
const withWitness = (doc: any) => {
  const measured = consumption(doc);
  measured.rawScannedReads = { ...structuredClone(measured.scannedReads), assets: [...measured.scannedReads.assets, "assets.js"].sort() };
  measured.privateInternalReads = [{ target: TARGET, targetSha256: sha(TARGET), file: SOURCE, sourceSha256: sha(SOURCE), specifier: SPECIFIER,
    line: source.split("\n").findIndex(line => line.includes(`"${SPECIFIER}"`)) + 1, rawAssets: ["assets.js"] }];
  return doc;
};

it("reads no assets.js from the private import path in the 63-entry inventory", () => {
  expect(Object.keys(measurements)).toHaveLength(63);
  expect(source).toContain(`from "${SPECIFIER}"`);
  const doc = document(), measured = consumption(doc);
  expect(doc.frames["site-shell"].reads.assets).toEqual([]);
  expect(measured.scannedReads.assets).toEqual([]);
  expect(measured.rawScannedReads).toBeUndefined();
  expect(measured.privateInternalReads).toBeUndefined();
  expect(measured.sourceFiles.map((file: any) => file.path)).toEqual(expect.arrayContaining([SOURCE, TARGET]));
  expect(() => surfaceEntryOf(doc)).not.toThrow();
});
it("keeps historical measurements with a private import witness valid", () => {
  expect(() => surfaceEntryOf(withWitness(document()))).not.toThrow();
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
  const doc = withWitness(document()); mutate(consumption(doc));
  expect(() => surfaceEntryOf(doc)).toThrow();
});
