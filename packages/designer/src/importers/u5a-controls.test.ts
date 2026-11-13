// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { rewriteShadcnAria } from "./rewrite.js";
import { generateCompiledCss } from "../compiled-css/generate.js";
import slots from "../catalog/slots/components.json" with { type: "json" };
import { generatedShadcnComponentFiles, importShadcnAriaComponents, materializeShadcnComponent, SHADCN_COMPONENT_ITEMS } from "./shadcn-aria-components.js";

const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(here, name), "utf8");
const input = () => ({ items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });
const supported: Record<string, string[]> = {
  checkbox: ["scope.single", "state.checked", "state.indeterminate", "state.invalid"],
  "radio-group": ["orientation.horizontal", "orientation.vertical", "state.invalid"],
  switch: ["state.disabled", "state.off", "state.on"],
  slider: ["orientation.horizontal", "orientation.vertical", "selection.range", "selection.single"],
  "toggle-button": ["size.lg", "size.md", "size.sm", "state.disabled", "state.focus-visible", "state.hover", "state.selected", "variant.ghost", "variant.outline"],
  "toggle-group": ["orientation.horizontal", "orientation.vertical", "selection.multiple", "selection.single"],
};
const counts: Record<string, number> = { checkbox: 1, "radio-group": 0, switch: 6, slider: 4, "toggle-button": 11, "toggle-group": 8 };

describe("six pinned control evidence surfaces", () => {
  it("declares on toggle-group the toggle focus ring its items render through the composed toggleVariants call", () => {
    const result = importShadcnAriaComponents(input());
    const group = result.fills.find(doc => doc.components["toggle-group"])!.components["toggle-group"]!;
    const toggle = result.fills.find(doc => doc.components["toggle-button"])!.components["toggle-button"]!;
    expect(group.composes).toContain("components.toggle-button");
    expect(result.rewrites["toggle-group"]!.files.find(file => file.path === "components/toggle-group/toggle-group.tsx")!.content).toMatch(/\btoggleVariants\(/);
    const inherited = toggle.reads.themes.filter(read => /^themes\.ring\./.test(read));
    expect(inherited.length).toBeGreaterThan(0);
    expect(group.reads.themes).toEqual(expect.arrayContaining(inherited));
    expect(result.fills.find(doc => doc.components.calendar)!.components.calendar!.reads.themes.filter(read => /^themes\.ring\./.test(read))).toEqual(result.rewrites.calendar!.reads.themes.filter(read => /^themes\.ring\./.test(read)));
  });
  it("binds the slider thumb's size-3 to the control mark var, leaving the track untouched, inside the slider contract", () => {
    const result = importShadcnAriaComponents(input());
    const fill = result.fills.find(doc => doc.components.slider)!.components.slider!;
    expect(fill.reads.themes).toContain("themes.ring.default");
    expect(fill.reads.themes.some(read => /control-size|focus-outline/.test(read))).toBe(false);
    const source = result.rewrites.slider!.files.find(file => file.path === "components/slider/slider.tsx")!.content;
    expect(source).toMatch(/ relative size-\(--ui-control-mark\) rounded-full /);
    expect(source).not.toMatch(/h-\(--ui-control-mark/);
    expect(slots.find(slot => slot.id === "components.slider")!.contract.allowedReads.themes).toContain("themes.ring");
  });
  it("binds the radio item's 16px box to the control mark var and keeps its focus ring, inside the radio contract", () => {
    const result = importShadcnAriaComponents(input());
    const fill = result.fills.find(doc => doc.components["radio-group"])!.components["radio-group"]!;
    expect(fill.reads.themes).toContain("themes.ring.default");
    expect(fill.reads.themes.some(read => /control-size|focus-outline/.test(read))).toBe(false);
    const source = result.rewrites["radio-group"]!.files.find(file => file.path === "components/radio-group/radio-group.tsx")!.content;
    expect(source).toContain("size-(--ui-control-mark,calc(var(--spacing)*4))");
    expect(slots.find(slot => slot.id === "components.radio-group")!.contract.allowedReads.themes).toContain("themes.ring");
  });
  it("partitions every closed contract into source-backed members and explicit gaps", () => {
    const result = importShadcnAriaComponents(input());
    for (const [leaf, members] of Object.entries(supported)) {
      const doc = result.fills.find(doc => doc.components[leaf])!;
      const fill = doc.components[leaf]!;
      const slot = slots.find(slot => slot.id === fill.slot)!;
      expect(fill.members, leaf).toEqual(members);
      expect(Object.keys(fill.propMap!), leaf).toEqual(members);
      expect(Object.values(fill.propMap!).every(pointer => typeof pointer === "string" && pointer.length > 0), leaf).toBe(true);
      expect(doc.$extensions["com.clossys.fill"].unmapped, leaf).toEqual(slot.contract.members.names!.filter(member => !members.includes(member)));
      expect([...fill.members, ...doc.$extensions["com.clossys.fill"].unmapped!].sort(), leaf).toEqual([...slot.contract.members.names!].sort());
      expect(doc.$extensions["com.clossys.fill"].status).toBe("draft");
    }
  });
  it("retains exact unresolved K4 findings and refuses unsafe materialization", () => {
    const result = importShadcnAriaComponents(input());
    for (const [leaf, count] of Object.entries(counts)) {
      const item = leaf === "toggle-button" ? "toggle" : leaf;
      expect(SHADCN_COMPONENT_ITEMS[item]).toBe(leaf);
      const rewrite = result.rewrites[item]!;
      expect(rewrite.issues, leaf).toHaveLength(count);
      expect([...new Set(rewrite.issues.map(issue => issue.code))], leaf).toEqual(count ? ["K4"] : []);
      if (count) expect(() => materializeShadcnComponent(result, item)).toThrow(/unresolved/);
      else {
        expect(leaf).toBe("radio-group");
        expect(materializeShadcnComponent(result, item)).toEqual(rewrite.files);
        const doc = result.fills.find(doc => doc.components[leaf])!;
        expect(doc.$extensions["com.clossys.fill"].evidence).toEqual([]);
        expect(doc.$extensions["com.clossys.fill"].status).toBe("draft");
      }
    }
  });
  it("renders the indeterminate checkbox as a currentColor bar before checked artwork", async () => {
    const rewrite = importShadcnAriaComponents(input()).rewrites.checkbox!;
    const code = rewrite.files.find(file => file.path === "components/checkbox/checkbox.tsx")!.content;
    const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
    const exports: { Checkbox?: React.ComponentType<Record<string, unknown>> } = {};
    const require = (name: string) => {
      if (name === "react-aria-components") return {
        Checkbox: ({ children, isSelected, isIndeterminate, ...props }: Record<string, unknown>) => React.createElement("label", props, (children as (state: unknown) => React.ReactNode)({ isSelected, isIndeterminate })),
        composeRenderProps: (children: React.ReactNode, render: (children: React.ReactNode, state: unknown) => React.ReactNode) => (state: unknown) => render(children, state),
      };
      if (name.endsWith("/icon/index")) return { Icon: ({ asset }: { asset: string }) => React.createElement("i", { "data-asset": asset }) };
      if (name.endsWith("/_parts/utils/index")) return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
      throw new Error(`Unexpected checkbox module ${name}`);
    };
    new Function("require", "exports", "React", output.outputText)(require, exports, React);
    for (const isSelected of [false, true]) for (const isIndeterminate of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(exports.Checkbox!, { isSelected, isIndeterminate }));
      if (isIndeterminate) {
        expect(html).toContain('data-slot="checkbox-indeterminate"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('border-color:currentColor');
        expect(html).toContain('w-(--spacing-sm) border-t-(length:--ui-border-hairline)');
        expect(html).not.toContain('data-asset=');
      } else {
        expect(html).not.toContain('checkbox-indeterminate');
        expect(html.includes('data-asset="assets.icon-check"')).toBe(isSelected);
      }
    }
    expect(rewrite.reads.assets).toEqual(["assets.icon-check"]);
    expect(rewrite.reads.themes).toContain("themes.spacing.default");
    expect(rewrite.issues.some(issue => issue.code === "K7")).toBe(false);
    const { css } = await generateCompiledCss({ stylesDir: resolve(here, "../../../../styles"), candidates: ["w-(--spacing-sm)", "border-t-(length:--ui-border-hairline)"] });
    expect(css).toContain("width: var(--spacing-sm)");
    expect(css).toContain("border-top-width: var(--ui-border-hairline)");
  });
  it("keeps checked and selected checkbox/switch paint bound to action ink", () => {
    const result = importShadcnAriaComponents(input());
    for (const item of ["checkbox", "switch"]) {
      const code = result.rewrites[item]!.files.map(file => file.content).join("\n");
      expect(code).toContain("data-checked:bg-(--color-action)");
      expect(code).toContain("data-selected:bg-(--color-action)");
      expect(code).not.toMatch(/(?:data-checked|data-selected):bg-\(--color-accent/);
    }
  });
  for (const item of ["checkbox", "switch"]) it(`keeps ${item} adapter output byte-exact with its golden`, () => {
    expect(importShadcnAriaComponents(input()).rewrites[item]).toEqual(JSON.parse(read(`${item}.golden.json`)));
  });
  it("regenerates the six descriptors without changing their immutable source pins", () => {
    const files = generatedShadcnComponentFiles(input());
    for (const leaf of Object.keys(supported)) expect(files[`components.${leaf}.json`]).toBe(readFileSync(resolve(here, `../../../catalog/fills/shadcn@aria/components.${leaf}.json`), "utf8"));
  });
  it("binds selected toggle paint and foreground to action without rebinding hover or other leaves", async () => {
    const content = 'const value = "data-selected:bg-muted aria-pressed:bg-muted data-[state=on]:bg-muted hover:bg-muted dark:data-selected:bg-muted not-data-selected:bg-muted"';
    for (const leaf of ["toggle-button", "toggle-group"]) {
      const result = rewriteShadcnAria({ item: "toggle", leaf, files: [{ path: "toggle.tsx", content }], styles: "", leafByItem: {} });
      const code = result.files[0]!.content;
      for (const state of ["data-selected", "aria-pressed", "data-[state=on]", "dark:data-selected"]) {
        expect(code).toContain(`${state}:bg-(--color-action)`);
        expect(code).toContain(`${state}:text-(--color-ink-on-action)`);
      }
      expect(code).toContain("hover:bg-(--color-surface-sunken)");
      expect(code).toContain("not-data-selected:bg-(--color-surface-sunken)");
      const { css } = await generateCompiledCss({ stylesDir: resolve(here, "../../../../styles"), candidates: ["data-selected:bg-(--color-action)", "data-selected:text-(--color-ink-on-action)"] });
      expect(css).toContain("background-color: var(--color-action)");
      expect(css).toContain("color: var(--color-ink-on-action)");
    }
    const other = rewriteShadcnAria({ item: "example", leaf: "checkbox", files: [{ path: "example.tsx", content }], styles: "", leafByItem: {} });
    expect(other.reads.themes).not.toContain("themes.primary.default");
  });
  it("binds only the three pinned toggle size markers to semantic control heights without theme reads", async () => {
    for (const leaf of ["toggle-button", "toggle-group"]) for (const [size, height, member] of [["sm", "7", "sm"], ["default", "8", "md"], ["lg", "9", "lg"]]) {
      const result = rewriteShadcnAria({ item: leaf === "toggle-button" ? "toggle" : leaf, leaf, files: [{ path: "toggle.tsx", content: `const value = "cn-toggle-size-${size}"` }], styles: `.cn-toggle-size-${size} { @apply h-${height}; }`, leafByItem: {} });
      expect(result.files[0]!.content).toContain(`h-(--ui-control-h-${member})`);
      expect(result.reads.themes).toEqual([]);
      expect(result.issues).toEqual([]);
      const { css } = await generateCompiledCss({ stylesDir: resolve(here, "../../../../styles"), candidates: [`h-(--ui-control-h-${member})`, `control-h-${member}`] });
      expect(css).toContain(`height: var(--ui-control-h-${member})`);
      expect(css).toContain("min-block-size: var(--ui-layout-tap-target, 44px)");
    }
    const unknown = rewriteShadcnAria({ item: "toggle", leaf: "toggle-button", files: [{ path: "toggle.tsx", content: 'const value = "cn-toggle-size-xl"' }], styles: ".cn-toggle-size-xl { @apply h-7; }", leafByItem: {} });
    expect(unknown.reads.themes).toEqual([]);
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "K4", value: "h-7" }));
  });
  it("keeps the 44px hit area for medium and large control heights", () => {
    const css = readFileSync(resolve(here, "../../../../styles/theme-keys.css"), "utf8");
    for (const size of ["md", "lg"]) expect(css).toMatch(new RegExp(`@utility control-h-${size} \\{[^}]*@apply tap-target;`));
  });
});
