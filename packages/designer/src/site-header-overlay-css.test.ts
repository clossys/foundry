import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const themeKeys = readFileSync(join(styles, "theme-keys.css"), "utf8");

/** A top-level rule's source, from its opening line to the closing brace at column 0. */
function topLevelBlock(css: string, opening: string): string {
  const start = css.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start) + 3);
}

/** A nested at-rule's body inside `block`, by brace matching. */
function nestedBlock(block: string, opening: string): string {
  const start = block.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = block.indexOf("{", start); i < block.length; i++) {
    if (block[i] === "{") depth++;
    else if (block[i] === "}" && --depth === 0) return block.slice(start, i + 1);
  }
  throw new Error(`unterminated ${opening}`);
}

/** Properties that move layout; a header state change may set none of them. */
const LAYOUT_PROPERTIES =
  /(?:^|[\s;{])(?:position|inset[\w-]*|top|bottom|left|right|width|height|min-[\w-]+|max-[\w-]+|padding[\w-]*|margin[\w-]*|border(?:-block-end)?-width|transform|translate|scale|display|font-size|line-height)\s*:/;

describe("site-header-overlay utility (theme-keys.css)", () => {
  const block = topLevelBlock(themeKeys, "@utility site-header-overlay {");
  const keyframes = topLevelBlock(themeKeys, "@keyframes site-header-glass {");
  const scrollDriven = nestedBlock(block, "@supports (animation-timeline: scroll())");
  const noBackdrop = nestedBlock(block, "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
  const reducedTransparency = nestedBlock(block, "@media (prefers-reduced-transparency: reduce)");

  it("is glass by default: the glass tokens, the blur token and a hairline in the line role", () => {
    const outside = block.slice(0, block.indexOf("@supports (animation-timeline: scroll())"));
    expect(outside).toContain("--site-header-glass-fill: var(--color-surface-glass, oklch(1 0 0 / 0.88));");
    expect(outside).toContain("--site-header-glass-blur: blur(var(--blur-glass, 16px));");
    expect(outside).toContain("background-color: var(--site-header-glass-fill);");
    expect(outside).toContain("backdrop-filter: var(--site-header-glass-blur);");
    expect(outside).toContain("-webkit-backdrop-filter: var(--site-header-glass-blur);");
    expect(outside).toContain("border-block-end-width: var(--ui-border-hairline, 1px);");
    expect(outside).toMatch(/&\[data-tone="inverse"\] \{\s*--site-header-glass-fill: var\(--color-surface-glass-inverse, oklch\(0\.2178 0 0 \/ 0\.88\)\);\s*--site-header-glass-line: var\(--color-line-on-inverse/);
  });

  it("falls back to the opaque plate for each tone where backdrop-filter is unsupported", () => {
    expect(noBackdrop).toContain("--site-header-glass-fill: var(--color-surface-raised, oklch(1 0 0));");
    expect(noBackdrop).toMatch(/&\[data-tone="inverse"\] \{\s*--site-header-glass-fill: var\(--color-surface-inverse, oklch\(0\.2178 0 0\)\);/);
    expect(noBackdrop).not.toContain("glass-inverse");
    expect(noBackdrop).not.toMatch(/--color-surface-glass\b/);
  });

  it("drops the blur and the translucency under prefers-reduced-transparency", () => {
    expect(reducedTransparency).toContain("--site-header-glass-blur: none;");
    expect(reducedTransparency).toContain("--site-header-glass-fill: var(--color-surface-raised, oklch(1 0 0));");
    expect(reducedTransparency).toMatch(/&\[data-tone="inverse"\] \{\s*--site-header-glass-fill: var\(--color-surface-inverse, oklch\(0\.2178 0 0\)\);/);
  });

  it("is transparent at the top only inside the scroll-driven branch, so a no-support engine stays glass", () => {
    const outside = block.replace(scrollDriven, "");
    expect(outside).not.toContain("transparent");
    expect(scrollDriven).toContain("background-color: transparent;");
    expect(scrollDriven).toContain("border-block-end-color: transparent;");
    expect(scrollDriven).toContain("animation-name: site-header-glass;");
    expect(scrollDriven).toContain("animation-timeline: scroll(root block);");
    expect(scrollDriven).toContain("animation-range: 0 var(--spacing-3xl, 48px);");
    expect(scrollDriven).toContain("animation-fill-mode: both;");
  });

  it("steps instead of fading under reduced motion", () => {
    expect(scrollDriven).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*animation-timing-function: steps\(1, jump-end\);/);
  });

  it("forces glass while a menu is open, by prop or by an expanded toggle", () => {
    expect(scrollDriven).toMatch(
      /&\[data-menu-open\],\s*&:has\(\[aria-expanded="true"\]\) \{\s*animation-name: none;\s*background-color: var\(--site-header-glass-fill\);/,
    );
  });

  it("changes paint only between states: no state rule or keyframe touches layout", () => {
    expect(keyframes).not.toMatch(LAYOUT_PROPERTIES);
    expect(scrollDriven).not.toMatch(LAYOUT_PROPERTIES);
    expect(noBackdrop).not.toMatch(LAYOUT_PROPERTIES);
    expect(reducedTransparency).not.toMatch(LAYOUT_PROPERTIES);
    expect(keyframes).toContain("background-color: var(--site-header-glass-fill);");
    expect(keyframes).toContain("backdrop-filter: var(--site-header-glass-blur);");
  });

  it("is carried into compiled.css with the fallback, the reduced-preference branches and the keyframes", () => {
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    expect(compiled).toContain(".site-header-overlay");
    expect(compiled).toContain("@keyframes site-header-glass");
    expect(compiled).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(compiled).toContain("prefers-reduced-transparency: reduce");
    expect(compiled).toContain("--color-surface-glass");
    expect(compiled).toContain("--blur-glass");
  });
});
