import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import { Suspense } from "react";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SemanticContent } from "../../components/SemanticContent.js";
import { Link } from "../../components/Link.client.js";
import { Button } from "../../components/Button.js";
import { CallToAction } from "../../blocks/CallToAction.js";
import { componentDescriptorHash, type ResolvedComponents } from "../../catalog-core/resolve-components.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../../importers/shadcn-aria-components.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../component-leaf.client.js";
import { componentLeaf } from "../component-leaf.js";
import { surfaceRuntimePreview } from "../preview.js";
import { groupASectionInput } from "./group-a-dataset.js";
import fill from "../../catalog/fills/foundry/sections.call-to-action.json" with { type: "json" };
import { renderCallToActionSection } from "./call-to-action.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

let selection: ConsumerComponentSelection;
const SelectedButton = componentLeaf<typeof Button>("components.button");
const sample = specimenDataset.sections.callToAction;
afterEach(cleanup);
beforeAll(async () => {
  // Exact pinned source is transformed by the native importer and compiled for this test.
  // The saved preview profile is runtime-pending; this is not fill qualification.
  const dir = resolve(import.meta.dirname, "../../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(dir, name), "utf8");
  const imported = importShadcnAriaComponents({
    items: readdirSync(dir).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
    notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  });
  const descriptor = imported.fills.find(doc => doc.components.card)?.components.card;
  if (!descriptor || descriptor.impl.kind !== "source") throw new Error("NEED native shadcn Card source");
  const files = materializeShadcnComponent(imported, "card");
  const source = new Map(files.map(file => [file.path, file.content]));
  const cache = new Map<string, Record<string, unknown>>();
  const installed = createRequire(import.meta.url);
  function compile(path: string): Record<string, unknown> {
    const existing = cache.get(path);
    if (existing) return existing;
    const content = source.get(path);
    if (content === undefined) throw new Error(`NEED registered source ${path}`);
    const compiled = transpileModule(content, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX }, fileName: path }).outputText;
    const result: { exports: Record<string, unknown> } = { exports: {} };
    const require = (specifier: string) => {
      if (!specifier.startsWith(".")) return installed(specifier);
      const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      const match = [target, `${target}.ts`, `${target}.tsx`].find(path => source.has(path));
      if (!match) throw new Error(`NEED registered import ${specifier}`);
      return compile(match);
    };
    new Function("require", "module", "exports", compiled)(require, result, result.exports);
    cache.set(path, result.exports);
    return result.exports;
  }
  const native = compile(descriptor.impl.entry);
  const profile: ResolvedComponents = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../studio/__fixtures__/default-component-preview-profile.json"), "utf8"));
  const previous = profile.components["components.card"];
  if (!previous) throw new Error("NEED registered Card preview selection");
  profile.components = { ...profile.components, "components.card": { ...previous, descriptor, impl: descriptor.impl, propMap: descriptor.propMap } };
  profile.files = [...profile.files, ...files];
  selection = { profile: { components: profile }, selectionHash: profile.selectionHash, descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])), modules: { "@clossys/designer/components": { SemanticContent, Link, Button }, [descriptor.impl.entry]: native } };
});
function mount(node: React.ReactNode) {
  return render(<ConsumerComponentProvider value={selection}><Suspense>{node}</Suspense></ConsumerComponentProvider>);
}

describe("registered CTA band on selected native component leaves", () => {
  it("renders the Studio runtime specimen as a named section with a native Card and real links", async () => {
    const preview = surfaceRuntimePreview({ slot: "sections.call-to-action", slotMap: { header: "header", actions: "actions" } });
    if (!("render" in preview)) throw new Error(preview.reason);
    const { container } = mount(preview.render());
    const heading = await screen.findByRole("heading", { level: 2, name: sample.title });
    const region = screen.getByRole("region", { name: sample.title });
    expect(region).toContainElement(heading);
    expect(region).toHaveAccessibleDescription(sample.description);
    expect(container.querySelector('[data-slot="card"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: sample.primary.label })).toHaveAttribute("href", sample.primary.href);
    expect(screen.getByRole("link", { name: sample.secondary.label })).toHaveAttribute("href", sample.secondary.href);
    expect(region).toHaveAttribute("data-ds-leaf", "sections.call-to-action");
    await userEvent.tab();
    expect(screen.getByRole("link", { name: sample.primary.label })).toHaveFocus();
  });
  it("keeps caller-owned Button interaction and heading rank", async () => {
    let count = 0;
    mount(<CallToAction title={sample.title} description={sample.description} headingLevel={3} primaryAction={<SelectedButton onPress={() => count++}>{sample.primary.label}</SelectedButton>} />);
    expect(await screen.findByRole("heading", { level: 3, name: sample.title })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: sample.primary.label }));
    expect(count).toBe(1);
  });
  it("rejects missing caller labels and a third action before rendering", () => {
    const input = groupASectionInput("call-to-action", fill);
    const content = (actions: Record<string, import("../../catalog-core/runtime-ports.js").RuntimeJson>) => ({ ...input, content: { ...input.content, actions: { ...input.content.actions!, value: actions } } });
    expect(() => renderCallToActionSection(content({ primary: { href: "/next" } }))).toThrow(/actions.primary.label/);
    expect(() => renderCallToActionSection(content({ primary: { label: sample.primary.label, href: "/next" }, third: {} }))).toThrow(/at most one primary/);
    expect(() => renderCallToActionSection({ ...input, content: { actions: input.content.actions! } })).toThrow(/header is missing/);
  });
  it("keeps narrow action layout bounded and stacks before the tablet breakpoint", async () => {
    const { container } = mount(renderCallToActionSection(groupASectionInput("call-to-action", fill)));
    await screen.findByRole("heading", { name: sample.title });
    const row = screen.getByRole("link", { name: sample.primary.label }).parentElement;
    expect(row).toHaveClass("flex-col", "w-full", "min-w-0", "tablet:flex-row", "tablet:flex-wrap");
    expect(container.querySelector("section")).toHaveClass("min-w-0", "w-full");
  });
});
