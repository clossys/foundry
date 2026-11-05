/**
 * The `/__specimen` mount: Publisher's specimen renderer over canonical records read through
 * the slot engine loaders. Producer's server mounts it beside Studio.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface SiteServerOptions {
  /** Canonical consumer roots; when present /__specimen is mounted. */
  readonly records?: readonly string[];
  /** Where payload npm imports resolve from when a specimen is bundled. */
  readonly workspace?: string;
  readonly defaultTheme?: string;
}

type Mount = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

/** The /__specimen handler over consumer roots, loaded only when there are roots to serve. */
/** The stock shadcn@aria base (`@clossys/designer-ui/src`), laid out as installed, when present. */
function shadcnRegistryBase(workspace: string): string | undefined {
  for (const from of [join(workspace, "package.json"), import.meta.url]) {
    try { return dirname(createRequire(from).resolve("@clossys/designer-ui")); } catch { /* not installed here */ }
  }
  return undefined;
}

export async function specimenMount(options: SiteServerOptions): Promise<Mount | undefined> {
  if (!options.records?.length) return undefined;
  const [{ createSpecimenHandler }, { libraryRecordSource }] = await Promise.all([import("@clossys/publisher/specimen"), import("../specimen/library-source.js")]);
  const registryBase = shadcnRegistryBase(options.workspace ?? process.cwd());
  const source = libraryRecordSource({ roots: options.records, ...(options.defaultTheme ? { defaultTheme: options.defaultTheme } : {}), ...(registryBase ? { registryBase } : {}) });
  return createSpecimenHandler({ source, workspace: options.workspace ?? process.cwd() });
}
