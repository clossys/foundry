import type { CellRef } from "@clossys/strategist";
import type { CopyApproval, CopyTranslationProvenance } from "../types.js";
import type { WriterLayer } from "../catalog-core/ids.js";

export type { WriterLayer } from "../catalog-core/ids.js";
export type LeafId = `${WriterLayer}.${string}`;
export type RecordId = `${"lx" | "st" | "pt" | "ps" | "nr"}.${string}`;
export type LocaleStatus = "draft" | "approved" | "retired";
export interface RecordBase {
  id: RecordId;
  leaf: LeafId;
  context: string;
  status: LocaleStatus;
  origin: "authored" | "external" | "foundry-default";
  external?: { publisher: string; reference: string; retrievedAt: string; license?: string };
  approval?: CopyApproval;
  translation?: CopyTranslationProvenance;
}
export type LexiconRecord = RecordBase & (
  | { kind: "voice-rule"; rule: "formality" | "warmth" | "energy" | "person" | "mood" | "sentence-length" | "reading-level"; value: string | number; forbidden?: string[] }
  | { kind: "term"; term: string; forms: string[]; casing?: string; termStatus: "brand" | "preferred" | "avoid"; alternative?: string; reason: string; pronunciation?: string; channel?: string }
  | { kind: "pattern-rule"; pattern: { source: string; flags?: string }; severity: "error" | "warning" | "advisory"; reason: string; alternative?: string }
  | { kind: "claim"; strategy: CellRef; phrasings: string[]; requiresCitation: true }
  | { kind: "format"; format: "number" | "plural" | "date" | "time" | "currency" | "unit" | "capitalization" | "punctuation" | "direction" | "expansion"; value: Record<string, unknown> }
);
export interface StringRecord extends RecordBase {
  text: string;
  args?: { name: string; type: "string" | "number" | "date" | "plural" | "select" }[];
  limits?: { maxChars?: number; maxWords?: number };
  assetRef?: { assetId: string; libraryVersion: string };
}
export interface PatternInstance extends RecordBase {
  parts: Record<string, { text: string } | { ref: { kind: "string"; id: RecordId } }>;
}
export type PassageRef = { ref: "string" | "term"; id: RecordId } | { ref: "pattern"; id: RecordId; part?: string };
export interface PassageRecord extends RecordBase {
  schema: LeafId;
  schemaDigest: string;
  fields: Record<string, PassageRef | PassageRef[]>;
}
export interface PageNarrative extends RecordBase {
  frame: { frameId: string };
  chrome?: RecordId;
  passages: RecordId[];
}
export interface ChromeNarrative extends RecordBase {
  frame: { frameId: string; configId: string };
  regions: Record<string, Record<string, PassageRef | PassageRef[]>>;
}
export interface Block {
  type: "heading" | "paragraph" | "list" | "quote" | "code" | "callout" | "figure" | "citation" | "table" | "toc";
  designer: { id: `components.${string}` | `sections.${string}`; configId: string };
  text?: string;
  children?: Block[];
  assetRef?: { assetId: string; libraryVersion: string };
  claim?: RecordId;
  timing?: { startMs: number; endMs: number };
}
export interface LongFormNarrative extends RecordBase {
  title: RecordId | string;
  frame: { frameId: string };
  blocks: Block[];
}
export type NarrativeRecord = PageNarrative | ChromeNarrative | LongFormNarrative;
export type WriterRecord = LexiconRecord | StringRecord | PatternInstance | PassageRecord | NarrativeRecord;
export interface WriterManifest {
  consumer: string;
  messageSyntax: "icu-mf1";
  defaultLocale: string;
  locales: { tag: string; dir: "ltr" | "rtl"; state: "active" | "planned" | "pseudo" }[];
  fallback: Record<string, string[]>;
  strategy: { root: string; contract: "writer.messaging" };
  leafFreeze: Record<WriterLayer, string>;
}
/** Markdown remains source data until the narrative parser interprets it. */
export interface WriterDocument { path: string; source: string }
export interface WriterLocaleContent {
  records: WriterRecord[];
  documents: WriterDocument[];
  files?: { path: string; recordIds: RecordId[] }[];
}
export interface WriterLibrary { manifest: WriterManifest; locales: Record<string, WriterLocaleContent> }
export interface WriterReceipt {
  libraryDigest: string;
  locales: Record<string, { digest: string; counts: Record<LocaleStatus | "missing", number> }>;
}
export interface WriterShapeIssue { code: "WR1" | "load"; path: string; message: string }
export interface WriterLoadResult { library: WriterLibrary | null; issues: WriterShapeIssue[]; exitCode: 0 | 1 | 2 }
