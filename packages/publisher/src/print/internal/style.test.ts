import { describe, expect, it } from "vitest";
import { RenderError } from "../../internal/errors.js";
import { flattenTokens } from "../../internal/tokens.js";
import { resolveStyleColors, resolveStyleTypography } from "./style.js";

describe("resolveStyleColors", () => {
  it("returns {} for an undefined style", () => {
    expect(resolveStyleColors(undefined, "slot \"x\"", new Map())).toEqual({});
  });

  it("resolves a known color role to the flattened map's literal value", () => {
    const flat = new Map([["--color-ink-primary", "#111111"]]);
    expect(resolveStyleColors({ color: "--color-ink-primary" }, 'slot "title"', flat)).toEqual({
      color: "#111111",
    });
  });

  it("resolves a known background role to the flattened map's literal value", () => {
    const flat = new Map([["--color-surface-raised", "#f5f5f5"]]);
    expect(resolveStyleColors({ background: "--color-surface-raised" }, 'slot "card"', flat)).toEqual({
      backgroundColor: "#f5f5f5",
    });
  });

  it("resolves both color and background together", () => {
    const flat = new Map([
      ["--color-ink-primary", "#111111"],
      ["--color-surface-raised", "#f5f5f5"],
    ]);
    expect(resolveStyleColors({ color: "--color-ink-primary", background: "--color-surface-raised" }, 'slot "card"', flat)).toEqual({
      color: "#111111",
      backgroundColor: "#f5f5f5",
    });
  });

  it("REFUSES an unknown color role — never a silent fallback colour", () => {
    let thrown: unknown;
    try {
      resolveStyleColors({ color: "--color-does-not-exist" }, 'slot "title"', new Map());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-style-role");
    expect((thrown as RenderError).message).toContain('slot "title"');
    expect((thrown as RenderError).message).toContain("--color-does-not-exist");
  });

  it("REFUSES an unknown background role", () => {
    expect(() => resolveStyleColors({ background: "--color-does-not-exist" }, "<page>", new Map())).toThrow(
      RenderError,
    );
  });

  it("does not resolve border/weight — deliberately unhandled (see this file's own doc comment); .typography is handled by resolveStyleTypography, not this function, and is likewise never looked up here", () => {
    const flat = new Map([["--color-ink-primary", "#111111"]]);
    // border/typography/weight roles that don't even exist in `flat` must
    // NOT throw, because none of the three is ever looked up by THIS
    // function.
    expect(
      resolveStyleColors({ border: "--not-a-real-role", typography: "not-real-either", weight: "also-not-real" }, "slot", flat),
    ).toEqual({});
  });
});

describe("resolveStyleTypography", () => {
  it("resolves an ElementKind's default role when style is undefined", () => {
    const flat = flattenTokens();
    const result = resolveStyleTypography("heading", undefined, 'slot "headline"', flat);
    expect(result.fontSize).toBe("28px");
    expect(result.fontFamily).toBe(flat.get("--font-display")!.replace(/"/g, "'"));
  });

  it("style.typography overrides the ElementKind default", () => {
    const flat = flattenTokens();
    const result = resolveStyleTypography("body", { typography: "--text-display-xl" }, 'slot "hero"', flat);
    expect(result.fontSize).toBe("72px");
  });

  it("REFUSES an unknown style.typography role — never a silent fallback size", () => {
    const flat = flattenTokens();
    let thrown: unknown;
    try {
      resolveStyleTypography("body", { typography: "--not-a-real-token" }, 'slot "hero"', flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-style-role");
  });

  it("rewrites embedded double quotes in font-family to single quotes, so the value survives a double-quoted HTML style=\"...\" attribute", () => {
    const flat = flattenTokens();
    const result = resolveStyleTypography("heading", undefined, 'slot "headline"', flat);
    expect(result.fontFamily).not.toContain('"');
    expect(result.fontFamily).toContain("'Segoe UI'");
  });
});
