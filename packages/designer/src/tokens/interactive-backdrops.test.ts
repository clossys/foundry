// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKDROP_REGISTRY,
  INTERACTIVE_BACKDROP_COLORS,
  INTERACTIVE_BACKDROP_COMPONENT_IDS,
  backdropComponentRecord,
  backdropRegistryFindings,
  carriesInteractiveBackdrop,
  contractBackdropSlot,
  interactiveBackdropDescriptorIssues,
  interactiveBackdropMetaIssues,
  interactiveBackdropPropPaths,
  previewInteractiveBackdropIssues,
  isInteractiveBackdropDescriptor,
  loadBackdropRegistry,
  resolveInteractiveBackdropParams,
} from "./interactive-backdrops.js";
import { catalogBackdropSurfaces, catalogSurfaceContract } from "../catalog-core/media-placement.js";

const packageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");
const registryJson = () => JSON.parse(read("src/catalog/rules/backdrop-components.json")) as { colors: string[]; components: { id: string; params: Record<string, unknown> }[] };

/** A surface's own code candidate, carrying the descriptor as meta.backdrop. */
const candidate = (backdrop: unknown = { component: "flickering-grid", params: { squareSize: 8 } }, slot = "sections.hero") => ({
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: slot.split(".").at(-1),
  type: "registry:block",
  files: [{ path: "surface.tsx", type: "registry:block", content: "export function Surface() { return null; }\n" }],
  meta: {
    slot,
    source: { kind: "original", ref: [], license: "MIT" },
    element: { slot, reason: "director:identity.visual.style" },
    backdrop,
  },
});
const hero = () => catalogSurfaceContract("sections.hero");

describe("interactive backdrop components derive from the adopted registry (foundry-build-0048 U23)", () => {
  it("lists exactly the registry's records, in registry order, each with defaults inside its own schema", () => {
    const doc = registryJson();
    expect(INTERACTIVE_BACKDROP_COMPONENT_IDS).toEqual(doc.components.map(entry => entry.id));
    expect(INTERACTIVE_BACKDROP_COMPONENT_IDS).toEqual(["particles", "flickering-grid", "grid-pattern", "gradient-mesh"]);
    expect(INTERACTIVE_BACKDROP_COLORS).toEqual(doc.colors);
    for (const component of INTERACTIVE_BACKDROP_COMPONENT_IDS) {
      const resolved = resolveInteractiveBackdropParams({ component, params: {} });
      expect(Object.keys(resolved)).toEqual(Object.keys(doc.components.find(entry => entry.id === component)!.params));
      expect(interactiveBackdropDescriptorIssues({ component, params: resolved }), component).toEqual([]);
    }
  });

  it("holds no literal fallback: a different registry admits only its own components and params", () => {
    const custom = loadBackdropRegistry({
      schema: "clossys.backdrop-components/1",
      colors: ["primary"],
      components: [{
        id: "ripple", source: { registry: "example", item: "ripple", version: "v1", file: "ripple.tsx", copy: "src/components/partners/example/ripple.tsx", export: "Ripple" },
        motion: "static", params: { rings: { type: "number", min: 1, max: 4, integer: true, default: 2, prop: "rings" } }, ladder: { rung: "L2" },
      }],
    });
    expect(interactiveBackdropDescriptorIssues({ component: "ripple", params: { rings: 3 } }, custom)).toEqual([]);
    expect(interactiveBackdropDescriptorIssues({ component: "particles", params: {} }, custom)).toEqual([expect.stringMatching(/not one of the adopted backdrop components ripple$/)]);
    expect(interactiveBackdropDescriptorIssues({ component: "ripple", params: {} })).toEqual([expect.stringMatching(/not one of the adopted backdrop components particles, flickering-grid, grid-pattern, gradient-mesh$/)]);
    expect(resolveInteractiveBackdropParams({ component: "ripple", params: {} }, custom)).toEqual({ rings: 2 });
    expect(backdropComponentRecord("ripple", custom)?.id).toBe("ripple");
    expect(backdropComponentRecord("ripple")).toBeUndefined();
  });

  it.each([
    ["a wrong schema", (doc: Record<string, unknown>) => ({ ...doc, schema: "x/1" }), /schema is not/],
    ["no colours", (doc: Record<string, unknown>) => ({ ...doc, colors: [] }), /colors is not a list/],
    ["a duplicate id", (doc: { components: unknown[] }) => ({ ...doc, components: [...doc.components, doc.components[0]] }), /listed twice/],
    ["an animated record with no reduced-motion policy", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "particles" ? { ...entry, reducedMotion: undefined } : entry) }), /declares no reducedMotion mode/],
    ["a static record with a reduced-motion policy", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "grid-pattern" ? { ...entry, reducedMotion: { mode: "omit" } } : entry) }), /is static and carries a reducedMotion policy/],
    ["a default out of range", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "particles" ? { ...entry, params: { ...(entry.params as object), quantity: { type: "number", min: 8, max: 200, default: 900, prop: "quantity" } } } : entry) }), /default is outside 8\.\.200/],
    ["a default colour off the list", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "particles" ? { ...entry, params: { ...(entry.params as object), color: { type: "color", default: "#fff", prop: "color", as: "hex" } } } : entry) }), /not one of the registry colours/],
    ["two params on one prop", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "particles" ? { ...entry, params: { ...(entry.params as object), vx: { type: "number", min: -1, max: 1, default: 0, prop: "vy" } } } : entry) }), /already sets/],
    ["a record without a ladder", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "gradient-mesh" ? { ...entry, ladder: undefined } : entry) }), /no source-ladder record/],
    ["an incomplete registry source", (doc: { components: Record<string, unknown>[] }) => ({ ...doc, components: doc.components.map(entry => entry.id === "particles" ? { ...entry, source: { registry: "magicui", item: "particles" } } : entry) }), /source needs registry, item, version, file, copy and export/],
  ])("refuses a registry with %s", (_label, mutate, message) => {
    const findings = backdropRegistryFindings((mutate as (doc: never) => unknown)(registryJson() as never));
    expect(findings.some(finding => message.test(finding)), findings.join("; ")).toBe(true);
    expect(() => loadBackdropRegistry((mutate as (doc: never) => unknown)(registryJson() as never))).toThrow(/backdrop components registry/);
  });

  it("the shipped registry is clean, and every animated record declares its reduced-motion policy", () => {
    expect(backdropRegistryFindings(registryJson())).toEqual([]);
    for (const entry of BACKDROP_REGISTRY.components.filter(item => item.motion === "animated")) expect(entry.reducedMotion, entry.id).toBeDefined();
  });

  it("admits every in-range number and listed colour, and resolves absent params to defaults", () => {
    const valid = [
      { component: "particles", params: { color: "accent", quantity: 8, staticity: 10, ease: 100, size: 2, vx: -1, vy: 1 } },
      { component: "particles", params: { quantity: 200 } },
      { component: "gradient-mesh", params: { from: "foreground", via: "border", to: "muted-foreground", speed: 1.25, intensity: 0.1 } },
      { component: "flickering-grid", params: { color: "border", squareSize: 16, gridGap: 2, flickerChance: 1, maxOpacity: 0.05 } },
      { component: "grid-pattern", params: { color: "primary", width: 96, height: 16 } },
      { component: "flickering-grid", params: {} },
    ];
    for (const descriptor of valid) {
      expect(interactiveBackdropDescriptorIssues(descriptor), JSON.stringify(descriptor)).toEqual([]);
      expect(isInteractiveBackdropDescriptor(descriptor)).toBe(true);
    }
    expect(resolveInteractiveBackdropParams({ component: "particles", params: { quantity: 12 } }))
      .toEqual({ color: "primary", quantity: 12, staticity: 50, ease: 50, size: 0.4, vx: 0, vy: 0 });
  });

  it.each([
    ["a non-object", "flickering-grid", /not an object \{component, params\}/],
    ["a list", [{ component: "flickering-grid", params: {} }], /not an object/],
    ["an unknown descriptor key", { component: "flickering-grid", params: {}, code: "alert(1)" }, /carries "code"/],
    ["an unknown component", { component: "three-scene", params: {} }, /not one of the adopted backdrop components/],
    ["a retired hand-built component", { component: "particle-field", params: {} }, /not one of the adopted backdrop components/],
    ["an inherited name as component", { component: "constructor", params: {} }, /not one of the adopted backdrop components/],
    ["a prototype name as component", { component: "__proto__", params: {} }, /not one of the adopted backdrop components/],
    ["missing params", { component: "flickering-grid" }, /params is undefined, not an object/],
    ["params as a list", { component: "flickering-grid", params: [] }, /params is a list, not an object/],
    ["an unknown param", { component: "flickering-grid", params: { src: "x" } }, /has no param "src"/],
    ["a URL as colour", { component: "particles", params: { color: "https://example.com/a.js" } }, /not one of the token colours/],
    ["a CSS colour", { component: "particles", params: { color: "#ff0000" } }, /not one of the token colours/],
    ["a CSS expression", { component: "gradient-mesh", params: { from: "var(--color-primary)" } }, /not one of the token colours/],
    ["code as colour", { component: "flickering-grid", params: { color: "()=>fetch('/x')" } }, /not one of the token colours/],
    ["an inherited colour name", { component: "grid-pattern", params: { color: "toString" } }, /not one of the token colours/],
    ["a numeric string", { component: "particles", params: { quantity: "48" } }, /not a finite number/],
    ["NaN", { component: "particles", params: { ease: Number.NaN } }, /not a finite number/],
    ["Infinity", { component: "gradient-mesh", params: { intensity: Number.POSITIVE_INFINITY } }, /not a finite number/],
    ["below range", { component: "particles", params: { quantity: 7 } }, /outside 8\.\.200/],
    ["above range", { component: "gradient-mesh", params: { speed: 2.01 } }, /outside 0\.\.2/],
    ["a fraction for an integer", { component: "grid-pattern", params: { width: 40.5 } }, /not a whole number/],
  ])("refuses %s", (_label, descriptor, message) => {
    const issues = interactiveBackdropDescriptorIssues(descriptor);
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
    expect(isInteractiveBackdropDescriptor(descriptor)).toBe(false);
    expect(() => resolveInteractiveBackdropParams(descriptor as never)).toThrow(TypeError);
  });

  it("paints only with registry colours, each a stock theme key every backdrop surface may read", () => {
    const keys = read("styles/theme-keys.css");
    for (const surface of catalogBackdropSurfaces()) {
      const contract = catalogSurfaceContract(surface) as { allowedReads: { themes: string[] } };
      for (const color of INTERACTIVE_BACKDROP_COLORS) expect(contract.allowedReads.themes, `${surface} ${color}`).toContain(`themes.${color}`);
    }
    for (const color of INTERACTIVE_BACKDROP_COLORS) expect(keys, color).toContain(`--color-${color}:`);
  });

  it("the provenance rule points at the contracts and the registry instead of listing ids", () => {
    const rule = JSON.parse(read("src/catalog/rules/provenance.json")) as { interactiveBackdrops: { slots: unknown; components: unknown } };
    expect(rule.interactiveBackdrops.slots).toEqual({ from: ["src/catalog/slots/sections.json", "src/catalog/slots/frames.json"], placement: "backdrop" });
    expect(rule.interactiveBackdrops.components).toEqual({ from: "src/catalog/rules/backdrop-components.json" });
    const slots = JSON.parse(read("src/catalog/slots/sections.json")) as { contract: Record<string, unknown> }[];
    expect(slots.filter(slot => "interactive" in slot.contract)).toEqual([]);
  });
});

describe("a surface accepts a backdrop only when its contract declares a backdrop slot", () => {
  const section = (placement?: string) => ({ slots: [{ name: "heading", type: "text", required: true }, { name: "art", type: "media", required: false, ...(placement ? { placement } : {}) }] });
  const frame = (placement?: string) => ({ slots: [{ id: "main", required: true, accepts: ["sections"] }, { id: "ground", required: false, accepts: ["assets"], ...(placement ? { placement } : {}) }] });

  it("contractBackdropSlot names the backdrop-placed slot of a section (name) or a frame (id), else undefined", () => {
    expect(contractBackdropSlot(hero())).toBe("backdrop");
    expect(contractBackdropSlot(section("backdrop"))).toBe("art");
    expect(contractBackdropSlot(section("figure"))).toBeUndefined();
    expect(contractBackdropSlot(section())).toBeUndefined();
    expect(contractBackdropSlot(frame("backdrop"))).toBe("ground");
    expect(contractBackdropSlot(frame())).toBeUndefined();
    for (const value of [undefined, null, "x", [], { slots: "x" }, { slots: [null, { placement: "backdrop" }] }]) expect(contractBackdropSlot(value), JSON.stringify(value)).toBeUndefined();
  });

  it.each([
    ["a section that declares one (the catalog hero)", "sections.hero", () => hero(), true],
    ["a section that declares one (synthetic)", "sections.feature", () => section("backdrop"), true],
    ["a section whose media slot is a figure", "sections.media", () => section("figure"), false],
    ["a section with no media slot placed", "sections.call-to-action", () => section(), false],
    ["a frame that declares one", "frames.marketing", () => frame("backdrop"), true],
    ["a frame that declares none", "frames.app", () => frame(), false],
    ["a component (no surface contract)", "components.button", () => undefined, false],
    ["an asset (no surface contract)", "assets.logo", () => undefined, false],
  ])("%s: accepts=%s", (_label, slot, contract, accepts) => {
    const issues = interactiveBackdropMetaIssues(candidate(undefined, slot), slot, contract());
    if (accepts) expect(issues).toEqual([]);
    else expect(issues).toEqual([`meta.backdrop rides only on the code candidate of a surface whose contract declares a backdrop-placed slot; the ${slot} contract declares none`]);
  });

  it("the catalog: the hero declares its backdrop slot, the CTA (which also renders Hero) and media do not", () => {
    expect(catalogBackdropSurfaces()).toEqual(["sections.hero"]);
    for (const slot of ["sections.call-to-action", "sections.media", "frames.site-shell", "components.button"]) {
      expect(interactiveBackdropMetaIssues(candidate(undefined, slot), slot, catalogSurfaceContract(slot)), slot).toHaveLength(1);
    }
  });

  it("admits a surface candidate carrying a valid descriptor or none, on any slot", () => {
    expect(carriesInteractiveBackdrop(candidate())).toBe(true);
    expect(interactiveBackdropMetaIssues(candidate(), "sections.hero", hero())).toEqual([]);
    const { backdrop: _backdrop, ...meta } = candidate().meta;
    const plain = { ...candidate(), meta };
    expect(carriesInteractiveBackdrop(plain)).toBe(false);
    expect(interactiveBackdropMetaIssues(plain, "sections.hero", hero())).toEqual([]);
    expect(interactiveBackdropMetaIssues(plain, "components.button", undefined)).toEqual([]);
    for (const value of [null, "x", [], { meta: null }, { meta: Object.create({ backdrop: {} }) }]) expect(carriesInteractiveBackdrop(value), JSON.stringify(value)).toBe(false);
  });

  it.each([
    ["an unknown component", { component: "three-scene", params: {} }, /not one of the adopted backdrop components/],
    ["a param out of range", { component: "flickering-grid", params: { squareSize: 1 } }, /outside 2\.\.16/],
    ["a URL colour", { component: "flickering-grid", params: { color: "https://example.com/x.js" } }, /not one of the token colours/],
    ["an extra descriptor key", { component: "flickering-grid", params: {}, module: "./x.js" }, /carries "module"/],
    ["an empty value", null, /not an object \{component, params\}/],
  ])("on a declaring surface, refuses %s", (_label, backdrop, message) => {
    const issues = interactiveBackdropMetaIssues(candidate(backdrop), "sections.hero", hero());
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
  });

  it("reads only the descriptor's own keys", () => {
    expect(interactiveBackdropDescriptorIssues(Object.create({ component: "flickering-grid", params: {} }))).toEqual([expect.stringMatching(/component is undefined, not one of the adopted backdrop components/)]);
  });
});

describe("an interactive backdrop in preview props (meta.backdrop is the only channel)", () => {
  const interactive = { kind: "interactive", backdrop: { component: "particles", params: { quantity: 160 } } };
  const previewed = (preview: unknown) => ({ name: "cta", type: "registry:block", files: [], meta: { source: { kind: "original", ref: [] }, preview } });

  it("finds one at a backdrop key or in Hero's interactive shape under any key, in fixtures.props or flat fixtures", () => {
    expect(previewInteractiveBackdropIssues(previewed({ fixtures: { file: "cta.tsx", export: "Hero", props: { backdrop: interactive } } })))
      .toEqual(["meta.preview.fixtures.props.backdrop is an interactive backdrop in preview props; it rides only as meta.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot"]);
    expect(interactiveBackdropPropPaths({ fixtures: { backdrop: { kind: "interactive", backdrop: { component: "flickering-grid", params: { squareSize: 1 } } } } }))
      .toEqual(["fixtures.backdrop"]);
    expect(interactiveBackdropPropPaths({ items: [{ art: interactive }], hero: { glow: { kind: "interactive", backdrop: null } } })).toEqual(["items.0.art", "hero.glow"]);
  });

  it("leaves still backdrops and other kinds alone, and a candidate with no preview", () => {
    expect(interactiveBackdropPropPaths({ backdrop: { kind: "none" }, media: { kind: "interactive" }, art: { kind: "image", image: {} } })).toEqual([]);
    expect(previewInteractiveBackdropIssues(candidate())).toEqual([]);
    for (const value of [null, "x", [], { meta: null }, { meta: Object.create({ preview: { backdrop: interactive } }) }]) expect(previewInteractiveBackdropIssues(value), JSON.stringify(value)).toEqual([]);
  });
});
