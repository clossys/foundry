/**
 * Specimen records from a consumer library (`library/<slot>/<element>/v<n>/`), read only
 * through the slot engine's own loaders and validators (`../records`). Publisher renders;
 * it sees only the validated version this store hands it, so Publisher never depends on
 * Producer and the record schema has one owner.
 *
 * Specimen ids are `<slot>/<element>`. A bare `<element>` (how a payload names a sibling
 * it imports through `@/`) resolves when exactly one slot in the roots holds it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { recordStoreSource, type SpecimenElementVersion, type SpecimenRecordSource, type SpecimenRecordStore } from "@clossys/publisher/specimen";
import { hashFiles } from "../records/hash.js";
import { ELEMENT_FILE, listVersions, payloadFiles, PREVIEW_FILE, readElementVersion, verifyElementVersion } from "../records/library.js";
import { RecordError } from "../records/validate.js";

const SEGMENT = /^[a-z0-9][a-z0-9.-]*$/;

export interface LibrarySourceOptions {
  /** Library roots (each holds `<slot>/<element>/v<n>/`), searched in order. */
  readonly roots: readonly string[];
  /** Theme id used when neither the URL nor the record names one. */
  readonly defaultTheme?: string;
}

const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** Where one specimen id lives: `{ root, slot, element }`, or undefined when no root holds it. */
export function locateLibraryElement(roots: readonly string[], id: string): { root: string; slot: string; element: string } | undefined {
  const parts = id.split("/");
  if (parts.length > 2 || !parts.every(part => SEGMENT.test(part) && !part.includes(".."))) return undefined;
  if (parts.length === 2) {
    const [slot, element] = parts as [string, string];
    const root = roots.find(candidate => isDir(join(candidate, slot, element)));
    return root ? { root, slot, element } : undefined;
  }
  const element = parts[0]!;
  for (const root of roots) {
    if (!isDir(root)) continue;
    const slots = readdirSync(root).filter(slot => SEGMENT.test(slot) && isDir(join(root, slot, element)));
    if (slots.length > 1) throw new Error(`element ${element} is in ${slots.length} slots (${slots.join(", ")}); name it as <slot>/${element}`);
    if (slots.length === 1) return { root, slot: slots[0]!, element };
  }
  return undefined;
}

/** A record store over library roots: every read is schema-validated and hash-verified. */
export function libraryRecordStore(rootsIn: readonly string[]): SpecimenRecordStore {
  const roots = rootsIn.map(root => resolve(root));
  return {
    async load(id, version) {
      const where = locateLibraryElement(roots, id);
      if (!where) return undefined;
      const { root, slot, element } = where;
      const versions = listVersions(root, slot, element);
      const chosen = version ?? versions.at(-1);
      if (chosen === undefined || !versions.includes(chosen)) return undefined;
      const read = readElementVersion(root, slot, element, chosen);
      const issues = verifyElementVersion(root, slot, element, chosen);
      if (issues.length) throw new RecordError(`element ${slot}/${element}@v${chosen}`, issues);
      const payload = payloadFiles(read.dir, read.element);
      const files = payload.map(path => ({ path, content: readFileSync(join(read.dir, path), "utf8") }));
      const own = [ELEMENT_FILE, PREVIEW_FILE, ...payload];
      const row: SpecimenElementVersion = {
        id: `${slot}/${element}`, version: chosen, kind: read.element.kind, layer: read.element.layer,
        files, preview: read.preview, contentHash: hashFiles(read.dir, own).replace(/^sha256:/, ""),
      };
      return row;
    },
  };
}

/** The specimen source for consumer libraries. */
export function libraryRecordSource(options: LibrarySourceOptions): SpecimenRecordSource {
  return recordStoreSource(libraryRecordStore(options.roots), options.defaultTheme ? { defaultTheme: options.defaultTheme } : {});
}

/** Every `<slot>/<element>` id in the roots, sorted (first root wins on a repeat). */
export function listLibraryElements(rootsIn: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const root of rootsIn.map(path => resolve(path))) {
    if (!isDir(root)) continue;
    for (const slot of readdirSync(root).filter(name => SEGMENT.test(name) && isDir(join(root, name)))) {
      for (const element of readdirSync(join(root, slot)).filter(name => SEGMENT.test(name) && isDir(join(root, slot, name)))) {
        if (listVersions(root, slot, element).length) ids.add(`${slot}/${element}`);
      }
    }
  }
  return [...ids].sort();
}
