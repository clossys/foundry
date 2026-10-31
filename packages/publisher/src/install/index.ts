/**
 * Publisher install-and-bind: one page record (a frame plus ordered section slots) becomes
 * installed shadcn registry items in a publishing substrate and a bound page record.
 *
 * Publisher only assembles. Every slot resolves to the registry item the consumer pinned
 * for it, read through the record-source seam (`SpecimenRecordSource`, see
 * `../specimen/source.ts`), so Publisher never imports the store that owns the records.
 * Items are installed with `shadcn add <item>` through an injectable runner (argument
 * array, no shell, cwd set to the substrate). An install is recorded with the sha256 of
 * every file it wrote, so a repeat install of the same pinned item is a no-op and an edited
 * file is a finding. Binding maps each section's copy slots to Writer keys and its asset
 * slots to consumer asset ids. Anything unresolved is a finding; nothing falls back.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import type { SpecimenRecord, SpecimenRecordSource } from "../specimen/types.js";

export const INSTALL_MANIFEST = ".clossys/install.json";
const MANIFEST_SCHEMA = "clossys.install/1";

/** One page: a frame slot and its ordered section slots, plus per-slot bindings. */
export interface InstallPageRecord {
  readonly id: string;
  readonly frame: string;
  readonly sections: readonly string[];
  /** Slots installed before the page but never mounted, such as a theme or a font. */
  readonly include?: readonly string[];
  /** Page-wide copy bindings: copy slot name to Writer key, for every mounted slot. */
  readonly copy?: Readonly<Record<string, string>>;
  /** Per slot: copy slot name to Writer key, asset slot name to consumer asset id. A slot binding overrides the page-wide one. */
  readonly bindings?: Readonly<Record<string, {
    readonly copy?: Readonly<Record<string, string>>;
    readonly assets?: Readonly<Record<string, string>>;
  }>>;
}

/** The element version a consumer pinned to a slot (the record id is `<slot>/<element>`). */
export interface InstallPin { readonly element: string; readonly version: number }
export type InstallPins = Readonly<Record<string, InstallPin>>;

export type InstallFindingCode =
  | "invalid-page" | "unpinned-slot" | "unpinned-dependency" | "missing-record" | "not-a-registry-item" | "no-entry"
  | "install-failed" | "hash-mismatch" | "unbound-copy-slot" | "missing-copy-key"
  | "unbound-asset-slot" | "missing-asset";
export interface InstallFinding { readonly code: InstallFindingCode; readonly slot?: string; readonly detail: string }

/** Runs the shadcn CLI: `args` follow the binary (`["add", ...]`); never through a shell. */
export type ShadcnRunner = (args: readonly string[], options: { readonly cwd: string }) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;

/** The installed file a slot mounts; without `export`, the renderer takes the default or sole component export. */
export interface SlotEntry { readonly file: string; readonly export?: string }

interface RegistryFile { readonly path: string; readonly type?: string; readonly target?: string; readonly content?: string }

/**
 * How a slot is placed on a page. `frame` and `section` come from the page record; `part` is a
 * slot another mounted slot's props name with `{ "$element": "<slot>" }`; `dependency` is a
 * pinned slot a registry item names in `registryDependencies` (`@<namespace>/<element>`);
 * `include` is a page `include` slot. Frames, sections and parts are mounted and bound.
 */
export type SlotRole = "frame" | "section" | "part" | "dependency" | "include";

/** A slot resolved to its pinned registry item. */
export interface ResolvedSlot {
  readonly slot: string;
  readonly role: SlotRole;
  readonly mounted: boolean;
  readonly record: SpecimenRecord;
  /** The registry item JSON handed to shadcn: files inlined, pinned dependencies removed. */
  readonly item: string;
  /** sha256 of `item`. */
  readonly itemHash: string;
  /** Substrate-relative paths the item installs to. */
  readonly files: readonly string[];
  /** The installed file the page mounts, and its export when the preview names one. */
  readonly entry?: SlotEntry;
  /** The export that maps the element's copy props to its copy slot names, when it has one. */
  readonly copyKeys?: string;
  /** The props the element mounts with, from its preview fixtures. */
  readonly props: Readonly<Record<string, unknown>>;
  readonly copySlots: readonly string[];
  readonly assetSlots: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const NAMESPACED = /^@[^/\s]+\/([^/\s]+)$/;
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const MOUNTED: ReadonlySet<SlotRole> = new Set(["frame", "section", "part"]);

/** Where shadcn writes a registry file without a `target`, by registry file type. */
const DEFAULT_DIRS: Readonly<Record<string, string>> = {
  "registry:ui": "components/ui", "registry:component": "components", "registry:block": "components",
  "registry:hook": "hooks", "registry:lib": "lib",
};

function installedPath(file: RegistryFile): string | undefined {
  const target = file.target ?? (file.type && DEFAULT_DIRS[file.type] ? `${DEFAULT_DIRS[file.type]}/${posix.basename(file.path)}` : undefined);
  if (!target) return undefined;
  const normal = posix.normalize(target.replace(/^~\//, ""));
  return isAbsolute(normal) || normal.startsWith("..") ? undefined : normal;
}

/** Every object node under a value, depth first. */
function eachNode(value: unknown, visit: (node: Record<string, any>) => void): void {
  if (Array.isArray(value)) for (const item of value) eachNode(item, visit);
  else if (isRecord(value)) { visit(value); for (const item of Object.values(value)) eachNode(item, visit); }
}

/**
 * The mount a preview describes. Either the fixtures are the props themselves, or they are a
 * mount spec: `{ file, export?, copyKeys?, props? }`, where `file` is the registry file to mount
 * and `copyKeys` names the export mapping each copy prop to a copy slot name.
 */
function mountOf(record: SpecimenRecord): { file?: string; export?: string; copyKeys?: string; props: Record<string, unknown> } {
  const fixtures = record.preview.fixtures ?? {};
  if (typeof fixtures.file === "string" && (fixtures.props === undefined || isRecord(fixtures.props))) {
    const name = str(fixtures.export) ?? record.preview.export, copyKeys = str(fixtures.copyKeys);
    return { file: fixtures.file, ...(name ? { export: name } : {}), ...(copyKeys ? { copyKeys } : {}), props: { ...(fixtures.props as Record<string, unknown> | undefined) } };
  }
  return { ...(record.preview.entry ? { file: record.preview.entry } : {}), ...(record.preview.export ? { export: record.preview.export } : {}), props: { ...fixtures } };
}

/** Copy and asset slots an element reads: its preview copy keys plus every `{ "$copy" }` / `{ "$asset" }` in its props. */
function slotsOf(record: SpecimenRecord, props: Record<string, unknown>): { copy: string[]; assets: string[] } {
  const copy = new Set<string>(Object.keys(record.preview.copy ?? {})), assets = new Set<string>();
  eachNode(props, node => {
    if (typeof node.$copy === "string") copy.add(node.$copy);
    if (typeof node.$asset === "string") assets.add(node.$asset);
  });
  return { copy: [...copy].sort(), assets: [...assets].sort() };
}

/** The record's registry item: its payload, or the payload file that is one. */
function registryItemOf(record: SpecimenRecord): { path: string; item: Record<string, any> } | undefined {
  const candidates = [{ path: record.payload.path, content: record.payload.raw }, ...(record.sources ?? []).filter(file => file.path !== record.payload.path)];
  for (const file of candidates) {
    if (!file.path.endsWith(".json")) continue;
    let item: unknown;
    try { item = JSON.parse(file.content); } catch { continue; }
    // An item without files (a theme's cssVars, a font) is still an item when it names its registry type.
    if (isRecord(item) && typeof item.name === "string" && (Array.isArray(item.files) || (typeof item.type === "string" && item.type.startsWith("registry:")))) {
      return { path: file.path, item: { ...item, files: Array.isArray(item.files) ? item.files : [] } };
    }
  }
  return undefined;
}

/**
 * Resolve every slot of a page to its pinned registry item, with the pinned slots those items
 * depend on or compose. A dependency is installed before the item that needs it. Unpinned slots
 * and dependencies are findings.
 */
export async function resolvePage(page: InstallPageRecord, pins: InstallPins, source: SpecimenRecordSource): Promise<{ slots: ResolvedSlot[]; findings: InstallFinding[] }> {
  const findings: InstallFinding[] = [], slots: ResolvedSlot[] = [];
  if (typeof page?.id !== "string" || typeof page.frame !== "string" || !Array.isArray(page.sections) || (page.include !== undefined && !Array.isArray(page.include))) {
    return { slots, findings: [{ code: "invalid-page", detail: "a page record needs an id, a frame slot and an ordered sections list" }] };
  }
  const byElement = new Map<string, string[]>();
  for (const [slot, pin] of Object.entries(pins)) byElement.set(pin.element, [...(byElement.get(pin.element) ?? []), slot]);
  const done = new Map<string, ResolvedSlot>(), active = new Set<string>();

  async function visit(slot: string, role: SlotRole, via?: string): Promise<void> {
    const seen = done.get(slot);
    if (seen) {
      if (MOUNTED.has(role) && !seen.mounted) {
        if (!seen.entry) { findings.push({ code: "no-entry", slot, detail: `${seen.record.id}: the registry item has no code file to mount` }); return; }
        const index = slots.indexOf(seen);
        const upgraded = { ...seen, role, mounted: true };
        slots[index] = upgraded; done.set(slot, upgraded);
      }
      return;
    }
    if (active.has(slot)) { findings.push({ code: "invalid-page", slot, detail: `${page.id}: slot ${slot} depends on itself through ${via}` }); return; }
    const pin = pins[slot];
    if (!pin) {
      findings.push(role === "dependency" || role === "part"
        ? { code: "unpinned-dependency", slot, detail: `${page.id}: ${via} needs slot ${slot}, which has no pinned registry item` }
        : { code: "unpinned-slot", slot, detail: `${page.id}: slot ${slot} has no pinned registry item` });
      return;
    }
    const id = `${slot}/${pin.element}`;
    const record = await source.read(id, pin.version);
    if (!record) { findings.push({ code: "missing-record", slot, detail: `${id}@v${pin.version} is pinned but not in the library` }); return; }
    const found = registryItemOf(record);
    if (!found) { findings.push({ code: "not-a-registry-item", slot, detail: `${id}@v${record.version}: no payload file is a shadcn registry item` }); return; }
    active.add(slot);
    try {
      const sources = new Map((record.sources ?? record.payload.files).map(file => [file.path, file.content]));
      const registryFiles: RegistryFile[] = [];
      for (const file of found.item.files as unknown[]) {
        if (!isRecord(file) || typeof file.path !== "string") continue;
        const content = typeof file.content === "string" ? file.content : sources.get(file.path);
        if (content === undefined) { findings.push({ code: "not-a-registry-item", slot, detail: `${id}: registry file ${file.path} has no content and is not in the record payload` }); return; }
        registryFiles.push({ ...(file as RegistryFile), content });
      }
      const files = registryFiles.map(installedPath);
      if (files.some(file => !file)) { findings.push({ code: "not-a-registry-item", slot, detail: `${id}: a registry file has no target or known type` }); return; }
      // Pinned dependencies install from their own records; only unnamespaced ones go to shadcn.
      const kept: string[] = [];
      for (const dependency of Array.isArray(found.item.registryDependencies) ? found.item.registryDependencies : []) {
        if (typeof dependency !== "string") continue;
        const match = NAMESPACED.exec(dependency);
        if (!match) { kept.push(dependency); continue; }
        const candidates = byElement.get(match[1]!) ?? [];
        if (candidates.length !== 1) {
          findings.push({ code: "unpinned-dependency", slot, detail: `${id} depends on ${dependency}, which ${candidates.length ? `${candidates.length} slots pin (${candidates.join(", ")})` : "no slot pins"}` });
          continue;
        }
        await visit(candidates[0]!, "dependency", id);
      }
      const mount = mountOf(record);
      if (role === "frame") delete mount.props.children;
      const parts = new Set<string>();
      eachNode(mount.props, node => { if (typeof node.$element === "string") parts.add(node.$element); });
      for (const part of parts) await visit(part, "part", id);
      const entryIndex = mount.file ? registryFiles.findIndex(file => file.path === mount.file) : registryFiles.findIndex(file => CODE.test(file.path));
      const mounted = MOUNTED.has(role);
      if (mounted && entryIndex < 0) { findings.push({ code: "no-entry", slot, detail: `${id}: the registry item has no code file to mount` }); return; }
      const item = `${JSON.stringify({ ...found.item, files: registryFiles, registryDependencies: kept }, null, 2)}\n`;
      const { copy, assets } = slotsOf(record, mount.props);
      const resolved: ResolvedSlot = {
        slot, role, mounted, record, item, itemHash: sha256(item), files: files as string[],
        ...(entryIndex >= 0 ? { entry: { file: files[entryIndex]!, ...(mount.export ? { export: mount.export } : {}) } } : {}),
        ...(mount.copyKeys ? { copyKeys: mount.copyKeys } : {}),
        props: mount.props, copySlots: copy, assetSlots: assets,
      };
      slots.push(resolved); done.set(slot, resolved);
    } finally {
      active.delete(slot);
    }
  }

  for (const slot of page.include ?? []) await visit(slot, "include");
  await visit(page.frame, "frame");
  for (const slot of page.sections) await visit(slot, "section");
  return { slots, findings };
}

interface ManifestEntry { readonly id: string; readonly version: number; readonly itemHash: string; readonly files: Readonly<Record<string, string>> }
interface Manifest { readonly schema: typeof MANIFEST_SCHEMA; readonly items: Readonly<Record<string, ManifestEntry>> }

async function readManifest(substrate: string): Promise<Manifest> {
  try {
    const value = JSON.parse(await readFile(join(substrate, INSTALL_MANIFEST), "utf8"));
    if (isRecord(value) && value.schema === MANIFEST_SCHEMA && isRecord(value.items)) return value as Manifest;
  } catch { /* no manifest yet */ }
  return { schema: MANIFEST_SCHEMA, items: {} };
}

async function fileHash(substrate: string, path: string): Promise<string | undefined> {
  const full = resolve(substrate, path);
  if (relative(substrate, full).startsWith("..")) return undefined;
  try { return sha256(await readFile(full)); } catch { return undefined; }
}

export interface InstallOptions {
  readonly page: InstallPageRecord;
  readonly pins: InstallPins;
  readonly source: SpecimenRecordSource;
  /** The publishing substrate (a shadcn project: `components.json` at its root). */
  readonly substrate: string;
  readonly runner: ShadcnRunner;
}
export interface InstallResult {
  readonly slots: readonly ResolvedSlot[];
  readonly installed: readonly { readonly slot: string; readonly id: string; readonly version: number; readonly status: "installed" | "unchanged"; readonly files: readonly string[] }[];
  readonly findings: readonly InstallFinding[];
}

/** Install a page's pinned registry items into the substrate. Idempotent; verified by hash. */
export async function installPage(options: InstallOptions): Promise<InstallResult> {
  const substrate = resolve(options.substrate);
  const { slots, findings } = await resolvePage(options.page, options.pins, options.source);
  // A page with an unresolved slot installs nothing: no partial page reaches the substrate.
  if (findings.length) return { slots, installed: [], findings };
  const manifest = await readManifest(substrate);
  const items: Record<string, ManifestEntry> = { ...manifest.items };
  const installed: InstallResult["installed"][number][] = [];
  const scratch = await mkdtemp(join(tmpdir(), "clossys-install-"));
  try {
    for (const slot of slots) {
      const { id, version } = slot.record;
      const previous = items[slot.slot];
      if (previous && previous.id === id && previous.version === version && previous.itemHash === slot.itemHash) {
        const drift: string[] = [];
        for (const [path, hash] of Object.entries(previous.files)) if (await fileHash(substrate, path) !== hash) drift.push(path);
        if (drift.length) findings.push({ code: "hash-mismatch", slot: slot.slot, detail: `${id}@v${version}: installed ${drift.join(", ")} no longer match the recorded install` });
        else installed.push({ slot: slot.slot, id, version, status: "unchanged", files: slot.files });
        continue;
      }
      const itemFile = join(scratch, `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.v${version}.json`);
      await writeFile(itemFile, slot.item);
      const run = await options.runner(["add", itemFile, "--yes", "--overwrite", "--cwd", substrate], { cwd: substrate });
      if (run.code !== 0) { findings.push({ code: "install-failed", slot: slot.slot, detail: `shadcn add ${id}@v${version} exited ${run.code}: ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ")}` }); continue; }
      const hashes: Record<string, string> = {};
      const missing: string[] = [];
      for (const path of slot.files) {
        const hash = await fileHash(substrate, path);
        if (hash) hashes[path] = hash; else missing.push(path);
      }
      if (missing.length) { findings.push({ code: "install-failed", slot: slot.slot, detail: `shadcn add ${id}@v${version} did not write ${missing.join(", ")}` }); continue; }
      items[slot.slot] = { id, version, itemHash: slot.itemHash, files: hashes };
      installed.push({ slot: slot.slot, id, version, status: "installed", files: slot.files });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  await mkdir(join(substrate, ".clossys"), { recursive: true });
  await writeFile(join(substrate, INSTALL_MANIFEST), `${JSON.stringify({ schema: MANIFEST_SCHEMA, items }, null, 2)}\n`);
  return { slots, installed, findings };
}

/** One mounted slot of a bound page: the installed entry and its bound props. */
export interface BoundSlot {
  readonly slot: string;
  readonly role: SlotRole;
  readonly id: string;
  readonly version: number;
  readonly entry: SlotEntry;
  /** Props with copy and assets resolved; `{ "$element": "<slot>" }` stays a reference to another bound slot. */
  readonly props: Readonly<Record<string, unknown>>;
  /** The export mapping copy props to copy slot names; the renderer passes the mapped text as the `copy` prop. */
  readonly copyKeys?: string;
  /** Copy slot name to the Writer key it is bound to. */
  readonly copy: Readonly<Record<string, string>>;
  /** Copy slot name to its bound Writer text. */
  readonly text: Readonly<Record<string, string>>;
  readonly assets: Readonly<Record<string, string>>;
}
export interface BoundPage {
  readonly schema: "clossys.bound-page/1";
  readonly id: string;
  readonly frame: BoundSlot;
  readonly sections: readonly BoundSlot[];
  /** Slots the frame or a section composes through `$element`. */
  readonly parts: readonly BoundSlot[];
}

export interface BindOptions {
  readonly page: InstallPageRecord;
  readonly slots: readonly ResolvedSlot[];
  /** Writer copy by key. */
  readonly copy: Readonly<Record<string, string>>;
  /** Consumer assets by id (the value is passed to the element as is). */
  readonly assets?: Readonly<Record<string, unknown>>;
}

function resolveProps(value: unknown, texts: Readonly<Record<string, string>>, values: Readonly<Record<string, unknown>>): unknown {
  if (Array.isArray(value)) return value.map(item => resolveProps(item, texts, values));
  if (!isRecord(value)) return value;
  if (typeof value.$copy === "string") return texts[value.$copy];
  if (typeof value.$asset === "string") return values[value.$asset];
  if (typeof value.$element === "string") return { $element: value.$element };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveProps(item, texts, values)]));
}

/** Bind every copy and asset slot of every mounted slot. Any unbound slot or unknown key is a finding, and then no page is emitted. */
export function bindPage(options: BindOptions): { page?: BoundPage; findings: InstallFinding[] } {
  const findings: InstallFinding[] = [];
  const bound: BoundSlot[] = [];
  for (const slot of options.slots) {
    if (!slot.mounted || !slot.entry) continue;
    const binding = options.page.bindings?.[slot.slot] ?? {};
    const copy: Record<string, string> = {}, assets: Record<string, string> = {}, texts: Record<string, string> = {}, values: Record<string, unknown> = {};
    for (const name of slot.copySlots) {
      const key = binding.copy?.[name] ?? options.page.copy?.[name];
      if (!key) { findings.push({ code: "unbound-copy-slot", slot: slot.slot, detail: `${options.page.id}: ${slot.record.id} copy slot ${name} is bound to no Writer key` }); continue; }
      if (!Object.hasOwn(options.copy, key)) { findings.push({ code: "missing-copy-key", slot: slot.slot, detail: `${options.page.id}: Writer has no key ${key} (for ${slot.record.id} ${name})` }); continue; }
      copy[name] = key; texts[name] = options.copy[key]!;
    }
    for (const name of slot.assetSlots) {
      const asset = binding.assets?.[name];
      if (!asset) { findings.push({ code: "unbound-asset-slot", slot: slot.slot, detail: `${options.page.id}: ${slot.record.id} asset slot ${name} is bound to no asset id` }); continue; }
      if (!options.assets || !Object.hasOwn(options.assets, asset)) { findings.push({ code: "missing-asset", slot: slot.slot, detail: `${options.page.id}: no consumer asset ${asset} (for ${slot.record.id} ${name})` }); continue; }
      assets[name] = asset; values[name] = options.assets[asset];
    }
    const props = resolveProps(slot.props, texts, values) as Record<string, unknown>;
    if (slot.role === "frame") props.children = options.page.sections.map(section => ({ $element: section }));
    bound.push({
      slot: slot.slot, role: slot.role, id: slot.record.id, version: slot.record.version, entry: slot.entry, props,
      ...(slot.copyKeys ? { copyKeys: slot.copyKeys } : {}), copy, text: texts, assets,
    });
  }
  const frame = bound.find(slot => slot.role === "frame");
  if (findings.length || !frame) return { findings };
  const sections = options.page.sections.map(name => bound.find(slot => slot.slot === name)).filter((slot): slot is BoundSlot => !!slot);
  return { page: { schema: "clossys.bound-page/1", id: options.page.id, frame, sections, parts: bound.filter(slot => slot.role === "part") }, findings };
}

/** Install and bind in one step: what `clossys publish --install` runs per page. */
export async function installAndBind(options: InstallOptions & Omit<BindOptions, "slots">): Promise<InstallResult & { page?: BoundPage }> {
  const result = await installPage(options);
  if (result.findings.length) return result;
  const { page, findings } = bindPage({ page: options.page, slots: result.slots, copy: options.copy, ...(options.assets ? { assets: options.assets } : {}) });
  return { ...result, findings, ...(page ? { page } : {}) };
}
