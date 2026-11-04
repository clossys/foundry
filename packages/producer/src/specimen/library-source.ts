/**
 * Publisher's specimen transport over canonical Designer slots. Consumer roots
 * hold agents/designer/ia.json; no legacy library or selection store is read.
 * Publisher renders the validated inline registry item and its recorded preview.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { adaptTheme, installedPath, recordStoreSource, type SpecimenAliasContext, type SpecimenElementVersion, type SpecimenRecordSource, type SpecimenRecordStore, type SpecimenTheme } from "@clossys/publisher/specimen";
import { listSlots, pinStamp, readCandidate, readSlot, readSlotEntry, type SlotEntry } from "../records/slots.js";
import { CANDIDATE_NAME, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";
import { RecordError } from "../records/validate.js";
import { dependencyPart, fixtureChildren, itemDependencies, moduleExports, pinnedWriterCopy, specimenTreeIssues, treeDependencyParts } from "../server/specimen-tree.js";
import { specimenStateOf, VISIBLE_STATE_CSS } from "../server/specimen-state.js";

const SEGMENT = /^[a-z0-9][a-z0-9.-]*$/;
export interface LibrarySourceOptions {
  /** Canonical consumer roots, searched in order. */
  readonly roots: readonly string[];
  readonly defaultTheme?: string;
  /**
   * The stock shadcn registry base an install falls back to (a directory laid out as installed:
   * `components/ui/*.tsx`, `hooks/*.ts`, `lib/*.ts`). It answers an `@/` import only when no pinned
   * candidate installs it and the importing closure declares that name in `registryDependencies`,
   * exactly as `shadcn add` fetches an unnamespaced dependency from the shadcn registry.
   */
  readonly registryBase?: string;
}

function versions(entry: SlotEntry, element: string): { name: string; version: number }[] {
  return entry.candidates.flatMap(name => {
    const match = CANDIDATE_NAME.exec(name);
    return match?.[1] === element && match[3] === "json" ? [{ name, version: Number(match[2]) }] : [];
  });
}

function findLibraryElement(roots: readonly string[], id: string): { root: string; entry: SlotEntry; element: string } | undefined {
  const parts = id.split("/");
  if (parts.length > 2 || !parts.every(part => SEGMENT.test(part) && !part.includes(".."))) return undefined;
  const element = parts.at(-1)!;
  for (const root of roots) {
    // A slot-qualified id reads only its own slot folder: a full listing per load made every
    // specimen read O(slots) and a whole pass O(slots^2) synchronous filesystem work.
    if (parts.length === 2) {
      const entry = readSlotEntry(root, "designer", parts[0]!);
      if (entry && versions(entry, element).length) return { root, entry, element };
      continue;
    }
    const matches = listSlots(root, "designer").filter(entry => versions(entry, element).length);
    if (matches.length > 1) throw new Error(`element ${element} is in ${matches.length} slots (${matches.map(entry => entry.id).join(", ")}); name it as <slot>/${element}`);
    if (matches.length) return { root, entry: matches[0]!, element };
  }
  return undefined;
}

/** Locate only candidates placed in the Designer IA; a bare name must be unique. */
export function locateLibraryElement(roots: readonly string[], id: string): { root: string; slot: string; element: string } | undefined {
  const found = findLibraryElement(roots, id);
  return found && { root: found.root, slot: found.entry.id, element: found.element };
}

function pinnedVersionOf(entry: SlotEntry | undefined, element: string): number | undefined {
  const pin = entry?.pin;
  const match = pin && CANDIDATE_NAME.exec(pin.candidate);
  return match && match[1] === element ? Number(match[2]) : undefined;
}

/** A missing or invalid pin never selects the newest candidate. */
export function pinnedLibraryVersion(root: string, slot: string, element: string): number | undefined {
  return pinnedVersionOf(readSlotEntry(root, "designer", slot), element);
}

const CODE_EXT = [".tsx", ".ts", ".jsx", ".js"];
const stripExt = (path: string) => path.replace(/\.(?:[cm]?[jt]sx?)$/, "");
interface Provider { readonly id: string; readonly content: string }
type InstallIndex = ReadonlyMap<string, readonly Provider[]>;

/** `@/<path>` (no extension) -> the pinned Designer elements whose registry files install it. */
function installIndex(roots: readonly string[]): InstallIndex {
  const index = new Map<string, Provider[]>();
  for (const root of roots) {
    const own = new Map<string, Provider[]>();
    for (const entry of listSlots(root, "designer")) {
      const match = entry.pin && CANDIDATE_NAME.exec(entry.pin.candidate);
      if (!match || match[3] !== "json") continue;
      let item: { files?: { path?: unknown; type?: unknown; target?: unknown; content?: unknown }[] };
      try { item = JSON.parse(readCandidate(root, "designer", entry.id, entry.pin!.candidate).bytes); } catch { continue; }
      const id = `${entry.id}/${match[1]}`;
      for (const file of item.files ?? []) {
        if (typeof file.path !== "string" || typeof file.content !== "string") continue;
        const installed = installedPath({ path: file.path, ...(typeof file.type === "string" ? { type: file.type } : {}), ...(typeof file.target === "string" ? { target: file.target } : {}) });
        if (!installed || !CODE_EXT.some(ext => installed.endsWith(ext))) continue;
        const key = stripExt(installed);
        own.set(key, [...(own.get(key) ?? []), { id, content: file.content }]);
      }
    }
    // The first consumer root that installs a path owns it, as in element lookup.
    for (const [key, providers] of own) if (!index.has(key)) index.set(key, providers);
  }
  return index;
}

/**
 * The one provider of an installed path: alone, else the slot named after the file
 * (`components/ui/button` -> `components.button`), else identical bytes; otherwise ambiguous.
 */
export function aliasProvider(index: InstallIndex, alias: string): string | undefined {
  const providers = index.get(stripExt(alias)) ?? index.get(`${stripExt(alias)}/index`);
  if (!providers?.length) return undefined;
  if (providers.length === 1) return providers[0]!.id;
  const base = posix.basename(stripExt(alias));
  const named = providers.filter(row => row.id.split("/")[0]!.split(".").at(-1) === base);
  if (named.length === 1) return named[0]!.id;
  if (providers.every(row => row.content === providers[0]!.content)) return [...providers].sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
  throw new Error(`@/${alias} is installed by ${providers.length} pinned candidates (${providers.map(row => row.id).join(", ")})`);
}

/** The stock registry file for `@/<alias>`, only when the closure declares it a registry dependency. */
function registryBaseItem(base: string, alias: string, context: SpecimenAliasContext): SpecimenElementVersion | undefined {
  const name = posix.basename(stripExt(alias));
  if (!context.registryDependencies.includes(name) || alias.split("/").some(part => part === ".." || part === "." || !part)) return undefined;
  for (const ext of CODE_EXT) {
    const file = join(base, `${stripExt(alias)}${ext}`);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const target = `${stripExt(alias)}${ext}`;
    const raw = JSON.stringify({ name, type: "registry:ui", files: [{ path: target, type: "registry:ui", target, content }] });
    return { id: `registry/${name}`, version: 1, kind: "visual", layer: "components", files: [{ path: `${name}.json`, content: raw }], preview: {}, contentHash: "" };
  }
  return undefined;
}

/** A fingerprint of every Designer pin (path + mtime + size), so an edited pin rebuilds the index. */
function pinFingerprint(roots: readonly string[]): string {
  return roots.flatMap(root => listSlots(root, "designer").map(entry => {
    return `${entry.id}:${pinStamp(entry.dir)}`;
  })).join("|");
}

/** Every byte and the pin come from the common model reader. No store fallback. */
export function libraryRecordStore(rootsIn: readonly string[], options: { readonly registryBase?: string } = {}): SpecimenRecordStore {
  const roots = rootsIn.map(root => resolve(root));
  let cached: { at: number; fingerprint: string; index: InstallIndex } | undefined;
  const index = (): InstallIndex => {
    // One fingerprint pass per second at most: alias lookups come in bursts per build.
    const now = Date.now();
    if (cached && now - cached.at < 1000) return cached.index;
    const fingerprint = pinFingerprint(roots);
    cached = { at: now, fingerprint, index: cached?.fingerprint === fingerprint ? cached.index : installIndex(roots) };
    return cached.index;
  };
  const store: SpecimenRecordStore = {
    async alias(alias, context) {
      const id = aliasProvider(index(), alias);
      if (id) return store.load(id);
      return options.registryBase ? registryBaseItem(options.registryBase, alias, context) : undefined;
    },
    async load(id, version) {
      const where = findLibraryElement(roots, id);
      if (!where) return undefined;
      const { root, entry, element } = where, slot = entry.id;
      const chosen = version ?? pinnedVersionOf(entry, element);
      if (chosen === undefined) return undefined;
      const candidate = versions(entry, element).find(candidate => candidate.version === chosen);
      if (!candidate) return undefined;
      const doc = readSlot(root, "designer", slot);
      const docIssues = validateSlotDoc(doc);
      if (docIssues.length) throw new RecordError(`slot ${slot}`, docIssues);
      if (doc.id !== slot || doc.agent !== "designer" || doc.kind !== "element" || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) docIssues.push({ code: "slot-mismatch", path: "slot.json", message: "slot identity or position differs from the IA" });
      if (docIssues.length) throw new RecordError(`slot ${slot}`, docIssues);
      const read = readCandidate(root, "designer", slot, candidate.name);
      const issues = validateCandidate("element", slot, candidate.name, read.bytes);
      if (entry.pin?.candidate === candidate.name && entry.pin.sha256 !== read.sha256) issues.push({ code: "pin-hash", path: "pin.json", message: "pinned candidate bytes do not match sha256" });
      if (issues.length) throw new RecordError(`candidate ${slot}/${candidate.name}`, issues);
      const item = JSON.parse(read.bytes);
      if (item.name !== element || (item.meta?.element?.id !== undefined && item.meta.element.id !== element) || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== slot)) throw new Error(`candidate ${slot}/${candidate.name}: element identity differs from the candidate name or slot`);
      const row: SpecimenElementVersion = {
        id: `${slot}/${element}`, version: chosen, kind: item.type, layer: entry.position.l0 ?? slot.split(".")[0]!,
        files: [{ path: `${element}.json`, content: read.bytes }], preview: previewWithTree(root, `${slot}/${candidate.name}`, item), contentHash: read.sha256,
      };
      return withSlotState(slot, item, withDependencyParts(row));
    },
  };
  return store;
}

/**
 * A preview whose fixtures declare an element tree (see server/specimen-tree.ts): every
 * `$component` must be an export of the fixture's own file and every `$copy` a pinned Writer key;
 * the keys it names are added to the preview copy the renderer resolves them from.
 */
function previewWithTree(root: string, where: string, item: { files?: { path?: unknown; content?: unknown }[]; meta?: { preview?: unknown } }): Record<string, unknown> {
  const preview = (item.meta?.preview ?? {}) as Record<string, unknown>;
  const fixtures = preview.fixtures as Record<string, unknown> | undefined;
  const tree = fixtureChildren(fixtures);
  if (tree === undefined) return preview;
  const file = typeof fixtures?.file === "string" ? fixtures.file : typeof preview.entry === "string" ? preview.entry : undefined;
  const source = item.files?.find(row => row.path === file)?.content;
  if (typeof source !== "string") throw new Error(`candidate ${where}: the preview tree names no file of the candidate`);
  const writer = pinnedWriterCopy(root);
  const issues = specimenTreeIssues(tree, moduleExports(source), writer, itemDependencies(item));
  if (issues.length) throw new Error(`candidate ${where}: ${issues.join("; ")}`);
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (typeof node.$copy === "string") keys.add(node.$copy);
      else Object.values(node).forEach(walk);
    }
  };
  walk(tree);
  const own = preview.copy && typeof preview.copy === "object" ? preview.copy as Record<string, unknown> : {};
  return { ...preview, copy: { ...Object.fromEntries([...keys].map(key => [key, writer[key]!])), ...own } };
}

/** The module a fixture tree's `<package>.<Export>` elements are mounted from. */
export const SPECIMEN_PARTS_FILE = "specimen/parts.tsx";

/**
 * A fixture tree that names exports of the candidate's own npm dependencies (`recharts.BarChart`
 * under a shadcn `ChartContainer`) mounts from one generated module: it re-exports the fixture
 * file and each named dependency export under a local name, and the tree names those. The
 * candidate bytes are unchanged; the module joins the record's files as the fixture file.
 */
function withDependencyParts(row: SpecimenElementVersion): SpecimenElementVersion {
  const preview = (row.preview && typeof row.preview === "object" ? row.preview : {}) as Record<string, unknown>;
  const fixtures = preview.fixtures && typeof preview.fixtures === "object" ? preview.fixtures as Record<string, unknown> : undefined;
  if (!fixtures || typeof fixtures.file !== "string" || typeof fixtures.export !== "string") return row;
  const parts = treeDependencyParts(fixtureChildren(fixtures));
  if (!parts.length) return row;
  const local = (name: string) => { const part = dependencyPart(name)!; return `${part.module.replace(/[^A-Za-z0-9_$]/g, "_")}$${part.export}`; };
  const target = posix.relative(posix.dirname(SPECIMEN_PARTS_FILE), fixtures.file.replace(CODE_FILE, ""));
  const byModule = new Map<string, string[]>();
  for (const name of parts) { const part = dependencyPart(name)!; byModule.set(part.module, [...(byModule.get(part.module) ?? []), `${part.export} as ${local(name)}`]); }
  const source = [
    "// Generated by Producer: the fixture file's exports and the dependency exports its tree names.",
    `export * from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`,
    ...[...byModule].map(([module, names]) => `export { ${names.join(", ")} } from ${JSON.stringify(module)};`),
    "",
  ].join("\n");
  const rename = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rename);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "$component" && typeof item === "string" && dependencyPart(item) ? local(item) : rename(item)]));
  };
  return {
    ...row,
    files: [...row.files, { path: SPECIMEN_PARTS_FILE, content: source }],
    preview: { ...preview, fixtures: { ...fixtures, file: SPECIMEN_PARTS_FILE, props: rename(fixtures.props) } },
    contentHash: createHash("sha256").update(row.contentHash).update("\0").update(source).digest("hex"),
  };
}

/** The specimen module a slot's declared state mounts the item through (see server/specimen-state.ts). */
export const SPECIMEN_STATE_FILE = "specimen/state.tsx";
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * An item in its slot's declared specimen state, as the installed path shows it: a slot whose
 * resting render is empty or hidden (a toast region, a skip link) mounts every item through one
 * generated module that renders the item's own entry export with its fixtures and applies the
 * state, `open` (the slot's opener shows one sample surface) or `visible` (focus-only content
 * shown revealed). The candidate bytes are unchanged; the module joins the record's files and
 * becomes the preview entry. A slot with no declared state is returned as it is.
 */
function withSlotState(slot: string, item: { files?: { path?: unknown; type?: unknown }[] }, row: SpecimenElementVersion): SpecimenElementVersion {
  const state = specimenStateOf(slot);
  if (!state) return row;
  const preview = (row.preview && typeof row.preview === "object" ? row.preview : {}) as Record<string, unknown>;
  const fixtures = preview.fixtures && typeof preview.fixtures === "object" ? preview.fixtures as Record<string, unknown> : undefined;
  const descriptor = !!fixtures && typeof fixtures.file === "string" && typeof fixtures.export === "string";
  const code = (item.files ?? []).filter((file): file is { path: string; type?: unknown } => typeof file.path === "string" && CODE_FILE.test(file.path));
  const entry = descriptor ? fixtures!.file as string : typeof preview.entry === "string" ? preview.entry : (code.find(file => typeof file.type === "string" && /registry:(?:ui|component|block|page)/.test(file.type)) ?? code[0])?.path;
  if (!entry) return row;
  const exported = descriptor ? fixtures!.export as string : typeof preview.export === "string" ? preview.export : undefined;
  const props = descriptor ? fixtures!.props : fixtures;
  const target = posix.relative(posix.dirname(SPECIMEN_STATE_FILE), entry.replace(CODE_FILE, ""));
  const open = state.state === "open" ? state : undefined;
  const source = [
    "// Generated by Producer: the item in its slot's declared specimen state.",
    `import { ${open ? "useEffect, " : ""}createElement } from "react";`,
    ...(open ? [`import { ${open.opener.export} as openSpecimen } from ${JSON.stringify(open.opener.module)};`] : []),
    `import * as Item from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`,
    // The item's own exports stay reachable for a fixture element tree.
    `export * from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`,
    "const pick = (name) => (name && Item[name]) || Item.default || Object.values(Item).find(value => typeof value === \"function\" || (!!value && typeof value === \"object\" && \"$$typeof\" in value));",
    "export function SpecimenState(props) {",
    `  const Root = pick(${JSON.stringify(exported ?? "")});`,
    ...(open ? [`  useEffect(() => { openSpecimen(${JSON.stringify(open.sample)}, { duration: Infinity }); }, []);`] : []),
    `  return createElement("div", { "data-specimen-state": ${JSON.stringify(state.state)} }, ${state.state === "visible" ? `createElement("style", null, ${JSON.stringify(VISIBLE_STATE_CSS)}), ` : ""}createElement(Root, props));`,
    "}",
    "",
  ].join("\n");
  const { fixtures: _fixtures, entry: _entry, export: _export, ...rest } = preview;
  return {
    ...row,
    files: [...row.files, { path: SPECIMEN_STATE_FILE, content: source }],
    preview: { ...rest, entry: SPECIMEN_STATE_FILE, export: "SpecimenState", ...(props && typeof props === "object" ? { fixtures: props } : {}) },
    contentHash: createHash("sha256").update(row.contentHash).update("\0").update(source).digest("hex"),
  };
}

/** The id the composed pinned theme answers to. */
export const PINNED_THEME_ID = "themes";

/**
 * The consumer's pinned theme as one theme: every pinned `themes.*` item that carries shadcn
 * `cssVars` (one variable each, or a whole theme), merged by variable name. The first consumer
 * root that sets a variable owns it, as in element lookup. A candidate whose bytes do not match
 * its pin adds nothing.
 */
export function pinnedLibraryTheme(rootsIn: readonly string[]): SpecimenTheme | undefined {
  const merged: Record<"theme" | "light" | "dark", Record<string, string>> = { theme: {}, light: {}, dark: {} };
  const hashes: string[] = [];
  for (const root of rootsIn.map(root => resolve(root))) {
    const own: typeof merged = { theme: {}, light: {}, dark: {} };
    for (const entry of listSlots(root, "designer")) {
      if (!entry.pin || !entry.id.startsWith("themes.")) continue;
      let item: { cssVars?: Record<string, unknown> } | undefined;
      try {
        const read = readCandidate(root, "designer", entry.id, entry.pin.candidate);
        if (read.sha256 !== entry.pin.sha256) continue;
        item = JSON.parse(read.bytes);
        hashes.push(`${entry.id}:${read.sha256}`);
      } catch { continue; }
      for (const mode of ["theme", "light", "dark"] as const) {
        const vars = item?.cssVars?.[mode];
        if (vars && typeof vars === "object" && !Array.isArray(vars)) Object.assign(own[mode], vars);
      }
    }
    for (const mode of ["theme", "light", "dark"] as const) merged[mode] = { ...own[mode], ...merged[mode] };
  }
  if (!Object.keys(merged.light).length) return undefined;
  const raw = JSON.stringify({ name: PINNED_THEME_ID, type: "registry:theme", cssVars: merged });
  return adaptTheme(PINNED_THEME_ID, raw, createHash("sha256").update(hashes.sort().join("\n")).digest("hex"));
}

/**
 * Library records with the consumer's pinned theme: a specimen that names no theme (or names
 * `themes`) gets every pinned theme variable, light and dark, not one `themes.*` leaf.
 */
export function libraryRecordSource(options: LibrarySourceOptions): SpecimenRecordSource {
  const base = recordStoreSource(libraryRecordStore(options.roots, options.registryBase ? { registryBase: options.registryBase } : {}), options.defaultTheme ? { defaultTheme: options.defaultTheme } : {});
  return {
    ...base,
    async theme(id) {
      if (id === PINNED_THEME_ID || (id === undefined && !options.defaultTheme)) return pinnedLibraryTheme(options.roots);
      return base.theme(id);
    },
  };
}

/** Actual candidate identities, in IA slots only; first consumer wins a repeat. */
export function listLibraryElements(rootsIn: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const root of rootsIn) for (const entry of listSlots(resolve(root), "designer")) for (const name of entry.candidates) {
    const match = CANDIDATE_NAME.exec(name);
    if (match?.[3] === "json") ids.add(`${entry.id}/${match[1]}`);
  }
  return [...ids].sort();
}
