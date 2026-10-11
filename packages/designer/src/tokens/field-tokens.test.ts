import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBackdropContract, type BackdropContract } from "../backdrop/contract.js";
import { checkFieldTokens } from "./field-tokens.js";
import { TOKENS, type TokenDefinition } from "./tokens.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "./internal/registry-from-css.js";

const css = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const LIGHT = registryFromDeclarations(parseRootDeclarations(css));
const DARK = registryFromDeclarations(mergeDeclarations(parseRootDeclarations(css), parseDeclarationsForSelector(css, ':root[data-theme="dark"]')));
const options = { tokens: LIGHT, darkTokens: DARK };
const pattern: BackdropContract = { kind: "pattern", pattern: "dot-field", ariaHidden: true, pointerEvents: "none", loading: { strategy: "idle", budgetBytes: 8192 } };
function override(registry: typeof LIGHT, name: string, value: string) {
  return { ...registry, [name]: { ...TOKENS[name]!, property: name, value } as TokenDefinition };
}

describe("field token contract", () => {
  it("adds exactly four brandable slots with proper semantic families and dynamic dot alias", () => {
    expect(TOKENS["--color-field-dot"]).toMatchObject({ family: "field-color", value: "var(--color-ink-on-inverse)", brandable: true, themeDependent: false });
    for (const name of ["--ui-field-alpha", "--ui-field-scale", "--ui-field-lens"]) expect(TOKENS[name]).toMatchObject({ family: "field", brandable: true, themeDependent: false });
    expect(Object.keys(TOKENS)).toHaveLength(185);
    expect(Object.values(TOKENS).filter((t) => t.brandable)).toHaveLength(60);
  });

  it("measures gamma-encoded sRGB dot pixels against the real light and dark themes", () => {
    const result = checkFieldTokens(options);
    expect(result.ok).toBe(true);
    expect(result.unchecked).toEqual([]);
    expect(result.contrast.light).toBeCloseTo(5.39038, 4);
    expect(result.contrast.dark).toBeCloseTo(7.34547, 4);
  });

  it("fails the combined result at alpha 0.40 through light, while honestly preserving dark (M-DF2)", () => {
    const result = checkFieldTokens({ tokens: override(LIGHT, "--ui-field-alpha", "0.40"), darkTokens: override(DARK, "--ui-field-alpha", "0.40") });
    expect(result.ok).toBe(false);
    expect(result.findings.filter((f) => f.rule === "field-alpha-contrast").map((f) => f.theme)).toEqual(["light"]);
    expect(result.contrast.light).toBeCloseTo(4.43813, 4);
    expect(result.contrast.dark).toBeCloseTo(6.29036, 4);
  });

  it("independently rejects a dark-theme dot pixel below AA at a stronger alpha", () => {
    const result = checkFieldTokens({ ...options, darkTokens: override(DARK, "--ui-field-alpha", "0.60") });
    expect(result.findings.some((f) => f.rule === "field-alpha-contrast" && f.theme === "dark")).toBe(true);
  });

  it("rejects out-of-range alpha and scale, warns on lens size, and accepts scale endpoints", () => {
    for (const alpha of ["-0.1", "1.1", "NaN", "0.34px"]) expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--ui-field-alpha", alpha) }).ok).toBe(false);
    expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--ui-field-scale", "2") }).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-scale-range", severity: "error" })]));
    for (const value of ["0.75", "1.5"]) expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--ui-field-scale", value) }).ok).toBe(true);
    const warned = checkFieldTokens({ ...options, tokens: override(LIGHT, "--ui-field-lens", "30rem") });
    expect(warned.ok).toBe(true);
    expect(warned.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-lens-range", severity: "warning" })]));
  });

  it.each([
    ["embedded function", "color-mix(in srgb, oklch(0.9702 0 0), white)"],
    ["trailing syntax", "oklch(0.9702 0 0) trailing"],
    ["malformed L", "oklch(0..97 0 0)"],
    ["malformed C", "oklch(0.97 0..1 0)"],
    ["malformed H", "oklch(0.97 0 0..1)"],
    ["overflow L", `oklch(${"9".repeat(400)} 0 0)`],
    ["overflow C", `oklch(0.97 ${"9".repeat(400)} 0)`],
    ["overflow H", `oklch(0.97 0 ${"9".repeat(400)})`],
    ["finite parse with overflowing RGB math", `oklch(${"9".repeat(308)} 0 0)`],
    ["malformed alpha", "oklch(0.97 0 0 / 0..1)"],
    ["overflow alpha", `oklch(0.97 0 0 / ${"9".repeat(400)})`],
  ])("rejects incomplete or nonfinite field colour: %s", (_label, value) => {
    const result = checkFieldTokens({ ...options, tokens: override(LIGHT, "--color-field-dot", value) });
    expect(result.ok).toBe(false);
    expect(result.unchecked).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast", theme: "light" })]));
  });
  it.each(["--color-field-dot", "--color-surface-inverse", "--color-ink-on-inverse"])("rejects hashless hex CSS field colour in %s", (name) => {
    const result = checkFieldTokens({ ...options, tokens: override(LIGHT, name, "ffffff") });
    expect(result.ok).toBe(false);
    expect(result.unchecked).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast", theme: "light" })]));
  });
  it("accepts complete six-digit CSS hex field colours", () => {
    const registry = override(override(override(LIGHT, "--color-field-dot", "#ffffff"), "--color-ink-on-inverse", "#ffffff"), "--color-surface-inverse", "#000000");
    expect(checkFieldTokens({ tokens: registry, themes: "light-only" })).toMatchObject({ ok: true, unchecked: [] });
  });
  it("fails closed on missing theme evidence, missing aliases, and translucent dot colours", () => {
    expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--ui-field-lens", `${"9".repeat(400)}rem`) }).unchecked).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-lens-range" })]));
    expect(checkFieldTokens({ tokens: LIGHT }).unchecked.length).toBeGreaterThan(0);
    expect(checkFieldTokens({ ...options, darkTokens: LIGHT }).unchecked.length).toBeGreaterThan(0);
    expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--color-field-dot", "var(--missing-dot)") }).unchecked.length).toBeGreaterThan(0);
    expect(checkFieldTokens({ ...options, tokens: override(LIGHT, "--color-field-dot", "oklch(0.97 0 0 / 0.5)") }).unchecked.length).toBeGreaterThan(0);
  });
});

describe("pattern backdrop declaration", () => {
  it("accepts a static pattern without a fallback or a media scrim", () => {
    expect(checkBackdropContract(pattern, options)).toMatchObject({ ok: true, findings: [], unchecked: [], themes: ["light", "dark"] });
  });

  it("uses the shared field-alpha result and enforces idle bounded loading", () => {
    const report = checkBackdropContract(pattern, { ...options, tokens: override(LIGHT, "--ui-field-alpha", "0.40") });
    expect(report.findings.some((f) => f.rule === "field-alpha")).toBe(true);
    for (const loading of [{ strategy: "lazy", budgetBytes: 8192 }, { strategy: "idle", budgetBytes: 8193 }, { strategy: "idle", budgetBytes: -1 }, { strategy: "idle" }, { strategy: "idle", budgetBytes: "8192" }, { strategy: "idle", budgetBytes: NaN }]) {
      expect(checkBackdropContract({ ...pattern, loading } as BackdropContract, options).findings.some((f) => f.rule === "lazy-loading-budget")).toBe(true);
    }
    expect(checkBackdropContract({ ...pattern, pattern: "unknown" } as unknown as BackdropContract, options).ok).toBe(false);
  });
});
