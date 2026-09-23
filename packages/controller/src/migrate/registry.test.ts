import { describe, expect, it } from "vitest";
import { COVERAGE_DECLARATION_KIND, LOOP_STATE_KIND, createRecordKindRegistry, defaultRecordKindRegistry } from "./registry.js";

describe("createRecordKindRegistry", () => {
  it("starts empty and registers/gets tables by kind", () => {
    const registry = createRecordKindRegistry();
    expect(registry.kinds()).toEqual([]);
    registry.register({ kind: "widget", currentVersion: 1, steps: [] });
    expect(registry.get("widget")).toEqual({ kind: "widget", currentVersion: 1, steps: [] });
    expect(registry.get("nonexistent")).toBeUndefined();
    expect(registry.kinds()).toEqual(["widget"]);
  });

  it("kinds() is sorted", () => {
    const registry = createRecordKindRegistry();
    registry.register({ kind: "zeta", currentVersion: 1, steps: [] });
    registry.register({ kind: "alpha", currentVersion: 1, steps: [] });
    expect(registry.kinds()).toEqual(["alpha", "zeta"]);
  });

  it("rejects a nonempty kind, non-positive-integer currentVersion", () => {
    const registry = createRecordKindRegistry();
    expect(() => registry.register({ kind: "", currentVersion: 1, steps: [] })).toThrow(/nonempty string/);
    expect(() => registry.register({ kind: "widget", currentVersion: 0, steps: [] })).toThrow(/positive integer/);
    expect(() => registry.register({ kind: "widget", currentVersion: 1.5, steps: [] })).toThrow(/positive integer/);
  });

  it("rejects two steps declared from the same version", () => {
    const registry = createRecordKindRegistry();
    expect(() =>
      registry.register({
        kind: "widget",
        currentVersion: 3,
        steps: [
          { fromVersion: 1, toVersion: 2, description: "a", migrate: (r) => r },
          { fromVersion: 1, toVersion: 3, description: "b", migrate: (r) => r },
        ],
      }),
    ).toThrow(/two migration steps from version 1/);
  });

  it("rejects a step that does not move strictly forward", () => {
    const registry = createRecordKindRegistry();
    expect(() =>
      registry.register({ kind: "widget", currentVersion: 2, steps: [{ fromVersion: 2, toVersion: 1, description: "backwards", migrate: (r) => r }] }),
    ).toThrow(/must move strictly forward/);
    expect(() =>
      registry.register({ kind: "widget", currentVersion: 2, steps: [{ fromVersion: 1, toVersion: 1, description: "sideways", migrate: (r) => r }] }),
    ).toThrow(/must move strictly forward/);
  });
});

describe("defaultRecordKindRegistry", () => {
  it("is seeded with exactly the two record kinds shipped on main today", () => {
    const registry = defaultRecordKindRegistry();
    expect(registry.kinds()).toEqual([COVERAGE_DECLARATION_KIND, LOOP_STATE_KIND].sort());
    expect(registry.get(LOOP_STATE_KIND)).toEqual({ kind: "loop-state", currentVersion: 1, steps: [] });
    expect(registry.get(COVERAGE_DECLARATION_KIND)).toEqual({ kind: "coverage-declaration", currentVersion: 1, steps: [] });
  });
});
