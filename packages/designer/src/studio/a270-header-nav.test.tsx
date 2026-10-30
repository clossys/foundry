import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import ts from "typescript";
import { computeCopyFingerprint, createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { importFoundryFrames, loadBuildCatalog, planSurfaceDefaults } from "../catalog-core/index.js";
import { planSurfacePreviews } from "./planned-surface-previews.js";
import { createHeaderNavSpecimen, headerNavSpecimenCopy } from "./__fixtures__/a270-header-nav.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { fixtureConsumerComponents } from "../catalog-core/__fixtures__/surface-consumer-components.js";
import { componentDescriptorHash, type ComponentCandidate } from "../catalog-core/resolve-components.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../importers/shadcn-aria-components.js";

const registry: CopyRegistry = {
  id: "example-header", locale: "en", revision: "1", source: { kind: "consumer", reference: "example-header" },
  entries: Object.entries(headerNavSpecimenCopy).map(([id, text]) => ({ id, text, context: "Neutral header specimen", status: "approved",
    approval: { approvedBy: "owner", approvedAt: "2026-01-01T00:00:00Z", textFingerprint: computeCopyFingerprint(text), fingerprintAlgorithm: "sha256" } })),
};
const resolveCopy = createCopyResolver(registry, { target: "production" });
function selectedHeaderComponents() {
  const directory = resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
  const imported = importShadcnAriaComponents({
    items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  });
  const descriptor = imported.fills.find(row => row.components.button)?.components.button as ComponentCandidate;
  if (descriptor.impl.kind !== "source" || !descriptor.secondaryExports?.some(row => row.name === "LinkButton"))
    throw new Error("NEED native selected Button.LinkButton secondary export metadata");
  const files = materializeShadcnComponent(imported, "button");
  const nativeRequire = createRequire(import.meta.url), modules = new Map<string, Record<string, unknown>>();
  const load = (path: string): Record<string, unknown> => {
    const cached = modules.get(path); if (cached) return cached;
    const file = files.find(file => file.path === path); if (!file) throw new Error(`Missing native selected source ${path}`);
    const namespace: Record<string, unknown> = {}; modules.set(path, namespace);
    const require = (specifier: string) => specifier.startsWith(".") ? load(posix.normalize(posix.join(posix.dirname(path), specifier.replace(/\.js$/, "") + ".ts"))) : nativeRequire(specifier);
    const output = ts.transpileModule(file.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function("require", "exports", output)(require, namespace);
    return namespace;
  };
  const selection = fixtureConsumerComponents(), profile = selection.profile.components;
  const hash = componentDescriptorHash(descriptor);
  const origin = { kind: "adopted" as const, source: "shadcn@aria", fill: "shadcn@aria/components.button", pin: descriptor.pin, license: descriptor.license, sha256: hash, adoptedAt: "2026-01-01" };
  return { ...selection, selectionHash: hash, profile: { components: { ...profile, selectionHash: hash, files: [...profile.files, ...files], components: {
    ...profile.components, "components.button": { ...profile.components["components.button"]!, originKind: "adopted" as const, origin, impl: descriptor.impl, propMap: descriptor.propMap, descriptor },
  } } }, descriptors: { ...selection.descriptors, "components.button": hash }, modules: { ...selection.modules, [descriptor.impl.entry]: load(descriptor.impl.entry) } };
}
const draw = () => render(<ConsumerComponentProvider value={selectedHeaderComponents()}><Suspense>{createHeaderNavSpecimen(resolveCopy).render()}</Suspense></ConsumerComponentProvider>);

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("registered header navigation specimen", () => {
  it("retains the existing native Frame plan and its Studio preview", () => {
    const fills = importFoundryFrames().fills;
    const slots = loadBuildCatalog().slots.filter(row => row.id === "frames.site-header");
    const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: ["frames.site-header"], preference: ["foundry"] });
    const previews = planSurfacePreviews({ plan, fills });
    expect(previews.unrenderable).toEqual([]);
    expect(previews.previews["frames.site-header"]).toMatchObject({ slot: "frames.site-header", fill: "foundry/frames.site-header", pointer: "@clossys/designer/shell/server#SiteHeader" });
    expect(createHeaderNavSpecimen(resolveCopy).fill).toEqual(fills.find(row => row.$extensions["com.clossys.fill"].slot === "frames.site-header"));
  });

  it("renders semantic brand, current navigation and selected shadcn CTA from approved Writer refs through the registered renderer", async () => {
    const specimen = createHeaderNavSpecimen(resolveCopy);
    draw();
    const cta = await screen.findByRole("link", { name: "Get started" });
    expect(screen.getByRole("banner")).toHaveStyle({ position: "static" });
    expect(screen.getByRole("link", { name: "ExampleCo home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(cta).toHaveAttribute("href", "#start");
    expect(cta).toHaveAttribute("data-slot", "button");
    expect(cta).toHaveAttribute("data-variant", "default");
    expect(specimen.input.content.brand!.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("opens the mobile navigation with the keyboard, dismisses on Escape and restores focus", async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByRole("link", { name: "Get started" });
    const menu = screen.getByRole("button", { name: "Menu" });
    menu.focus();
    await user.keyboard("{Enter}");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveAttribute("aria-expanded", "false"));
    expect(menu).toHaveFocus();
  });

  it("fails closed when a Writer label is unresolved or loses production approval", () => {
    expect(() => createHeaderNavSpecimen(() => undefined)).toThrow();
    const unapproved: CopyRegistry = { ...registry, entries: registry.entries.map(entry => ({ ...entry, status: "draft", approval: undefined })) };
    expect(() => createHeaderNavSpecimen(createCopyResolver(unapproved, { target: "production" }))).toThrow();
  });
});
