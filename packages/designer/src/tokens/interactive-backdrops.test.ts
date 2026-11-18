// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_BACKDROP_COLORS,
  INTERACTIVE_BACKDROP_COMPONENT_IDS,
  INTERACTIVE_BACKDROP_COMPONENTS,
  INTERACTIVE_BACKDROP_ITEM_KEYS,
  INTERACTIVE_BACKDROP_ITEM_TYPE,
  INTERACTIVE_BACKDROP_KIND,
  INTERACTIVE_BACKDROP_META_KEYS,
  INTERACTIVE_BACKDROP_SOURCE_KEYS,
  interactiveBackdropCandidateIssues,
  interactiveBackdropEnvelopeIssues,
  interactiveBackdropDescriptorIssues,
  isInteractiveBackdropDescriptor,
  resolveInteractiveBackdropParams,
} from "./interactive-backdrops.js";

const packageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(packageRoot, path), "utf8");

const candidate = (backdrop: unknown = { component: "grid-glow", params: { cell: 32 } }) => ({
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "hero-grid-glow",
  type: "registry:block",
  files: [],
  meta: {
    slot: "sections.hero",
    source: { kind: INTERACTIVE_BACKDROP_KIND, ref: [], license: "MIT" },
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
    expect(rule.interactiveBackdrops.slots).toEqual(["sections.hero"]);
    expect(rule.interactiveBackdrops.components).toEqual([...INTERACTIVE_BACKDROP_COMPONENT_IDS]);
    const slots = JSON.parse(read("src/catalog/slots/sections.json")) as { id: string; contract: { interactive?: { components: string[] } } }[];
    expect(slots.filter(slot => slot.contract.interactive).map(slot => slot.id)).toEqual(["sections.hero"]);
    expect(slots.find(slot => slot.id === "sections.hero")!.contract.interactive!.components).toEqual([...INTERACTIVE_BACKDROP_COMPONENT_IDS]);
  });
});

describe("interactive backdrop candidate (the registry item a consumer pins)", () => {
  it("admits a descriptor-only item", () => {
    expect(interactiveBackdropCandidateIssues(candidate())).toEqual([]);
  });

  it.each([
    ["code in files", (item: ReturnType<typeof candidate>) => ({ ...item, files: [{ path: "backdrop.tsx", type: "registry:block", content: "export default () => null" }] }), /carries files/],
    ["no files list", (item: ReturnType<typeof candidate>) => { const { files: _files, ...rest } = item; return rest; }, /carries files/],
    ["an installer key", (item: ReturnType<typeof candidate>) => ({ ...item, dependencies: ["three"] }), /carries dependencies/],
    ["global css", (item: ReturnType<typeof candidate>) => ({ ...item, css: { body: {} } }), /carries css/],
    ["another type", (item: ReturnType<typeof candidate>) => ({ ...item, type: "registry:ui" }), /type is "registry:ui"/],
    ["an extra meta key", (item: ReturnType<typeof candidate>) => ({ ...item, meta: { ...item.meta, refVerbatim: { files: {} } } }), /meta carries refVerbatim/],
    ["an extra source key", (item: ReturnType<typeof candidate>) => ({ ...item, meta: { ...item.meta, source: { ...item.meta.source, hash: "sha256:0" } } }), /meta\.source carries hash/],
    ["a cited ref", (item: ReturnType<typeof candidate>) => ({ ...item, meta: { ...item.meta, source: { ...item.meta.source, ref: ["shadcn/hero@1.0.0"] } } }), /not \[\]: it adopts and cites nothing/],
    ["another kind", (item: ReturnType<typeof candidate>) => ({ ...item, meta: { ...item.meta, source: { ...item.meta.source, kind: "original" } } }), /kind is "original", not interactive-backdrop/],
    ["no descriptor", (item: ReturnType<typeof candidate>) => { const { backdrop: _backdrop, ...meta } = item.meta; return { ...item, meta }; }, /no meta\.backdrop descriptor/],
    ["an invalid descriptor", () => candidate({ component: "grid-glow", params: { cell: 4 } }), /outside 16\.\.96/],
    ["no meta", (item: ReturnType<typeof candidate>) => ({ ...item, meta: undefined }), /no meta object/],
  ])("refuses %s", (_label, mutate, message) => {
    const issues = interactiveBackdropCandidateIssues(mutate(candidate()));
    expect(issues.some(issue => message.test(issue)), issues.join("; ")).toBe(true);
  });

  it("refuses a value that is not an object", () => {
    expect(interactiveBackdropCandidateIssues(null)).toEqual(["the interactive backdrop is not a registry item object"]);
  });
});

describe("interactive backdrop envelope parity with the ref-verbatim gate", () => {
  it("the gate's plain-JS envelope keeps the same keys and messages", async () => {
    const gate = await import("../../scripts/check-ref-verbatim.mjs");
    expect(gate.INTERACTIVE_BACKDROP_KIND).toBe(INTERACTIVE_BACKDROP_KIND);
    expect([...gate.INTERACTIVE_ITEM_KEYS]).toEqual([...INTERACTIVE_BACKDROP_ITEM_KEYS]);
    expect([...gate.INTERACTIVE_META_KEYS]).toEqual([...INTERACTIVE_BACKDROP_META_KEYS]);
    expect([...gate.INTERACTIVE_SOURCE_KEYS]).toEqual([...INTERACTIVE_BACKDROP_SOURCE_KEYS]);
    expect(gate.INTERACTIVE_ITEM_TYPE).toBe(INTERACTIVE_BACKDROP_ITEM_TYPE);
    const item = candidate();
    const cases: unknown[] = [
      null, [], item,
      { ...item, files: [{ path: "x.tsx" }], css: {}, type: "registry:ui" },
      { ...item, meta: undefined },
      { ...item, meta: { ...item.meta, source: "x", refVerbatim: {} } },
      { ...item, meta: { ...item.meta, source: { kind: "original", ref: ["a"], hash: "h" } } },
    ];
    for (const value of cases) expect(gate.interactiveEnvelopeIssues(value), JSON.stringify(value)).toEqual(interactiveBackdropEnvelopeIssues(value));
  });
});
