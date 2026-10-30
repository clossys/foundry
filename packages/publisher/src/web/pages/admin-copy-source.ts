import { validateWriterRecord } from "@clossys/writer";
import type { StringRecord } from "@clossys/writer";
import { runtimeSnapshot } from "@clossys/designer/catalog";
import type { AdminPageCopyEnvelope } from "./admin-copy.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Server boundary: authentic draft records are checked by Writer's public
 * schema. Optional limits remain absent; no approval or defaults are invented. */
export function prepareAdminPageCopyEnvelopes(input: readonly { readonly source: string; readonly envelope: unknown }[]): readonly AdminPageCopyEnvelope[] {
  return runtimeSnapshot(input.map(({ source, envelope: value }) => {
    if (!source?.trim() || !object(value) || typeof value.version !== "number" || typeof value.revision !== "number" || typeof value.locale !== "string" || typeof value.state !== "string" || typeof value.activation !== "string" || !Array.isArray(value.records) || !Array.isArray(value.bindings)) throw new TypeError("Writer source envelope is malformed");
    const isString = (record: unknown): record is StringRecord => validateWriterRecord(record, "strings").length === 0;
    const records = value.records;
    if (!records.every(isString)) throw new TypeError("Writer refused source string-record validation");
    const bindings = value.bindings.map(binding => {
      if (!object(binding) || typeof binding.cellId !== "string" || typeof binding.recordId !== "string" || typeof binding.target !== "string" || typeof binding.kind !== "string") throw new TypeError("Writer source binding is malformed");
      return { cellId: binding.cellId, recordId: binding.recordId, target: binding.target, kind: binding.kind };
    });
    const aliases: Record<string, string> = {};
    if (value.aliases !== undefined) {
      if (!object(value.aliases)) throw new TypeError("Writer source aliases are malformed");
      for (const [key, id] of Object.entries(value.aliases)) { if (typeof id !== "string") throw new TypeError("Writer source alias is malformed"); aliases[key] = id; }
    }
    const externalRecords = value.externalRecords === undefined ? [] : Array.isArray(value.externalRecords) ? value.externalRecords.map(external => {
      if (!object(external) || typeof external.recordId !== "string" || typeof external.source !== "string" || typeof external.sourceContext !== "string") throw new TypeError("Writer external record is malformed");
      return { recordId: external.recordId, source: external.source, sourceContext: external.sourceContext };
    }) : (() => { throw new TypeError("Writer external records are malformed"); })();
    return { source, envelope: { ...value, version: value.version, revision: value.revision, locale: value.locale, state: value.state, activation: value.activation, records, bindings,
      ...(value.aliases === undefined ? {} : { aliases }), ...(value.externalRecords === undefined ? {} : { externalRecords }) } };
  }));
}
