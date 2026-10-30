import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import { loadCatalog } from "../../../designer/src/catalog-core/index.js";
import { resolve } from "../../../designer/src/catalog-core/resolve.js";
import { sourceRoster, tokenContract } from "../../../designer/src/catalog-core/token-contract.js";
import { completedTokenLibrary } from "../../../designer/src/importers/__fixtures__/completed-token-library.js";
import { selectionShadcnTokens } from "./selection-shadcn-tokens.js";

function consumer() {
  const catalog = loadCatalog();
  const library = completedTokenLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29");
  return { catalog, library };
}
const selected = () => resolve(consumer());
const block = (css: string, selector: string) => css.slice(css.indexOf(selector) + selector.length).split("}")[0]!;
const values = (css: string) => Object.fromEntries([...css.matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));

describe("selected consumer shadcn token mapping", () => {
  it("covers every live exact contract target and alias in each theme", () => {
    const profile = selected();
    const output = selectionShadcnTokens(profile, tokenContract);
    const expected = [...new Set([
      ...Object.values(tokenContract.leaves).flatMap(leaf => Object.values(leaf.members ?? {}).filter(member => member.status === "live" && member.kind !== "moved").map(member => member.target)),
      ...Object.keys(tokenContract.aliases),
    ])].sort();
    expect(output.properties).toEqual(expected);
    const light = values(block(output.css, ":root {"));
    const explicitDark = values(block(output.css, ':root[data-theme="dark"] {'));
    const systemDark = values(block(output.css, ':root:not([data-theme="light"]) {'));
    expect(Object.keys(light).sort()).toEqual(expected);
    expect(Object.keys(explicitDark).sort()).toEqual(expected);
    expect(systemDark).toEqual(explicitDark);
    expect(output.css).toContain("@media (prefers-color-scheme: dark)");
    for (const [target, source] of Object.entries({ "--card-foreground": "--foreground", "--popover-foreground": "--foreground", "--secondary-foreground": "--foreground", "--sidebar-foreground": "--foreground", "--sidebar-accent": "--accent", "--sidebar-accent-foreground": "--foreground", "--sidebar-border": "--border", "--sidebar-ring": "--ring", "--sidebar-primary": "--primary", "--sidebar-primary-foreground": "--primary-foreground", "--radius": "--radius-lg" })) {
      expect(light[target], target).toBe(light[source]);
      expect(explicitDark[target], target).toBe(explicitDark[source]);
    }
  });

  it("uses actual authored consumer values instead of copying a preset palette", () => {
    const input = consumer();
    const fill = input.library.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "tokens.action-color")!;
    const action = (fill.tokens as Record<string, any>)["action-color"].default;
    action.$value = { colorSpace: "oklch", components: [0.31, 0.08, 240] };
    action.$extensions["com.clossys.css"].raw = "oklch(0.31 0.08 240)";
    action.$extensions["com.clossys.modes"].dark = { colorSpace: "oklch", components: [0.81, 0.07, 240] };
    const profile = resolve(input);
    const output = selectionShadcnTokens(profile, tokenContract);
    const light = values(block(output.css, ":root {"));
    const dark = values(block(output.css, ':root[data-theme="dark"] {'));
    expect(light["--primary"]).toBe(profile.members["tokens.action-color.default"]!.css.light);
    expect(dark["--primary"]).toBe(profile.members["tokens.action-color.default"]!.css.dark);
    expect(light["--primary"]).not.toBe(dark["--primary"]);
    for (const preset of sourceRoster.tokens.presets) {
      expect(light["--primary"]).not.toBe(preset.theme.vars.light["--primary"]);
      expect(dark["--primary"]).not.toBe(preset.theme.vars.dark["--primary"]);
    }
    expect(light["--sidebar-primary"]).toBe(light["--primary"]);
    expect(dark["--sidebar-primary"]).toBe(dark["--primary"]);
  });

  it("reduces shared shadcn keys to explicit native roles independently of contract order", () => {
    const profile = selected();
    const canonical = { "--accent": "tokens.surface-color.selected", "--accent-foreground": "tokens.text-color.on-accent", "--border": "tokens.border-color.base", "--muted": "tokens.surface-color.sunken", "--muted-foreground": "tokens.text-color.muted", "--primary": "tokens.action-color.default", "--radius-lg": "tokens.surface-radius.default", "--text-xs": "tokens.body-size.s" };
    // Distinct signals expose a wrong owner even when a preset gives both
    // competing native roles the same value.
    for (const [target, id] of Object.entries(canonical)) {
      profile.members[id]!.alias = {};
      profile.members[id]!.css = { light: `native${target}`, dark: `dark${target}` };
    }
    const reordered = { ...tokenContract, leaves: Object.fromEntries(Object.entries(tokenContract.leaves).reverse().map(([id, leaf]) => [id, { ...leaf, members: Object.fromEntries(Object.entries(leaf.members ?? {}).reverse()) }])) };
    const output = selectionShadcnTokens(profile, tokenContract);
    expect(selectionShadcnTokens(profile, reordered)).toEqual(output);
    const light = values(block(output.css, ":root {"));
    for (const [target, id] of Object.entries(canonical)) {
      expect(light[target], target).toBe(profile.members[id]!.css.light);
    }
  });

  it("follows consumer aliases in each mode and permits invariant structural tokens", () => {
    const profile = selected();
    const member = profile.members["tokens.action-color.default"]!;
    member.alias = { light: "tokens.text-color.primary", dark: "tokens.text-color.on-inverse" };
    const output = selectionShadcnTokens(profile, tokenContract);
    expect(values(block(output.css, ":root {"))["--primary"]).toBe(profile.members["tokens.text-color.primary"]!.css.light);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--primary"]).toBe(profile.members["tokens.text-color.on-inverse"]!.css.dark);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--radius"]).toBe(profile.members["tokens.surface-radius.default"]!.css.light);
  });

  it("reports a missing consumer token, dark color or broken alias instead of filling it from defaults", () => {
    const absent = selected();
    delete (absent.members as Record<string, unknown>)["tokens.surface-color.base"];
    expect(() => selectionShadcnTokens(absent, tokenContract)).toThrow(/tokens.surface-color.base is unavailable/);
    const noDark = selected();
    delete noDark.members["tokens.action-color.default"]!.css.dark;
    expect(() => selectionShadcnTokens(noDark, tokenContract)).toThrow(/tokens.action-color.default has no dark value/);
    const broken = selected();
    broken.members["tokens.action-color.default"]!.alias = { light: "tokens.missing.default" };
    expect(() => selectionShadcnTokens(broken, tokenContract)).toThrow(/tokens.missing.default is unavailable/);
    broken.members["tokens.action-color.default"]!.alias = { light: "tokens.action-color.default" };
    expect(() => selectionShadcnTokens(broken, tokenContract)).toThrow(/cyclic light alias/);
  });

  it("feeds native live references to the real Tailwind compiler", async () => {
    const output = selectionShadcnTokens(selected(), tokenContract);
    const compiler = await compile(`${output.theme}\n@tailwind utilities;`);
    const css = compiler.build(["bg-primary", "bg-background", "text-foreground", "border-border", "ring-ring", "rounded-lg"]);
    for (const [declaration, value] of Object.entries({ "background-color": "var(--primary)", color: "var(--foreground)", "border-color": "var(--border)", "--tw-ring-color": "var(--ring)" })) {
      expect(css).toContain(`${declaration}: ${value}`);
    }
    expect(css).toContain("background-color: var(--background)");
    expect(css).toContain(`border-radius: var(${selected().members["tokens.surface-radius.default"]!.emit})`);
    expect(css).not.toContain("background-color: oklch(");
  });
});
