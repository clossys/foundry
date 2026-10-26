import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const themeKeys = readFileSync(join(styles, "theme-keys.css"), "utf8");
const compiled = readFileSync(join(styles, "compiled.css"), "utf8");

/** A `@utility` block's source, from its `@utility` line to the closing brace at column 0. */
function utilityBlock(name: string): string {
  const start = themeKeys.indexOf(`@utility ${name} {`);
  expect(start, name).toBeGreaterThan(-1);
  return themeKeys.slice(start, themeKeys.indexOf("\n}\n", start) + 3);
}

/** A compiled rule for `.name`, from its selector to the closing brace at its own indent. */
function compiledRule(name: string): string {
  const start = compiled.indexOf(`  .${name} {`);
  expect(start, name).toBeGreaterThan(-1);
  return compiled.slice(start, compiled.indexOf("\n  }\n", start) + 5);
}

/** Every `translate:` / `transform:` declaration in a block, outside the reduced-motion-safe branch. */
function movementOutside(block: string, safeBranch: string): string[] {
  const safe = block.indexOf(safeBranch);
  const outside = safe === -1 ? block : block.slice(0, safe);
  return outside.match(/(translate|transform)\s*:[^;]*;/g) ?? [];
}

describe("quiet-action utility (the T4 chevron nudge)", () => {
  const block = utilityBlock("quiet-action");
  const NO_PREFERENCE = "@media (prefers-reduced-motion: no-preference)";

  it("pads the block to the tap target", () => {
    expect(block).toContain("min-block-size: var(--ui-layout-tap-target, 44px);");
  });

  it("moves the trailing icon only when the reader allows motion: under reduced motion the chevron takes no transform", () => {
    expect(block).toContain(NO_PREFERENCE);
    expect(movementOutside(block, NO_PREFERENCE)).toEqual([]);
    const motion = block.slice(block.indexOf(NO_PREFERENCE));
    expect(motion).toContain("translate: calc(var(--spacing-xs, 4px) / 2) 0;");
    expect(motion).toContain("transition-duration: var(--ui-duration-fast, 120ms);");
    expect(motion).toContain("transition-timing-function: var(--ease-default, cubic-bezier(.2, 0, 0, 1));");
  });

  it("is carried into compiled.css with the same shape", () => {
    const rule = compiledRule("quiet-action");
    expect(rule).toContain("min-block-size: var(--ui-layout-tap-target, 44px);");
    expect(rule).toContain(NO_PREFERENCE);
    expect(movementOutside(rule, NO_PREFERENCE)).toEqual([]);
    expect(rule).toContain("translate: calc(var(--spacing-xs, 4px) / 2) 0;");
  });
});

describe("icon-control utilities (the icon-only control boxes)", () => {
  it("md is the 44px tap target", () => {
    const block = utilityBlock("icon-control-md");
    expect(block).toContain("inline-size: var(--ui-layout-tap-target, 44px);");
    expect(block).toContain("block-size: var(--ui-layout-tap-target, 44px);");
    expect(block).not.toContain("position:");
  });

  it("sm is a 28px square on the small control height whose ::before pads the hit area back to 44px", () => {
    const block = utilityBlock("icon-control-sm");
    expect(block).toContain("inline-size: var(--ui-control-h-sm, 28px);");
    expect(block).toContain("block-size: var(--ui-control-h-sm, 28px);");
    expect(block).toContain("position: relative;");
    expect(block).toMatch(/&::before \{[^}]*inset: calc\(\(var\(--ui-control-h-sm, 28px\) - var\(--ui-layout-tap-target, 44px\)\) \/ 2\);/);
  });

  it("both compile into compiled.css", () => {
    expect(compiledRule("icon-control-md")).toContain("var(--ui-layout-tap-target, 44px)");
    expect(compiledRule("icon-control-sm")).toContain("::before");
  });
});
