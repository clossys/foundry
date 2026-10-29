/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyLibraryChange, emit, libraryHash, planSurfaceRuntime, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { BuildCatalogData, ConsumerRuntimePorts, RuntimeContent, RuntimeJson, RuntimeRenderInput } from "@clossys/designer/catalog";
import { designerRouteServerData } from "@clossys/designer/studio/route/server";
import { createWholeStudioInitialSession } from "@clossys/designer/studio/queries";
import type { DesignerRoutePageProps, DesignerRouteServerData } from "@clossys/designer/studio/route";
import { getAdminCopy } from "@clossys/writer/admin-copy";
import { loadCatalogBundles } from "../../../designer/dist/catalog-bundles.js";
import { packageBarrelExports } from "../../../designer/dist/library-cli/surface-package-evidence.js";
import { packageSurfaceLibrary } from "../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { selectedRuntime } from "../../../designer/dist/importers/__fixtures__/selected-runtime.js";
import { PublisherRoutePage } from "./publisher/PublisherRoutePage.js";
import { WriterRoutePage } from "./writer/WriterRoutePage.js";
import { FIXTURE_INSTANCE_REGISTRIES } from "./instances/__fixtures__/standard-instances.js";
import { installFrameTestEnvironment } from "./publisher/__fixtures__/frame-test-environment.js";

const observed = vi.hoisted(() => {
  const ports: ConsumerRuntimePorts<ReactNode>[] = [];
  const inputs: RuntimeRenderInput<ReactNode>[] = [];
  return { ports, inputs };
});
vi.mock("@clossys/designer/catalog", async importOriginal => {
  const actual = await importOriginal<typeof import("@clossys/designer/catalog")>();
  return { ...actual, checkConsumerRuntimePorts(ports: ConsumerRuntimePorts<ReactNode>, catalog: BuildCatalogData, expected: { consumer: string; libraryHash: string; selectionHash: string }) {
    observed.ports.push(ports);
    return actual.checkConsumerRuntimePorts(ports, catalog, expected);
  } };
});
vi.mock("@clossys/designer/frames", async importOriginal => {
  const actual = await importOriginal<typeof import("@clossys/designer/frames")>();
  // Observe the route's renderer boundary; the selected Section below executes
  // the original renderer separately, with the exact index captured here.
  return { ...actual, surfaceRuntimeCallbacks(leaves: readonly string[]) {
    return Object.fromEntries(leaves.map(leaf => [actual.surfaceRendererId(leaf), (input: RuntimeRenderInput<ReactNode>) => { observed.inputs.push(input); return null; }]));
  } };
});
let data: DesignerRouteServerData;
let initialSession: NonNullable<DesignerRoutePageProps["initialSession"]>;
let components: ConsumerRuntimePorts<ReactNode>["components"];
let drawAction: (input: RuntimeRenderInput<ReactNode>) => ReactNode;

beforeAll(async () => {
  const fixture = await packageSurfaceLibrary();
  const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
  const shell = await readFile(join(fixtureDirectory, "../../../designer/dist/shell/index.js"), "utf8");
  const manifest = JSON.parse(await readFile(join(fixtureDirectory, "../../../designer/package.json"), "utf8"));
  const inventory = packageBarrelExports(shell);
  const packages = [...fixture.packages, { module: "@clossys/designer/shell", version: manifest.version,
    artifactSha256: createHash("sha256").update(shell).digest("hex"), values: inventory.values, types: inventory.types }];
  const surfaceOptions = { ...fixture.options, packages };
  const bundles = loadCatalogBundles();
  const button = bundles.componentFills.find(document => document.$extensions["com.clossys.fill"].source === "shadcn@aria" && document.$extensions["com.clossys.fill"].slot === "components.button")!;
  const catalog = { ...fixture.catalog, components: { ...fixture.catalog.components, fills: [button] } };
  const componentOptions = { packageExports: {
    clsx: ["clsx"], "tailwind-merge": ["twMerge"], "class-variance-authority": ["cva", "VariantProps"],
    react: ["ComponentProps", "forwardRef"],
    "react-aria-components": ["Button", "Link", "ButtonProps", "LinkProps", "composeRenderProps"],
  } };
  const library = applyLibraryChange(catalog, fixture.library, {
    baseHash: libraryHash(fixture.library),
    changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "shadcn@aria" } }],
    bundles: bundles.sourceBundles,
  }, { componentOptions, surfaceOptions });
  const snapshot = { library, componentOptions, surfaceOptions };
  const engine = { catalog, ...snapshot };
  const profile = resolve(engine);
  // Emit from the same resolved library used by the manifest and initial session.
  // No raw component namespace or standalone preview index is merged into it.
  const files = emit(profile, ["component-index", "components-consumption"]);
  const consumption = JSON.parse(files.find(file => file.path === "components-consumption.json")!.contents);
  expect(consumption.consumer).toBe(library.source.id);
  expect(consumption.selectionHash).toBe(profile.selectionHash);
  components = selectedRuntime(files.map(file => ({ path: file.path, content: file.contents }))).load("component-index.ts");
  const leaves = ["frames.app-shell", "sections.data-table", "sections.record-detail", "sections.notices"];
  const planned = planSurfaceRuntime({ engine, packages, leaves, renderers: Object.fromEntries(leaves.map(leaf => [leaf, { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" }])) });
  expect(planned.gaps).toEqual([]);
  const frame = planned.manifest.fills.find(fill => fill.leaf === "frames.app-shell")!;
  const values: Record<string, RuntimeJson> = {
    sidebar: { brand: { name: "Example", markSrc: "/mark.svg" }, tree: [{ id: "home", label: "Home", href: "/home" }], account: { signedOutLabel: "Signed out", sections: [] } },
    command: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "No commands", groups: [], shortcutEnabled: false },
  };
  const contents: RuntimeContent[] = Object.entries(values).map(([slot, value]) => ({ reference: { kind: "records", ref: `example.frame/${slot}` }, value, hash: runtimeHash(value) }));
  data = designerRouteServerData({ catalog, snapshot, manifest: planned.manifest,
    cell: { theme: "light", state: "default", width: 1024 },
    frame: { leaf: frame.leaf, fill: frame.fill, config: frame.config, members: [], content: Object.fromEntries(contents.map(row => [row.reference.ref.split("/").at(-1)!, row.reference])) },
    contents, header: { id: "route-component-binding", data: { title: "Example" } },
  });
  initialSession = createWholeStudioInitialSession({ id: "route-component-binding", catalog, snapshot });
  const actual = await vi.importActual<typeof import("@clossys/designer/frames")>("@clossys/designer/frames");
  drawAction = actual.surfaceRuntimeCallbacks(["sections.empty-state"])[actual.surfaceRendererId("sections.empty-state")]!;
}, 120_000);
afterEach(() => { cleanup(); observed.ports.length = 0; observed.inputs.length = 0; vi.unstubAllGlobals(); document.documentElement.style.fontSize = ""; });

it.each(["publisher", "writer"] as const)("binds %s to its actual emitted index and preserves missing-export refusal", route => {
  installFrameTestEnvironment();
  document.documentElement.style.fontSize = "18px";
  const page = route === "publisher"
    ? <PublisherRoutePage components={components} serverData={{ ...data, publisher: { instances: [], fills: [], registries: FIXTURE_INSTANCE_REGISTRIES, designerHref: "/designer" } }} initialSession={initialSession} />
    : <WriterRoutePage components={components} serverData={{ ...data, writer: { copy: getAdminCopy() } }} initialSession={initialSession} />;
  render(page);
  expect(observed.ports.length).toBeGreaterThan(0);
  expect(observed.inputs.length).toBeGreaterThan(0);
  for (const ports of observed.ports) {
    expect(ports.components).toBe(components);
    expect(ports.manifest.consumer).toBe(data.snapshot.library.source.id);
    expect(ports.manifest.selectionHash).toBe(data.manifest.selectionHash);
  }
  const captured = observed.inputs.at(-1)!;
  expect(captured.components).toBe(components);
  expect(captured.profile.consumer).toBe(data.snapshot.library.source.id);
  expect(captured.profile.selectionHash).toBe(data.manifest.selectionHash);
  cleanup();
  const action: RuntimeRenderInput<ReactNode> = { ...captured, path: "sections.main.0",
    fill: { ...captured.fill, leaf: "sections.empty-state" },
    selection: { leaf: "sections.empty-state", members: [], content: {} },
    content: { header: { reference: { kind: "records", ref: "empty-heading" }, value: { heading: "No records" }, hash: runtimeHash({ heading: "No records" }) }, actions: { reference: { kind: "records", ref: "create" }, value: { label: "Create a record" }, hash: runtimeHash({ label: "Create a record" }) } },
  };
  render(<>{drawAction(action)}</>);
  const button = screen.getByRole("button", { name: "Create a record" });
  expect(button).toHaveAttribute("data-slot", "button");
  expect(button).toHaveAttribute("data-ds-leaf", "components.button");
  expect(button).toHaveAttribute("data-ds-fill", "shadcn@aria/components.button");
  cleanup();
  const { Button: _removed, ...missing } = components;
  expect(() => render(<>{drawAction({ ...action, components: missing })}</>)).toThrow(/selected component.*Button/i);
});
