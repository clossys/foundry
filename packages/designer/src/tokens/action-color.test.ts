// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import slots from "../catalog/slots/tokens.json" with { type: "json" };
import action from "../catalog/fills/foundry/themes.primary.json" with { type: "json" };
import text from "../catalog/fills/foundry/themes.foreground.json" with { type: "json" };
import focus from "../catalog/fills/foundry/tokens.focus-shadow.json" with { type: "json" };
import { TOKENS } from "./tokens.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { resolveTokenValue } from "./internal/resolve-token-value.js";
import { contrastRatio } from "./color.js";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve } from "../catalog-core/index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { tokenCatalog } from "../catalog-core/__fixtures__/token-catalog.js";

const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const expected = { default: ["#0A0A0A", "#FAFAFA"], hover: ["#262626", "#E5E5E5"], pressed: ["#404040", "#D4D4D4"], "on-inverse": ["#FAFAFA", "#0A0A0A"], "on-inverse-hover": ["#E5E5E5", "#262626"] };
describe("action palette contract", () => {
  it("records the five distinct action members in both source modes", () => {
    const slot = slots.find(slot => slot.id === "themes.primary")!;
    expect(slot.contract.members).toEqual({ mode: "closed", names: Object.keys(expected) });
    expect(slot.contract.modes).toEqual(["light", "dark"]);
    for (const [name, values] of Object.entries(expected)) {
      const member = action.tokens["action-color"][name as keyof typeof action.tokens["action-color"]];
      expect(member.$value.hex).toBe(values[0]);
      expect(member.$extensions["com.clossys.modes"].dark.hex).toBe(values[1]);
    }
    expect(text.tokens["text-color"]["on-action"]).toEqual({ $type: "color", $value: "{themes.foreground.default}" });
  });
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
  it("offers and emits action through the public engine independently of an adopted accent", () => {
    const catalog = tokenCatalog(loadCatalog());
    const library = completedTokenLibrary(catalog, { id: "example-action", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-24");
    const alternate = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "themes.primary", source: "radix-colors" }] });
    const before = resolve({ catalog, library }), after = resolve({ catalog, library: alternate });
    expect(after.members["themes.primary.default"]!.css).not.toEqual(before.members["themes.primary.default"]!.css);
    for (const name of Object.keys(expected)) expect(after.members[`themes.primary.${name}`]!.css).toEqual(before.members[`themes.primary.${name}`]!.css);
    expect(after.members["themes.primary-foreground.default"]!.css).toEqual(before.members["themes.primary-foreground.default"]!.css);
    const output = emit(after, ["css-brand", "css-scales"], { header: false }).map(file => file.contents).join("\n");
    expect(output).toContain("--color-action: #0A0A0A;");
    expect(output).toContain("--color-action: #FAFAFA;");
    expect(output).toContain("--color-ink-on-action: var(--color-ink-on-inverse, ");
  });
  it("replaces the translucent inverse edge with a solid two-pixel focus-color ring", () => {
    const ring = focus.tokens["focus-shadow"]["on-inverse"];
    expect(ring.$value).toBe("0 0 0 2px var(--color-focus-ring-on-inverse, oklch(0.9702 0 0))");
    expect(ring.$extensions["com.clossys.css"].reads).toEqual(["themes.ring.default"]);
  });
});
