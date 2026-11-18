// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_BACKDROP_COLORS,
  INTERACTIVE_BACKDROP_COMPONENT_IDS,
  INTERACTIVE_BACKDROP_COMPONENTS,
  INTERACTIVE_BACKDROP_SLOT,
  carriesInteractiveBackdrop,
  interactiveBackdropDescriptorIssues,
  interactiveBackdropMetaIssues,
  isInteractiveBackdropDescriptor,
  resolveInteractiveBackdropParams,
} from "./interactive-backdrops.js";

const packageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");

/** The hero's own code candidate, carrying the descriptor as meta.backdrop. */
const candidate = (backdrop: unknown = { component: "grid-glow", params: { cell: 32 } }) => ({
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "hero",
  type: "registry:block",
  files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return null; }\n" }],
  meta: {
    slot: "sections.hero",
    source: { kind: "original", ref: [], license: "MIT" },
    element: { slot: "sections.hero", reason: "director:identity.visual.style" },
    backdrop,
  },
});

describe("interactive backdrop descriptor (foundry-build-0048 A4)", () => {
  it("ships exactly three Foundry components, each with defaults inside its own schema", () => {
    expect(INTERACTIVE_BACKDROP_COMPONENT_IDS).toEqual(["particle-field", "gradient-mesh", "grid-glow"]);
    for (const component of INTERACTIVE_BACKDROP_COMPONENT_IDS) {
      const resolved = resolveInteractiveBackdropParams({ component, params: {} } as never);
      expect(Object.keys(resolved)).toEqual(Object.keys(INTERACTIVE_BACKDROP_COMPONENTS[component]));
      expect(interactiveBackdropDescriptorIssues({ component, params: resolved }), component).toEqual([]);
    }
  });

  it("admits every in-range number, listed colour and boolean, and resolves absent params to defaults", () => {
    const valid = [
      { component: "particle-field", params: { color: "accent", density: 8, speed: 0, size: 4, links: true } },
      { component: "particle-field", params: { density: 160, speed: 2 } },
      { component: "gradient-mesh", params: { from: "foreground", via: "border", to: "muted-foreground", speed: 1.25, intensity: 0.1 } },
      { component: "grid-glow", params: { line: "border", glow: "secondary", cell: 96, follow: false, pulse: true } },
      { component: "grid-glow", params: {} },
    ];
    for (const descriptor of valid) {
      expect(interactiveBackdropDescriptorIssues(descriptor), JSON.stringify(descriptor)).toEqual([]);
      expect(isInteractiveBackdropDescriptor(descriptor)).toBe(true);
    }
    expect(resolveInteractiveBackdropParams({ component: "particle-field", params: { density: 12 } }))
      .toEqual({ color: "primary", density: 12, speed: 0.5, size: 2, links: false });
  });

  it.each([
    ["a non-object", "grid-glow", /not an object \{component, params\}/],
    ["a list", [{ component: "grid-glow", params: {} }], /not an object/],
    ["an unknown descriptor key", { component: "grid-glow", params: {}, code: "alert(1)" }, /carries "code"/],
    ["an unknown component", { component: "three-scene", params: {} }, /not one of the Foundry components/],
    ["an inherited name as component", { component: "constructor", params: {} }, /not one of the Foundry components/],
    ["a prototype name as component", { component: "__proto__", params: {} }, /not one of the Foundry components/],
    ["missing params", { component: "grid-glow" }, /params is undefined, not an object/],
    ["params as a list", { component: "grid-glow", params: [] }, /params is a list, not an object/],
    ["an unknown param", { component: "grid-glow", params: { src: "x" } }, /has no param "src"/],
    ["a URL as colour", { component: "particle-field", params: { color: "https://example.com/a.js" } }, /not one of the token colours/],
    ["a CSS colour", { component: "particle-field", params: { color: "#ff0000" } }, /not one of the token colours/],
    ["a CSS expression", { component: "gradient-mesh", params: { from: "var(--color-primary)" } }, /not one of the token colours/],
    ["code as colour", { component: "grid-glow", params: { glow: "()=>fetch('/x')" } }, /not one of the token colours/],
    ["an inherited colour name", { component: "grid-glow", params: { glow: "toString" } }, /not one of the token colours/],
    ["a numeric string", { component: "particle-field", params: { density: "48" } }, /not a finite number/],
    ["NaN", { component: "particle-field", params: { speed: Number.NaN } }, /not a finite number/],
    ["Infinity", { component: "gradient-mesh", params: { intensity: Number.POSITIVE_INFINITY } }, /not a finite number/],
    ["below range", { component: "particle-field", params: { density: 7 } }, /outside 8\.\.160/],
    ["above range", { component: "gradient-mesh", params: { speed: 2.01 } }, /outside 0\.\.2/],
    ["a fraction for an integer", { component: "grid-glow", params: { cell: 40.5 } }, /not a whole number/],
    ["a string boolean", { component: "grid-glow", params: { follow: "true" } }, /not a boolean/],
    ["a number boolean", { component: "particle-field", params: { links: 1 } }, /not a boolean/],
  ])("refuses %s", (_label, descriptor, message) => {
    const issues = interactiveBackdropDescriptorIssues(descriptor);
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
    expect(isInteractiveBackdropDescriptor(descriptor)).toBe(false);
    expect(() => resolveInteractiveBackdropParams(descriptor as never)).toThrow(TypeError);
  });

  it("paints only with theme colours the hero contract reads, each a stock theme key", () => {
    const hero = (JSON.parse(read("src/catalog/slots/sections.json")) as { id: string; contract: { allowedReads: { themes: string[] } } }[]).find(slot => slot.id === "sections.hero")!;
    const keys = read("styles/theme-keys.css");
    for (const color of INTERACTIVE_BACKDROP_COLORS) {
      expect(hero.contract.allowedReads.themes, color).toContain(`themes.${color}`);
      expect(keys, color).toContain(`--color-${color}:`);
    }
  });

  it("the provenance rule and the hero contract list exactly these components, for the hero slot only", () => {
    const rule = JSON.parse(read("src/catalog/rules/provenance.json")) as { interactiveBackdrops: { slots: string[]; components: string[] } };
    expect(rule.interactiveBackdrops.slots).toEqual([INTERACTIVE_BACKDROP_SLOT]);
    expect(rule.interactiveBackdrops.components).toEqual([...INTERACTIVE_BACKDROP_COMPONENT_IDS]);
    const slots = JSON.parse(read("src/catalog/slots/sections.json")) as { id: string; contract: { interactive?: { components: string[] } } }[];
    expect(slots.filter(slot => slot.contract.interactive).map(slot => slot.id)).toEqual(["sections.hero"]);
    expect(slots.find(slot => slot.id === "sections.hero")!.contract.interactive!.components).toEqual([...INTERACTIVE_BACKDROP_COMPONENT_IDS]);
  });
});

describe("interactive backdrop on the hero's own code candidate (meta.backdrop)", () => {
  it("admits a hero code candidate carrying a valid descriptor, and one carrying none", () => {
    expect(INTERACTIVE_BACKDROP_SLOT).toBe("sections.hero");
    expect(carriesInteractiveBackdrop(candidate())).toBe(true);
    expect(interactiveBackdropMetaIssues(candidate(), "sections.hero")).toEqual([]);
    const { backdrop: _backdrop, ...meta } = candidate().meta;
    const plain = { ...candidate(), meta };
    expect(carriesInteractiveBackdrop(plain)).toBe(false);
    expect(interactiveBackdropMetaIssues(plain, "sections.hero")).toEqual([]);
    expect(interactiveBackdropMetaIssues(plain, "sections.call-to-action")).toEqual([]);
    for (const value of [null, "x", [], { meta: null }, { meta: Object.create({ backdrop: {} }) }]) expect(carriesInteractiveBackdrop(value), JSON.stringify(value)).toBe(false);
  });

  it("refuses a descriptor on any other slot's candidate, the CTA (which also renders Hero) included", () => {
    for (const slot of ["sections.call-to-action", "sections.media", "components.button"]) {
      expect(interactiveBackdropMetaIssues(candidate(), slot)).toEqual([`meta.backdrop rides only on a sections.hero code candidate, not on a ${slot} candidate`]);
    }
  });

  it.each([
    ["an unknown component", { component: "three-scene", params: {} }, /not one of the Foundry components/],
    ["a param out of range", { component: "grid-glow", params: { cell: 4 } }, /outside 16\.\.96/],
    ["a URL colour", { component: "grid-glow", params: { glow: "https://example.com/x.js" } }, /not one of the token colours/],
    ["an extra descriptor key", { component: "grid-glow", params: {}, module: "./x.js" }, /carries "module"/],
    ["an empty value", null, /not an object \{component, params\}/],
  ])("refuses %s", (_label, backdrop, message) => {
    const issues = interactiveBackdropMetaIssues(candidate(backdrop), "sections.hero");
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
  });

  it("reads only the descriptor's own keys", () => {
    expect(interactiveBackdropDescriptorIssues(Object.create({ component: "grid-glow", params: {} }))).toEqual([expect.stringMatching(/component is undefined, not one of the Foundry components/)]);
  });
});
