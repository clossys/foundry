/**
 * The store-format marker (foundry-build-0048 U13): `<consumer>/store-format.json`, written by
 * `clossys migrate slots --apply` only once every slot folder of the store holds `clossys.slot/2`
 * slot files, `clossys.pin/2` (or `clossys.pin-map/1`) pins and headered candidates.
 *
 * Once a store carries the marker its readers fail closed: a `clossys.slot/1` slot.json or a pin/1
 * pin.json found in it afterwards (written by hand, by an old Producer, or restored from an old commit)
 * is refused, never read as the old format. Anything at the marker path counts, even a file that does
 * not parse: a damaged marker never reopens the old formats.
 *
 * Compatibility readers that still read slot/1 and pin/1 (by design): a store with no marker (not yet
 * converted), and the migrations that convert one (migrate/slots.ts, slot-1-to-2.ts, pin-1-to-2.ts,
 * recut.ts, through records/pin-map.ts readPinFile).
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { SLOT_SCHEMA, SLOT_V1_SCHEMA } from "./slot.js";

export const STORE_FORMAT_FILE = "store-format.json";
export const STORE_FORMAT_SCHEMA = "clossys.store-format/1";
export const PIN_V2_SCHEMA = "clossys.pin/2";

export interface StoreFormatDoc {
  readonly schema: typeof STORE_FORMAT_SCHEMA;
  readonly slot: typeof SLOT_SCHEMA;
  readonly pin: typeof PIN_V2_SCHEMA;
  readonly convertedAt: string;
  readonly createdBy: { readonly actor: "code"; readonly cli: string; readonly version: string };
}

export const storeFormatPath = (consumer: string): string => join(consumer, STORE_FORMAT_FILE);

/** True when the store carries the marker: anything at its path (fail closed; a link or a damaged file counts too). */
export function isConvertedStore(consumer: string): boolean {
  try { lstatSync(storeFormatPath(consumer)); return true; } catch { return false; }
}

/** The marker's bytes. */
export function storeFormatBytes(doc: Omit<StoreFormatDoc, "schema" | "slot" | "pin">): string {
  const full: StoreFormatDoc = { schema: STORE_FORMAT_SCHEMA, slot: SLOT_SCHEMA, pin: PIN_V2_SCHEMA, ...doc };
  return `${JSON.stringify(full, null, 2)}\n`;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** True for a pin/1 document: a pin record with no schema key. */
export const isPin1 = (value: unknown): boolean => object(value) && !Object.hasOwn(value, "schema") && Object.hasOwn(value, "candidate");
/** True for a `clossys.slot/1` document. */
export const isSlot1 = (value: unknown): boolean => object(value) && value.schema === SLOT_V1_SCHEMA;

/** Why a reader refuses an old-format file in a converted store (DRAFT copy, not owner-approved). */
export const oldFormatRefusal = (what: string): string =>
  `${what} is an old format in a store converted to ${SLOT_SCHEMA} and ${PIN_V2_SCHEMA} (${STORE_FORMAT_FILE}): refused; write it through its verb`;
