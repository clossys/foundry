// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateNativeShadcnCss } from "./shadcn-native.js";

const stylesDir = resolve("packages/designer/styles");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("native shadcn CSS", () => {
  it("retains the pinned standard contract and Nova rules verbatim", () => {
    const css = readFileSync(resolve(stylesDir, "shadcn-native.css"), "utf8");
    const contract = css.slice(css.indexOf("@custom-variant dark"), css.indexOf("\n.style-nova {"));
    expect(hash(contract)).toBe("ec67185f468abdaa8c8c79f3d80a6a738342e5f5f0839732dd36e88cce6c132d");
    const badge = css.slice(css.indexOf("  /* MARK: Badge */"), css.indexOf("  /* MARK: Separator */"));
    expect(hash(badge)).toBe("49832966326dc361eb2af6a33d8293e6db02ef2ae585cdf1621e56f99a1c1dc6");
    const upstream = readFileSync(resolve(stylesDir, "../src/importers/__fixtures__/shadcn-aria/style-nova.css"), "utf8");
    const separator = upstream.slice(upstream.indexOf("  /* MARK: Separator */"), upstream.indexOf("  /* MARK: Sheet */"));
    expect(css.slice(css.indexOf("  /* MARK: Separator */"), css.lastIndexOf("}\n"))).toBe(separator);
  });

  it("compiles fixed source values and reads the existing primary token contract", async () => {
    const css = await generateNativeShadcnCss(stylesDir);
    expect(css).toContain("--spacing: 0.25rem");
    expect(css).toContain("--default-transition-duration: 150ms");
    expect(css).toContain("height: calc(var(--spacing) * 5)");
    expect(css).toContain("padding-block: calc(var(--spacing) * 0.5)");
    expect(css).toContain("border-radius: calc(var(--radius) * 2.6)");
    expect(css).toContain(".\\[\\&\\>svg\\]\\:pointer-events-none > svg");
    expect(css).toMatch(/\.style-nova \.cn-badge-variant-default \{\s*background-color: var\(--primary\)/);
    const adapter = JSON.parse(readFileSync(resolve(stylesDir, "../src/catalog/adapters/shadcn@aria.json"), "utf8"));
    expect(adapter.bindings.primary).toEqual({ member: "tokens.action-color.default", property: "--color-action" });
    expect(css).toContain(`--primary: var(${adapter.bindings.primary.property})`);
    expect(css).not.toContain("var(--ui-duration-default)");
    expect(css).toContain(".bg-border");
    expect(css).toContain("background-color: var(--border)");
    expect(css).toContain(".aria-\\[orientation\\=vertical\\]\\:self-stretch");
    expect(css).toContain("height: 1px");
  });
});
