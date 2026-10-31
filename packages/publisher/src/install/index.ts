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
  /** Per slot: copy slot name to Writer key, asset slot name to consumer asset id. */
  readonly bindings?: Readonly<Record<string, {
    readonly copy?: Readonly<Record<string, string>>;
    readonly assets?: Readonly<Record<string, string>>;
  }>>;
}

/** The element version a consumer pinned to a slot (the record id is `<slot>/<element>`). */
export interface InstallPin { readonly element: string; readonly version: number }
export type InstallPins = Readonly<Record<string, InstallPin>>;

export type InstallFindingCode =
  | "invalid-page" | "unpinned-slot" | "missing-record" | "not-a-registry-item" | "no-entry"
  | "install-failed" | "hash-mismatch" | "unbound-copy-slot" | "missing-copy-key"
  | "unbound-asset-slot" | "missing-asset";
export interface InstallFinding { readonly code: InstallFindingCode; readonly slot?: string; readonly detail: string }

/** Runs the shadcn CLI: `args` follow the binary (`["add", ...]`); never through a shell. */
export type ShadcnRunner = (args: readonly string[], options: { readonly cwd: string }) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;

/** The installed file a slot mounts; without `export`, the renderer takes the default or sole component export. */
export interface SlotEntry { readonly file: string; readonly export?: string }

interface RegistryFile { readonly path: string; readonly type?: string; readonly target?: string }

/** A slot resolved to its pinned registry item. */
export interface ResolvedSlot {
  readonly slot: string;
  readonly role: "frame" | "section";
  readonly record: SpecimenRecord;
  /** sha256 of the registry item JSON as pinned. */
  readonly itemHash: string;
  /** Substrate-relative paths the item installs to. */
  readonly files: readonly string[];
  /** The installed file the page mounts, and its export when the preview names one. */
  readonly entry: SlotEntry;
  readonly copySlots: readonly string[];
  readonly assetSlots: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

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

/** Copy and asset slots an element reads: `{ "$copy": name }` / `{ "$asset": name }` in its fixtures, plus its copy keys. */
function slotsOf(record: SpecimenRecord): { copy: string[]; assets: string[] } {
  const copy = new Set<string>(Object.keys(record.preview.copy ?? {})), assets = new Set<string>();
  for (const value of Object.values(record.preview.fixtures ?? {})) {
    if (isRecord(value) && typeof value.$copy === "string") copy.add(value.$copy);
    if (isRecord(value) && typeof value.$asset === "string") assets.add(value.$asset);
  }
  return { copy: [...copy].sort(), assets: [...assets].sort() };
}

/** Resolve every slot of a page to its pinned registry item. Unpinned slots are findings. */
export async function resolvePage(page: InstallPageRecord, pins: InstallPins, source: SpecimenRecordSource): Promise<{ slots: ResolvedSlot[]; findings: InstallFinding[] }> {
  const findings: InstallFinding[] = [], slots: ResolvedSlot[] = [];
  if (typeof page?.id !== "string" || typeof page.frame !== "string" || !Array.isArray(page.sections)) {
    return { slots, findings: [{ code: "invalid-page", detail: "a page record needs an id, a frame slot and an ordered sections list" }] };
  }
  const order: { slot: string; role: ResolvedSlot["role"] }[] = [{ slot: page.frame, role: "frame" }, ...page.sections.map(slot => ({ slot, role: "section" as const }))];
  for (const { slot, role } of order) {
    const pin = pins[slot];
    if (!pin) { findings.push({ code: "unpinned-slot", slot, detail: `${page.id}: slot ${slot} has no pinned registry item` }); continue; }
    const id = `${slot}/${pin.element}`;
    const record = await source.read(id, pin.version);
    if (!record) { findings.push({ code: "missing-record", slot, detail: `${id}@v${pin.version} is pinned but not in the library` }); continue; }
    let item: unknown;
    try { item = JSON.parse(record.payload.raw); } catch { item = undefined; }
    if (!isRecord(item) || typeof item.name !== "string" || !Array.isArray(item.files) || !item.files.length) {
      findings.push({ code: "not-a-registry-item", slot, detail: `${id}@v${record.version}: payload ${record.payload.path} is not a shadcn registry item` });
      continue;
    }
    const registryFiles = (item.files as unknown[]).filter((file): file is RegistryFile => isRecord(file) && typeof file.path === "string");
    const files = registryFiles.map(installedPath);
    if (files.some(file => !file)) { findings.push({ code: "not-a-registry-item", slot, detail: `${id}: a registry file has no target or known type` }); continue; }
    const entryIndex = record.preview.entry ? registryFiles.findIndex(file => file.path === record.preview.entry) : registryFiles.findIndex(file => CODE.test(file.path));
    if (entryIndex < 0) { findings.push({ code: "no-entry", slot, detail: `${id}: the registry item has no code file to mount` }); continue; }
    const { copy, assets } = slotsOf(record);
    slots.push({
      slot, role, record, itemHash: sha256(record.payload.raw), files: files as string[],
      entry: { file: files[entryIndex]!, ...(record.preview.export ? { export: record.preview.export } : {}) }, copySlots: copy, assetSlots: assets,
    });
  }
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
      await writeFile(itemFile, slot.record.payload.raw);
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
  readonly id: string;
  readonly version: number;
  readonly entry: SlotEntry;
  readonly props: Readonly<Record<string, unknown>>;
  /** Copy slot name to the Writer key it is bound to. */
  readonly copy: Readonly<Record<string, string>>;
  readonly assets: Readonly<Record<string, string>>;
}
export interface BoundPage {
  readonly schema: "clossys.bound-page/1";
  readonly id: string;
  readonly frame: BoundSlot;
  readonly sections: readonly BoundSlot[];
}

export interface BindOptions {
  readonly page: InstallPageRecord;
  readonly slots: readonly ResolvedSlot[];
  /** Writer copy by key. */
  readonly copy: Readonly<Record<string, string>>;
  /** Consumer assets by id (the value is passed to the element as is). */
  readonly assets?: Readonly<Record<string, unknown>>;
}

/** Bind every copy and asset slot. Any unbound slot or unknown key is a finding, and then no page is emitted. */
export function bindPage(options: BindOptions): { page?: BoundPage; findings: InstallFinding[] } {
  const findings: InstallFinding[] = [];
  const bound: BoundSlot[] = [];
  for (const slot of options.slots) {
    const binding = options.page.bindings?.[slot.slot] ?? {};
    const copy: Record<string, string> = {}, assets: Record<string, string> = {}, texts: Record<string, string> = {}, values: Record<string, unknown> = {};
    for (const name of slot.copySlots) {
      const key = binding.copy?.[name];
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
    const props: Record<string, unknown> = {};
    for (const [prop, value] of Object.entries(slot.record.preview.fixtures ?? {})) {
      if (isRecord(value) && typeof value.$copy === "string") { if (value.$copy in texts) props[prop] = texts[value.$copy]; }
      else if (isRecord(value) && typeof value.$asset === "string") { if (value.$asset in values) props[prop] = values[value.$asset]; }
      else props[prop] = value;
    }
    bound.push({ slot: slot.slot, id: slot.record.id, version: slot.record.version, entry: slot.entry, props, copy, assets });
  }
  const frame = bound.find((_, index) => options.slots[index]!.role === "frame");
  if (findings.length || !frame) return { findings };
  return { page: { schema: "clossys.bound-page/1", id: options.page.id, frame, sections: bound.filter(slot => slot !== frame) }, findings };
}

/** Install and bind in one step: what `clossys publish --install` runs per page. */
export async function installAndBind(options: InstallOptions & Omit<BindOptions, "slots">): Promise<InstallResult & { page?: BoundPage }> {
  const result = await installPage(options);
  if (result.findings.length) return result;
  const { page, findings } = bindPage({ page: options.page, slots: result.slots, copy: options.copy, ...(options.assets ? { assets: options.assets } : {}) });
  return { ...result, findings, ...(page ? { page } : {}) };
}
