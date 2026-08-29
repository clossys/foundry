import { describe, expect, it } from "vitest";
import type { TokenDefinition } from "../tokens.js";
import { TOKENS } from "../tokens.js";
import { resolveTokenValue } from "./resolve-token-value.js";

function def(property: string, value: string): TokenDefinition {
  return { property, family: "surface", value, brandable: false, themeDependent: false };
}

describe("resolveTokenValue", () => {
  it("resolves a literal (non-alias) value in one step", () => {
    const result = resolveTokenValue("--color-ink-primary", TOKENS);
    expect(result.value).toBe(TOKENS["--color-ink-primary"]!.value);
    expect(result.chain).toEqual(["--color-ink-primary"]);
    expect(result.missingProperty).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("walks a real whole-value var() alias to its literal (--color-chart-surface -> --color-surface-raised)", () => {
    const result = resolveTokenValue("--color-chart-surface", TOKENS);
    expect(result.value).toBe(TOKENS["--color-surface-raised"]!.value);
    expect(result.chain).toEqual(["--color-chart-surface", "--color-surface-raised"]);
  });

  it("walks --color-ink-on-accent to --color-ink-on-inverse's literal value", () => {
    const result = resolveTokenValue("--color-ink-on-accent", TOKENS);
    expect(result.value).toBe(TOKENS["--color-ink-on-inverse"]!.value);
    expect(result.chain).toEqual(["--color-ink-on-accent", "--color-ink-on-inverse"]);
  });

  it("walks a doubly-nested alias chain to the final literal", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", "var(--b, 0)"),
      "--b": def("--b", "var(--c, oklch(0.5 0 0))"),
      "--c": def("--c", "oklch(0.5 0 0)"),
    };
    const result = resolveTokenValue("--a", tokens);
    expect(result.value).toBe("oklch(0.5 0 0)");
    expect(result.chain).toEqual(["--a", "--b", "--c"]);
  });

  it("reports missingProperty, not a thrown error, when the starting property itself is absent", () => {
    const result = resolveTokenValue("--does-not-exist", TOKENS);
    expect(result.value).toBeUndefined();
    expect(result.missingProperty).toBe("--does-not-exist");
    expect(result.cycle).toBeUndefined();
    expect(result.chain).toEqual(["--does-not-exist"]);
  });

  it("reports missingProperty when an alias partway through the chain points at an unregistered property", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", "var(--b, 0)"),
    };
    const result = resolveTokenValue("--a", tokens);
    expect(result.value).toBeUndefined();
    expect(result.missingProperty).toBe("--b");
    expect(result.chain).toEqual(["--a", "--b"]);
  });

  it("detects a two-property cycle and reports it rather than looping forever", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", "var(--b, 0)"),
      "--b": def("--b", "var(--a, 0)"),
    };
    const result = resolveTokenValue("--a", tokens);
    expect(result.value).toBeUndefined();
    expect(result.cycle).toBe("--a");
    expect(result.chain).toEqual(["--a", "--b"]);
  });

  it("detects a self-cycle (a token aliasing itself)", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", "var(--a, 0)"),
    };
    const result = resolveTokenValue("--a", tokens);
    expect(result.cycle).toBe("--a");
    expect(result.chain).toEqual(["--a"]);
  });

  it("treats a COMPOSITE value containing var() as a terminal literal, not something to walk into", () => {
    // --ui-ring-focus's real shape: a var() reference embedded in a larger
    // box-shadow value, not the WHOLE value — see this file's own header,
    // "WHAT COUNTS AS A WHOLE-VALUE ALIAS".
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--ui-ring-focus": def("--ui-ring-focus", "0 0 0 2px var(--color-accent, oklch(0.4748 0 0))"),
      "--color-accent": def("--color-accent", "oklch(0.4748 0 0)"),
    };
    const result = resolveTokenValue("--ui-ring-focus", tokens);
    expect(result.value).toBe("0 0 0 2px var(--color-accent, oklch(0.4748 0 0))");
    expect(result.chain).toEqual(["--ui-ring-focus"]);
  });

  it("handles attacker-sized whole-value alias fallbacks without regex backtracking", () => {
    const spaces = " ".repeat(200_000);
    const valid: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", `var(---,${spaces}fallback)`),
    };
    expect(resolveTokenValue("--a", valid)).toMatchObject({
      value: undefined,
      missingProperty: "---",
      chain: ["--a", "---"],
    });

    const invalidValue = `var(---,${spaces}fallback`;
    const invalid: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", invalidValue),
    };
    expect(resolveTokenValue("--a", invalid)).toMatchObject({ value: invalidValue, chain: ["--a"] });
  });

  it("resolves every real chart-chrome alias in this package's own TOKENS to a literal, never a missing/cyclic result", () => {
    for (const property of ["--color-chart-surface", "--color-chart-axis", "--color-chart-axis-label"]) {
      const result = resolveTokenValue(property, TOKENS);
      expect(result.value, `${property} should resolve to a literal`).toBeDefined();
      expect(result.missingProperty).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    }
  });
});
