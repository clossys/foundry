import type {
  CopyEntry,
  LinkEntry,
  ManagedBlockEntry,
  Manifest,
  PrivateDirectoryEntry,
} from "./types.js";

/**
 * Manifest loading and validation. Pure: it takes an already-parsed object and
 * never reads a file, so a caller can validate a manifest that came from
 * anywhere -- a checkout, a request body, a test fixture.
 */

function asArray<T>(value: unknown, name: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value as T[];
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value === "") throw new Error(message);
  return value;
}

const OCTAL_MODE = /^[0-7]{3,4}$/;

/**
 * Validate a parsed manifest and return it in normalized form.
 *
 * Throws rather than returning findings, because every caller of this is about
 * to mutate a machine: there is no useful "continue with the parts that
 * parsed". A half-applied manifest is the state hardest to reason about later.
 */
export function loadManifest(raw: unknown): Manifest {
  if (typeof raw !== "object" || raw === null) throw new Error("Manifest must be an object");
  const record = raw as Record<string, unknown>;

  if (record["version"] !== 1) throw new Error("Manifest must declare supported version 1");

  const links = asArray<LinkEntry>(record["links"], "links");
  const copies = asArray<CopyEntry>(record["copies"], "copies");
  const managedBlocks = asArray<ManagedBlockEntry>(record["managedBlocks"], "managedBlocks");
  const privateDirectories = asArray<PrivateDirectoryEntry>(
    record["privateDirectories"],
    "privateDirectories",
  );

  const destinations = new Set<string>();
  for (const [name, entries] of [
    ["links", links],
    ["copies", copies],
    ["managedBlocks", managedBlocks],
  ] as const) {
    for (const entry of entries) {
      const destination = requireString(
        (entry as { destination?: unknown }).destination,
        `${name} entries must declare a destination`,
      );
      // Two entries owning one destination is not a merge; it is a race whose
      // winner depends on iteration order, and whose loser leaves no trace.
      if (destinations.has(destination)) {
        throw new Error(`Manifest manages destination more than once: ${destination}`);
      }
      destinations.add(destination);
    }
  }

  for (const entry of links) {
    const hasSource = typeof entry.source === "string" && entry.source !== "";
    const hasTarget = typeof entry.target === "string" && entry.target !== "";
    if (hasSource === hasTarget) {
      throw new Error(
        `links entries must declare exactly one of source or target: ${entry.destination}`,
      );
    }
    // A symlink has no content of its own, so there is nothing to expand. A
    // manifest asking for a templated link is asking for the reader to receive
    // the literal ${TOKEN} -- which reads as a real instruction and is worse
    // than an obviously missing file.
    if ((entry as { template?: unknown }).template) {
      throw new Error(
        `links entries cannot be templated: ${entry.destination}. A templated source must be installed as a copy or a managed block.`,
      );
    }
  }

  for (const entry of copies) {
    requireString(entry.source, `copies entries must declare a source: ${entry.destination}`);
    if (entry.mode !== undefined && !OCTAL_MODE.test(entry.mode)) {
      throw new Error(`copies mode must be an octal string: ${entry.destination}`);
    }
  }

  for (const entry of managedBlocks) {
    requireString(
      entry.source,
      `managedBlocks entries must declare a source: ${entry.destination}`,
    );
    const start = requireString(
      entry.startMarker,
      `managedBlocks entries must declare startMarker: ${entry.destination}`,
    );
    const end = requireString(
      entry.endMarker,
      `managedBlocks entries must declare endMarker: ${entry.destination}`,
    );
    if (start === end) {
      throw new Error(`managedBlocks markers must be distinct: ${entry.destination}`);
    }
  }

  for (const entry of privateDirectories) {
    requireString(entry.path, "privateDirectories entries must declare a path");
    if (typeof entry.create !== "boolean") {
      throw new Error(`privateDirectories entries must declare create: ${entry.path}`);
    }
  }

  const defaults = record["defaults"];
  return {
    version: 1,
    ...(typeof defaults === "object" && defaults !== null
      ? { defaults: defaults as { workspaceRoot?: string } }
      : {}),
    links,
    copies,
    managedBlocks,
    privateDirectories,
  };
}
