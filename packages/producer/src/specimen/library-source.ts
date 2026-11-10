/**
 * Publisher's specimen transport over canonical Designer slots. Consumer roots
 * hold agents/designer/ia.json; no legacy library or selection store is read.
 * Publisher renders the validated inline registry item and its recorded preview.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { adaptTheme, installedPath, recordStoreSource, SPECIMEN_SAMPLE_COPY_KEYS, type SpecimenAliasContext, type SpecimenElementVersion, type SpecimenRecordSource, type SpecimenRecordStore, type SpecimenTheme } from "@clossys/publisher/specimen";
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
  /**
   * The pinned Writer copy specimen inputs read (`pinnedWriterCopy` of the one root), taken once by
   * a caller that loads many candidates in one pass. Without it each candidate load scans Writer.
   */
  readonly writerCopy?: Readonly<Record<string, string>>;
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
      // A pinned Designer candidate that cannot be read or parsed is an error, not a missing provider.
      try { item = JSON.parse(readCandidate(root, "designer", entry.id, entry.pin!.candidate).bytes); }
      catch (error) { throw new Error(`Designer slot ${entry.id}: pinned candidate ${entry.pin!.candidate} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`); }
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
export function libraryRecordStore(rootsIn: readonly string[], options: { readonly registryBase?: string; readonly writerCopy?: Readonly<Record<string, string>> } = {}): SpecimenRecordStore {
  const roots = rootsIn.map(root => resolve(root));
  if (options.writerCopy && roots.length !== 1) throw new Error("a Writer copy snapshot belongs to exactly one consumer root");
  let cached: { at: number; fingerprint: string; index: InstallIndex } | undefined;
  const index = (): InstallIndex => {
    // One fingerprint pass per second at most: alias lookups come in bursts per build.
    const now = Date.now();
    if (cached && now - cached.at < 1000) return cached.index;
    const fingerprint = pinFingerprint(roots);
    cached = { at: now, fingerprint, index: cached?.fingerprint === fingerprint ? cached.index : installIndex(roots) };
    return cached.index;
  };
  // A caller's Writer snapshot (one scan per specimen pass) or a scan of the root per load.
  const writer = (root: string) => options.writerCopy ? () => options.writerCopy! : () => pinnedWriterCopy(root);
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
      const specimen = specimenInputs(root, `${slot}/${candidate.name}`, item, true, writer(root));
      const row: SpecimenElementVersion = {
        id: `${slot}/${element}`, version: chosen, kind: item.type, layer: entry.position.l0 ?? slot.split(".")[0]!,
        files: [{ path: `${element}.json`, content: read.bytes }], preview: specimen.preview, contentHash: read.sha256,
      };
      return withSlotState(slot, item, withSlotInputs(`${slot}/${candidate.name}`, specimen, withDependencyParts(row)));
    },
  };
  return store;
}

type CandidateItem = { type?: unknown; files?: { path?: unknown; type?: unknown; target?: unknown; content?: unknown }[]; meta?: { preview?: unknown; element?: { reads?: { copyKeys?: unknown } } } };

/** One declared copy slot (`meta.element.reads.copyKeys` entry); a bare string there is a key the element reads through host data. */
interface CopySlotEntry { readonly slot: string; readonly prop: string; readonly previewKey: string }
/** The candidate's declared copy slots: the `{ slot, prop, previewKey }` entries of `meta.element.reads.copyKeys`. */
function declaredCopySlots(item: CandidateItem): CopySlotEntry[] {
  const keys = item.meta?.element?.reads?.copyKeys;
  return Array.isArray(keys) ? keys.filter((key): key is CopySlotEntry => !!key && typeof key === "object") : [];
}

/** One slot a specimen mounts through `{ "$element": "<slot>" }`: its pinned item's entry, import and resolved props. */
interface SlotInput { readonly slot: string; readonly sha256: string; readonly module: string; readonly export: string; readonly props: unknown }

/** A candidate's specimen preview with every input resolved from the pins, and the slots it mounts. */
interface SpecimenInputs { readonly preview: Record<string, unknown>; readonly slots: readonly SlotInput[] }

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && !!item);

/** Every `{ "$copy" }` key and `{ "$element" }` slot a fixture names, at any depth (props and element trees). */
function fixtureRefs(value: unknown, found = { copy: new Set<string>(), slots: new Set<string>() }) {
  if (Array.isArray(value)) value.forEach(item => fixtureRefs(item, found));
  else if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typeof node.$copy === "string") found.copy.add(node.$copy);
    if (typeof node.$element === "string") found.slots.add(node.$element);
    Object.values(node).forEach(item => fixtureRefs(item, found));
  }
  return found;
}

/** `{ "$copy": key }` -> the key's text, everywhere in a value. */
function withCopy(value: unknown, copy: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map(item => withCopy(item, copy));
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.$copy === "string") return copy[node.$copy];
  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, withCopy(item, copy)]));
}

/**
 * The inputs a candidate's specimen reads, each from its pin. A candidate declares them in
 * `meta.preview.inputs`: `copy`, the Writer keys its fixtures name (`{ "$copy": key }`), and
 * `slots`, the Designer slots its fixtures mount (`{ "$element": slot }`). The specimen copy is
 * the pinned Writer text of exactly the declared keys, so a changed Writer pin changes the
 * specimen; a candidate carries no copy snapshot of its own (`preview.copy` must be empty). A
 * fixture reference that is not declared, a declared key no pinned Writer slot holds and a
 * declared slot with no Designer pin are errors. Theme and font items also get the pinned text
 * of the token specimens' sample keys (SPECIMEN_SAMPLE_COPY_KEYS), which the renderer sets.
 *
 * A fixture element tree (see server/specimen-tree.ts) is checked as before: every `$component`
 * must be an export of the fixture's own file and every `$copy` a pinned Writer key.
 */
function specimenInputs(root: string, where: string, item: CandidateItem, mounting = true, writerSource: () => Readonly<Record<string, string>> = () => pinnedWriterCopy(root)): SpecimenInputs {
  const preview = { ...(item.meta?.preview && typeof item.meta.preview === "object" ? item.meta.preview as Record<string, unknown> : {}) };
  const fixtures = preview.fixtures as Record<string, unknown> | undefined;
  const raw = preview.inputs;
  const issues: string[] = [];
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => key !== "copy" && key !== "slots"))) throw new Error(`candidate ${where}: meta.preview.inputs must be { copy?: [<writer key>], slots?: [<designer slot>] }`);
  const declared = (raw ?? {}) as { copy?: unknown; slots?: unknown };
  if (declared.copy !== undefined && !strings(declared.copy)) throw new Error(`candidate ${where}: meta.preview.inputs.copy must list Writer keys`);
  if (declared.slots !== undefined && !strings(declared.slots)) throw new Error(`candidate ${where}: meta.preview.inputs.slots must list Designer slot ids`);
  const copyKeys = (declared.copy ?? []) as string[], slotIds = (declared.slots ?? []) as string[];
  const own = preview.copy;
  if (own !== undefined && (!own || typeof own !== "object" || Object.keys(own).length)) issues.push("preview.copy is a copy snapshot; the specimen reads Writer copy from the pinned Writer slots through meta.preview.inputs.copy");
  // Read lazily: most candidates declare no copy, and a Writer scan per load is the slow part.
  let cached: Readonly<Record<string, string>> | undefined;
  const writer = () => cached ??= writerSource();
  const tree = fixtureChildren(fixtures);
  if (tree !== undefined) {
    const file = typeof fixtures?.file === "string" ? fixtures.file : typeof preview.entry === "string" ? preview.entry : undefined;
    const source = item.files?.find(row => row.path === file)?.content;
    if (typeof source !== "string") throw new Error(`candidate ${where}: the preview tree names no file of the candidate`);
    issues.push(...specimenTreeIssues(tree, moduleExports(source), writer(), itemDependencies(item)));
  }
  const used = fixtureRefs(fixtures);
  for (const key of used.copy) if (!copyKeys.includes(key)) issues.push(`fixture $copy ${key} is not a declared input (meta.preview.inputs.copy)`);
  for (const slot of used.slots) if (!slotIds.includes(slot)) issues.push(`fixture $element ${slot} is not a declared input (meta.preview.inputs.slots)`);
  for (const key of copyKeys) if (typeof writer()[key] !== "string") issues.push(`input ${key} is not a key of a pinned Writer slot`);
  if (slotIds.length && !mounting) issues.push(`a mounted input slot mounts no further slot (${slotIds.join(", ")})`);
  // A declared copy slot previews with a declared input: the D4 rule holds for its preview key too.
  const copySlots = declaredCopySlots(item);
  for (const entry of copySlots) if (!copyKeys.includes(entry.previewKey)) issues.push(`copy slot ${entry.slot} previews with ${entry.previewKey}, which is not a declared input (meta.preview.inputs.copy)`);
  const slots: SlotInput[] = [];
  if (mounting) for (const slot of slotIds) {
    const input = slotInput(root, slot, writerSource);
    if (typeof input === "string") issues.push(input);
    else slots.push(input);
  }
  if (issues.length) throw new Error(`candidate ${where}: ${issues.join("; ")}`);
  const copy: Record<string, string> = Object.fromEntries(copyKeys.map(key => [key, writer()[key]!]));
  if (item.type === "registry:theme" || item.type === "registry:font") {
    for (const key of Object.values(SPECIMEN_SAMPLE_COPY_KEYS)) if (typeof writer()[key] === "string") copy[key] = writer()[key]!;
  }
  // Copy slots come from meta.element.reads.copyKeys only, never from a preview field of the same name.
  const { inputs: _inputs, copySlots: _ignored, ...rest } = preview;
  return { preview: { ...rest, copy, ...(copySlots.length ? { copySlots } : {}) }, slots };
}

/** The pinned item a `$element` input mounts, or why it cannot be mounted. */
function slotInput(root: string, slot: string, writerSource: () => Readonly<Record<string, string>>): SlotInput | string {
  const entry = readSlotEntry(root, "designer", slot);
  if (!entry?.pin) return `input slot ${slot} has no Designer pin`;
  let read: { bytes: string; sha256: string };
  try { read = readCandidate(root, "designer", slot, entry.pin.candidate); } catch (error) { return `input slot ${slot}: its pinned candidate cannot be read (${error instanceof Error ? error.message : String(error)})`; }
  if (read.sha256 !== entry.pin.sha256) return `input slot ${slot}: the pinned candidate bytes do not match sha256`;
  let item: CandidateItem;
  try { item = JSON.parse(read.bytes); } catch (error) { return `input slot ${slot}: the pinned candidate is not JSON (${error instanceof Error ? error.message : String(error)})`; }
  let own: SpecimenInputs;
  try { own = specimenInputs(root, `${slot}/${entry.pin.candidate}`, item, false, writerSource); } catch (error) { return `input slot ${slot}: ${error instanceof Error ? error.message : String(error)}`; }
  const fixtures = own.preview.fixtures as Record<string, unknown> | undefined;
  if (!fixtures || typeof fixtures.file !== "string" || typeof fixtures.export !== "string" || !fixtures.props || typeof fixtures.props !== "object") return `input slot ${slot}: its pinned preview names no fixture file, export and props`;
  const file = item.files?.find(row => row.path === fixtures.file);
  const installed = file && typeof file.path === "string" ? installedPath({ path: file.path, ...(typeof file.type === "string" ? { type: file.type } : {}), ...(typeof file.target === "string" ? { target: file.target } : {}) }) : undefined;
  if (!installed || !CODE_FILE.test(installed)) return `input slot ${slot}: its fixture file ${String(fixtures.file)} installs no code`;
  return { slot, sha256: read.sha256, module: `@/${stripExt(installed)}`, export: fixtures.export, props: withCopy(fixtures.props, own.preview.copy as Record<string, string>) };
}

/** The module a specimen's `$element` inputs mount through. */
export const SPECIMEN_INPUTS_FILE = "specimen/inputs.tsx";

/**
 * A specimen whose fixtures mount other slots (`{ "$element": "components.logo" }`, a header's brand)
 * mounts through one generated module: it imports each input slot's pinned entry through its `@/`
 * install path (the pinned install index resolves it, as an install does), renders it with that
 * item's own resolved fixture props, and passes the element where the fixture names the slot. The
 * candidate bytes are unchanged; the module joins the record's files as the fixture file.
 */
function withSlotInputs(where: string, specimen: SpecimenInputs, row: SpecimenElementVersion): SpecimenElementVersion {
  if (!specimen.slots.length) return row;
  const preview = (row.preview && typeof row.preview === "object" ? row.preview : {}) as Record<string, unknown>;
  const fixtures = preview.fixtures && typeof preview.fixtures === "object" ? preview.fixtures as Record<string, unknown> : undefined;
  if (!fixtures || typeof fixtures.file !== "string" || typeof fixtures.export !== "string") throw new Error(`candidate ${where}: a preview that mounts input slots names its fixture file and export`);
  const target = posix.relative(posix.dirname(SPECIMEN_INPUTS_FILE), fixtures.file.replace(CODE_FILE, ""));
  const relative = target.startsWith(".") ? target : `./${target}`;
  const source = [
    "// Generated by Producer: the item with the input slots its fixtures mount, each at its pin.",
    'import { createElement } from "react";',
    `import * as Item from ${JSON.stringify(relative)};`,
    `export * from ${JSON.stringify(relative)};`,
    ...specimen.slots.map((input, index) => `import { ${input.export === "default" ? "default" : input.export} as Input${index} } from ${JSON.stringify(input.module)};`),
    `const INPUTS = { ${specimen.slots.map((input, index) => `${JSON.stringify(input.slot)}: () => createElement(Input${index}, ${JSON.stringify(input.props)})`).join(", ")} };`,
    "const mount = (value) => Array.isArray(value) ? value.map(mount)",
    "  : value && typeof value === \"object\" && !(\"$$typeof\" in value)",
    "    ? (typeof value.$element === \"string\" && Object.hasOwn(INPUTS, value.$element) ? INPUTS[value.$element]() : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mount(item)])))",
    "    : value;",
    `export function SpecimenInputs(props) { return createElement(Item[${JSON.stringify(fixtures.export)}], mount(props)); }`,
    "",
  ].join("\n");
  return {
    ...row,
    files: [...row.files, { path: SPECIMEN_INPUTS_FILE, content: source }],
    preview: { ...preview, fixtures: { ...fixtures, file: SPECIMEN_INPUTS_FILE, export: "SpecimenInputs" } },
    // The input pins join the hash: a re-pinned logo is a different build of this header.
    contentHash: specimen.slots.reduce((hash, input) => hash.update("\0").update(input.slot).update("\0").update(input.sha256), createHash("sha256").update(row.contentHash).update("\0").update(source)).digest("hex"),
  };
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
  const provider = state.state === "provider" ? state.provider : undefined;
  const source = [
    "// Generated by Producer: the item in its slot's declared specimen state.",
    `import { ${open ? "useEffect, " : ""}createElement } from "react";`,
    ...(open ? [`import { ${open.opener.export} as openSpecimen } from ${JSON.stringify(open.opener.module)};`] : []),
    ...(provider ? [`import { ${provider.export} as SpecimenProvider } from ${JSON.stringify(provider.module)};`] : []),
    `import * as Item from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`,
    // The item's own exports stay reachable for a fixture element tree.
    `export * from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`,
    "const pick = (name) => (name && Item[name]) || Item.default || Object.values(Item).find(value => typeof value === \"function\" || (!!value && typeof value === \"object\" && \"$$typeof\" in value));",
    "export function SpecimenState(props) {",
    `  const Root = pick(${JSON.stringify(exported ?? "")});`,
    ...(open ? [`  useEffect(() => { openSpecimen(${JSON.stringify(open.sample)}, { duration: Infinity }); }, []);`] : []),
    `  return createElement("div", { "data-specimen-state": ${JSON.stringify(state.state)} }, ${state.state === "visible" ? `createElement("style", null, ${JSON.stringify(VISIBLE_STATE_CSS)}), ` : ""}${provider ? "createElement(SpecimenProvider, null, createElement(Root, props))" : "createElement(Root, props)"});`,
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
      // A drifted pin contributes nothing (the pin check flags it); an unreadable or malformed
      // pinned theme is an error, never a silently dropped theme.
      const read = readCandidate(root, "designer", entry.id, entry.pin.candidate);
      if (read.sha256 !== entry.pin.sha256) continue;
      let item: { cssVars?: Record<string, unknown> } | undefined;
      try { item = JSON.parse(read.bytes); }
      catch (error) { throw new Error(`Designer theme ${entry.id}: pinned candidate ${entry.pin.candidate} is not JSON: ${error instanceof Error ? error.message : String(error)}`); }
      hashes.push(`${entry.id}:${read.sha256}`);
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
  const base = recordStoreSource(libraryRecordStore(options.roots, { ...(options.registryBase ? { registryBase: options.registryBase } : {}), ...(options.writerCopy ? { writerCopy: options.writerCopy } : {}) }), options.defaultTheme ? { defaultTheme: options.defaultTheme } : {});
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
