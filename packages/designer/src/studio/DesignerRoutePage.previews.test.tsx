import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { applyLibraryChange, libraryHash, planSurfaceRuntime, resolve, runtimeHash } from "../catalog-core/index.js";
import { packageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../frames/__fixtures__/shell-copy.js";
import { DesignerRoutePage } from "./DesignerRoutePage.js";
import { designerRouteServerData } from "./route-data.js";
import type { DesignerRouteServerData } from "./route-data.js";
import { createWholeStudioInitialSession } from "./initial-session.js";
import { pseudoStudioCopy } from "./__fixtures__/copy-hand-roll.js";
import type { StudioCopyBinding } from "./copy-binding.js";

const feedback = ["banner", "toast", "status-mark", "progress-bar", "spinner", "skeleton"].map(name => `components.${name}`);
let serverData: DesignerRouteServerData, initialSession: ReturnType<typeof createWholeStudioInitialSession>;
let findingMessages: StudioCopyBinding["messages"];
beforeAll(async () => {
  // The public admin-route fixture: actual package surfaces and registered
  // component adoption, including verified source bundles and dependencies.
  const fixture = await packageSurfaceLibrary(), bundles = loadCatalogBundles();
  const modules = await readSurfacePackageEvidence(["@clossys/designer/frames", "@clossys/designer/shell"].map(module => ({ frames: { pointer: { impl: { kind: "package", module } } } })) as Parameters<typeof readSurfacePackageEvidence>[0]);
  const packages = [...fixture.packages.filter(row => !modules.some(module => module.module === row.module)), ...modules];
  const surfaceOptions = { ...fixture.options, packages };
  const catalog = { ...fixture.catalog, components: { ...fixture.catalog.components, fills: bundles.componentFills } };
  const componentOptions = { installedRac: installedHeadlessLibrary() };
  const selected = ["components.icon", "components.button", "components.semantic-content", ...feedback];
  const sourceLeaves = new Set(["components.banner", "components.progress-bar", "components.skeleton"]);
  const library = applyLibraryChange(catalog, fixture.library, { baseHash: libraryHash(fixture.library), bundles: bundles.sourceBundles,
    changes: selected.map(slot => ({ portion: "components" as const, change: { op: "adopt" as const, slot, source: sourceLeaves.has(slot) ? "shadcn@aria" : "foundry" } })),
  }, { componentOptions, surfaceOptions });
  const snapshot = { library, componentOptions, surfaceOptions };
  const engine = { catalog, ...snapshot }, profile = resolve(engine);
  expect(selected.every(leaf => profile.components.components[leaf])).toBe(true);
  expect(profile.check.findings.filter(finding => finding.severity === "error")).toEqual([]);
  // Synthetic host references for this fixture's diagnostics; no Writer wording
  // or approval state is supplied or changed by a preview test.
  findingMessages = Object.fromEntries(profile.check.findings.flatMap(finding => ["designer.scorecard", "studio.inspector"].map(prefix => [`${prefix}.finding.${finding.code}`, { id: `fixture.finding.${finding.code}` }])));
  const planned = planSurfaceRuntime({ engine, packages, leaves: ["frames.app-shell"], renderers: { "frames.app-shell": { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" } } });
  expect(planned.gaps, JSON.stringify(planned.gaps)).toEqual([]);
  const frame = planned.manifest.fills[0]!;
  const contents = [
    { reference: { kind: "records" as const, ref: "example.frame/sidebar" }, value: { brand: { name: "Example", markSrc: "/mark.svg" }, tree: [], account: { signedOutLabel: "Signed out", sections: [] } } },
    { reference: { kind: "records" as const, ref: "example.frame/command" }, value: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "No commands", groups: [], shortcutEnabled: false } },
  ].map(row => ({ ...row, hash: runtimeHash(row.value) }));
  serverData = designerRouteServerData({ catalog, snapshot, manifest: planned.manifest, cell: { theme: "light", state: "default", width: 1440 },
    frame: { leaf: frame.leaf, fill: frame.fill, config: frame.config, members: [], content: { sidebar: contents[0]!.reference, command: contents[1]!.reference } }, contents,
    header: { id: "example-designer", data: { title: "Designer" } },
  });
  initialSession = createWholeStudioInitialSession({ id: "example-admin-preview-session", catalog, snapshot });
}, 120000);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); document.documentElement.style.fontSize = ""; });

it("renders registered Feedback implementations in near and mid complete-route cells", async () => {
  document.documentElement.style.fontSize = "18px";
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  // A narrow measured canvas keeps some cells in the visible board at mid tier,
  // while the selected component receives a live near-tier slot.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  window.history.replaceState(null, "", "/?layer=components&node=components.banner");
  const { copy: originalCopy } = pseudoStudioCopy();
  const copy: StudioCopyBinding = { ...originalCopy, messages: findingMessages, resolver: ref => ref.id.startsWith("fixture.finding.") ? { ref, text: `[[${ref.id}]]`, servedLocale: ref.locale } : originalCopy.resolver(ref) };
  const view = render(<ShellCopyProvider resolver={shellCopyFixtureResolver}><DesignerRoutePage copy={copy} serverData={serverData} initialSession={JSON.parse(JSON.stringify(initialSession))} /></ShellCopyProvider>);
  await act(async () => {});
  expect(view.container.querySelector('[data-route-display="designer"]')).toHaveAttribute("data-route-session", initialSession.id);
  const cells = feedback.map(leaf => {
    const cell = view.container.querySelector(`[data-system-cell="${leaf}"]`);
    expect(cell, leaf).not.toBeNull();
    expect(cell!.querySelector('[data-system-thumbnail="pending"]'), leaf).toBeNull();
    expect(cell!.querySelector(`[data-component-specimen="${leaf}"]`), leaf).not.toBeNull();
    expect(cell!.querySelector('[data-specimen-error], [data-specimen-unavailable]'), leaf).toBeNull();
    if (cell!.getAttribute("data-system-tier") === "mid") expect(cell!.querySelector("[data-system-rest-preview]")).toHaveAttribute("inert");
    return cell!;
  });
  expect(cells.some(cell => cell.getAttribute("data-system-tier") === "near")).toBe(true);
  expect(cells.some(cell => cell.getAttribute("data-system-tier") === "mid")).toBe(true);
}, 30000);
