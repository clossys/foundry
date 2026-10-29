import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../../../styles/theme-keys.css", import.meta.url), "utf8");
const compiled = readFileSync(new URL("../../../styles/compiled.css", import.meta.url), "utf8");
const compiledStart = compiled.indexOf('.site-header-nav-sheet[data-slot="sheet-content"]');
const compiledSheet = compiled.slice(compiledStart, compiled.indexOf(".site-header-row {", compiledStart));
function block(css: string, selector: string): string {
  const at = css.indexOf(selector), start = css.indexOf("{", at);
  if (at < 0 || start < 0) return "";
  let depth = 1, end = start + 1;
  for (; end < css.length && depth; end++) { if (css[end] === "{") depth++; if (css[end] === "}") depth--; }
  return css.slice(start + 1, end - 1);
}
const hasReducedMotionFallback = (css: string, selector: string) => {
  const reduced = block(block(css, selector), "@media (prefers-reduced-motion: reduce)");
  return reduced.includes("animation: none") && reduced.includes("transition: none");
};
describe("MK-3 chrome CSS delivery", () => {
  it("ships a portalled drawer with bounded viewport, safe-area padding and full-size links", () => {
    for (const css of [block(source, "@utility site-header-nav-sheet"), compiledSheet]) {
      expect(css).toContain('[data-slot="sheet-content"]');
      expect(css).toContain("max-block-size: 100dvb");
      expect(css).toContain("overflow-y: auto");
      expect(css).toContain("safe-area-inset-bottom");
      expect(css).toContain("min-block-size: var(--ui-layout-tap-target, 44px)");
    }
  });
  it("keeps the desktop duplicate hidden on narrow screens but available for measurement and no-script navigation", () => {
    expect(block(source, "@utility site-header-mobile")).toContain(".site-header-nav-inline { display: none !important; }");
    const contract = block(source, "@utility site-header-contract");
    expect(contract).toContain("&[data-measuring] .site-header-nav-inline { display: contents !important; }");
    expect(block(contract, "@media (scripting: none)")).toContain("display: flex !important");
  });
  it("disables drawer motion in both authored and shipped CSS; removal mutant is detected", () => {
    expect(hasReducedMotionFallback(source, "@utility site-header-nav-sheet")).toBe(true);
    expect(hasReducedMotionFallback(`@utility generated {${compiledSheet}}`, "@utility generated")).toBe(true);
    const reduced = block(block(source, "@utility site-header-nav-sheet"), "@media (prefers-reduced-motion: reduce)");
    const mutant = source.replace(reduced, "");
    expect(hasReducedMotionFallback(mutant, "@utility site-header-nav-sheet")).toBe(false);
  });
  it("retains the footer's own one/two/four column breakpoints", () => {
    const columns = block(source, "@utility site-footer-columns");
    expect(columns).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(block(columns, "@container (min-width: 768px)")).toContain("repeat(2, minmax(0, 1fr))");
    expect(block(columns, "@container (min-width: 1280px)")).toContain("repeat(4, minmax(0, 1fr))");
  });
});
