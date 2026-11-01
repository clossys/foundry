/**
 * The `/__specimen` mount: Publisher's specimen renderer over canonical records read through
 * the slot engine loaders. Producer's server mounts it beside Studio.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface SiteServerOptions {
  /** Canonical consumer roots; when present /__specimen is mounted. */
  readonly records?: readonly string[];
  /** Where payload npm imports resolve from when a specimen is bundled. */
  readonly workspace?: string;
  readonly defaultTheme?: string;
}

type Mount = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

/** The /__specimen handler over consumer roots, loaded only when there are roots to serve. */
export async function specimenMount(options: SiteServerOptions): Promise<Mount | undefined> {
  if (!options.records?.length) return undefined;
  const [{ createSpecimenHandler }, { libraryRecordSource }] = await Promise.all([import("@clossys/publisher/specimen"), import("../specimen/library-source.js")]);
  const source = libraryRecordSource({ roots: options.records, ...(options.defaultTheme ? { defaultTheme: options.defaultTheme } : {}) });
  return createSpecimenHandler({ source, workspace: options.workspace ?? process.cwd() });
}
