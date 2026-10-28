/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { publisherCopyFixtureResolver } from "./publisher/__fixtures__/writer-copy.js";
import userEvent from "@testing-library/user-event";
import { DesignerRoutePage, PublisherRoutePage, WriterRoutePage, type WriterRouteServerData } from "@clossys/publisher/web/registered-route";
import { SHELL_COPY_REFS } from "@clossys/designer/frames";
import { getAdminCopy, type AdminCopy } from "@clossys/writer/admin-copy";
import { WRITER_COPY_REFS } from "./writer/copy.js";
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
  const leaves = ["frames.app-shell", "sections.data-table", "sections.record-detail", "sections.notices"];
  const planned = planSurfaceRuntime({ engine, packages, leaves, renderers: Object.fromEntries(leaves.map(leaf => [leaf, { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" }])) });
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
  for (const kind of ["designer", "publisher", "writer"] as const) {
    const component = kind === "designer" ? "DesignerRoutePage" : kind === "writer" ? "WriterRoutePage" : "PublisherRoutePage";
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

function writerData(): WriterRouteServerData {
  const source = getAdminCopy();
  const ids = new Set([...JSON.stringify(SHELL_COPY_REFS).matchAll(/st\.[a-z0-9]{10}/g)].map(match => match[0]));
  for (const ref of Object.values(WRITER_COPY_REFS)) ids.add(ref.id);
  const copy: AdminCopy = { envelopes: source.envelopes, records: source.records.filter(record => ids.has(record.id)) };
  return { ...data, writer: { copy, selectedRecordId: WRITER_COPY_REFS.records.id } };
}
it("mounts Writer's selected Sections with real store data, draft CopyRef stamps and no unstamped body literals", async () => {
  environment();
  const writer = writerData(), before = JSON.stringify(writer.writer.copy);
  const errors = vi.spyOn(console, "error");
  const view = render(<WriterRoutePage serverData={writer} initialSession={initialSession} />);
  await act(async () => {});
  expect(view.container.querySelector('[data-route-display="writer"]')).toHaveAttribute("data-route-authentication", "unverified");
  expect(screen.getByRole("heading", { level: 1, name: "Writer", exact: true })).toBeVisible();
  const roots = ["sections.data-table", "sections.record-detail", "sections.notices"].map(leaf => {
    const root = view.container.querySelector(`[data-ds-leaf="${leaf}"]`)!;
    expect(root, leaf).not.toBeNull();
    return root;
  });
  expect(roots[0]!.querySelectorAll("tbody tr")).toHaveLength(Math.min(50, writer.writer.copy.records.length));
  expect(roots[1]).toHaveTextContent("Copy records");
  expect(roots[1]).toHaveTextContent("WriterRoutePage");
  expect(roots[2]).toHaveTextContent(`${writer.writer.copy.records.length} records`);
  const unwrapped: string[] = [];
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent?.trim() && !node.parentElement?.closest("style, script, [data-copy-ref], [data-copy-value=technical]")) unwrapped.push(node.textContent);
    }
  }
  expect(unwrapped).toEqual([]);
  expect(view.container.querySelectorAll('[data-copy-ref][data-copy-locale="en"][data-copy-status="draft"]').length).toBeGreaterThan(10);
  const next = WRITER_COPY_REFS.detail.id;
  await userEvent.setup().click(within(roots[0] as HTMLElement).getByRole("row", { name: new RegExp(next) }));
  await act(async () => {});
  expect(roots[1]!.querySelector(`[data-copy-ref="${next}"]`)).not.toBeNull();
  expect(JSON.stringify(writer.writer.copy)).toBe(before);
  expect(errors.mock.calls).toEqual([]);
}, 30000);
it("pages a thousand Writer records without losing selection or its inspector", async () => {
  environment();
  const writer = writerData();
  const records = [...writer.writer.copy.records];
  while (records.length < 1000) records.push({ ...records[0]!, id: `st.${records.length.toString(32).padStart(10, "0")}` });
  const copy = { ...writer.writer.copy, records };
  const serverData = { ...writer, writer: { copy } };
  // The initial server render is bounded too, before client interactions.
  const html = renderToString(<WriterRoutePage serverData={serverData} initialSession={initialSession} />);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  expect(parsed.querySelectorAll('[data-ds-leaf="sections.data-table"] tbody tr')).toHaveLength(50);
  const view = render(<WriterRoutePage serverData={serverData} initialSession={initialSession} />);
  const table = () => screen.getByRole("grid", { name: "Copy records" });
  const rows = () => table().querySelectorAll("tbody tr");
  const user = userEvent.setup();
  expect(rows()).toHaveLength(50);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(rows()).toHaveLength(50);
  expect(within(table()).queryByRole("row", { name: new RegExp(records[0]!.id) })).toBeNull();
  await user.click(within(table()).getByRole("row", { name: new RegExp(records[50]!.id) }));
  const detail = () => view.container.querySelector('[data-ds-leaf="sections.record-detail"]');
  expect(detail()!.querySelector(`[data-copy-ref="${records[50]!.id}"]`)).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  expect(rows()).toHaveLength(50);
  expect(detail()!.querySelector(`[data-copy-ref="${records[50]!.id}"]`)).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(within(table()).getByRole("row", { name: new RegExp(records[50]!.id) })).toHaveAttribute("aria-selected", "true");
  expect(view.container.querySelector(`[data-copy-ref="${WRITER_COPY_REFS.pageSummary.id}"]`)).toHaveTextContent("Page 2 of 20");
  expect(copy.records).toHaveLength(1000);
}, 30000);
it("opens the selected record's final page and clamps a shrinking record store", async () => {
  environment();
  const writer = writerData();
  const records = [...writer.writer.copy.records];
  while (records.length < 103) records.push({ ...records[0]!, id: `st.${records.length.toString(32).padStart(10, "0")}` });
  const serverData = { ...writer, writer: { copy: { ...writer.writer.copy, records }, selectedRecordId: records[102]!.id } };
  const view = render(<WriterRoutePage serverData={serverData} initialSession={initialSession} />);
  expect(screen.getByRole("grid", { name: "Copy records" }).querySelectorAll("tbody tr")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getByRole("row", { name: new RegExp(records[102]!.id) })).toHaveAttribute("aria-selected", "true");
  view.rerender(<WriterRoutePage serverData={{ ...serverData, writer: { copy: writer.writer.copy } }} initialSession={initialSession} />);
  const finalPage = Math.ceil(writer.writer.copy.records.length / 50);
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(view.container.querySelector(`[data-copy-ref="${WRITER_COPY_REFS.pageSummary.id}"]`)).toHaveTextContent(`Page ${finalPage} of ${finalPage}`);
  expect(screen.getByRole("grid", { name: "Copy records" }).querySelectorAll("tbody tr")).toHaveLength(writer.writer.copy.records.length - (finalPage - 1) * 50);
}, 30000);
it("leases Writer details only into the Frame right-panel after a row is selected", async () => {
  environment();
  const writer = writerData();
  const view = render(<WriterRoutePage serverData={{ ...writer, writer: { copy: writer.writer.copy } }} initialSession={initialSession} />);
  await act(async () => {});
  expect(view.container.querySelector('[data-frame-module$="-writer-inspector"]')).toBeNull();
  expect(view.container.querySelector('[data-ds-leaf="sections.record-detail"]')).toBeNull();
  const table = screen.getByRole("grid", { name: "Copy records" });
  await userEvent.setup().click(within(table).getByRole("row", { name: new RegExp(WRITER_COPY_REFS.records.id) }));
  await act(async () => {});
  const lease = view.container.querySelector('[data-frame-module$="-writer-inspector"]');
  expect(lease).not.toBeNull();
  expect(lease!.querySelector('[data-ds-leaf="sections.record-detail"]')).not.toBeNull();
  expect(lease!.closest('[data-application-frame-panel="pane"]')).not.toBeNull();
  expect(view.container.querySelector('main [data-ds-leaf="sections.record-detail"]')).toBeNull();
}, 30000);
it("refuses Writer's unselected Sections, foreign sessions, executable data and missing copy", () => {
  environment();
  const writer = writerData();
  for (const serverData of [
    { ...writer, manifest: { ...writer.manifest, fills: writer.manifest.fills.filter(fill => fill.leaf !== "sections.notices") } },
    { ...writer, writer: { ...writer.writer, execute: () => undefined } },
  ]) {
    const view = render(<WriterRoutePage serverData={serverData} initialSession={initialSession} />);
    expect(view.container.querySelector('[data-route-display="writer"]')).toBeNull(); cleanup();
  }
  const view = render(<WriterRoutePage serverData={writer} initialSession={{ ...initialSession, snapshotHash: "sha256:invalid" }} />);
  expect(view.container.querySelector('[data-route-display="writer"]')).toBeNull(); cleanup();
  const missing = { ...writer, writer: { copy: { ...writer.writer.copy, records: writer.writer.copy.records.filter(record => record.id !== WRITER_COPY_REFS.records.id) } } };
  expect(() => renderToString(<WriterRoutePage serverData={missing} initialSession={initialSession} />)).toThrow(`Writer copy Need: ${WRITER_COPY_REFS.records.id}`);
});
