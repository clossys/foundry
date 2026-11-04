import { readFileSync } from "node:fs";
import { treeHash } from "./hash.js";
import { withFrameOwnershipSchema } from "./frame-ownership-schema.js";
import { validateAgainst, type JsonSchema, type SchemaIssue } from "./schema.js";
import {
  ELEMENT_SCHEMA,
  PREVIEW_SCHEMA,
  REFERENCES_MANIFEST_SCHEMA,
  SLOT_CONTRACT_SCHEMA,
} from "./schemas.js";
import type {
  ElementRecord,
  PreviewRecord,
  ReferencesManifest,
  SlotContract,
} from "./types.js";

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

export class RecordError extends Error {
  readonly issues: readonly SchemaIssue[];
  constructor(what: string, issues: readonly SchemaIssue[]) {
    super(`${what} is invalid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "RecordError";
    this.issues = issues;
  }
}

function run<T>(schema: JsonSchema, value: unknown, semantic: (v: T) => SchemaIssue[]): Validation<T> {
  const issues = validateAgainst(schema, value);
  if (issues.length === 0) issues.push(...semantic(value as T));
  return issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues };
}

function slotInLayer(slot: string, layer: string, path: string): SchemaIssue[] {
  return slot.startsWith(`${layer}.`) ? [] : [{ path, message: `slot "${slot}" is not in layer "${layer}"` }];
}

export function validateElement(value: unknown): Validation<ElementRecord> {
  return run<ElementRecord>(ELEMENT_SCHEMA, value, (record) => {
    const issues = slotInLayer(record.slot, record.layer, "$.slot");
    const { mode, source, parent } = record.lineage;
    if (mode !== "original" && !source) issues.push({ path: "$.lineage.source", message: `is required when mode is ${mode}` });
    if (mode === "original" && source) issues.push({ path: "$.lineage.source", message: "must be absent when mode is original" });
    if (mode === "original" && record.lineage.parts) issues.push({ path: "$.lineage.parts", message: "must be absent when mode is original" });
    const proof = record.lineage.exactParts;
    if (proof) {
      if (mode === "original") issues.push({ path: "$.lineage.exactParts", message: "must be absent when mode is original" });
      const count = 1 + (record.lineage.parts?.length ?? 0);
      for (const [file, evidence] of Object.entries(proof.files)) {
        let end = 0;
        for (const segment of evidence.segments) {
          const at = `$.lineage.exactParts.files.${file}`;
          if (segment.start !== end || segment.endExclusive <= segment.start) issues.push({ path: at, message: "segments must form a contiguous nonempty byte partition" });
          end = segment.endExclusive;
          if (segment.source.reference >= count || segment.source.endExclusive <= segment.source.start) issues.push({ path: at, message: "invalid source reference or byte boundaries" });
          let editEnd = 0;
          for (const edit of segment.edits) {
            if (edit.start < editEnd || edit.endExclusive <= edit.start || edit.endExclusive > segment.source.endExclusive - segment.source.start) issues.push({ path: at, message: "edits must be ordered nonoverlapping source byte spans" });
            editEnd = edit.endExclusive;
          }
        }
      }
    }
    if (parent && parent.version >= record.version) issues.push({ path: "$.lineage.parent.version", message: "must be lower than version" });
    return issues;
  });
}

export function validatePreview(value: unknown): Validation<PreviewRecord> {
  return run<PreviewRecord>(PREVIEW_SCHEMA, value, () => []);
}

export function validateSlotContract(value: unknown): Validation<SlotContract> {
  return run<SlotContract>(withFrameOwnershipSchema(SLOT_CONTRACT_SCHEMA), value, (contract) => {
    const issues = slotInLayer(contract.slot, contract.layer, "$.slot");
    if (!contract.ownership) return issues;
    if (contract.layer !== "frames") issues.push({ path: "$.ownership", message: "ownership belongs only to frame contracts" });
    const inputs = new Map(contract.inputs.map(input => [input.name, input]));
    if (inputs.size !== contract.inputs.length) issues.push({ path: "$.inputs", message: "frame input names must be unique" });
    const bound = new Set<string>();
    for (const [region, names] of Object.entries(contract.ownership.regions)) for (const name of names) {
      const path = `$.ownership.regions.${region}`;
      const input = inputs.get(name);
      if (!input) issues.push({ path, message: `undeclared input ${name}` });
      if (bound.has(name)) issues.push({ path, message: `input ${name} is bound by more than one region` });
      bound.add(name);
      if (input && (input.kind === "copy" || input.kind === "asset") && !input.slot) issues.push({ path, message: `${input.kind} input ${name} must bind an owning slot` });
    }
    for (const input of contract.inputs) if (input.required && input.kind !== "theme" && !bound.has(input.name)) issues.push({ path: "$.ownership.regions", message: `required input ${input.name} has no owning region` });
    return issues;
  });
}

export function validateReferencesManifest(value: unknown): Validation<ReferencesManifest> {
  return run<ReferencesManifest>(REFERENCES_MANIFEST_SCHEMA, value, (manifest) => {
    const issues: SchemaIssue[] = [];
    const dirs = new Set<string>();
    manifest.items.forEach((item, index) => {
      const where = `$.items[${index}]`;
      if (!manifest.registries[item.registry]) issues.push({ path: `${where}.registry`, message: `unknown registry "${item.registry}"` });
      const expected = `${item.registry}/${item.name}@${item.version}`;
      if (item.dir !== expected) issues.push({ path: `${where}.dir`, message: `must be ${expected}` });
      if (dirs.has(item.dir)) issues.push({ path: `${where}.dir`, message: "duplicate item directory" });
      dirs.add(item.dir);
      if (treeHash(item.files) !== item.hash) issues.push({ path: `${where}.hash`, message: "does not match its files" });
      item.adaptations?.forEach((adaptation, n) => {
        if (treeHash(adaptation.upstream.files) !== adaptation.upstream.hash) issues.push({ path: `${where}.adaptations[${n}].upstream.hash`, message: "does not match its upstream files" });
      });
    });
    return issues;
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function load<T>(path: string, what: string, validate: (value: unknown) => Validation<T>): T {
  const result = validate(readJson(path));
  if (!result.ok) throw new RecordError(`${what} ${path}`, result.issues);
  return result.value;
}

export const loadElement = (path: string): ElementRecord => load(path, "element record", validateElement);
export const loadPreview = (path: string): PreviewRecord => load(path, "preview record", validatePreview);
export const loadSlotContract = (path: string): SlotContract => load(path, "slot contract", validateSlotContract);
export const loadReferencesManifest = (path: string): ReferencesManifest =>
  load(path, "references manifest", validateReferencesManifest);
