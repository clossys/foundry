// @vitest-environment node
/** Package descriptor reads/composes/consumption are derived from the measured source: a snapshot must exist and equal the independent measurement, which alone supplies actual use. */
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
  it("a registered descriptor that predates measurement reports the measurement unavailable, bytes unchanged; refresh is the remedy", () => {
    expect(["reads", "composes", "consumption"].filter(key => key in legacyEntry)).toEqual([]);
    const before = JSON.stringify(legacyEntry);
    expect(consumptionFindings(legacyEntry)).toContain("S8 surface consumption measurement unavailable");
    expect(JSON.stringify(legacyEntry)).toBe(before);
  });
  it("a descriptor that declares any derived field is checked as written, so under-reporting stays visible", () => {
    const observed = [...new Set([...current.consumption!.scannedComposes, ...(current.consumption!.scannedReads.components ?? [])])].sort();
    expect(observed).toEqual(expect.arrayContaining(["frames.app-header", "frames.app-sidebar", "frames.command", "frames.sheet"]));
    expect(consumptionFindings({ ...current, composes: [] })).toContain(`S5 underreported composes: ${observed.join(", ")}`);
    const { consumption: _drop, ...partial } = current;
    expect(consumptionFindings(partial)).toContain("S8 surface consumption measurement unavailable");
    expect(consumptionFindings({ ...current, consumption: { ...current.consumption!, scannedComposes: [] } })).toContain("S8 package consumption snapshot differs from canonical measurement");
  });
  it("reports measurement unavailable when the pinned package has no measurement, whatever the snapshot says", () => {
    expect(consumptionFindings(current, { ...(pin as object), version: "0.0.0-unmeasured" })).toEqual(["S8 surface consumption measurement unavailable"]);
  });
});
