// @vitest-environment node
/** Package descriptor reads/composes/consumption are derived from the measured source, never trusted as authored. */
import { describe, expect, it } from "vitest";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { loadBuildCatalog, loadFoundrySurfaceHistory } from "./index.js";
import { contractFindings, type SurfaceDefaultDescriptor } from "./surface-defaults.js";
import type { FrameSlot } from "./types.js";

const slot = loadBuildCatalog().slots.find((row): row is FrameSlot => row.id === "frames.app-shell")!;
const doc = importFoundryFrames().fills.find(row => row.$extensions["com.clossys.fill"].slot === "frames.app-shell")!;
const pin = doc.$extensions["com.clossys.fill"].pin;
const current = (doc as unknown as { frames: Record<string, SurfaceDefaultDescriptor> }).frames["app-shell"]!;
const legacy = loadFoundrySurfaceHistory()["sha256:b740aea8605c3bbbdb3f1c817031a0693965920b2efae0573c312f8c1043a4ed"]![0]!;
const legacyEntry = (legacy.document as unknown as { frames: Record<string, SurfaceDefaultDescriptor> }).frames["app-shell"]!;
const consumptionFindings = (fill: SurfaceDefaultDescriptor, packagePin: unknown = pin) => contractFindings(slot, fill, packagePin).filter(message => /^S8|underreported|unsupported/.test(message));

describe("derived package descriptor metadata", () => {
  it("the current import carries measured composes, and they are clean", () => {
    expect(current.composes).toEqual(expect.arrayContaining(["frames.app-header", "frames.app-sidebar", "frames.command", "frames.sheet"]));
    expect(consumptionFindings(current)).toEqual([]);
  });
  it("a registered descriptor that predates measurement is read through the same-pin measurement, bytes unchanged [mutant: drop the derived view]", () => {
    expect(["reads", "composes", "consumption"].filter(key => key in legacyEntry)).toEqual([]);
    const before = JSON.stringify(legacyEntry);
    expect(consumptionFindings(legacyEntry)).toEqual([]);
    expect(JSON.stringify(legacyEntry)).toBe(before);
  });
  it("a descriptor that declares any derived field is checked as written, so under-reporting stays visible", () => {
    expect(consumptionFindings({ ...current, composes: [] })).toContain("S5 underreported composes: frames.app-header, frames.app-sidebar, frames.command, frames.sheet");
    const { consumption: _drop, ...partial } = current;
    expect(consumptionFindings(partial)).toContain("S8 package consumption snapshot differs from canonical measurement");
  });
  it("reports measurement unavailable only when the pinned package has no measurement", () => {
    expect(consumptionFindings(legacyEntry, { ...(pin as object), version: "0.0.0-unmeasured" })).toEqual(["S8 surface consumption measurement unavailable"]);
  });
});
