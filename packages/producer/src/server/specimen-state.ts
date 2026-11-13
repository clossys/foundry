import { posix } from "node:path";
import { installedPath } from "@clossys/publisher/specimen";

/**
 * Specimen states: how a slot shows its items when their resting render is empty or hidden.
 *
 * A slot declares one state and the specimen renderer applies it to every item pinned or
 * recorded in that slot, so no item needs a per-item specimen tweak. (Sample children need no
 * state: every item renders the children its preview fixture declares, see specimen-tree.ts.)
 * - `open`: the item's surface is opened on mount through the slot's opener
 *   (a toast region shows one toast instead of nothing);
 * - `visible`: content hidden until focus (`sr-only` with a focus-visible reveal) renders
 *   in its revealed form (a skip link shows instead of nothing);
 * - `provider`: the item reads a context its stock provider supplies, so it mounts inside that
 *   provider (a sidebar row calls `useSidebar`, which throws outside `SidebarProvider`), given the
 *   state's `props`.
 * A slot with no declaration renders the item at rest.
 */
export type SpecimenState =
  | { readonly state: "open"; readonly opener: { readonly module: string; readonly export: string }; readonly sample: string }
  | { readonly state: "visible" }
  | { readonly state: "provider"; readonly provider: { readonly module: string; readonly export: string; readonly props?: Readonly<Record<string, unknown>> } };

const REACT_FLOW: SpecimenState = { state: "provider", provider: { module: "@xyflow/react", export: "ReactFlowProvider" } };
// The specimen needs the sidebar context only: the provider's layout wrapper is `min-h-svh`, which
// would fill the specimen frame by itself and push the item past it, so it sizes to its content.
const SIDEBAR: SpecimenState = { state: "provider", provider: { module: "@/components/ui/sidebar", export: "SidebarProvider", props: { style: { minHeight: 0 } } } };

export const SLOT_SPECIMEN_STATES: Readonly<Record<string, SpecimenState>> = {
  "components.toast": { state: "open", opener: { module: "sonner", export: "toast" }, sample: "Changes saved" },
  "components.skip-nav": { state: "visible" },
  // Sidebar parts call `useSidebar`, which throws outside `SidebarProvider`: every slot with a
  // recorded candidate that mounts one bare. (The chart and progress slots mount their own provider.)
  "components.sidebar": SIDEBAR,
  "components.navigation-tree": SIDEBAR,
  "components.studio.sidebar-static-row": SIDEBAR,
  // React Flow parts read the flow store (`Handle`, `Background`), which throws outside `ReactFlowProvider`.
  "components.flow.canvas": REACT_FLOW,
  "components.flow.base-handle": REACT_FLOW,
  "components.flow.labeled-handle": REACT_FLOW,
};

export function specimenStateOf(slot: string): SpecimenState | undefined {
  return SLOT_SPECIMEN_STATES[slot];
}

/** An installed code file of an item: its substrate path (`components/ui/sidebar.tsx`) and bytes. */
export interface InstalledCode { readonly path: string; readonly content: string }

/** A registry item's code files at the substrate paths the shadcn CLI installs them to. */
export function installedCode(item: unknown): InstalledCode[] {
  const record = item && typeof item === "object" ? item as { type?: unknown; files?: unknown } : {};
  const files = Array.isArray(record.files) ? record.files as { path?: unknown; type?: unknown; target?: unknown; content?: unknown }[] : [];
  return files.flatMap(file => {
    if (typeof file.path !== "string" || typeof file.content !== "string" || !/\.(?:[cm]?[jt]sx?)$/.test(file.path)) return [];
    const type = typeof file.type === "string" ? file.type : typeof record.type === "string" ? record.type : undefined;
    const path = installedPath({ path: file.path, ...(type ? { type } : {}), ...(typeof file.target === "string" ? { target: file.target } : {}) });
    return path ? [{ path, content: file.content }] : [];
  });
}

const CODE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** The specifier a substrate file answers to: `components/ui/sidebar.tsx` is `@/components/ui/sidebar`. */
function moduleOf(path: string): string {
  return `@/${path.replace(CODE_EXTENSION, "")}`;
}

/**
 * Whether an item reads `module`: one of its installed files is that module, or imports it by
 * package name, `@/` alias or a relative path resolved from the file's installed path.
 */
function readsModule(files: readonly InstalledCode[], module: string): boolean {
  return files.some(file => moduleOf(file.path) === module || [...file.content.matchAll(IMPORT_SPECIFIER)].some(([, specifier]) => {
    const resolved = specifier!.startsWith(".") ? moduleOf(posix.join(posix.dirname(file.path), specifier!)) : specifier!.replace(CODE_EXTENSION, "");
    return resolved === module;
  }));
}

/**
 * The state one item of `slot` mounts in. A slot's provider state wraps only an item that reads
 * the provider's module, and never an item whose entry is that provider (the same export of the
 * same module): it would mount inside a second copy of itself (a `SidebarProvider` preview inside
 * the slot's `SidebarProvider`, whose `min-h-svh` wrapper then overrides the fixture's height).
 * `entry` is the mounted file's installed path and export (none: the first component export).
 */
export function itemSpecimenState(slot: string, files: readonly InstalledCode[], entry: { readonly file: string; readonly export?: string | undefined }): SpecimenState | undefined {
  const state = specimenStateOf(slot);
  if (state?.state !== "provider") return state;
  const { module, export: name } = state.provider;
  if (entry.export === name && moduleOf(entry.file) === module) return undefined;
  return readsModule(files, module) ? state : undefined;
}

/** CSS that renders `sr-only` content in its revealed form, scoped to a `visible` specimen. */
export const VISIBLE_STATE_CSS = "[data-specimen-state=visible] .sr-only{position:static;width:auto;height:auto;margin:0;padding:revert-layer;overflow:visible;clip:auto;clip-path:none;white-space:normal}";

/** Resolve a preview fixture value against the item's bound copy: `{ "$copy": key }` becomes its text. */
export function resolveSampleCopy(value: unknown, text: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map(item => resolveSampleCopy(item, text));
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.$copy === "string") return Object.hasOwn(text, node.$copy) ? text[node.$copy] : "";
  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, resolveSampleCopy(item, text)]));
}
