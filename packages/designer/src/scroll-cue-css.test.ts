import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");

/** The `scroll-cue` utility's source rule, from its `@utility` line to the closing brace at column 0. */
function utilityBlock(css: string): string {
  const start = css.indexOf("@utility scroll-cue {");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start) + 3);
}

describe("scroll-cue utility (theme-keys.css)", () => {
  const block = utilityBlock(readFileSync(join(styles, "theme-keys.css"), "utf8"));
  const supports = block.indexOf("@supports (animation-timeline: scroll())");

  it("falls back to the container's top edge, and is fixed to the window only inside the scroll-timeline @supports branch", () => {
    expect(supports).toBeGreaterThan(-1);
    const outside = block.slice(0, supports);
    expect(outside).toContain("position: absolute;");
    expect(outside).not.toContain("position: fixed");
    const inside = block.slice(supports);
    expect(inside).toContain("position: fixed;");
    expect(inside).toContain("bottom: calc(env(safe-area-inset-bottom, 0px) + var(--spacing-xl, 24px));");
    // The branch that fixes the cue is the branch that fades it: never fixed without the fade.
    expect(inside).toContain("animation-timeline: scroll(root block);");
    expect(inside).toContain("animation-name: scroll-cue-out;");
    expect(inside).toContain("animation-range: 0 calc(var(--ui-layout-tap-target, 44px) * 3);");
  });

  it("ends hidden and inert, takes no motion token it does not need, and never moves under reduced motion", () => {
    const keyframes = readFileSync(join(styles, "theme-keys.css"), "utf8").match(/@keyframes scroll-cue-out \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(keyframes).toMatch(/opacity: 0;/);
    expect(keyframes).toMatch(/visibility: hidden;/);
    expect(keyframes).toMatch(/pointer-events: none;/);
    expect(keyframes).not.toMatch(/transform|translate/);
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*animation-timing-function: steps\(1, jump-end\);/);
  });

  it("is carried into compiled.css with the same fixed-only-under-@supports shape", () => {
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    expect(compiled).toContain("@keyframes scroll-cue-out");
    expect(compiled).not.toContain("scroll-fade-out");
  });
});
