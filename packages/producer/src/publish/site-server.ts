/**
 * The `/__specimen` mount: Publisher's specimen renderer over canonical records read through
 * the slot engine loaders. Producer's server mounts it beside Studio.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isModuleAbsent } from "../errors.js";
import { pinnedWriterCopy } from "../server/specimen-tree.js";

export interface SiteServerOptions {
  /** Canonical consumer roots; when present /__specimen is mounted. */
  readonly records?: readonly string[];
  /** Where payload npm imports resolve from when a specimen is bundled. */
  readonly workspace?: string;
  readonly defaultTheme?: string;
  /** The pinned Writer copy every record load reads (`writerSnapshot`); without it each load scans Writer. */
  readonly writerCopy?: () => Readonly<Record<string, string>>;
}

type Mount = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

/** The /__specimen handler over consumer roots, loaded only when there are roots to serve. */
/** The stock shadcn@aria base (`@clossys/designer-ui/src`), laid out as installed, when present. */
function shadcnRegistryBase(workspace: string): string | undefined {
  for (const from of [join(workspace, "package.json"), import.meta.url]) {
    // Not installed from this base: try the next. Any other resolution failure is a broken install.
    try { return dirname(createRequire(from).resolve("@clossys/designer-ui")); } catch (error) { if (!isModuleAbsent(error)) throw error; }
  }
  return undefined;
}

export async function specimenMount(options: SiteServerOptions): Promise<Mount | undefined> {
  if (!options.records?.length) return undefined;
  const [{ createSpecimenHandler }, { libraryRecordSource }] = await Promise.all([import("@clossys/publisher/specimen"), import("../specimen/library-source.js")]);
  const registryBase = shadcnRegistryBase(options.workspace ?? process.cwd());
  const source = libraryRecordSource({ roots: options.records, ...(options.defaultTheme ? { defaultTheme: options.defaultTheme } : {}), ...(registryBase ? { registryBase } : {}), ...(options.writerCopy ? { writerCopy: options.writerCopy } : {}) });
  return createSpecimenHandler({ source, workspace: options.workspace ?? process.cwd() });
}

/**
 * One consumer's pinned Writer copy, scanned on first read and again only after `refresh` (the
 * server calls it from its slot watcher on a Writer change). A specimen record load reads it
 * instead of scanning Writer itself: a scan per load held the one event loop for every card.
 */
export function writerSnapshot(library: string): { read: () => Readonly<Record<string, string>>; refresh: () => void } {
  let copy: Readonly<Record<string, string>> | undefined;
  return { read: () => copy ??= pinnedWriterCopy(library), refresh: () => { copy = undefined; } };
}
