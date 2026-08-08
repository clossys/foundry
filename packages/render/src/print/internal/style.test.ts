import { describe, expect, it } from "vitest";
import { RenderError } from "../../internal/errors.js";
import { resolveStyleColors } from "./style.js";

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

  it("does not resolve border/typography/weight — deliberately unhandled (see this file's own doc comment)", () => {
    const flat = new Map([["--color-ink-primary", "#111111"]]);
    // border/typography/weight roles that don't even exist in `flat` must
    // NOT throw, because they are never looked up at all.
    expect(
      resolveStyleColors({ border: "--not-a-real-role", typography: "not-real-either", weight: "also-not-real" }, "slot", flat),
    ).toEqual({});
  });
});
