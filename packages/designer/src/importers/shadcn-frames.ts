import data from "./vendor/shadcn-app-shell.data.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { surfaceDigest, surfaceManifest, surfaceDescriptorHash, surfaceDerivationHash } from "../catalog-core/surface-library.js";
import type { SurfaceCandidateDocument, SurfaceFrameEntry, SurfaceTransform, SurfaceBase, SurfaceMaterializationReceipt } from "../catalog-core/surface-types.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";

/** Authenticated official sidebar input and the explicit, token-based frame port. */
export function importShadcnFrames() {
  for (const file of data.upstream) if (sha256(file.content) !== file.sha256) throw new Error("shadcn-frames: upstream source differs from pin");
  const source = "shadcn@aria", slot = "frames.app-shell", name = "ShadcnAppShell";
  const upstream = data.upstream.map(({ path, content }) => ({ path, content }));
  const licence = data.upstream.find(file => file.path === "LICENSE.md")!.content;
  const notice = { path: `notices/surfaces/n-${sha256(licence)}.txt`, content: licence };
  const files = [data.output, notice];
  const binding = (path: readonly string[]) => ({ export: name, path });
  const field = (path: string) => binding(path.split("."));
  const slots = Object.fromEntries(Object.entries({ "skip-link": "skipLabel", sidebar: "navigation", header: "context", main: "children", inspector: "rightPanel", command: "commands", "page-module": "pageModule", progress: "progress", state: "stateViews", toasts: "toasts" }).map(([key, path]) => [key, field(path)]));
  const propMap = Object.fromEntries(["layout.standard", "layout.immersive", "stage.contained", "stage.full", "theme.system", "theme.light", "theme.dark"].map(member => [member, field(member.startsWith("theme.") ? "theme.defaultPreference" : member.split(".")[0]!)]));
  const statePorts = Object.fromEntries(Object.entries({ "sidebar-collapsed": ["navigation.collapsed", "onSidebarCollapsedChange"], "inspector-collapsed": ["rightPanel.collapsed", "onInspectorCollapsedChange"], width: ["rightPanel.value", "onInspectorWidthChange"], theme: ["theme.preference", "onThemePreferenceChange"], navigating: ["state.navigating", "onNavigatingChange"], "main-state": ["state.main", "onMainStateChange"] }).map(([key, [value, change]]) => [key, { value: field(value!), change: field(change!) }]));
  const frame: SurfaceFrameEntry = {
    kind: "frame", slot, source, impl: { kind: "source", entry: data.output.path, export: name }, rendering: "client", members: Object.keys(propMap), states: ["default"],
    slots, propMap, statePorts,
    reads: { tokens: ["tokens.body-size", "tokens.border-color", "tokens.control-radius", "tokens.spacing", "tokens.surface-color", "tokens.text-color"], assets: [] },
    composes: ["components.button", "components.logo", "components.menu", "components.semantic-content", "components.sheet", "components.sidebar", "frames.app-header", "frames.command", "frames.inspector"], parts: [],
    api: { version: 1, exports: [{ name: "AppShell", export: name }] }, bindings: data.bindings as SurfaceFrameEntry["bindings"],
    dependencies: [{ module: "react", version: "19.3.0", license: "MIT" }, { module: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }, ...["blocks", "frames", "shell", "theme"].map(path => ({ module: `@clossys/designer/${path}`, version: "0.12.0", license: "MIT" }))],
    license: "MIT", pin: { kind: "git", url: adapter.pin.url, commit: data.commit, files: surfaceManifest(upstream) }, notice: notice.path, outputSha256: surfaceManifest(files), blockers: [],
  };
  const recipe = [{ path: "rules/shadcn-aria-app-shell-v1.json", content: stableStringify({ port: data.port, output: data.output, operation: "official-sidebar-token-frame-port" }) }];
  const transform: SurfaceTransform = {
    identity: { id: "shadcn-aria-app-shell", version: "1", sha256: surfaceDigest(surfaceManifest(recipe)).slice(7) }, source: recipe,
    run: ({ candidate, upstream: actual }) => {
      if (stableStringify(surfaceManifest(actual)) !== stableStringify(frame.pin.files) || candidate.slot !== slot) throw new Error("shadcn-frames: immutable source mismatch");
      return { fill: frame, files: structuredClone(files), blockers: [] };
    },
  };
  const fill: SurfaceCandidateDocument = { $extensions: { "com.clossys.fill": { id: `${source}/${slot}`, slot, source, mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${data.upstream[0]!.path}`, relation: "same-contract", builtOn: frame.composes, conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft" } }, frames: { "app-shell": frame } };
  return { fills: [fill], transforms: [transform], upstream, files };
}

/** Immutable recipe receipts for the specified consumer; the normal materializer still verifies every byte. */
export function shadcnFrameMaterializations(catalog: CompositeCatalogData, consumerSource: string): SurfaceMaterializationReceipt[] {
  const imported = importShadcnFrames(), doc = imported.fills[0]!, candidate = Object.values(doc.frames!)[0]!, transform = imported.transforms[0]!;
  const base: SurfaceBase = { source: candidate.source, fill: doc.$extensions["com.clossys.fill"].id, license: candidate.license, pin: candidate.pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: candidate.pin.files, notices: candidate.pin.files.filter(row => row.path === "LICENSE.md") };
  const text = stableStringify({ version: 1, base, transform: transform.identity, rule: null, inputs: [] });
  const files = [...imported.files, { path: `surfaces/receipts/r-${sha256(text)}.json`, content: text }];
  const fill = { ...candidate, source: consumerSource, outputSha256: surfaceManifest(files) };
  return [{ operation: "adopt", slot: candidate.slot, baseDescriptorHash: base.descriptorHash, transform: transform.identity, rule: null, inputsHash: surfaceDerivationHash(base, transform.identity, null, catalog, candidate.slot, []), descriptorHash: surfaceDescriptorHash(fill), outputSha256: fill.outputSha256 }];
}
