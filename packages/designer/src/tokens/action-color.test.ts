// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { resolveTokenValue } from "./internal/resolve-token-value.js";
import { contrastRatio } from "./color.js";

// The five-member catalog action palette, its alternate-accent adoption and the focus-shadow leaf left with the
// themes rename (themes.primary is one shadcn member); the shipped stylesheet's action states stay pinned here.
const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const expected = { default: ["#0A0A0A", "#FAFAFA"], hover: ["#262626", "#E5E5E5"], pressed: ["#404040", "#D4D4D4"], "on-inverse": ["#FAFAFA", "#0A0A0A"], "on-inverse-hover": ["#E5E5E5", "#262626"] };
describe("action palette contract", () => {
  it.each(["light", "dark"] as const)("keeps action labels readable in every %s state, independently of accent", mode => {
    const declarations = parseRootDeclarations(css);
    if (mode === "dark") for (const [key, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]')) declarations.set(key, value);
    const registry = Object.fromEntries(Object.values(TOKENS).map(token => [token.property, { ...token, value: declarations.get(token.property)! }]));
    // A consumer changing accent must not change any action value or label.
    registry["--color-accent"] = { ...registry["--color-accent"]!, value: "#8250DF" };
    const resolved = (property: string) => resolveTokenValue(property, registry).value!;
    for (const name of Object.keys(expected)) {
      const suffix = name === "default" ? "" : "-" + name;
      const label = name.startsWith("on-inverse") ? "--color-ink-primary" : "--color-ink-on-action";
      expect(contrastRatio(resolved(label), resolved("--color-action" + suffix)), name).toBeGreaterThanOrEqual(4.5);
    }
    expect(resolved("--color-action")).not.toBe(resolved("--color-accent"));
  });
});
