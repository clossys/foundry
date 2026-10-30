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
    expect(hash(contract)).toBe("0cc258353183624319b33829924d80165adc26d70eb85908a83b0c7744170674");
    const common = readFileSync(resolve(stylesDir, "../scripts/__fixtures__/proc3-upstream/globals.css"), "utf8");
    expect(common).toContain("  --font-heading: var(--font-heading);");
    expect(common).toContain("  .cn-font-heading {\n    @apply font-heading;\n  }");
    expect(css).toContain("  .cn-font-heading {\n    @apply font-heading;\n  }");
    const badge = css.slice(css.indexOf("  /* MARK: Badge */"), css.indexOf("  /* MARK: Separator */"));
    expect(hash(badge)).toBe("49832966326dc361eb2af6a33d8293e6db02ef2ae585cdf1621e56f99a1c1dc6");
    const upstream = readFileSync(resolve(stylesDir, "../src/importers/__fixtures__/shadcn-aria/style-nova.css"), "utf8");
    const separator = upstream.slice(upstream.indexOf("  /* MARK: Separator */"), upstream.indexOf("  /* MARK: Sheet */"));
    expect(css.slice(css.indexOf("  /* MARK: Separator */"), css.indexOf("  /* MARK: Skeleton */"))).toBe(separator);
    const skeleton = upstream.slice(upstream.indexOf("  /* MARK: Skeleton */"), upstream.indexOf("  /* MARK: Slider */"));
    expect(css.slice(css.indexOf("  /* MARK: Skeleton */"), css.indexOf("  /* MARK: Card */"))).toBe(skeleton);
    const card = upstream.slice(upstream.indexOf("  /* MARK: Card */"), upstream.indexOf("  /* MARK: Carousel */"));
    expect(css.slice(css.indexOf("  /* MARK: Card */"), css.indexOf("  /* MARK: Radio Group */"))).toBe(card);
    const radio = upstream.slice(upstream.indexOf("  /* MARK: Radio Group */"), upstream.indexOf("  /* MARK: Resizable */"));
    expect(css.slice(css.indexOf("  /* MARK: Radio Group */"), css.indexOf("  /* MARK: Switch */"))).toBe(radio);
    const nativeSwitch = upstream.slice(upstream.indexOf("  /* MARK: Switch */"), upstream.indexOf("  /* MARK: Table */"));
    expect(css.slice(css.indexOf("  /* MARK: Switch */"), css.lastIndexOf("}\n"))).toBe(nativeSwitch);
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
    expect(css).toMatch(/\.style-nova \.cn-skeleton \{\s*border-radius: calc\(var\(--radius\) \* 0\.8\);\s*background-color: var\(--muted\)/);
    expect(css).toContain(".animate-pulse");
    expect(css).toContain("@keyframes pulse");
    expect(css).toMatch(/\.style-nova \.cn-card \{[\s\S]*?background-color: var\(--card\)/);
    expect(css).toContain(".style-nova .cn-card-description");
    expect(css).toContain("font-family: var(--font-heading)");
    expect(css).toContain(".style-nova .cn-radio-group-item-aria");
    expect(css).toContain(".style-nova .cn-radio-group-indicator-icon");
  });
});
