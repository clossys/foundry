/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext, useContext, useState, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame, ShellCopyProvider, SHELL_COPY_REFS } from "@clossys/designer/frames";
import type { ShellCopyResolver } from "@clossys/designer/frames";
import { PageHeaderModule } from "@clossys/designer/shell";
import { LibraryBoardSection } from "@clossys/designer/blocks";
import { labels as boardLabels } from "../../../designer/dist/studio/__fixtures__/studio.js";
import { loadBuildCatalog, runtimeHash, resolve, runtimeAssemblyCells, libraryHash, runRuntimeAssemblyEvidence, prepareRuntimeAssembly } from "@clossys/designer/catalog";
import { RegisteredRoutePage, RegisteredRouteProjectionPage, prepareRegisteredRoute, prepareRegisteredRouteFromNode, prepareRegisteredRouteProjection } from "./registered-route.js";
import type { PlainRegisteredRouteProjection, RegisteredRouteRuntime } from "./registered-route.js";
import type { FlowInstanceBinding } from "../core/instance-binding.js";
import { plainRouteProjectionRegistry } from "../core/route-projection.js";
import { deriveRouteRuntimeBinding } from "../core/route-runtime.js";
import { routeRegistryDigest, routeCompositionDigest } from "../core/route-registry.js";
import { isCurrentRegisteredRouteSourceEvidence, recordRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import { beginRegisteredRouteNodeTransaction, issueRegisteredRouteNodeCurrent, registeredRouteNodeCurrentSnapshot } from "../core/route-node-current.js";
import { deriveRegisteredRouteLifecycle, registeredRouteLifecycleStatus } from "../core/route-lifecycle.js";
import type { RegisteredRouteNodeCurrentContext } from "../core/route-lifecycle.js";
import { recordRouteRuntimeMaterialization } from "../core/route-runtime.js";
import { PublisherPlanStore } from "../planning/change-set.js";
import { syntheticPlan, SYNTHETIC_ROUTE_REGISTRIES } from "../core/__fixtures__/registered-route.js";
import { sha256 } from "../planning/digest.js";
import type { RuntimeAssemblySnapshot, RuntimeMeasurementBatch, RuntimeRect } from "@clossys/designer/catalog";
import { projectRouteRegistry } from "../core/route-registry.js";
import { flowStageStyleSheet } from "../core/flow-stage.js";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "./__fixtures__/registered-route-runtime.js";
let temporary: string, compiled: CompiledRegisteredRoute, compiledHost: CompiledRegisteredRoute;
const Owner = createContext("missing");
/** Explicit host fixture copy. Unknown references stay unresolved. */
const shellLabels: Record<string, string> = {
  [SHELL_COPY_REFS.frame.skip.id]: "Skip synthetic workspace content",
  [SHELL_COPY_REFS.frame.navigationOpen.id]: "Open synthetic navigation",
  [SHELL_COPY_REFS.frame.navigationClose.id]: "Close synthetic navigation",
  [SHELL_COPY_REFS.frame.breadcrumb.id]: "Synthetic breadcrumb",
  [SHELL_COPY_REFS.frame.collapsedBreadcrumb.id]: "Collapsed synthetic breadcrumb",
  [SHELL_COPY_REFS.frame.pageInfo.id]: "Synthetic page information",
  [SHELL_COPY_REFS.frame.pageActions.id]: "Synthetic page actions",
  [SHELL_COPY_REFS.navigation.empty.id]: "No synthetic navigation entries",
  [SHELL_COPY_REFS.commands.results.id]: "Synthetic command results",
};
const resolveShellLabel: ShellCopyResolver = ref => shellLabels[ref.id] === undefined ? undefined : { ref, text: shellLabels[ref.id]! };
function Action({ compact }: { compact: boolean }) { const owner = useContext(Owner), [n, update] = useState(0); return <button onClick={() => update(n + 1)}>{owner}:{String(compact)}:{n}</button>; }
beforeAll(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-registered-route-")));
  compiled = await compileRegisteredRouteFixture(temporary);
  compiledHost = await compileRegisteredRouteFixture(join(temporary, "host-content"), true);
}, 30000);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1440);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });
/** SYNTHETIC compiled selection metadata and callbacks exercise the fixed binder.
 * AppFrame, header provider, public Layout and action context are actual modules.
 * Callback identity is deliberately synthetic: this is no consumer qualification. */
function fixture(hostContent = false) {
  const appFrame = loadBuildCatalog().slots.find(row => row.id === "frames.app-shell")!;
  const hostSlots = hostContent && appFrame.contract.kind === "frame" ? appFrame.contract.slots.filter(row => row.id === "skip-link") : [];
  const { route, registry, engine, profile, frame, content, source, layoutSource, actionSource, registries, consumer, manifest } = syntheticRegisteredRoute(hostContent ? compiledHost : compiled);
  const runtime: RegisteredRouteRuntime = {
    // Runtime checks consume selected slot contracts, not unrelated value-fill offers.
    // Keep their complete contracts while bounding this synthetic snapshot payload.
    assembly: { identity: { kind: "artifact", name: "SYNTHETIC fixed binder", sha256: runtimeHash(compiled.compiled) }, engine, contracts: { ...loadBuildCatalog(), fills: [], slots: engine.catalog.surfaces!.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow"] as const, scroll: "region" as const }, slots: [...slot.contract.slots, ...hostSlots] } : { ...slot.contract, substrates: ["flow"] as const, substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC fixture declaration" }] } })) },
      ports: { manifest,
        renderers: { [content.renderer.id]: () => <article aria-label="SYNTHETIC body">{compiled.module.Content!()}</article>, [frame.renderer.id]: input => {
          const header = input.pageHeader!;
          return <ShellCopyProvider resolver={resolveShellLabel}><AppFrame {...(hostContent ? { skipLabel: input.content["skip-link"]!.value as string, mainId: "app-main" } : {})} brand={{ markSrc: "/mark.svg", wordmark: "Example", label: "Example workspace", ...header.brand }} navigation={{ tree: [], activeId: "", label: "Workspace" }} account={{ signedOutLabel: "Signed out", sections: [] }} commands={{ heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "Empty", triggerLabel: "Commands", groups: [] }} onNavigate={() => {}}>
            <PageHeaderModule id={header.id} header={{ ...header.data, actions: { render: header.actions!.render } }} />{input.slots.main}
          </AppFrame></ShellCopyProvider>;
        } }, resolveContent: () => undefined }, themes: ["light"], states: ["default"], css: [{ id: "publisher-flow-stage.css", contents: flowStageStyleSheet(profile, "layouts.stack", "stack.focus") }], assets: [] },
    instanceLibrary: { id: consumer, role: "consumer", resolveFill: (leaf, config) => leaf === "layouts.stack" && config === "stack.focus" ? { library: consumer, leaf, config, headings: [], states: ["default"], renderer: source } : undefined, resolveContent: ref => ref },
    registries,
    layoutRenderer: { id: "Stack", source: layoutSource, sourceHash: runtimeHash(layoutSource) }, cell: { theme: "light", state: "default", width: 320 }, headerActions: { renderer: { id: "SYNTHETIC Actions", source: actionSource, sourceHash: runtimeHash(actionSource) }, state: { revision: 1 } },
  };
  return { route, registry, runtime: { ...runtime, assembly: { ...runtime.assembly, stageMeasurements: { renderer: runtime.layoutRenderer!, environment: { kind: "SYNTHETIC independent Stage geometry" }, cells: runtimeAssemblyCells(resolve(engine), ["light"], ["default"]).map(cell => ({ cell, width: cell.width - 80 })) } } } };
}
function canvasFixture() {
  const f = fixture(), { layout: _layout, ...canonical } = f.route.composition.binding as FlowInstanceBinding;
  const body = { kind: "canvas" as const, source: { kind: "static" as const }, boards: [{ id: "assets/icons", section: { slot: "body", index: 0 }, groups: { domain: "assets" } }], arrangement: { kind: "grid" as const, columns: 1, gap: { x: 0, y: 0 } }, collapseBelow: "tokens.breakpoint.tablet" as const };
  Object.assign(f.route.composition, { binding: { ...canonical, body } });
  const source = { entry: "frames/FrameStage.tsx", files: { "frames/FrameStage.tsx": "// SYNTHETIC source declaration for actual imported Stage; no qualification" }, dependencies: {} }, renderer = { id: "SYNTHETIC Stage", source, sourceHash: runtimeHash(source) }, module = { package: "@clossys/designer/frames" as const, export: "FrameStage" as const, renderer };
  const { layoutRenderer: _renderer, ...runtime } = f.runtime, frame = runtime.assembly.ports.manifest.fills.find(fill => fill.kind === "frame")!, section = runtime.assembly.ports.manifest.fills.find(fill => fill.kind === "section" && fill.leaf === "sections.content")!;
  const names: Record<string, string> = { "stage.label": "Current library", "stage.board": "Icons" };
  const board = vi.fn(() => <LibraryBoardSection records={{ columns: { version: 1, items: [] }, rows: { version: 1, layer: "assets", boardId: "assets/icons", label: "Icons", items: [] }, controls: { version: 1, mode: "view", canSave: false, pending: false } }} labels={boardLabels} previews={{ selectionHash: "SYNTHETIC", sourceHashes: {}, render: () => undefined }} onCommand={() => {}} />);
  return { ...f, board, runtime: { ...runtime, registries: { ...runtime.registries, frames: runtime.registries.frames.map(row => ({ ...row, contract: { ...row.contract, stage: { accepts: ["flow", "canvas"] as const, scroll: "region" as const } } })), sections: runtime.registries.sections.map(row => ({ ...row, contract: { ...row.contract, substrates: ["flow", "canvas"] as const, substrateTests: ["flow", "canvas"].map(substrate => ({ substrate: substrate as "flow" | "canvas", file: "SYNTHETIC.tsx", name: "Synthetic selected callback; actual comparison component" })) } })) },
    assembly: { ...runtime.assembly, contracts: { ...runtime.assembly.contracts, slots: runtime.assembly.contracts.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow", "canvas"] as const, scroll: "region" as const } } : slot.contract.kind === "section" ? { ...slot.contract, substrates: ["flow", "canvas"] as const, substrateTests: ["flow", "canvas"].map(substrate => ({ substrate: substrate as "flow" | "canvas", file: "SYNTHETIC.tsx", name: "Synthetic declared support" })) } : slot.contract })) },
      ports: { ...runtime.assembly.ports, manifest: { ...runtime.assembly.ports.manifest, fills: runtime.assembly.ports.manifest.fills.map(fill => fill === frame ? { ...fill, stageModule: module } : fill) }, stageActions: { onViewportChange() {} }, renderers: { ...runtime.assembly.ports.renderers, [section.renderer.id]: board }, resolveContent: reference => names[reference.ref] ? { reference, value: names[reference.ref]!, hash: runtimeHash(names[reference.ref]) } : undefined },
      stage: { module, bodyDigest: runtimeHash(body), label: { kind: "copy" as const, ref: "stage.label" }, labels: { "sections.body.0": { kind: "copy" as const, ref: "stage.board" } }, controller: renderer, state: { camera: { viewport: { x: 0, y: 0, zoom: 1 }, minZoom: 0.1, maxZoom: 2, fitPadding: 0 } } },
    },
  } satisfies RegisteredRouteRuntime };
}
describe("fixed registered route execution, explicitly synthetic selection proof", () => {
  it("registered canvas executes selected comparison nodes through canonical Stage and Frame provider", async () => {
    const { route, registry, runtime, board } = canvasFixture();
    const prepared = prepareRegisteredRoute(registry, route.routeId, runtime, ({ compact }) => <Action compact={compact} />);
    expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
    expect(prepared.input?.layout).toBeUndefined();
    render(<Owner.Provider value="original"><RegisteredRoutePage registry={registry} routeId={route.routeId} useRuntime={() => runtime} renderActions={({ compact }) => <Action compact={compact} />} /></Owner.Provider>);
    expect(board).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-frame-stage]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-library-board="assets/icons"]')).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Current library" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "original:false:0" }));
    expect(screen.getByRole("button", { name: "original:false:1" })).toBeInTheDocument();
  });
  it("executes closed flow Stage inside the selected Frame with the actual selected Layout and original providers", async () => {
    const { route, registry, runtime } = fixture();
    const body = { kind: "flow" as const, source: { kind: "static" as const }, sections: [{ slot: "body", index: 0 }] };
    Object.assign(route.composition.binding, { body });
    const source = { entry: "frames/FrameStage.tsx", files: { "frames/FrameStage.tsx": "// SYNTHETIC descriptor for actual imported Stage" }, dependencies: {} };
    const renderer = { id: "SYNTHETIC flow Stage", source, sourceHash: runtimeHash(source) };
    const module = { package: "@clossys/designer/frames" as const, export: "FrameStage" as const, renderer };
    const stageRuntime: RegisteredRouteRuntime = { ...runtime, assembly: { ...runtime.assembly,
      ports: { ...runtime.assembly.ports, manifest: { ...runtime.assembly.ports.manifest, fills: runtime.assembly.ports.manifest.fills.map(fill => fill.kind === "frame" ? { ...fill, stageModule: module } : fill) },
        resolveContent: reference => ({ reference, value: reference.ref === "stage.label" ? "Flow workspace" : "Selected content", hash: runtimeHash(reference.ref === "stage.label" ? "Flow workspace" : "Selected content") }) },
      stage: { module, bodyDigest: runtimeHash(body), label: { kind: "copy", ref: "stage.label" }, labels: { "sections.body.0": { kind: "copy", ref: "stage.section" } }, controller: renderer, state: {} },
    } };
    const prepared = prepareRegisteredRoute(registry, route.routeId, stageRuntime, ({ compact }) => <Action compact={compact} />);
    expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
    expect(prepared.input?.layout?.descriptor.config).toBe("stack.focus");
    render(<Owner.Provider value="original"><RegisteredRoutePage registry={registry} routeId={route.routeId} useRuntime={() => stageRuntime} renderActions={({ compact }) => <Action compact={compact} />} /></Owner.Provider>);
    expect(document.querySelectorAll('[data-frame-stage][data-frame-stage-layout="flow"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-layout="layouts.stack"]')).toHaveLength(1);
    expect(screen.getByRole("article", { name: "SYNTHETIC body" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "original:false:0" }));
    expect(screen.getByRole("button", { name: "original:false:1" })).toBeInTheDocument();
  });
  it("transports an explicit original host-content reference into the real AppFrame skip link", () => {
    const { route, registry, runtime } = fixture(true);
    const reference = { kind: "copy" as const, ref: "original/skip-link" }, value = "Skip this original workspace";
    Object.assign(route.composition.binding.frame, { content: { "skip-link": reference } });
    const originalResolver = vi.fn(() => ({ reference, value, hash: runtimeHash(value) }));
    Object.assign(runtime.assembly.ports, { resolveContent: originalResolver });
    const result = prepareRegisteredRoute(registry, route.routeId, runtime, ({ compact }) => <Action compact={compact} />);
    expect(result.status, JSON.stringify(result)).toBe("ready");
    expect(result.input?.binding.frame.content).toEqual({ "skip-link": reference });
    render(<RegisteredRoutePage registry={registry} routeId={route.routeId} useRuntime={() => runtime} renderActions={({ compact }) => <Action compact={compact} />} />);
    expect(screen.getByRole("link", { name: value })).toHaveAttribute("href", "#app-main");
    expect(originalResolver).toHaveBeenCalledWith(reference);
  });
  it("keeps omitted or unresolved required frame host content pending", () => {
    const { route, registry, runtime } = fixture(true);
    expect(route.composition.binding.frame).not.toHaveProperty("content");
    const absent = prepareRegisteredRoute(registry, route.routeId, runtime, () => null);
    expect(absent.status, JSON.stringify(absent)).toBe("pending");
    expect(absent.findings.join(" ")).toContain("required content missing");
    Object.assign(route.composition.binding.frame, { content: { "skip-link": { kind: "copy", ref: "original/skip-link" } } });
    const unresolved = prepareRegisteredRoute(registry, route.routeId, runtime, () => null);
    expect(unresolved.status, JSON.stringify(unresolved)).toBe("pending");
    expect(unresolved.findings.join(" ")).toContain("consumer content unresolved");
  });
  it.each(["wrong hash", "foreign reference"])("refuses resolved frame content with %s", mismatch => {
    const { route, registry, runtime } = fixture(true);
    const reference = { kind: "copy" as const, ref: "original/skip-link" }, value = "Original skip label";
    Object.assign(route.composition.binding.frame, { content: { "skip-link": reference } });
    Object.assign(runtime.assembly.ports, { resolveContent: () => ({ reference: mismatch === "foreign reference" ? { ...reference, ref: "foreign/skip-link" } : reference, value, hash: runtimeHash(mismatch === "wrong hash" ? "stale label" : value) }) });
    const result = prepareRegisteredRoute(registry, route.routeId, runtime, () => null);
    expect(result.status, JSON.stringify(result)).toBe("refused");
    expect(result.findings.join(" ")).toContain("stale or foreign content binding");
  });
  it.each([{ kind: "host-node", ref: "original/skip-link" }, { kind: "copy", ref: " " }, { kind: "copy", ref: "original/skip-link", value: "serialized host value" }])("refuses malformed frame content references %j", reference => {
    const { route, registry, runtime } = fixture(true);
    Object.assign(route.composition.binding.frame, { content: { "skip-link": reference } });
    const result = prepareRegisteredRoute(registry, route.routeId, runtime, () => null);
    expect(result.status, JSON.stringify(result)).toBe("refused");
    expect(result.findings.join(" ")).toContain("Frame content must contain only named typed consumer references");
  });
  it("executes a throwaway route through its selected Layout, actual Frame/header provider and original action context", async () => {
    const { route, registry, runtime } = fixture();
    const result = prepareRegisteredRoute(registry, route.routeId, runtime, ({ compact }) => <Action compact={compact} />);
    expect(result.status, JSON.stringify(result)).toBe("ready");
    render(<Owner.Provider value="original"><RegisteredRoutePage registry={registry} routeId={route.routeId} useRuntime={() => runtime} renderActions={({ compact }) => <Action compact={compact} />} /></Owner.Provider>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Example workspace" })).toHaveAttribute("href", route.path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tools");
    expect(screen.getByRole("article", { name: "SYNTHETIC body" })).toHaveTextContent("SYNTHETIC");
    expect(document.querySelectorAll('[data-layout="layouts.stack"]')).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "original:false:0" }));
    expect(screen.getByRole("button", { name: "original:false:1" })).toBeInTheDocument();
  });
  it("does not authenticate caller session strings or a self-hashed projection without the original mounted hooks", () => {
    const { route, registry, runtime } = fixture();
    Object.assign(route.composition.binding, { body: { ...route.composition.binding.body!, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } });
    const projection = { session: { id: "copied-session", revision: 1 }, libraryHash: runtimeHash(runtime.assembly.engine.library) };
    const result = prepareRegisteredRoute(registry, route.routeId, { ...runtime, designerQuery: { input: { projection, projectionHash: runtimeHash(projection) } } as never }, () => null);
    expect(result.status).toBe("pending");
    expect(result.findings).toContain("Actual mounted original Designer provider association unavailable");
  });
  it("refuses host body escape and stale selection/config without executing a fallback page", () => {
    const { route, registry, runtime } = fixture(); const actions = (): ReactNode => null;
    expect(prepareRegisteredRoute(registry, route.routeId, { ...runtime, body: <h1>Old page</h1> } as never, actions).status).toBe("refused");
    for (const escape of [{ renderBody: () => <h1>Old page</h1> }, { renderStage: () => <h1>Old page</h1> }, { sectionNodes: {} }])
      expect(prepareRegisteredRoute(registry, route.routeId, { ...runtime, ...escape } as never, actions).status).toBe("refused");
    expect(prepareRegisteredRoute(registry, route.routeId, { ...runtime, instanceLibrary: { ...runtime.instanceLibrary, resolveFill: () => undefined } }, actions).status).toBe("pending");
    expect(prepareRegisteredRoute(registry, route.routeId, { ...runtime, assembly: { ...runtime.assembly, ports: { ...runtime.assembly.ports, manifest: { ...runtime.assembly.ports.manifest, selectionHash: `sha256:${"0".repeat(64)}` } } } }, actions).status).toBe("refused");
  });
});

function plainFixture() {
  const current = fixture(), route = structuredClone(current.route);
  Object.assign(route.composition.binding, { body: { ...route.composition.binding.body!, source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } } } });
  const source = { entry: "studio/designer-layer-boards.js", files: { "studio/designer-layer-boards.js": "// SYNTHETIC unverified display provenance" }, dependencies: {} };
  const projection: PlainRegisteredRouteProjection = { kind: "publisher.route-projection", version: 1, authentication: "unverified", consumer: current.registry.consumer, routes: [{ kind: "derived-route-view", registration: route, derivation: { id: "designer.layer-boards", version: 1, renderer: { id: "SYNTHETIC provenance", source, sourceHash: runtimeHash(source) }, state: {} } }] };
  return { ...current, route, projection };
}
describe("plain route projection is display data, never authenticated evidence", () => {
  it("renders a selected derived body from plain JSON while keeping provenance visibly unverified", () => {
    const { route, projection, runtime } = plainFixture(), json = JSON.parse(JSON.stringify(projection));
    const prepared = prepareRegisteredRouteProjection(json, route.routeId, runtime, ({ compact }) => <Action compact={compact} />);
    expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
    expect(prepared.authentication).toBe("unverified");
    expect(prepared.materialization).toBeUndefined();
    expect(prepared.input?.binding.body?.source).toEqual({ kind: "derived", query: { id: "designer.layer-boards", version: 1 } });
    render(<Owner.Provider value="original"><RegisteredRouteProjectionPage projection={json} routeId={route.routeId} useRuntime={() => runtime} renderActions={({ compact }) => <Action compact={compact} />} /></Owner.Provider>);
    expect(screen.getByRole("article", { name: "SYNTHETIC body" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it("refuses malformed readonly route-array rows and nested projections without widening them into accepted views", () => {
    const { route, projection, runtime } = plainFixture();
    const rows = [null, undefined, false, 1, "row", [], {},
      { kind: "derived-route-view", registration: null, derivation: {} },
      { kind: "static-route-view", registration: [] },
      { ...projection.routes[0], registration: { ...route, composition: [] } },
      { ...projection.routes[0], registration: { ...route, composition: { ...route.composition, binding: null } } },
      { ...projection.routes[0], derivation: [] },
    ];
    for (const row of rows) {
      // JSON decoding does not honor a readonly-array declaration. Preserve the
      // malformed runtime value so exact key/type checks must refuse it.
      const value = Object.assign(structuredClone(projection), { routes: Object.freeze([row]) });
      const prepared = prepareRegisteredRouteProjection(value, route.routeId, runtime);
      expect(prepared.status).toBe("refused");
      expect(prepared.authentication).toBe("unverified");
      expect(prepared.materialization).toBeUndefined();
    }
    const empty = Object.assign(structuredClone(projection), { routes: Object.freeze([]) });
    expect(plainRouteProjectionRegistry(empty)).toEqual({ version: 1, consumer: projection.consumer, routes: [] });
    expect(prepareRegisteredRouteProjection(empty, route.routeId, runtime)).toMatchObject({ status: "refused", authentication: "unverified", findings: ["Exactly one registered route is required"] });
  });
  it("structurally rejects plain projections in authenticated registry/binding/receipt paths", () => {
    const { route, projection, runtime } = plainFixture();
    expect(prepareRegisteredRoute(projection as never, route.routeId, runtime).status).toBe("refused");
    expect(deriveRouteRuntimeBinding(projection as never, runtime.assembly.engine, runtime.assembly.ports.manifest).status).toBe("refused");
    expect(isCurrentRegisteredRouteSourceEvidence(projection as never, { version: 1, consumer: projection.consumer, routes: [route] }, route)).toBe(false);
    for (const source of [{ brand: true }, JSON.parse(JSON.stringify({ routeId: route.routeId, registry: runtimeHash(projection), materialization: runtimeHash("claimed"), identity: runtime.assembly.identity }))]) {
      expect(prepareRegisteredRouteFromNode({ version: 1, consumer: projection.consumer, routes: [route] }, route.routeId, runtime, { source: source as never }).status).toBe("refused");
    }
    expect(prepareRegisteredRouteFromNode(projection as never, route.routeId, runtime, { source: {} as never }).status).toBe("refused");
  });
  it("refuses provenance stripping/upgrades, static rewriting and JSON receipt/status/brand claims", () => {
    const { route, projection, runtime } = plainFixture(), actions = () => null;
    for (const value of [undefined, null, {}, { ...projection, authentication: "verified" }, { ...projection, authentication: undefined }, { ...projection, sourceEvidence: {} }, { ...projection, receipt: {} }, { ...projection, status: "built" }, { ...projection, brand: true }]) expect(prepareRegisteredRouteProjection(value as never, route.routeId, runtime, actions).status).toBe("refused");
    const changed = structuredClone(projection);
    Object.assign(changed.routes[0]!.registration.composition.binding.body!, { source: { kind: "static" } });
    expect(plainRouteProjectionRegistry(changed)).toBeUndefined();
    expect(prepareRegisteredRouteProjection(changed, route.routeId, runtime, actions).status).toBe("refused");
    expect(prepareRegisteredRouteProjection(projection, route.routeId, { ...runtime, source: JSON.parse(JSON.stringify({ routeId: route.routeId, brand: true })) }, actions).status).toBe("refused");
    expect(prepareRegisteredRouteProjection(projection, "unknown.route", runtime, actions).status).toBe("refused");
    expect(() => render(<RegisteredRouteProjectionPage projection={projection} routeId="unknown.route" useRuntime={() => runtime} />)).toThrow(/identity is unavailable/);
  });
});

it.each(["forged brand", "serialized receipt"])("refuses a structurally current %s without the original source-operation identity", kind => {
  const { route, registry, runtime } = fixture();
  const fields = { routeId: route.routeId, registry: routeRegistryDigest(registry), composition: routeCompositionDigest(route), identity: runtime.assembly.identity, files: {} };
  const source = kind === "forged brand" ? { ...fields, brand: true } : JSON.parse(JSON.stringify(fields));
  expect(isCurrentRegisteredRouteSourceEvidence(source as never, registry, route)).toBe(false);
  expect(prepareRegisteredRouteFromNode(registry, route.routeId, runtime, { source: source as never }, () => null).status).toBe("refused");
});

/** Controlled internal seal mechanics only. These test records deliberately do
 * not establish filesystem source authentication or actual browser qualification.
 * The production Node entry can issue a context only after its unchanged checks. */
async function lifecycleFixture(derived = true, substrate: "canvas" | "flow" = "canvas") {
  const f = substrate === "canvas" ? canvasFixture() : fixture(), { runtime, route, registry } = f;
  // The small runtime fixture keeps only its selected synthetic Frame. Plan
  // recommendations also require their unchanged canonical offer declarations.
  Object.assign(runtime, { registries: { ...runtime.registries, frames: [...SYNTHETIC_ROUTE_REGISTRIES.frames.filter(frame => !runtime.registries.frames.some(selected => selected.id === frame.id)), ...runtime.registries.frames] } });
  const sourceBytes = { entry: "SYNTHETIC-runner.ts", files: { "SYNTHETIC-runner.ts": "// Controlled receipt mechanics; not measured consumer evidence" }, dependencies: {} };
  const runner = { id: "SYNTHETIC controlled invocation", source: sourceBytes, sourceHash: runtimeHash(sourceBytes) };
  Object.assign(runtime.assembly, { identity: { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, runner });
  const prepared = prepareRegisteredRoute(registry, route.routeId, runtime, ({ compact }) => <Action compact={compact} />);
  expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
  if (prepared.status !== "ready" || !prepared.input) throw new Error("Controlled canonical assembly unavailable");
  const assembly = prepared.input;
  const descriptor = (entry: string) => { const source = { entry, files: { [entry]: "// Controlled source identity only" }, dependencies: {} }; return { id: entry, source, sourceHash: runtimeHash(source) }; };
  const query = { input: { phase: "ready", session: { revision: 1, edits: [] }, placements: ["tokens/core"], content: "Current source" }, implementation: descriptor("studio/designer-layer-boards.js"), provider: descriptor("studio/WholeStudioProvider.js") };
  let materialization;
  if (derived) {
    const body = { ...assembly.binding.body!, source: { kind: "derived" as const, query: { id: "designer.layer-boards", version: 1 } } };
    Object.assign(route.composition.binding, { body }); Object.assign(assembly, { binding: { ...assembly.binding, body }, stage: { ...assembly.stage!, bodyDigest: runtimeHash(body) } });
    const facts = { input: query.input, implementation: query.implementation, provider: query.provider };
    materialization = recordRouteRuntimeMaterialization(route.composition.binding, route.composition.binding, assembly.engine, facts);
    const data = prepared.assembly.snapshot.data as Record<string, unknown>;
    Object.assign(assembly, { query: { id: "designer.layer-boards", version: 1, renderer: query.implementation, state: facts,
      inputHash: runtimeHash({ libraryHash: libraryHash(assembly.engine.library), selectionHash: resolve(assembly.engine).selectionHash, content: data.content, state: facts }),
      outputHash: runtimeHash({ body, sections: assembly.binding.sections, frameSlots: assembly.binding.frameSlots }) } });
  }
  const store = new PublisherPlanStore(runtime.registries), aligned = await store.apply(store.propose(syntheticPlan([route])), () => true);
  const plan = structuredClone(aligned);
  const identity = { kind: "git" as const, head: "1".repeat(40), tree: "2".repeat(40) };
  const source = recordRegisteredRouteSourceEvidence(registry, route, identity, {}, plan.digest, { profile: runtimeHash(resolve(assembly.engine)), manifest: runtimeHash(assembly.ports.manifest), css: Object.fromEntries(assembly.css.map(file => [file.id, `sha256:${sha256(file.contents)}` as const])) }, materialization?.digest);
  const transaction = beginRegisteredRouteNodeTransaction("SYNTHETIC controlled Node transaction", route.routeId);
  const contextInput = { registry, route, plan, source, assembly, original: runtime.assembly, materialization, ...(derived ? { query } : {}) };
  const current = issueRegisteredRouteNodeCurrent({ ...contextInput, transaction });
  const renew = () => issueRegisteredRouteNodeCurrent({ ...contextInput, transaction: beginRegisteredRouteNodeTransaction("SYNTHETIC controlled Node transaction", route.routeId) });
  const input = { current, registry, route, source, assembly, ...(materialization ? { materialization } : {}) };
  const collect = async () => runRuntimeAssemblyEvidence(assembly, { descriptor: runner, kind: "browser", run: async ({ snapshot }) => controlledMeasurements(snapshot) });
  const promote = async () => { const fresh = await collect(); expect(fresh.status, JSON.stringify(fresh)).toBe("measured"); if (!fresh.evidence) throw new Error("Controlled evidence unavailable"); return deriveRegisteredRouteLifecycle({ ...input, runtime: fresh.evidence, fresh }); };
  return { ...f, assembly, source, current, query, materialization, plan, input, collect, promote, renew };
}
function controlledMeasurements(snapshot: RuntimeAssemblySnapshot): RuntimeMeasurementBatch {
  const rect = (top: number, width: number, height: number): RuntimeRect => ({ left: 0, right: width, top, bottom: top + height, width, height });
  const bytes = "SYNTHETIC controlled geometry corpus";
  return { bundle: { identity: "SYNTHETIC", bytes, hash: runtimeHash(bytes) }, cells: snapshot.cells.map(cell => {
    const key = JSON.stringify([cell.theme, cell.state, cell.width]);
    return { cell, viewport: cell.width, documentScrollWidth: cell.width, breakpoints: snapshot.breakpoints,
      ...(snapshot.stageWidths && snapshot.stageBasisHash ? { stage: { width: snapshot.stageWidths[key]!, basisHash: snapshot.stageBasisHash } } : {}),
      elements: snapshot.measuredPaths.map((path, index) => ({ path, parent: index ? "frame" : null, rect: rect(index ? index * 100 : 0, cell.width, index ? 90 : 1000), clientWidth: cell.width, scrollWidth: cell.width, display: "block", visibility: "visible", opacity: 1, order: 0, flexDirection: "column", gridAutoFlow: "row", direction: "ltr", writingMode: "horizontal-tb", clip: null, text: [] })) };
  }) };
}
describe("controlled lifecycle current-context mechanics, never actual Node/browser readiness", () => {
  it("keeps derived Canvas lifecycle reads deterministic within exactly one current Node transaction", async () => {
    const f = await lifecycleFixture(), result = await f.promote();
    expect(result.status, JSON.stringify(result)).toBe("built"); if (result.status === "planned") throw new Error("Controlled lifecycle unavailable");
    for (let read = 0; read < 3; read++) {
      expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, f.current)).toBe("built");
      expect(projectRouteRegistry(f.registry, f.plan, f.runtime.registries, { [f.route.routeId]: result.evidence }, { [f.route.routeId]: f.current }).rows[0]!.status).toBe("built");
    }
    beginRegisteredRouteNodeTransaction("SYNTHETIC controlled Node transaction", f.route.routeId);
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, f.current)).toBe("planned");
  });
  it("refuses prior transaction receipts under a new current context", async () => {
    const f = await lifecycleFixture(), first = await f.promote();
    expect(first.status).toBe("built"); if (first.status === "planned") throw new Error("Controlled lifecycle unavailable");
    const current = f.renew();
    expect(registeredRouteLifecycleStatus(f.registry, f.route, first.evidence, f.current)).toBe("planned");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, first.evidence, current)).toBe("planned");
  });
  it("refuses a consumed runtime invocation in a later transaction", async () => {
    const f = await lifecycleFixture(), observed = await f.collect();
    expect(observed.evidence).toBeDefined();
    const first = deriveRegisteredRouteLifecycle({ ...f.input, runtime: observed.evidence!, fresh: observed });
    expect(first.status).toBe("built");
    const current = f.renew();
    expect(deriveRegisteredRouteLifecycle({ ...f.input, current, runtime: observed.evidence!, fresh: observed }).status).toBe("planned");
  });
  it("accepts a new runtime invocation for the new current transaction", async () => {
    const f = await lifecycleFixture(), current = f.renew(), observed = await f.collect();
    expect(observed.evidence).toBeDefined();
    const result = deriveRegisteredRouteLifecycle({ ...f.input, current, runtime: observed.evidence!, fresh: observed });
    expect(result.status).toBe("built"); if (result.status === "planned") throw new Error("New controlled invocation unavailable");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, current)).toBe("built");
  });
  it("preserves opaque lifecycle provenance even with the genuine current context", async () => {
    const f = await lifecycleFixture(), result = await f.promote();
    expect(result.status).toBe("built"); if (result.status === "planned") throw new Error("Controlled lifecycle unavailable");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, { ...result.evidence }, f.current)).toBe("planned");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, JSON.parse(JSON.stringify(result.evidence)), f.current)).toBe("planned");
    expect(() => issueRegisteredRouteNodeCurrent({ transaction: beginRegisteredRouteNodeTransaction("SYNTHETIC foreign source", f.route.routeId), registry: f.registry, route: f.route, plan: f.plan, source: { ...f.source }, assembly: f.assembly, original: f.runtime.assembly, materialization: f.materialization, query: f.query })).toThrow("Exact Node source/plan/materialization/assembly context unavailable");
    const issue = (assembly: typeof f.assembly, original = f.runtime.assembly) => issueRegisteredRouteNodeCurrent({ transaction: beginRegisteredRouteNodeTransaction("SYNTHETIC wrong current input", f.route.routeId), registry: f.registry, route: f.route, plan: f.plan, source: f.source, assembly, original, materialization: f.materialization, query: f.query });
    expect(() => issue({ ...f.assembly, identity: { kind: "git", head: "3".repeat(40), tree: "4".repeat(40) } })).toThrow("Exact Node source/plan/materialization/assembly context unavailable");
    expect(() => issue(f.assembly, { ...f.runtime.assembly, engine: { ...f.runtime.assembly.engine, library: { ...f.runtime.assembly.engine.library, source: { ...f.runtime.assembly.engine.library.source, license: "Apache-2.0" } } } })).toThrow("Exact Node source/plan/materialization/assembly context unavailable");
  });
  it("keeps the exact selected Flow Layout available without a Canvas substitution", async () => {
    const f = await lifecycleFixture(false, "flow"), result = await f.promote();
    expect(result.status, JSON.stringify(result)).toBe("built"); if (result.status === "planned") throw new Error("Controlled lifecycle unavailable");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, f.current)).toBe("built");
    Object.assign(f.assembly, { layout: { ...f.assembly.layout!, descriptor: { ...f.assembly.layout!.descriptor, config: "foreign-config" } } });
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, f.current)).toBe("planned");
  });
  it.each(["missing", "forged", "serialized", "deserialized", "foreign"])("refuses %s context without shape-based promotion", async mutation => {
    const f = await lifecycleFixture(), result = await f.promote();
    expect(result.status).toBe("built"); if (result.status === "planned") throw new Error("Controlled lifecycle unavailable");
    let current: RegisteredRouteNodeCurrentContext | undefined = f.current;
    if (mutation === "missing") current = undefined;
    if (mutation === "forged") current = { kind: "publisher.node-current-route", routeId: f.route.routeId } as RegisteredRouteNodeCurrentContext;
    if (mutation === "serialized") current = JSON.stringify(f.current) as unknown as RegisteredRouteNodeCurrentContext;
    if (mutation === "deserialized") current = JSON.parse(JSON.stringify(f.current));
    if (mutation === "foreign") { const foreign = { ...f.route, routeId: "example.foreign" }; expect(registeredRouteLifecycleStatus({ ...f.registry, routes: [foreign] }, foreign, result.evidence, current)).toBe("planned"); return; }
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, current)).toBe("planned");
  });
  it.each(["source", "provider", "query", "phase", "placement", "Edit", "plan", "engine", "CSS", "content", "Frame contract", "action callback", "Stage callback"])("invalidates %s mutations on repeated current-context reads", async mutation => {
    const f = await lifecycleFixture(), result = await f.promote();
    expect(result.status).toBe("built"); if (result.status === "planned") throw new Error("Controlled lifecycle unavailable");
    if (mutation === "source") Object.assign(f.registry, { consumer: "foreign" });
    if (mutation === "provider") f.query.provider.id = "foreign provider";
    if (mutation === "query") f.query.implementation.id = "foreign implementation";
    if (mutation === "phase") f.query.input.phase = "error";
    if (mutation === "placement") f.query.input.placements.push("tokens/foreign");
    if (mutation === "Edit") f.query.input.session.revision++;
    if (mutation === "plan") Object.assign(f.plan, { version: f.plan.version + 1 });
    if (mutation === "engine") Object.assign(f.runtime.assembly, { engine: { ...f.runtime.assembly.engine, library: { ...f.runtime.assembly.engine.library, source: { ...f.runtime.assembly.engine.library.source, id: "foreign" } } } });
    if (mutation === "CSS") Object.assign(f.runtime.assembly, { css: [...f.runtime.assembly.css, { id: "changed.css", contents: "/* current bytes changed */" }] });
    if (mutation === "content") f.query.input.content = "Changed current content";
    if (mutation === "Frame contract") Object.assign(f.runtime.assembly.contracts.slots.find(slot => slot.id === f.assembly.binding.frame.leaf)!.contract, { root: "section" });
    if (mutation === "action callback") Object.assign(f.assembly, { pageHeader: { ...f.assembly.pageHeader!, actions: { ...f.assembly.pageHeader!.actions!, render: () => null } } });
    if (mutation === "Stage callback") Object.assign(f.runtime.assembly.ports, { stageActions: { onViewportChange() {} } });
    expect(registeredRouteLifecycleStatus(f.registry, f.route, result.evidence, f.current)).toBe("planned");
  });
  it.each(["Canvas-to-Flow", "absent-Stage", "foreign-Stage", "wrong-labels", "wrong-body-digest"])("refuses %s mutation in the canonical Canvas assembly", async mutation => {
    const f = await lifecycleFixture(false), observed = await f.collect();
    expect(observed.evidence).toBeDefined();
    const promoted = deriveRegisteredRouteLifecycle({ ...f.input, runtime: observed.evidence!, fresh: observed });
    expect(promoted.status, JSON.stringify(promoted)).toBe("built"); if (promoted.status === "planned") throw new Error("Controlled Canvas lifecycle unavailable");
    expect(registeredRouteNodeCurrentSnapshot(f.current, f.registry, f.route, f.source)).toBeDefined();
    if (mutation === "Canvas-to-Flow") Object.assign(f.assembly, { binding: { ...f.assembly.binding, body: { kind: "flow", source: { kind: "static" }, sections: [{ slot: "body", index: 0 }] } } });
    if (mutation === "absent-Stage") Object.assign(f.assembly, { stage: undefined });
    if (mutation === "foreign-Stage") Object.assign(f.assembly, { stage: { ...f.assembly.stage!, module: { ...f.assembly.stage!.module, export: "LocalStage" } } });
    if (mutation === "wrong-labels") Object.assign(f.assembly, { stage: { ...f.assembly.stage!, labels: { "sections.foreign.0": { kind: "copy", ref: "stage.board" } } } });
    if (mutation === "wrong-body-digest") Object.assign(f.assembly, { stage: { ...f.assembly.stage!, bodyDigest: runtimeHash("foreign body") } });
    expect(registeredRouteNodeCurrentSnapshot(f.current, f.registry, f.route, f.source)).toBeUndefined();
    expect(deriveRegisteredRouteLifecycle({ ...f.input, runtime: observed.evidence!, fresh: observed }).status).toBe("planned");
    expect(registeredRouteLifecycleStatus(f.registry, f.route, promoted.evidence, f.current)).toBe("planned");
  });
  it("keeps unmeasured runtime pending even with an authentic internal current context", async () => {
    const f = await lifecycleFixture(), observed = await f.collect();
    expect(observed.evidence).toBeDefined();
    const unmeasured = deriveRegisteredRouteLifecycle({ ...f.input, runtime: observed.evidence!, fresh: { status: "pending", findings: ["Actual consumer browser measurement unavailable"], limits: [] } });
    expect(unmeasured.status).toBe("planned");
  });
});
