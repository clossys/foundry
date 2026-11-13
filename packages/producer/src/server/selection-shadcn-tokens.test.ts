import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import { loadCatalog } from "../../../designer/src/catalog-core/index.js";
import { resolve } from "../../../designer/src/catalog-core/resolve.js";
import type { CompositeEngineInput, DtcgToken } from "../../../designer/src/catalog-core/types.js";
import { sourceRoster, tokenContract } from "../../../designer/src/catalog-core/token-contract.js";
import { completedTokenLibrary } from "../../../designer/src/importers/__fixtures__/completed-token-library.js";
import { selectionShadcnTokens } from "./selection-shadcn-tokens.js";
import { compileSelection } from "./selection.js";

function consumer() {
  const catalog = loadCatalog();
  const library = completedTokenLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-29");
  return { catalog, library };
}
const selected = () => resolve(consumer());
const catalogSlots = loadCatalog().slots;
const block = (css: string, selector: string) => css.slice(css.indexOf(selector) + selector.length).split("}")[0]!;
const values = (css: string) => Object.fromEntries([...css.matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));

describe("selected consumer shadcn token mapping", () => {
  it("covers every live exact contract target and alias in each theme", () => {
    const profile = selected();
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
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
    for (const [target, id] of Object.entries({ "--card-foreground": "themes.card-foreground.default", "--popover-foreground": "themes.popover-foreground.default", "--secondary-foreground": "themes.secondary-foreground.default", "--sidebar-foreground": "themes.sidebar-foreground.default", "--sidebar-accent": "themes.sidebar-accent.default", "--sidebar-accent-foreground": "themes.sidebar-accent-foreground.default", "--sidebar-border": "themes.sidebar-border.default", "--sidebar-ring": "themes.sidebar-ring.default", "--sidebar-primary": "themes.sidebar-primary.default", "--sidebar-primary-foreground": "themes.sidebar-primary-foreground.default", "--radius": "themes.radius.default" })) {
      const member = profile.members[id]!;
      expect(light[target], target).toBe(member.css.light);
      expect(explicitDark[target], target).toBe(member.css.dark ?? member.css.light);
    }
  });

  it("uses actual authored consumer values instead of copying a preset palette", () => {
    const input = consumer();
    const fill = input.library.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === "themes.primary")!;
    const action = (fill.themes!.primary as Record<string, DtcgToken>).default!;
    expect(action.$type).toBe("color");
    action.$value = { colorSpace: "oklch", components: [0.31, 0.08, 240] };
    action.$extensions = { ...action.$extensions,
      "com.clossys.css": { ...action.$extensions?.["com.clossys.css"], raw: "oklch(0.31 0.08 240)" },
      "com.clossys.modes": { ...action.$extensions?.["com.clossys.modes"], dark: { colorSpace: "oklch", components: [0.81, 0.07, 240] } },
    };
    const profile = resolve(input);
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    const light = values(block(output.css, ":root {"));
    const dark = values(block(output.css, ':root[data-theme="dark"] {'));
    expect(light["--primary"]).toBe(profile.members["themes.primary.default"]!.css.light);
    expect(dark["--primary"]).toBe(profile.members["themes.primary.default"]!.css.dark);
    expect(light["--primary"]).not.toBe(dark["--primary"]);
    for (const preset of sourceRoster.themes.presets) {
      expect(light["--primary"]).not.toBe(preset.theme.vars.light["--primary"]);
      expect(dark["--primary"]).not.toBe(preset.theme.vars.dark["--primary"]);
    }
    expect(light["--sidebar-primary"]).toBe(profile.members["themes.sidebar-primary.default"]!.css.light);
    expect(dark["--sidebar-primary"]).toBe(profile.members["themes.sidebar-primary.default"]!.css.dark);
  });

  it("keeps distinct native shadcn owners independently of contract order", () => {
    const profile = selected();
    const canonical = { "--accent": "themes.accent.default", "--accent-foreground": "themes.accent-foreground.default", "--border": "themes.border.default", "--muted": "themes.muted.default", "--muted-foreground": "themes.muted-foreground.default", "--primary": "themes.primary.default", "--radius": "themes.radius.default", "--sidebar-primary": "themes.sidebar-primary.default" };
    // Distinct signals expose a wrong owner even when a preset gives both
    // competing native roles the same value.
    for (const [target, id] of Object.entries(canonical)) {
      profile.members[id]!.alias = {};
      profile.members[id]!.css = { light: `native${target}`, dark: `dark${target}` };
    }
    const reordered = { ...tokenContract, leaves: Object.fromEntries(Object.entries(tokenContract.leaves).reverse().map(([id, leaf]) => [id, { ...leaf, members: Object.fromEntries(Object.entries(leaf.members ?? {}).reverse()) }])) };
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    expect(selectionShadcnTokens(profile, reordered, catalogSlots)).toEqual(output);
    const light = values(block(output.css, ":root {"));
    const dark = values(block(output.css, ':root[data-theme="dark"] {'));
    for (const [target, id] of Object.entries(canonical)) {
      expect(light[target], target).toBe(profile.members[id]!.css.light);
      expect(dark[target], target).toBe(profile.members[id]!.css.dark);
    }
  });

  it("maps explicit contract aliases in both modes and refuses conflicting or ambiguous owners", () => {
    const profile = selected();
    const aliases = { ...tokenContract.aliases, "--fixture-primary": "themes.primary.default" };
    const output = selectionShadcnTokens(profile, { ...tokenContract, aliases }, catalogSlots);
    expect(values(block(output.css, ":root {"))["--fixture-primary"]).toBe(profile.members["themes.primary.default"]!.css.light);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--fixture-primary"]).toBe(profile.members["themes.primary.default"]!.css.dark);
    expect(() => selectionShadcnTokens(profile, { ...tokenContract, aliases: { ...aliases, "--primary": "themes.foreground.default" } }, catalogSlots)).toThrow(/conflicts with its native owner/);
    const duplicate = { ...tokenContract, leaves: { ...tokenContract.leaves, "themes.fixture": { members: { default: { kind: "theme", target: "--primary", status: "live" } } } } };
    expect(() => selectionShadcnTokens(profile, duplicate, catalogSlots)).toThrow(/no unambiguous native owner/);
  });

  it("follows consumer aliases in each mode and permits invariant structural tokens", () => {
    const profile = selected();
    const member = profile.members["themes.primary.default"]!;
    member.alias = { light: "themes.foreground.default", dark: "themes.foreground.default" };
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    expect(values(block(output.css, ":root {"))["--primary"]).toBe(profile.members["themes.foreground.default"]!.css.light);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--primary"]).toBe(profile.members["themes.foreground.default"]!.css.dark);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--radius"]).toBe(profile.members["themes.radius.default"]!.css.light);
  });

  it("reports a missing consumer token, dark color or broken alias instead of filling it from defaults", () => {
    const absent = selected();
    delete (absent.members as Record<string, unknown>)["themes.background.default"];
    expect(() => selectionShadcnTokens(absent, tokenContract, catalogSlots)).toThrow(/themes.background.default is unavailable/);
    const noDark = selected();
    delete noDark.members["themes.primary.default"]!.css.dark;
    expect(() => selectionShadcnTokens(noDark, tokenContract, catalogSlots)).toThrow(/themes.primary.default has no dark value/);
    const broken = selected();
    broken.members["themes.primary.default"]!.alias = { light: "tokens.missing.default" };
    expect(() => selectionShadcnTokens(broken, tokenContract, catalogSlots)).toThrow(/tokens.missing.default is unavailable/);
    broken.members["themes.primary.default"]!.alias = { light: "themes.primary.default" };
    expect(() => selectionShadcnTokens(broken, tokenContract, catalogSlots)).toThrow(/cyclic light alias/);
  });

  it("feeds native live colors to Tailwind and keeps structural radius in consumer CSS", async () => {
    const profile = selected();
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    const compiler = await compile(`${output.theme}\n@tailwind utilities;`);
    const css = compiler.build(["bg-primary", "bg-background", "text-foreground", "border-border", "ring-ring", "rounded-lg"]);
    for (const [declaration, value] of Object.entries({ "background-color": "var(--primary)", color: "var(--foreground)", "border-color": "var(--border)", "--tw-ring-color": "var(--ring)" })) {
      expect(css).toContain(`${declaration}: ${value}`);
    }
    expect(css).toContain("background-color: var(--background)");
    // The current contract owns --radius, not a Tailwind --radius-lg namespace.
    expect(css).not.toContain("border-radius:");
    expect(values(block(output.css, ":root {"))["--radius"]).toBe(profile.members["themes.radius.default"]!.css.light);
    expect(values(block(output.css, ':root[data-theme="dark"] {'))["--radius"]).toBe(profile.members["themes.radius.default"]!.css.dark ?? profile.members["themes.radius.default"]!.css.light);
    expect(css).not.toContain("background-color: oklch(");
  });
  it("reuses genuinely light-only catalog shadows in both dark outputs", () => {
    const input = consumer();
    const profile = resolve(input);
    const shadows = Object.entries(profile.members).filter(([, member]) => member.slot === "themes.shadow");
    expect(shadows.length).toBeGreaterThan(0);
    expect(input.catalog.slots.find(slot => slot.id === "themes.shadow")!.contract.modes).toEqual(["light"]);
    const output = selectionShadcnTokens(profile, tokenContract, input.catalog.slots);
    for (const [, member] of shadows) {
      expect(member.css.dark).toBeUndefined();
      expect(member.alias.dark).toBeUndefined();
      for (const selector of [":root {", ':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {']) {
        expect(values(block(output.css, selector))[member.emit!]).toBe(member.css.light);
      }
    }
  });

  it("refuses missing dark values for dual-mode shadows and colors", () => {
    const profile = selected();
    const shadow = Object.values(profile.members).find(member => member.slot === "themes.shadow")!;
    const dualMode = catalogSlots.map(slot => slot.id === shadow.slot
      ? { ...slot, contract: { ...slot.contract, modes: ["light", "dark"] as const } } : slot);
    expect(() => selectionShadcnTokens(profile, tokenContract, dualMode)).toThrow(/themes.shadow.*has no dark value/);
    const color = profile.members["themes.primary.default"]!;
    color.css = { light: color.css.light };
    color.value = { light: color.value.light };
    color.alias = { light: "themes.foreground.default" };
    expect(() => selectionShadcnTokens(profile, tokenContract, catalogSlots)).toThrow(/themes.primary.default has no dark value/);
  });

  it("preserves an explicit dark shadow even when its catalog is light-only", () => {
    const profile = selected();
    const shadow = Object.values(profile.members).find(member => member.slot === "themes.shadow")!;
    shadow.alias = {};
    shadow.css = { ...shadow.css, dark: "0 7px 19px #123456" };
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    expect(values(block(output.css, ":root {"))[shadow.emit!]).toBe(shadow.css.light);
    for (const selector of [':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {']) {
      expect(values(block(output.css, selector))[shadow.emit!]).toBe(shadow.css.dark);
    }
  });

  it("resolves a light-only shadow alias in light mode and retains explicit dark aliases", () => {
    const profile = selected();
    const shadows = Object.entries(profile.members).filter(([, member]) => member.slot === "themes.shadow");
    const [id, shadow] = shadows[0]!;
    const [targetId, target] = shadows[1]!;
    target.alias = {};
    target.css = { ...target.css, dark: "0 5px 17px #654321" };
    shadow.alias = { light: targetId };
    const output = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    for (const selector of [':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {']) {
      expect(values(block(output.css, selector))[shadow.emit!]).toBe(target.css.light);
    }
    shadow.alias = { light: targetId, dark: targetId };
    const explicit = selectionShadcnTokens(profile, tokenContract, catalogSlots);
    expect(values(block(explicit.css, ':root[data-theme="dark"] {'))[shadow.emit!]).toBe(target.css.dark);
    shadow.alias = { light: targetId, dark: id };
    expect(() => selectionShadcnTokens(profile, tokenContract, catalogSlots)).toThrow(/cyclic dark alias/);
  });

  it("transports the selected catalog modes through the real Studio caller", async () => {
    const { catalog, library } = consumer();
    const input: CompositeEngineInput = {
      catalog: { values: catalog, components: { slots: [], fills: [] } },
      library: { source: library.source, adoptedAt: library.adoptedAt,
        values: { fills: library.fills, complete: library.complete }, components: { fills: [], files: [] } },
    };
    const selection = await compileSelection(fileURLToPath(new URL("../../", import.meta.url)), input, [], "shadow-modes");
    const expected = selectionShadcnTokens(resolve({ catalog, library }), tokenContract, catalog.slots);
    expect(selection.css).toContain(expected.css);
  }, 30_000);

});
