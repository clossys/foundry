import type { WriterSlotBodyRecord } from "./slot-body.js";

export const WRITER_DECLARATIONS_SCHEMA = "clossys.writer-declarations/1" as const;
export const WRITER_DECLARATIONS_FILENAME = "declarations.json" as const;

export interface WriterDeclarationRef extends Record<string, unknown> { id: string }
export interface WriterDeclarationField extends Record<string, unknown> {
  key: string;
  ref: WriterDeclarationRef;
  locale?: string;
  source?: string;
}
export interface WriterDeclarationSection extends Record<string, unknown> {
  sectionId: string;
  configId: string;
  passageAlias?: string;
  fields: WriterDeclarationField[];
}
export interface WriterLocaleDeclarations extends Record<string, unknown> {
  aliases: Record<string, string>;
  sections: WriterDeclarationSection[];
}
export interface WriterDeclarations extends Record<string, unknown> {
  schema: typeof WRITER_DECLARATIONS_SCHEMA;
  locales: Record<string, WriterLocaleDeclarations>;
}
export interface WriterDeclarationsProjectOptions {
  /** The caller asserts these are ALL selected native records, including external targets. */
  completeRecords?: readonly WriterSlotBodyRecord[];
}

export class WriterDeclarationsParseError extends Error {
  /** JSON Pointer into declarations.json (empty string names the document). */
  constructor(message: string, public readonly path: string) {
    super(`Writer declarations${path || "/"}: ${message}`);
    this.name = "WriterDeclarationsParseError";
  }
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const localeTag = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const at = (path: string, key: string | number) => `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const fail = (message: string, path: string): never => { throw new WriterDeclarationsParseError(message, path); };

// JSON.parse alone would silently discard repeated aliases or other authored keys.
function rejectDuplicateKeys(source: string): void {
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)!;
  let i = 0;
  const visit = (path: string): void => {
    const token = tokens[i++];
    if (token === "{") {
      const seen = new Set<string>();
      while (tokens[i] !== "}") {
        const key = JSON.parse(tokens[i++]!) as string;
        const child = at(path, key);
        if (seen.has(key)) fail("Repeated JSON object key", child);
        seen.add(key);
        i++; // colon; syntax was already validated by JSON.parse
        visit(child);
        if (tokens[i] !== ",") break;
        i++;
      }
      i++;
    } else if (token === "[") {
      let index = 0;
      while (tokens[i] !== "]") {
        visit(at(path, index++));
        if (tokens[i] !== ",") break;
        i++;
      }
      i++;
    }
  };
  visit("");
}

function validate(value: unknown): asserts value is WriterDeclarations {
  if (!object(value) || value.schema !== WRITER_DECLARATIONS_SCHEMA) fail(`Expected schema ${WRITER_DECLARATIONS_SCHEMA}`, "/schema");
  const root = value as Record<string, unknown>;
  if (!object(root.locales) || !Object.keys(root.locales).length) fail("Expected explicit locale declarations", "/locales");
  for (const [locale, raw] of Object.entries(root.locales as Record<string, unknown>)) {
    const path = at("/locales", locale);
    if (!localeTag.test(locale)) fail("Invalid locale tag", path);
    if (!object(raw) || !Object.hasOwn(raw, "aliases") || !object(raw.aliases) || !Object.hasOwn(raw, "sections") || !Array.isArray(raw.sections)) {
      fail("Expected explicit aliases object and sections array", path);
    }
    const declared = raw as WriterLocaleDeclarations;
    for (const [alias, id] of Object.entries(declared.aliases)) {
      if (!text(alias) || !text(id)) fail("Expected nonempty alias and record id", at(`${path}/aliases`, alias));
    }
    const sections = new Set<string>();
    declared.sections.forEach((section, index) => {
      const sectionPath = at(`${path}/sections`, index);
      if (!object(section) || !text(section.sectionId) || !text(section.configId) || !Array.isArray(section.fields)) fail("Expected sectionId, configId and explicit fields array", sectionPath);
      const key = JSON.stringify([section.sectionId, section.configId]);
      if (sections.has(key)) fail("Repeated sectionId/configId declaration", sectionPath);
      sections.add(key);
      if (Object.hasOwn(section, "passageAlias") && !text(section.passageAlias)) fail("Expected nonempty passageAlias", `${sectionPath}/passageAlias`);
      const fields = new Set<string>();
      section.fields.forEach((field, fieldIndex) => {
        const fieldPath = at(`${sectionPath}/fields`, fieldIndex);
        if (!object(field) || !text(field.key) || !object(field.ref) || !text(field.ref.id)) fail("Expected field key and ref.id", fieldPath);
        if (fields.has(field.key)) fail("Repeated field key", `${fieldPath}/key`);
        fields.add(field.key);
        if (Object.hasOwn(field, "locale") && field.locale !== locale) fail("Field locale must match declaration locale", `${fieldPath}/locale`);
        if (Object.hasOwn(field, "source") && !text(field.source)) fail("Expected nonempty field source", `${fieldPath}/source`);
      });
    });
  }
}

/** Parse authored native declarations.json text. Missing declarations are not empty maps. */
export function parseWriterDeclarations(source: string): WriterDeclarations {
  if (typeof source !== "string") fail("Expected declarations JSON text", "");
  let value: unknown;
  try { value = JSON.parse(source); } catch { fail("Invalid declarations JSON", ""); }
  rejectDuplicateKeys(source);
  validate(value);
  return value;
}

function equalJSON(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equalJSON(v, right[i]));
  if (object(left) && object(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJSON(left[key], right[key]));
  }
  return false;
}

/**
 * Select an explicit locale without deriving aliases or sections from record context/bindings.
 * completeRecords opts into target validation; omitted records leave external ids unverified.
 * declarations must be a document returned by parseWriterDeclarations, not arbitrary JS objects.
 * The returned locale declaration is a fresh data copy, retaining parsed values and array order.
 */
export function projectWriterDeclarations(
  declarations: WriterDeclarations,
  locale: string,
  options: WriterDeclarationsProjectOptions = {},
): WriterLocaleDeclarations {
  validate(declarations);
  if (typeof locale !== "string" || !Object.hasOwn(declarations.locales, locale)) fail("Missing authored locale declaration", at("/locales", locale));
  const selected = declarations.locales[locale]!;
  if (options.completeRecords !== undefined) {
    if (!Array.isArray(options.completeRecords)) fail("Expected complete native record rows", "/completeRecords");
    const records = new Map<string, Record<string, unknown>>();
    for (const row of options.completeRecords) {
      if (!object(row) || typeof row.locale !== "string" || !object(row.record) || !text(row.record.id)) fail("Invalid native record row", "/completeRecords");
      if (row.locale !== locale) continue;
      const previous = records.get(row.record.id);
      if (previous && !equalJSON(previous, row.record)) fail(`Conflicting native record ${row.record.id}`, "/completeRecords");
      records.set(row.record.id, row.record);
    }
    const requireId = (id: string, path: string) => { if (!records.has(id)) fail(`Missing record ${id} from complete native rows for ${locale}`, path); };
    for (const [alias, id] of Object.entries(selected.aliases)) requireId(id, at(`/locales/${locale}/aliases`, alias));
    selected.sections.forEach((section, i) => section.fields.forEach((field, j) => requireId(field.ref.id, `/locales/${locale}/sections/${i}/fields/${j}/ref/id`)));
  }
  return structuredClone(selected);
}

/**
 * Canonical declarations.json bytes: validated by the one reader, two-space indent,
 * authored key and array order, trailing newline. Throws on anything the reader refuses.
 */
export function serializeWriterDeclarations(declarations: WriterDeclarations): string {
  const bytes = `${JSON.stringify(declarations, null, 2)}\n`;
  parseWriterDeclarations(bytes);
  return bytes;
}

/**
 * Write a consumer's `agents/writer/declarations.json` through the reader's own validation.
 * With completeRecords, every alias and section field must name a pinned record in each
 * declared locale before anything is written. Symbolic links are refused.
 */
export async function writeWriterDeclarations(
  consumerDir: string,
  declarations: WriterDeclarations,
  options: WriterDeclarationsProjectOptions = {},
): Promise<{ path: string; bytes: string }> {
  const { lstat, rename, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const bytes = serializeWriterDeclarations(declarations);
  const parsed = parseWriterDeclarations(bytes);
  if (options.completeRecords !== undefined) for (const locale of Object.keys(parsed.locales)) projectWriterDeclarations(parsed, locale, options);
  const dir = join(consumerDir, "agents", "writer");
  const path = join(dir, WRITER_DECLARATIONS_FILENAME);
  for (const target of [dir, path]) {
    const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (stat?.isSymbolicLink()) throw new WriterDeclarationsParseError(`Refusing symbolic link at ${target}`, "");
    if (target === dir && !stat?.isDirectory()) throw new WriterDeclarationsParseError(`No Writer agent folder at ${dir}`, "");
  }
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { encoding: "utf8", flag: "wx" });
  await rename(temp, path);
  return { path, bytes };
}
