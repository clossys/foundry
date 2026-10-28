/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { publisherCopyFixtureResolver } from "./publisher/__fixtures__/writer-copy.js";
import { DesignerRoutePage, PublisherRoutePage } from "@clossys/publisher/web/registered-route";
import { emitCompleteRoutePage } from "./registered-route-source.js";
import { createWholeStudioInitialSession } from "@clossys/designer/studio/queries";
import { designerRouteServerData, routeBreakpointPixels } from "@clossys/designer/studio/route/server";
import type { DesignerRoutePageProps, DesignerRouteServerData } from "@clossys/designer/studio/route";
import type { PublisherRoutePageProps, PublisherRouteServerData } from "@clossys/publisher/web/registered-route";
import { loadBuildCatalog, planSurfaceRuntime, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent, RuntimeJson, SurfacePackageEvidence } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { packageSurfaceLibrary } from "../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { FIXTURE_INSTANCE_REGISTRIES } from "./instances/__fixtures__/standard-instances.js";
import { createM1ExampleDraft } from "./publisher/__fixtures__/example-plan.js";
import { installFrameTestEnvironment } from "./publisher/__fixtures__/frame-test-environment.js";

let realPublisher: PublisherRouteServerData["publisher"] | undefined;
let data: DesignerRouteServerData, initialSession: NonNullable<DesignerRoutePageProps["initialSession"]>;
// Generated consumer module loading is tracked separately.
// These focused tests exercise public component imports directly.
const Consumer = { DesignerConsumer: DesignerRoutePage, PublisherConsumer: PublisherRoutePage };
beforeAll(async () => {
  if (process.env.COMPLETE_ROUTE_REAL_DATA) {
    const payload = JSON.parse(await readFile(process.env.COMPLETE_ROUTE_REAL_DATA, "utf8"));
    data = payload.serverData; initialSession = payload.initialSession; realPublisher = payload.publisher;
    return;
  }
  // Full real shipped catalog and package-pointer adoption through the disk reader.
  // Fixture content is explicitly local test data, never actual consumer adoption evidence.
  const fixture = await packageSurfaceLibrary();
  const modulePointer = (module: string) => ({ frames: { pointer: { impl: { kind: "package", module } } } });
  const modules = await readSurfacePackageEvidence([modulePointer("@clossys/designer/frames"), modulePointer("@clossys/designer/shell")] as Parameters<typeof readSurfacePackageEvidence>[0]);
  const packages: SurfacePackageEvidence[] = [...fixture.packages.filter(row => !modules.some(module => module.module === row.module)), ...modules];
  const snapshot = { library: fixture.library, surfaceOptions: { ...fixture.options, packages } };
  const engine = { catalog: fixture.catalog, ...snapshot };
  const planned = planSurfaceRuntime({ engine, packages, leaves: ["frames.app-shell"], renderers: { "frames.app-shell": { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" } } });
  expect(planned.gaps).toEqual([]);
  const frame = planned.manifest.fills[0]!;
  const values: Record<string, RuntimeJson> = {
    sidebar: { brand: { name: "Example", markSrc: "/mark.svg" }, tree: [{ id: "home", label: "Home", href: "/home" }], account: { signedOutLabel: "Signed out", sections: [] } },
    command: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "No commands", groups: [], shortcutEnabled: false },
  };
  const contents: RuntimeContent[] = Object.entries(values).map(([slot, value]) => ({ reference: { kind: "records", ref: `example.frame/${slot}` }, value, hash: runtimeHash(value) }));
  data = designerRouteServerData({ catalog: fixture.catalog, snapshot, manifest: planned.manifest, cell: { theme: "light", state: "default", width: 1024 }, frame: { leaf: frame.leaf, fill: frame.fill, config: frame.config, members: [], content: Object.fromEntries(contents.map(row => [row.reference.ref.split("/").at(-1)!, row.reference])) }, contents, header: { id: "example-designer", data: { title: "Designer", nav: { label: "Designer layers", activeId: "tokens", items: ["tokens", "assets", "components", "sections", "frames"].map(id => ({ id, label: id, href: `?layer=${id}` })) } } } });
  initialSession = createWholeStudioInitialSession({ id: "example-original-route-session", catalog: fixture.catalog, snapshot });
}, 120000);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.style.fontSize = ""; window.history.replaceState(null, "", "/"); });
function environment() { installFrameTestEnvironment(); document.documentElement.style.fontSize = "18px"; }
it("mounts the public Designer component through all five original layers", async () => {
  environment();
  const errors = vi.spyOn(console, "error");
  for (const layer of ["tokens", "assets", "components", "sections", "frames"]) {
    window.history.replaceState(null, "", `/?layer=${layer}`);
    const view = render(<Consumer.DesignerConsumer serverData={data} initialSession={JSON.parse(JSON.stringify(initialSession))} />);
    await act(async () => {});
    const root = view.container.querySelector('[data-route-display="designer"]');
    expect(root, view.container.textContent?.slice(0, 500)).toHaveAttribute("data-route-layer", layer);
    expect(root).toHaveAttribute("data-route-session", initialSession.id);
    expect(root).toHaveAttribute("data-route-authentication", "unverified");
    expect(view.container.querySelector("[data-studio-canvas]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Designer", exact: true })).toBeVisible();
    cleanup();
  }
  expect(errors.mock.calls).toEqual([]);
}, 120000);
it("keeps first-render rem thresholds pending, then uses the actual mounted root font size", async () => {
  environment();
  const html = renderToString(<Consumer.DesignerConsumer serverData={data} initialSession={initialSession} />);
  expect(html).toContain("Measuring Designer breakpoints");
  expect(html).not.toContain('data-route-display="designer"');
  const view = render(<Consumer.DesignerConsumer serverData={data} initialSession={initialSession} />);
  await act(async () => {});
  expect(view.container.querySelector('[data-route-display="designer"]')).not.toBeNull();
  const profile = resolve({ catalog: { ...data.catalog, surfaces: data.catalog.surfaces && { ...data.catalog.surfaces, transforms: [], rules: [] } }, library: data.snapshot.library, surfaceOptions: data.snapshot.surfaceOptions, componentOptions: data.snapshot.componentOptions });
  const rem = Object.entries(profile.values.members).find(([id, member]) => id.startsWith("tokens.breakpoint.") && member.value.light && typeof member.value.light === "object" && "unit" in member.value.light && member.value.light.unit === "rem");
  expect(rem).toBeDefined();
  expect(routeBreakpointPixels(profile)[rem![0]]).toBeUndefined();
  const remValue = rem![1].value.light as { value: number; unit: "rem" };
  expect((view.container.querySelector('[data-route-display="designer"]') as HTMLElement).style.getPropertyValue(`--breakpoint-${rem![0].slice("tokens.breakpoint.".length)}`)).toBe(`${remValue.value * 18}px`);
}, 30000);
it("mounts Publisher with original workspace heading and actual channel content", async () => {
  environment();
  const publisher: PublisherRouteServerData = { ...data, publisher: realPublisher ?? { instances: [], fills: [], registries: FIXTURE_INSTANCE_REGISTRIES, designerHref: "/designer", draftPlan: createM1ExampleDraft() } };
  const errors = vi.spyOn(console, "error");
  const view = render(<Consumer.PublisherConsumer serverData={publisher} initialSession={initialSession} copyResolver={publisherCopyFixtureResolver} />);
  await act(async () => {});
  expect(view.container.querySelector('[data-route-display="publisher"]')).toHaveAttribute("data-route-authentication", "unverified");
  expect(screen.getAllByRole("heading", { level: 1 }).map(node => node.textContent)).toEqual(["Publisher"]);
  expect(within(screen.getByRole("navigation", { name: "Publisher delivery channels" })).getByRole("link", { name: realPublisher ? "Admin" : "Site" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Publisher workspace" })).toBeVisible();
  expect(errors.mock.calls).toEqual([]);
}, 30000);
it("refuses a missing, changed or foreign initial session and tampered frame identity", () => {
  environment();
  for (const input of [undefined, { ...initialSession, snapshotHash: "sha256:invalid" }]) {
    const view = render(<Consumer.DesignerConsumer serverData={data} initialSession={input} />);
    expect(view.container.querySelector('[data-route-display="designer"]')).toBeNull();
    cleanup();
  }
  const foreign = { ...data, snapshot: { ...data.snapshot, library: { ...data.snapshot.library, source: { ...data.snapshot.library.source, id: "foreign" } } } };
  for (const serverData of [foreign, { ...data, frame: { ...data.frame, fill: "foreign/frame" } }, { ...data, cell: { ...data.cell, width: 0 } }]) {
    const view = render(<Consumer.DesignerConsumer serverData={serverData} initialSession={initialSession} />);
    expect(screen.getByRole("alert")).toHaveTextContent("initial data does not match");
    expect(view.container.querySelector('[data-studio-canvas]')).toBeNull(); cleanup();
  }
});

it("changes the active original Designer layer after mount without replacing its session", async () => {
  environment();
  const errors = vi.spyOn(console, "error");
  const view = render(<Consumer.DesignerConsumer serverData={data} initialSession={initialSession} />);
  await act(async () => {});
  const root = view.container.querySelector('[data-route-display="designer"]')!;
  expect(root).toHaveAttribute("data-route-layer", "tokens");
  await act(async () => { window.history.pushState(null, "", "/?layer=components"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(view.container.querySelector('[data-route-display="designer"]')).toBe(root);
  expect(root).toHaveAttribute("data-route-layer", "components");
  expect(root).toHaveAttribute("data-route-session", initialSession.id);
  expect(errors.mock.calls).toEqual([]);
}, 30000);

it("emits only a server loader and the two complete component props", () => {
  for (const kind of ["designer", "publisher"] as const) {
    const component = kind === "designer" ? "DesignerRoutePage" : "PublisherRoutePage";
    const source = emitCompleteRoutePage({ kind, file: "src/app/page.tsx", loader: { file: "src/data.ts", export: "loadData" } });
    expect(source).toBe([
      `import { ${component} } from "@clossys/publisher/web/registered-route";`,
      'import { loadData as loadRouteData } from "../data.ts";',
      'const metadata = {"robots":"noindex, nofollow","twitter":{"card":"summary"}};',
      "export { metadata };",
      "export default async function CompletePage() {",
      "  const data = await loadRouteData();",
      `  return <${component} serverData={data.serverData} initialSession={data.initialSession} />;`,
      "}", "",
    ].join("\n"));
    expect(source).not.toMatch(/useRuntime|Provider|controller|registry=/);
  }
  expect(() => emitCompleteRoutePage({ kind: "other", file: "page.tsx", loader: { file: "data.ts", export: "load" } } as never)).toThrow();
  expect(() => emitCompleteRoutePage({ kind: "designer", file: "../page.tsx", loader: { file: "data.ts", export: "load" } })).toThrow();
  expect(() => emitCompleteRoutePage({ kind: "designer", file: "page.tsx", loader: { file: "data.ts", export: "bad-export" } })).toThrow();
});
it("converts rem only from a selected declared root token or actual measurements", () => {
  const profile = { values: { members: {
    "tokens.breakpoint.large": { value: { light: { value: 48, unit: "rem" } } },
    "tokens.typography.root": { value: { light: { value: 20, unit: "px" } } },
  } } } as Parameters<typeof routeBreakpointPixels>[0];
  expect(routeBreakpointPixels(profile)).toEqual({});
  expect(routeBreakpointPixels(profile, "tokens.typography.root")).toEqual({ "tokens.breakpoint.large": 960 });
  expect(routeBreakpointPixels(profile, "tokens.missing")).toEqual({});
  expect(routeBreakpointPixels(profile, undefined, { "tokens.breakpoint.large": 864 })).toEqual({ "tokens.breakpoint.large": 864 });
});
it("refuses a tampered Publisher frame before rendering its workspace", () => {
  environment();
  const publisher = { ...data, publisher: realPublisher ?? { instances: [], fills: [], registries: FIXTURE_INSTANCE_REGISTRIES, designerHref: "/designer", draftPlan: createM1ExampleDraft() } };
  for (const serverData of [{ ...publisher, frame: { ...publisher.frame, fill: "foreign/frame" } }, { ...publisher, manifest: { ...publisher.manifest, selectionHash: "sha256:foreign" } }]) {
    const view = render(<Consumer.PublisherConsumer serverData={serverData} initialSession={initialSession} />);
    expect(screen.getByRole("alert")).toHaveTextContent("initial data does not match");
    expect(screen.queryByRole("region", { name: "Publisher workspace" })).toBeNull(); cleanup();
  }
});
