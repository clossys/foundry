// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, generate, type CssNode } from "css-tree";
import { SECTION_REVEAL_CSS, SectionRevealStyle } from "./section-reveal.js";

function applied(reduced: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  const visit = (node: CssNode) => {
    if (node.type === "StyleSheet" || node.type === "Block") node.children.forEach(visit);
    if (node.type === "Atrule" && node.name === "media" && node.block) {
      const query = generate(node.prelude!);
      if (query === `(prefers-reduced-motion:${reduced ? "reduce" : "no-preference"})`) visit(node.block);
    }
    if (node.type === "Rule" && generate(node.prelude) === "[data-designer-reveal]") node.block.children.forEach(declaration => {
      if (declaration.type === "Declaration") values[declaration.property] = generate(declaration.value);
    });
  };
  visit(parse(SECTION_REVEAL_CSS));
  return values;
}
describe("shared section reveal", () => {
  it("ships its styles as SSR markup, with token-driven motion only when permitted", () => {
    expect(renderToStaticMarkup(<SectionRevealStyle />)).toContain("@keyframes reveal");
    expect(SECTION_REVEAL_CSS).toContain("var(--ui-motion-shift-reveal, 24px)");
    expect(applied(false).animation).toContain("var(--animate-reveal,");
  });
  it("keeps all content visible and static with reduced motion", () => {
    expect(applied(true)).toMatchObject({ animation: "none", transform: "none", opacity: "1" });
  });
});
