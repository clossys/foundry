import { describe, expect, it } from "vitest";
import { buildGeometryWarnings, buildSyntheticLayout, orderEntries, SYNTHETIC_ELEMENT, SYNTHETIC_FRAME } from "./geometry.js";
import type { GeometryEntry } from "./geometry.js";

describe("buildSyntheticLayout", () => {
  it("builds one slot per distinct binding.slot, in first-occurrence order, all sharing the placeholder frame/element", () => {
    const layout = buildSyntheticLayout([{ slot: "b" }, { slot: "a" }, { slot: "b" }]);
    expect(layout.slots).toEqual([
      { key: "b", element: SYNTHETIC_ELEMENT, frame: SYNTHETIC_FRAME, required: false },
      { key: "a", element: SYNTHETIC_ELEMENT, frame: SYNTHETIC_FRAME, required: false },
    ]);
  });

  it("skips a binding with no usable slot key", () => {
    const layout = buildSyntheticLayout([{ slot: "" }, { slot: undefined }, { slot: "real" }]);
    expect(layout.slots.map((s) => s.key)).toEqual(["real"]);
  });
});

describe("orderEntries", () => {
  it("sorts by frame.y ascending, then frame.x ascending", () => {
    const entries: GeometryEntry[] = [
      { key: "bottom", frame: { x: 0, y: 0.5, w: 1, h: 0.1 }, text: "t", element: "body" },
      { key: "top-right", frame: { x: 0.5, y: 0, w: 0.5, h: 0.1 }, text: "t", element: "body" },
      { key: "top-left", frame: { x: 0, y: 0, w: 0.5, h: 0.1 }, text: "t", element: "body" },
    ];
    expect(orderEntries(entries).map((e) => e.key)).toEqual(["top-left", "top-right", "bottom"]);
  });

  it("is stable — ties keep their original relative order, the no-op case for an all-identical placeholder frame", () => {
    const entries: GeometryEntry[] = [
      { key: "first", frame: SYNTHETIC_FRAME, text: "t", element: "body" },
      { key: "second", frame: SYNTHETIC_FRAME, text: "t", element: "body" },
      { key: "third", frame: SYNTHETIC_FRAME, text: "t", element: "body" },
    ];
    expect(orderEntries(entries).map((e) => e.key)).toEqual(["first", "second", "third"]);
  });
});

describe("buildGeometryWarnings", () => {
  it("emits one slots-stacked warning naming both slots when two frames vertically overlap at different x", () => {
    const entries: GeometryEntry[] = [
      { key: "left", frame: { x: 0, y: 0, w: 0.5, h: 0.2 }, text: "L", element: "body" },
      { key: "right", frame: { x: 0.5, y: 0, w: 0.5, h: 0.2 }, text: "R", element: "body" },
    ];
    const warnings = buildGeometryWarnings(entries);
    const stacked = warnings.filter((w) => w.code === "slots-stacked");
    expect(stacked).toHaveLength(1);
    expect(stacked[0]!.slots).toEqual(["left", "right"]);
  });

  it("clusters three mutually-overlapping slots into a single warning naming all three", () => {
    const entries: GeometryEntry[] = [
      { key: "a", frame: { x: 0, y: 0, w: 0.33, h: 0.2 }, text: "A", element: "body" },
      { key: "b", frame: { x: 0.33, y: 0, w: 0.33, h: 0.2 }, text: "B", element: "body" },
      { key: "c", frame: { x: 0.66, y: 0, w: 0.34, h: 0.2 }, text: "C", element: "body" },
    ];
    const warnings = buildGeometryWarnings(entries);
    const stacked = warnings.filter((w) => w.code === "slots-stacked");
    expect(stacked).toHaveLength(1);
    expect(stacked[0]!.slots).toEqual(["a", "b", "c"]);
  });

  it("emits no slots-stacked warning for two slots stacked vertically with no y overlap", () => {
    const entries: GeometryEntry[] = [
      { key: "top", frame: { x: 0, y: 0, w: 1, h: 0.2 }, text: "T", element: "body" },
      { key: "bottom", frame: { x: 0, y: 0.2, w: 1, h: 0.2 }, text: "B", element: "body" },
    ];
    const warnings = buildGeometryWarnings(entries);
    expect(warnings.filter((w) => w.code === "slots-stacked")).toEqual([]);
  });

  it("emits a slot-width-lost warning for every slot with frame.w < 1, independent of overlap", () => {
    const entries: GeometryEntry[] = [{ key: "narrow", frame: { x: 0.25, y: 0, w: 0.5, h: 0.2 }, text: "N", element: "body" }];
    const warnings = buildGeometryWarnings(entries);
    expect(warnings).toEqual([
      {
        code: "slot-width-lost",
        slots: ["narrow"],
        message:
          'Slot "narrow" was sized to 50% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email\'s full content width — its intended width is lost.',
      },
    ]);
  });

  it("emits no warnings at all for a single full-width slot", () => {
    const entries: GeometryEntry[] = [{ key: "solo", frame: { x: 0, y: 0, w: 1, h: 0.2 }, text: "S", element: "body" }];
    expect(buildGeometryWarnings(entries)).toEqual([]);
  });
});
