import { readFileSync } from "node:fs";
import { treeHash } from "./hash.js";
import { withFrameOwnershipSchema } from "./frame-ownership-schema.js";
import { validateAgainst, type JsonSchema, type SchemaIssue } from "./schema.js";
import {
  ELEMENT_SCHEMA,
  PREVIEW_SCHEMA,
  REFERENCES_MANIFEST_SCHEMA,
  RELEASE_SCHEMA,
  SELECTION_SCHEMA,
  SLOT_CONTRACT_SCHEMA,
} from "./schemas.js";
import type {
  ElementRecord,
  Pins,
  PinState,
  PreviewRecord,
  ReferencesManifest,
  Release,
  Selection,
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

export function validateRelease(value: unknown): Validation<Release> {
  return run<Release>(RELEASE_SCHEMA, value, () => []);
}

/**
 * Replay a pin history into the pins it implies. Throws on an event that
 * cannot apply; `validateSelection` turns that into an issue.
 */
export function foldHistory(history: Selection["history"]): Pins {
  const pins: Record<string, PinState> = {};
  const byId = new Map<string, Selection["history"][number]>();
  for (const [index, event] of history.entries()) {
    const where = `$.history[${index}]`;
    if (byId.has(event.id)) throw new FoldError(where, `duplicate event id "${event.id}"`);
    const previous = history[index - 1];
    if (previous && event.at < previous.at) throw new FoldError(where, "events must be in time order");
    if (event.action === "unpin") {
      if (event.element !== undefined || event.version !== undefined || event.hash !== undefined) {
        throw new FoldError(where, "unpin carries no element, version or hash");
      }
      if (!pins[event.slot]) throw new FoldError(where, `slot ${event.slot} is not pinned`);
      delete pins[event.slot];
    } else {
      if (event.element === undefined || event.version === undefined || event.hash === undefined) {
        throw new FoldError(where, `${event.action} needs element, version and hash`);
      }
      if (event.action === "restore") {
        const target = event.restores === undefined ? undefined : byId.get(event.restores);
        if (!target || target.action === "unpin" || target.slot !== event.slot) {
          throw new FoldError(where, "restore must name an earlier pin of the same slot");
        }
        if (target.element !== event.element || target.version !== event.version || target.hash !== event.hash) {
          throw new FoldError(where, "restore must re-apply exactly the element, version and hash it names");
        }
      } else if (event.restores !== undefined) {
        throw new FoldError(where, "only a restore names an earlier event");
      }
      pins[event.slot] = { element: event.element, version: event.version, hash: event.hash, event: event.id };
    }
    byId.set(event.id, event);
  }
  return pins;
}

class FoldError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
  }
}

function canonical(pins: Pins): string {
  return JSON.stringify(Object.keys(pins).sort().map((slot) => [slot, pins[slot]]));
}

export function validateSelection(value: unknown): Validation<Selection> {
  return run<Selection>(SELECTION_SCHEMA, value, (selection) => {
    let implied: Pins;
    try {
      implied = foldHistory(selection.history);
    } catch (error) {
      if (error instanceof FoldError) return [{ path: error.path, message: error.message }];
      throw error;
    }
    return canonical(implied) === canonical(selection.pins)
      ? []
      : [{ path: "$.pins", message: "pins disagree with the replayed history" }];
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
export const loadSelection = (path: string): Selection => load(path, "selection", validateSelection);
export const loadRelease = (path: string): Release => load(path, "release", validateRelease);
export const loadSlotContract = (path: string): SlotContract => load(path, "slot contract", validateSlotContract);
export const loadReferencesManifest = (path: string): ReferencesManifest =>
  load(path, "references manifest", validateReferencesManifest);
