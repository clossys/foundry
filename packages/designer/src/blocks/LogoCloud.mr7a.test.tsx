import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogoCloud } from "./LogoCloud.js";

const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Mark ${index}`, logo: <svg /> }));

describe("MR-7a logo evidence", () => {
  it("preserves every mark in full rows and rejects a five-mark partial row [mutant: count 5]", () => {
    for (const count of [3, 4, 6, 8, 12]) {
      const markup = renderToStaticMarkup(<LogoCloud items={items(count)} />);
      expect(markup.match(/<li\b/g)).toHaveLength(count);
      for (const item of items(count)) expect(markup).toContain(item.name);
    }
    expect(() => renderToStaticMarkup(<LogoCloud items={items(5)} />)).toThrow(TypeError);
  });

  it("composes canonical primitives without raw styled elements [mutant: raw styled span or anchor]", () => {
    const source = readFileSync(join(import.meta.dirname, "LogoCloud.tsx"), "utf8");
    expect(source).not.toMatch(/<(?:a|button|input)\b/);
    expect(source).not.toMatch(/<(?:p|span)\b[^>]*(?:className|style)=/);
    expect(source).toContain("SemanticContent");
    expect(source).toContain("<Link");
  });
});
