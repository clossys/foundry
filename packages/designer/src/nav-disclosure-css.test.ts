import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const css = readFileSync(join(styles, "theme-keys.css"), "utf8");

function block(text: string, opening: string): string {
  const start = text.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${opening}`);
}

// R2F-26c: NavDisclosure is the stock Collapsible; its own panel, icon and toggle utilities are gone.
describe("nav disclosure header contract", () => {
  it("owns no NavDisclosure utilities and keeps the header's toggle bars and mobile sheet", () => {
    for (const name of ["nav-disclosure-panel", "nav-disclosure-icon", "nav-disclosure-toggle"]) expect(css).not.toContain(`@utility ${name} {`);
    const contract = block(css, "@utility site-header-contract {");
    expect(contract).toMatch(/::after \{[^}]*transition: transform var\(--ui-duration-default, 240ms\)/);
    expect(contract).toContain("@media (prefers-reduced-motion: reduce) { & .nav-disclosure-toggle:not([aria-label])::before, & .nav-disclosure-toggle:not([aria-label])::after { transition: none; } }");
    expect(block(css, "@utility site-header-mobile {")).toContain("& .nav-disclosure-panel[data-expanded], & .nav-disclosure-panel[data-present] { display: flex; flex-direction: column; }");
  });

  it("lays every header region out at its natural one-line width while measuring", () => {
    const contract = block(css, "@utility site-header-contract {");
    for (const region of [".site-header-brand", ".site-header-nav-links", ".site-header-desktop-actions", ".site-header-actions"]) {
      expect(contract).toContain(`&[data-measuring] ${region}`);
    }
    // planner:wd-reg: only the region rules size to max-content; 84acf3ed2 added the separate
    // `&[data-measuring] .site-header-nav-inline { display: contents !important; }` flattening rule, pinned below.
    const regionRule = /&\[data-measuring\][^{]*\.site-header-(?:brand|nav-links|desktop-actions|actions)\b[^{]*\{([^}]*)\}/g;
    const rules = [...contract.matchAll(regionRule)].map(match => match[1]!);
    expect(rules).toHaveLength(2);
    expect([...contract.matchAll(/&\[data-measuring\][^{]*\{([^}]*)\}/g)]).toHaveLength(3);
    expect(contract).toContain("&[data-measuring] .site-header-nav-inline { display: contents !important; }");
    for (const rule of rules) {
      expect(rule).toContain("inline-size: max-content;");
      expect(rule).toContain("max-inline-size: none;");
      expect(rule).toContain("flex-shrink: 0;");
      expect(rule).toContain("white-space: nowrap;");
    }
    const compiled = readFileSync(join(styles, "compiled.css"), "utf8");
    expect(compiled).toContain("[data-measuring]");
  });
});
