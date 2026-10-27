/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "@clossys/designer/frames";
import { PageHeaderModule } from "@clossys/designer/shell";
import { loadBuildCatalog, resolve, runtimeAssemblyCells, runtimeHash } from "@clossys/designer/catalog";
import { prepareRegisteredRoute, type RegisteredRouteRuntime } from "../registered-route-binding.js";
import type { RouteRegistry } from "../../core/route-registry.js";
import { flowStageStyleSheet } from "../../core/flow-stage.js";
import { compileRegisteredRouteFixture, syntheticRegisteredRoute, type CompiledRegisteredRoute } from "../__fixtures__/registered-route-runtime.js";
import { PublisherInstancesView } from "./PublisherInstancesView.js";
import { FIXTURE_BREAKPOINTS } from "./__fixtures__/standard-instances.js";

let temporary: string, compiled: CompiledRegisteredRoute;
beforeAll(async () => {
  temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "SYNTHETIC-instances-runtime-")));
  compiled = await compileRegisteredRouteFixture(temporary);
}, 30000);
beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1440);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

/** SYNTHETIC compiled selection and callbacks drive the actual closed route binder, as in registered-route.test.tsx.
 * AppFrame, the header provider and the public Layout are actual modules; this is no consumer qualification. */
/** A descendant that throws while React reconciles it, after the assembly's own render returned. */
function SyntheticDescendantFailure(): never { throw new Error("SYNTHETIC descendant failure"); }
function fixture(options: { failingDescendant?: boolean } = {}) {
  const { route, registry, engine, profile, frame, content, source, layoutSource, actionSource, registries, consumer, manifest } = syntheticRegisteredRoute(compiled);
  const section = vi.fn(() => <article aria-label="SYNTHETIC body">{options.failingDescendant ? <SyntheticDescendantFailure /> : compiled.module.Content!()}</article>);
  const runtime: RegisteredRouteRuntime = {
    assembly: { identity: { kind: "artifact", name: "SYNTHETIC instances binder", sha256: runtimeHash(compiled.compiled) }, engine,
      contracts: { ...loadBuildCatalog(), slots: engine.catalog.surfaces!.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow"] as const, scroll: "region" as const } } : { ...slot.contract, substrates: ["flow"] as const, substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC fixture declaration" }] } })) },
      ports: { manifest,
        renderers: { [content.renderer.id]: section, [frame.renderer.id]: input => {
          const header = input.pageHeader!;
          return <AppFrame brand={{ markSrc: "/mark.svg", wordmark: "Example", label: "Example workspace", ...header.brand }} navigation={{ tree: [], activeId: "", label: "Workspace" }} account={{ signedOutLabel: "Signed out", sections: [] }} commands={{ heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "Empty", triggerLabel: "Commands", groups: [] }} onNavigate={() => {}}>
            <PageHeaderModule id={header.id} header={{ ...header.data, actions: { render: header.actions!.render } }} />{input.slots.main}
          </AppFrame>;
        } }, resolveContent: () => undefined },
      themes: ["light"], states: ["default"], css: [{ id: "publisher-flow-stage.css", contents: flowStageStyleSheet(profile, "layouts.stack", "stack.focus") }], assets: [] },
    instanceLibrary: { id: consumer, role: "consumer", resolveFill: (leaf, config) => leaf === "layouts.stack" && config === "stack.focus" ? { library: consumer, leaf, config, headings: [], states: ["default"], renderer: source } : undefined, resolveContent: ref => ref },
    registries,
    layoutRenderer: { id: "Stack", source: layoutSource, sourceHash: runtimeHash(layoutSource) }, cell: { theme: "light", state: "default", width: 320 },
    headerActions: { renderer: { id: "SYNTHETIC Actions", source: actionSource, sourceHash: runtimeHash(actionSource) }, state: { revision: 1 } },
  };
  const measured: RegisteredRouteRuntime = { ...runtime, assembly: { ...runtime.assembly, stageMeasurements: { renderer: runtime.layoutRenderer!, environment: { kind: "SYNTHETIC independent Stage geometry" }, cells: runtimeAssemblyCells(resolve(engine), ["light"], ["default"]).map(cell => ({ cell, width: cell.width - 80 })) } } };
  const renderActions = ({ compact }: { compact: boolean }) => <button type="button">SYNTHETIC actions {String(compact)}</button>;
  return { route, registry, runtime: measured, registries, section, renderActions, binding: route.composition.binding };
}
/** The host side: the actual closed binder, run by the host and handed to the client view. */
const hostRoutes = (registry: RouteRegistry, runtime: RegisteredRouteRuntime, renderActions: ReturnType<typeof fixture>["renderActions"]) =>
  ({ registry, usePreparedRoute: (route: { readonly routeId: string }) => prepareRegisteredRoute(registry, route.routeId, runtime, renderActions) });
const select = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole("button", { name: new RegExp(label) }));
  await user.click(await screen.findByRole("option", { name: option, exact: true }));
};
const region = () => screen.getByRole("region", { name: "Scrollable instance render" });
const noPlaceholder = (root: ParentNode) => {
  expect(root.querySelector("[data-instance-placeholder], [data-section-placeholder], [data-layout-placeholder], [data-placeholder-slot]")).toBeNull();
  expect((root as Element).textContent ?? "").not.toMatch(/placeholder|pending F5|pending S4/i);
};

describe("Publisher Instances render through the registered-route runtime", () => {
  it("draws the selected Frame and Section renderers for a bound cell, with no placeholder markup", async () => {
    const user = userEvent.setup();
    const f = fixture();
    render(<PublisherInstancesView instances={[f.binding]} library={f.runtime.instanceLibrary} registries={f.registries} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer"
      runtimeRoutes={hostRoutes(f.registry, f.runtime, f.renderActions)} />);
    await select(user, "Viewport", "320 px");
    const frame = within(region()).getByTitle(`${f.binding.label} · 320 px light runtime render`) as HTMLIFrameElement;
    fireEvent.load(frame);
    const page = within(frame.contentDocument!.body);
    expect(page.getByRole("article", { name: "SYNTHETIC body" })).toBeInTheDocument();
    expect(page.getByRole("button", { name: /SYNTHETIC actions/ })).toBeInTheDocument();
    expect(f.section).toHaveBeenCalled();
    noPlaceholder(frame.contentDocument!.body);
    noPlaceholder(region());
  });

  it("contains a descendant render error in the Foundry empty state, and the failure does not stick across a cell change", async () => {
    const user = userEvent.setup();
    const failing = { failingDescendant: true };
    const f = fixture(failing);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PublisherInstancesView instances={[f.binding]} library={f.runtime.instanceLibrary} registries={f.registries} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer"
      runtimeRoutes={hostRoutes(f.registry, f.runtime, f.renderActions)} />);
    await select(user, "Viewport", "320 px");
    // jsdom may already have loaded the srcdoc frame (mounting the throwing portal); load it here if it has not.
    const pending = within(region()).queryByTitle(`${f.binding.label} · 320 px light runtime render`);
    if (pending) expect(() => fireEvent.load(pending)).not.toThrow();
    expect(await within(region()).findByRole("heading", { name: "Runtime render unavailable" })).toBeVisible();
    expect(region()).toHaveTextContent("Runtime render failed: SYNTHETIC descendant failure");
    expect(region().querySelector("iframe")).toBeNull();
    expect(f.section).toHaveBeenCalled();
    noPlaceholder(region());
    failing.failingDescendant = false;
    await select(user, "Theme", "dark");
    expect(region()).toHaveTextContent("320 px dark default is outside the bound runtime matrix");
    expect(region()).not.toHaveTextContent("SYNTHETIC descendant failure");
    await select(user, "Theme", "light");
    const frame = within(region()).getByTitle(`${f.binding.label} · 320 px light runtime render`) as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(within(frame.contentDocument!.body).getByRole("article", { name: "SYNTHETIC body" })).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("states a cell outside the bound runtime matrix instead of drawing it", async () => {
    const user = userEvent.setup();
    const f = fixture();
    render(<PublisherInstancesView instances={[f.binding]} library={f.runtime.instanceLibrary} registries={f.registries} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer"
      runtimeRoutes={hostRoutes(f.registry, f.runtime, f.renderActions)} />);
    await select(user, "Viewport", "320 px");
    await select(user, "Theme", "dark");
    expect(within(region()).getByRole("heading", { name: "Runtime render unavailable" })).toBeVisible();
    expect(region()).toHaveTextContent("320 px dark default is outside the bound runtime matrix");
    expect(region().querySelector("iframe")).toBeNull();
    noPlaceholder(region());
  });

  it("shows the binder's own pending finding when the host runtime is incomplete", () => {
    const f = fixture();
    const { layoutRenderer: _layout, ...incomplete } = f.runtime;
    render(<PublisherInstancesView instances={[f.binding]} library={f.runtime.instanceLibrary} registries={f.registries} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer"
      runtimeRoutes={hostRoutes(f.registry, incomplete, f.renderActions)} />);
    expect(within(region()).getByRole("heading", { name: "Runtime render unavailable" })).toBeVisible();
    expect(region()).toHaveTextContent("Runtime assembly pending: Exact selected public flow Layout source/configuration is unavailable");
    expect(f.section).not.toHaveBeenCalled();
    noPlaceholder(region());
  });

  it("refuses to draw an instance that no registered route binds", () => {
    const f = fixture();
    const loose = { ...f.binding, instanceId: "SYNTHETIC.unregistered" };
    render(<PublisherInstancesView instances={[loose]} library={f.runtime.instanceLibrary} registries={f.registries} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer"
      runtimeRoutes={hostRoutes(f.registry, f.runtime, f.renderActions)} />);
    expect(region()).toHaveTextContent("This instance is not a registered route.");
    expect(f.section).not.toHaveBeenCalled();
    noPlaceholder(region());
  });
});
