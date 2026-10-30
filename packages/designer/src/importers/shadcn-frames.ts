import data from "./vendor/shadcn-app-shell.data.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { surfaceDigest, surfaceManifest } from "../catalog-core/surface-library.js";
import type { SurfaceCandidateDocument, SurfaceFrameEntry, SurfaceTransform } from "../catalog-core/surface-types.js";

/** Authenticated official sidebar input and the explicit, token-based frame port. */
export function importShadcnFrames() {
  for (const file of data.upstream) if (sha256(file.content) !== file.sha256) throw new Error("shadcn-frames: upstream source differs from pin");
  const source = "shadcn@aria", slot = "frames.app-shell", name = "ShadcnAppShell";
  const upstream = data.upstream.map(({ path, content }) => ({ path, content }));
  const notice = { path: "notices/shadcn-app-shell.txt", content: data.upstream.find(file => file.path === "LICENSE.md")!.content };
  const files = [data.output, notice];
  const binding = (path: readonly string[]) => ({ export: name, path });
  const field = (path: string) => binding(path.split("."));
  const slots = Object.fromEntries(Object.entries({ "skip-link": "skipLabel", sidebar: "navigation", header: "context", main: "children", inspector: "rightPanel", command: "commands", "page-module": "pageModule", progress: "progress", state: "stateViews", toasts: "toasts" }).map(([key, path]) => [key, field(path)]));
  const propMap = Object.fromEntries(["layout.standard", "layout.immersive", "stage.contained", "stage.full", "theme.system", "theme.light", "theme.dark"].map(member => [member, field(member.startsWith("theme.") ? "theme.defaultPreference" : member.split(".")[0]!)]));
  const statePorts = Object.fromEntries(Object.entries({ "sidebar-collapsed": ["navigation.collapsed", "navigation.onCollapsedChange"], "inspector-collapsed": ["rightPanel.collapsed", "rightPanel.onCollapsedChange"], width: ["rightPanel.value", "rightPanel.onChange"], theme: ["theme.preference", "theme.onPreferenceChange"], navigating: ["state.navigating", "state.navigating"], "main-state": ["state.main", "state.main"] }).map(([key, [value, change]]) => [key, { value: field(value!), change: field(change!) }]));
  const frame: SurfaceFrameEntry = {
    kind: "frame", slot, source, impl: { kind: "source", entry: data.output.path, export: name }, rendering: "client", members: Object.keys(propMap), states: ["default"],
    slots, propMap, statePorts,
    reads: { tokens: ["tokens.body-size", "tokens.border-color", "tokens.control-radius", "tokens.spacing", "tokens.surface-color", "tokens.text-color"], assets: [] },
    composes: ["components.button", "components.logo", "components.menu", "components.semantic-content", "components.sidebar", "frames.app-header", "frames.command", "frames.inspector"], parts: [],
    api: { version: 1, exports: [{ name: "AppShell", export: name }] }, bindings: [],
    dependencies: [{ module: "react", version: "19.3.0", license: "MIT" }, { module: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }, ...["components", "blocks", "frames", "shell", "theme"].map(path => ({ module: `@clossys/designer/${path}`, version: "0.12.0", license: "MIT" }))],
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
