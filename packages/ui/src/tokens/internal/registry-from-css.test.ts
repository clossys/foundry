import { describe, expect, it } from "vitest";
import { mergeDeclarations, registryFromDeclarations } from "./registry-from-css.js";

describe("registryFromDeclarations", () => {
  it("wraps each declaration into a full TokenDefinition, preserving property and value exactly", () => {
    const declarations = new Map([
      ["--color-surface-base", "oklch(0.19 0 0)"],
      ["--color-ink-primary", "oklch(0.97 0 0)"],
    ]);
    const registry = registryFromDeclarations(declarations);
    expect(Object.keys(registry).sort()).toEqual(["--color-ink-primary", "--color-surface-base"]);
    expect(registry["--color-surface-base"]).toMatchObject({ property: "--color-surface-base", value: "oklch(0.19 0 0)" });
    expect(registry["--color-ink-primary"]).toMatchObject({ property: "--color-ink-primary", value: "oklch(0.97 0 0)" });
  });

  it("produces an empty registry from an empty declarations map, without throwing", () => {
    expect(registryFromDeclarations(new Map())).toEqual({});
  });
});

describe("mergeDeclarations", () => {
  it("keeps a base property untouched by overrides, mirroring real CSS cascade for an alias only declared in :root", () => {
    const base = new Map([
      ["--color-chart-surface", 'var(--color-surface-raised, oklch(1 0 0))'],
      ["--color-surface-raised", "oklch(1 0 0)"],
    ]);
    const overrides = new Map([["--color-surface-raised", "oklch(0.26 0 0)"]]);
    const merged = mergeDeclarations(base, overrides);
    expect(merged.get("--color-chart-surface")).toBe('var(--color-surface-raised, oklch(1 0 0))');
    expect(merged.get("--color-surface-raised")).toBe("oklch(0.26 0 0)");
  });

  it("does not mutate either input map", () => {
    const base = new Map([["--a", "1"]]);
    const overrides = new Map([["--a", "2"], ["--b", "3"]]);
    mergeDeclarations(base, overrides);
    expect(base.get("--a")).toBe("1");
    expect([...base.keys()]).toEqual(["--a"]);
  });

  it("adds a property present only in overrides", () => {
    const merged = mergeDeclarations(new Map([["--a", "1"]]), new Map([["--b", "2"]]));
    expect(merged.get("--a")).toBe("1");
    expect(merged.get("--b")).toBe("2");
  });
});
