import { createHash } from "node:crypto";
import { loadWriterCatalog, type WriterSlot } from "../catalog/ia/index.js";
import { canonicalWriterJSON } from "../digest/index.js";
import type { Block, PassageRef, PatternInstance, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions, WriterDesignerEvidence } from "./freeze.js";

const RECORD_ID = /^(lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;
const isString = (record: WriterRecord): record is StringRecord => "text" in record;
const isPattern = (record: WriterRecord): record is PatternInstance => "parts" in record;
const isPassage = (record: WriterRecord): boolean => "schema" in record;
const isChrome = (record: WriterRecord): boolean => "regions" in record;

function recordKind(record: WriterRecord): string {
  if ("kind" in record) return "lexicon";
  if (isString(record)) return "string";
  if (isPattern(record)) return "pattern";
  if (isPassage(record)) return "passage";
  return "narrative";
}

/** Fingerprint the complete passage schema contract, independent of IA placement. */
export function writerPassageSchemaDigest(contract: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalWriterJSON(contract), "utf8").digest("hex");
}

/**
 * Resolve WR1-shaped source against same-locale records and explicit catalog/evidence.
 * Passage schema digests are lowercase SHA-256 of canonicalWriterJSON(slot.contract).
 * Unversioned frame/block references require exactly one versioned Designer evidence
 * document. Configs, including the empty default ID, must be explicitly listed.
 */
export function checkWriterClosedWorld(library: WriterLibrary, options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const catalog = options.catalog ?? loadWriterCatalog();
  const findings: WriterCheckFinding[] = [];
  const slots = new Map<string, WriterSlot[]>();
  for (const slot of catalog.slots) slots.set(slot.id, [...(slots.get(slot.id) ?? []), slot]);
  const designerLibraries = options.designerLibraries ?? [];

  for (const [locale, content] of Object.entries(library.locales)) {
    const records = new Map<string, WriterRecord[]>();
    for (const record of content.records) records.set(record.id, [...(records.get(record.id) ?? []), record]);
    for (const record of content.records) {
      const path = `${locale}/records/${record.id}`;
      const fail = (field: string, message: string): void => {
        findings.push({ code: "WR3", severity: "error", path: `${path}.${field}`, message, locale, recordId: record.id, field });
      };
      const slot = (id: string, field: string, expectedKind: string): WriterSlot | undefined => {
        const matches = slots.get(id) ?? [];
        if (matches.length !== 1) {
          fail(field, `Catalog leaf ${id} must resolve to exactly one slot.`);
          return undefined;
        }
        const target = matches[0]!;
        if (target.contract.kind !== expectedKind) {
          fail(field, `Catalog leaf ${id} must have kind ${expectedKind}.`);
          return undefined;
        }
        return target;
      };
      const resolve = (id: string, field: string, expected: string, accepts: (target: WriterRecord) => boolean): WriterRecord | undefined => {
        const matches = records.get(id) ?? [];
        if (matches.length !== 1) {
          fail(field, `Reference ${id} must resolve to exactly one ${expected} record in locale ${locale}.`);
          return undefined;
        }
        const target = matches[0]!;
        if (target.status === "retired") {
          fail(field, `Reference ${id} targets a retired record in locale ${locale}.`);
          return undefined;
        }
        if (!accepts(target)) {
          fail(field, `Reference ${id} must target a ${expected} record.`);
          return undefined;
        }
        return target;
      };
      const passageRef = (ref: PassageRef, field: string): void => {
        if (ref.ref === "string") resolve(ref.id, `${field}.id`, "string", isString);
        else if (ref.ref === "term") resolve(ref.id, `${field}.id`, "term", target => "kind" in target && target.kind === "term");
        else {
          const part = "part" in ref ? ref.part : undefined;
          const target = resolve(ref.id, `${field}.id`, "pattern", isPattern);
          if (target && isPattern(target) && part !== undefined && !Object.hasOwn(target.parts, part)) {
            fail(`${field}.part`, `Pattern ${ref.id} has no part ${part}.`);
          }
        }
      };
      const refs = (values: Record<string, PassageRef | PassageRef[]>, field: string): void => {
        for (const [name, value] of Object.entries(values)) {
          const key = `${field}.${name}`;
          if (Array.isArray(value)) value.forEach((ref, index) => passageRef(ref, `${key}[${index}]`));
          else passageRef(value, key);
        }
      };
      const evidence = (field: string, version?: string): WriterDesignerEvidence | undefined => {
        const matches = version === undefined ? designerLibraries : designerLibraries.filter(item => item.version === version);
        if (matches.length !== 1 || !matches[0]!.version.trim()) {
          fail(field, version === undefined
            ? "Reference requires exactly one versioned consumer Designer evidence document."
            : `Reference requires exactly one consumer Designer evidence document for version ${version}.`);
          return undefined;
        }
        return matches[0];
      };
      const asset = (ref: { assetId: string; libraryVersion: string }, field: string): void => {
        const source = evidence(`${field}.libraryVersion`, ref.libraryVersion);
        if (source && !source.assets.includes(ref.assetId)) fail(`${field}.assetId`, `Asset ${ref.assetId} is absent from Designer version ${source.version}.`);
      };
      const frame = (ref: { frameId: string; configId?: string }): void => {
        const source = evidence("frame.frameId");
        if (!source) return;
        const matches = source.frames.filter(item => item.id === ref.frameId);
        if (matches.length !== 1) {
          fail("frame.frameId", `Frame ${ref.frameId} must resolve exactly once in Designer version ${source.version}.`);
          return;
        }
        if (ref.configId !== undefined && !matches[0]!.configs?.includes(ref.configId)) {
          fail("frame.configId", `Frame config ${ref.configId} is absent from Designer version ${source.version}.`);
        }
      };
      const blocks = (values: Block[], field: string): void => {
        values.forEach((block, index) => {
          const key = `${field}[${index}]`;
          const source = evidence(`${key}.designer.id`);
          if (source) {
            if (!source.leaves.includes(block.designer.id)) fail(`${key}.designer.id`, `Designer leaf ${block.designer.id} is absent from version ${source.version}.`);
            else if (!Object.hasOwn(source.configs ?? {}, block.designer.id) || !source.configs?.[block.designer.id]?.includes(block.designer.configId)) {
              fail(`${key}.designer.configId`, `Designer config ${block.designer.configId} is absent for ${block.designer.id} in version ${source.version}.`);
            }
          }
          if (block.assetRef) asset(block.assetRef, `${key}.assetRef`);
          if (block.claim !== undefined) resolve(block.claim, `${key}.claim`, "claim", target => "kind" in target && target.kind === "claim");
          if (block.children) blocks(block.children, `${key}.children`);
        });
      };

      if ((records.get(record.id)?.length ?? 0) !== 1) fail("id", "Record ID is duplicated within this locale.");
      slot(record.leaf, "leaf", recordKind(record));
      if (isString(record)) {
        if (record.assetRef) asset(record.assetRef, "assetRef");
      } else if (isPattern(record)) {
        for (const [name, part] of Object.entries(record.parts)) {
          if ("ref" in part) resolve(part.ref.id, `parts.${name}.ref.id`, "string", isString);
        }
      } else if ("schema" in record) {
        if (record.schema !== record.leaf) fail("schema", "Passage schema must equal its leaf.");
        const schema = slot(record.schema, "schema", "passage");
        if (schema) {
          if (schema.contract.passageSchema !== record.schema) fail("schema", "Passage schema ID differs from its catalog contract.");
          const expected = writerPassageSchemaDigest(schema.contract);
          if (record.schemaDigest !== expected) fail("schemaDigest", "Passage schema digest differs from the current catalog contract.");
        }
        refs(record.fields, "fields");
      } else if ("frame" in record) {
        frame(record.frame);
        if ("regions" in record) {
          for (const [name, region] of Object.entries(record.regions)) refs(region, `regions.${name}`);
        } else if ("passages" in record) {
          if (record.chrome !== undefined) resolve(record.chrome, "chrome", "chrome narrative", isChrome);
          record.passages.forEach((id, index) => resolve(id, `passages[${index}]`, "passage", isPassage));
        } else {
          if (RECORD_ID.test(record.title)) resolve(record.title, "title", "string", isString);
          blocks(record.blocks, "blocks");
        }
      }
    }
  }
  return findings;
}
