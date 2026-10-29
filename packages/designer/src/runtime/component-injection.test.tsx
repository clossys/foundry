import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { componentDescriptorHash, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { selectedRuntime } from "../importers/__fixtures__/selected-runtime.js";
import * as foundry from "../components/index.js";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";
import { specimenDataset } from "../studio/specimen-dataset.js";
import { surfaceRuntimeCallbacks as serverCallbacks } from "./server-registry.js";
import { surfaceRuntimeCallbacks, surfaceRuntimeRenderers, surfaceRendererId } from "./index.js";

const bundles = loadCatalogBundles();
const document = bundles.componentFills.find(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria" && Object.values(doc.components)[0]!.slot === "components.button")!;
const descriptor = Object.values(document.components)[0]!;
const profile = {
  consumer: "runtime-injection", selectionHash: `sha256:${"0".repeat(64)}`,
  components: { "components.button": { slot: descriptor.slot, originKind: "adopted", origin: { kind: "adopted", source: descriptor.source, fill: document.$extensions["com.clossys.fill"].id, pin: descriptor.pin, license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-29" }, impl: descriptor.impl, propMap: descriptor.propMap, reads: { tokens: {}, assets: descriptor.reads.assets, components: descriptor.reads.components }, descriptor } },
  files: bundles.sourceBundles.find(bundle => bundle.slot === "components.button")!.files,
  check: { ok: true, findings: [] }, packageExports: { clsx: ["clsx"], "tailwind-merge": ["twMerge"], "class-variance-authority": ["cva", "VariantProps"], react: ["ComponentProps", "forwardRef"], "react-aria-components": ["Button", "Link", "ButtonProps", "LinkProps", "composeRenderProps"] },
} as unknown as ResolvedComponents;
// The real emitter and pinned source loader; no replacement Button implementation or hand-stamped DOM.
const files = emitComponents(profile, ["component-index"]);
const emitted = selectedRuntime(files).load("component-index.ts") as Record<string, unknown>;
const components = { ...foundry, Logo: foundry.Logomark, ...emitted };
function input(leaf: string, index: Record<string, unknown> = components): RuntimeRenderInput<ReactNode> {
  const entry = surfaceRuntimeRenderers[leaf]!;
  const sample = entry.sample(specimenDataset);
  return {
    components: index, path: leaf.startsWith("frames.") ? "frame" : "sections.main.0",
    fill: { leaf, slots: Object.keys(sample), members: [] }, selection: { leaf, members: [], content: {} },
    content: Object.fromEntries(Object.entries(sample).map(([slot, value]) => [slot, { value }])),
    cell: { theme: "light", state: "default", width: 1280 }, slots: { main: ["Body"] }, profile: {},
    host: { navigate() {}, themeControl: null, theme: { preference: "light" } },
  } as unknown as RuntimeRenderInput<ReactNode>;
}
function draw(leaf: string, value = input(leaf)) {
  const callback = surfaceRuntimeCallbacks([leaf])[surfaceRendererId(leaf)]!;
  return render(<ShellCopyProvider resolver={shellCopyFixtureResolver}>{callback(value)}</ShellCopyProvider>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("consumer runtime component injection", () => {
  it("renders a Section action through the actual emitted shadcn@aria index", () => {
    const value = input("sections.empty-state");
    draw("sections.empty-state", { ...value, content: { ...value.content, actions: { value: { label: "Create a record" } } } } as RuntimeRenderInput<ReactNode>);
    const button = screen.getByRole("button", { name: "Create a record" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveAttribute("data-ds-leaf", "components.button");
    expect(button).toHaveAttribute("data-ds-fill", "shadcn@aria/components.button");
  });
  it("forwards the selected index into AppFrame chrome and its nested blocks", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    draw("frames.app-shell");
    const button = await screen.findByRole("button", { name: specimenDataset.frames.app.commands.triggerLabel });
    expect(button.closest('[data-application-navigation-region="header"]')).not.toBeNull();
    expect(button.closest('[data-application-frame-region="navigation"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("data-ds-fill", "shadcn@aria/components.button");
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-ds-fill", "shadcn@aria/components.button");
  });
  it("forwards the index into a native server frame and refuses its missing exports", () => {
    const callback = serverCallbacks(["frames.auth-shell"])[surfaceRendererId("frames.auth-shell")]!;
    const selected = { ...components, SemanticContent: ({ as, ...props }: Record<string, unknown>) => createElement(as as string, { ...props, "data-selected-semantic": "consumer" }) };
    const value = input("frames.auth-shell", selected);
    render(<>{callback(value)}</>);
    expect(screen.getByRole("main")).toHaveAttribute("data-selected-semantic", "consumer");
    cleanup();
    const { SemanticContent: _removed, ...missing } = selected;
    expect(() => render(<>{callback({ ...value, components: missing })}</>)).toThrow(/selected component.*SemanticContent/i);
    expect(() => callback({ ...value, components: undefined })).toThrow(/component index/i);
  });
  it("refuses an absent consumer index and a missing selected export", () => {
    const callback = surfaceRuntimeCallbacks(["sections.empty-state"])[surfaceRendererId("sections.empty-state")]!;
    expect(() => callback({ ...input("sections.empty-state"), components: undefined })).toThrow(/component index/i);
    const { Button: _removed, ...missingButton } = components;
    const value = input("sections.empty-state", missingButton);
    expect(() => draw("sections.empty-state", { ...value, content: { ...value.content, actions: { value: { label: "Create a record" } } } } as RuntimeRenderInput<ReactNode>)).toThrow(/selected component.*Button/i);
  });
});
