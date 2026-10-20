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
    expect(outside).toContain("--site-header-glass-fill: var(--color-surface-glass, oklch(1 0 0 / 0.6));");
    expect(outside).toContain("--site-header-glass-blur: blur(var(--blur-glass, 20px));");
    expect(outside).toContain("background-color: var(--site-header-glass-fill, oklch(1 0 0 / 0.6));");
    expect(outside).toContain("backdrop-filter: var(--site-header-glass-blur, blur(20px));");
    expect(outside).toContain("-webkit-backdrop-filter: var(--site-header-glass-blur, blur(20px));");
    expect(outside).toContain("border-block-end-width: var(--ui-border-hairline, 1px);");
    expect(outside).toMatch(/&\[data-tone="inverse"\] \{\s*--site-header-glass-fill: var\(--color-surface-glass-inverse, oklch\(0\.2178 0 0 \/ 0\.85\)\);\s*--site-header-glass-line: var\(--color-line-on-inverse/);
  });

  it("paints inherited ink from live data-tone rather than the initial static ink class", () => {
    const base = nestedBlock(block, '&[data-tone="base"] {');
    const inverse = nestedBlock(block, '&[data-tone="inverse"] {');
    expect(base).toContain("color: var(--color-ink-primary, oklch(0.2178 0 0));");
    expect(inverse).toContain("color: var(--color-ink-on-inverse, oklch(0.9702 0 0));");
    expect(nestedBlock(block, "& .site-header-brand > a.text-inherit {")).toContain("color: inherit;");
  });

  it("keeps only the automatic frame's ghost controls on the live ink and an AA-tested opaque hover plate", () => {
    const automatic = nestedBlock(block, "&.site-header-ground-aware {");
    expect(automatic).toContain('--site-header-action-hover: var(--color-surface-raised, oklch(1 0 0));');
    expect(nestedBlock(automatic, '&[data-tone="inverse"] {')).toContain('--site-header-action-hover: var(--color-surface-inverse, oklch(0.2178 0 0));');
    const actions = nestedBlock(automatic, '&[data-placement="overlay"][data-tone] .site-header-actions > a,');
    expect(actions).toContain('&[data-placement="overlay"][data-tone] .site-header-desktop-actions a.text-ink-primary:not(.bg-surface-raised),');
    expect(actions).toContain('&[data-placement="overlay"][data-tone] .nav-disclosure-toggle:not([data-tone]) {');
    expect(actions).toContain("color: inherit;");
    expect(actions).toContain("background-color: transparent;");
    expect(nestedBlock(actions, "&:hover, &:focus-visible {")).toContain("color: inherit;");
    expect(actions).toContain("background-color: var(--site-header-action-hover, var(--color-surface-raised, oklch(1 0 0)));");
    // These selectors beat both normal and hover utilities on an initially
    // inverse action. Its icon and current-item underline use currentColor.
    expect(automatic).not.toContain("--color-control-tonal");
    expect(automatic).not.toMatch(LAYOUT_PROPERTIES);
  });

  it("resets expanded mobile-panel action hover and focus plates to match the panel's own base ink", () => {
    const mobile = topLevelBlock(themeKeys, "@utility site-header-mobile {");
    const panel = nestedBlock(mobile, "& .nav-disclosure-panel {");
    expect(panel).toContain("color: var(--color-ink-primary, oklch(0.2178 0 0));");
    expect(panel).toContain("--site-header-action-hover: var(--color-surface-raised, oklch(1 0 0));");
    expect(panel).toContain("--site-header-focus: var(--color-ink-primary, oklch(0.2178 0 0));");
    // Inline inverse header actions keep their inverse plate: only the
    // narrow or overflow-collapsed panel establishes this base-ink scope.
    const automatic = nestedBlock(block, "&.site-header-ground-aware {");
    expect(nestedBlock(automatic, '&[data-tone="inverse"] {')).toContain("--site-header-action-hover: var(--color-surface-inverse, oklch(0.2178 0 0));");
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
    // A ghost control's transparent fill reveals the header plate; it does
    // not make that plate transparent in the no-animation fallback.
    const automatic = nestedBlock(block, "&.site-header-ground-aware {");
    const controls = nestedBlock(automatic, '&[data-placement="overlay"][data-tone] .site-header-actions > a,');
    const outside = block.replace(scrollDriven, "").replace(controls, "");
    expect(outside).toContain("background-color: var(--site-header-glass-fill, oklch(1 0 0 / 0.6));");
    expect(outside).not.toContain("transparent");
    expect(scrollDriven).toContain("background-color: transparent;");
    expect(scrollDriven).toContain("border-block-end-color: transparent;");
    expect(scrollDriven).toContain("animation-name: site-header-glass;");
    expect(scrollDriven).toContain("animation-timeline: scroll(root block);");
    expect(scrollDriven).toContain("animation-range: 0 var(--spacing-3xl, 48px);");
    expect(scrollDriven).toContain("animation-fill-mode: both;");
  });

  it("steps to glass at the first scroll instead of fading under reduced motion", () => {
    const reducedMotion = nestedBlock(scrollDriven, "@media (prefers-reduced-motion: reduce)");
    // One step over the first pixel, not over the whole 48px ramp: the header
    // is transparent only at the very top and glass from the first scroll.
    expect(reducedMotion).toContain("animation-timing-function: steps(1, jump-end);");
    expect(reducedMotion).toContain("animation-range: 0 1px;");
  });

  it("forces glass while a menu is open, by prop, by an expanded toggle or by an open details", () => {
    expect(scrollDriven).toMatch(
      /&\[data-menu-open\],\s*&:has\(\[aria-expanded="true"\]\),\s*&:has\(details\[open\]\) \{\s*animation-name: none;\s*background-color: var\(--site-header-glass-fill, oklch\(1 0 0 \/ 0\.6\)\);/,
    );
  });

  it("draws focus indicators in the tone's ink, not accent, so they clear 3:1 on the glass", () => {
    const outside = block.slice(0, block.indexOf("@supports not"));
    expect(outside).toContain("--site-header-focus: var(--color-ink-primary, oklch(0.2178 0 0));");
    expect(outside).toContain("--ui-ring-focus: 0 0 0 2px var(--site-header-focus, oklch(0.2178 0 0));");
    expect(outside).toMatch(/&\[data-tone="inverse"\] \{[^}]*--site-header-focus: var\(--color-ink-on-inverse, oklch\(0\.9702 0 0\)\);[^}]*\}/);
    // Higher specificity than a `focus-visible:outline-*` utility (0,2,0),
    // so the outline colour is the tone's ink whatever the rule order.
    expect(outside).toMatch(/&\[data-placement="overlay"\] :focus-visible \{\s*outline-color: var\(--site-header-focus, oklch\(0\.2178 0 0\)\);\s*\}/);
    expect(outside).not.toContain("--color-accent");
  });

  it("changes paint only between states: no state rule or keyframe touches layout", () => {
    expect(keyframes).not.toMatch(LAYOUT_PROPERTIES);
    expect(scrollDriven).not.toMatch(LAYOUT_PROPERTIES);
    expect(noBackdrop).not.toMatch(LAYOUT_PROPERTIES);
    expect(reducedTransparency).not.toMatch(LAYOUT_PROPERTIES);
    expect(keyframes).toContain("background-color: var(--site-header-glass-fill, oklch(1 0 0 / 0.6));");
    expect(keyframes).toContain("backdrop-filter: var(--site-header-glass-blur, blur(20px));");
  });

  it("is carried into compiled.css with the fallback, the reduced-preference branches and the keyframes", () => {
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    expect(compiled).toContain(".site-header-overlay");
    expect(compiled).toContain("@keyframes site-header-glass");
    expect(compiled).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(compiled).toContain("prefers-reduced-transparency: reduce");
    expect(compiled).toContain("--color-surface-glass");
    expect(compiled).toContain("--blur-glass");
    expect(compiled).toContain("--ui-ring-focus: 0 0 0 2px var(--site-header-focus, oklch(0.2178 0 0));");
    expect(compiled).toContain('&[data-placement="overlay"] :focus-visible {');
  });
});
