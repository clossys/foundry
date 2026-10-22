import { SECTIONED_VIEW_CONTENT_CONTRACT as CONTRACT, CONTENT_ITEM_EYEBROW_MAX_CHARACTERS, validateSectionedViewDocument } from "../../core/sectioned-view.js";
import { proseParagraphTextLength } from "../../internal/prose-text.js";

/** Reject executable or inherited data before any rendering discriminator is read. */
export function assertClosedData(value: unknown, path: string, ancestors = new Set<object>()): void {
  if (typeof value === "function" || typeof value === "symbol") throw new Error(`${path} must contain data only.`);
  if (typeof value !== "object" || value === null) return;
  if (ancestors.has(value)) throw new Error(`${path} contains a data cycle.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be an ordinary array.`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${path}.${index} must be an enumerable data array entry.`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new Error(`${path} has a non-index array field.`);
    }
  } else if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${path} must be a plain data record.`);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new Error(`${path} must have enumerable own data fields.`);
    assertClosedData(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}
const COPY_FIELDS = new Set(["heading", "description", "eyebrow", "label", "title", "detail", "meta", "note", "text", "value", "valueText", "limitText", "previousText", "caption", "endLabel", "continuesLabel", "initials", "name", "origin", "cite", "fn", "subjectOf", "relationLabel", "flagLabel"]);
const PART_COPY_FIELDS: Readonly<Record<string, readonly string[]>> = { schedule: ["date", "amount"], shares: ["shareText"], files: ["format", "source"] };
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function axis(value: Record<string, unknown>, key: string, allowed: readonly unknown[], path: string): void {
  if (!Object.hasOwn(value, key) || !allowed.includes(value[key])) throw new Error(`${path}.${key} must be an explicit resolved axis.`);
}
/** Reuse authored structural validation with private placeholder refs; public text and provenance never change. */
export function assertCanonicalContentSection(section: Record<string, unknown>, path: string): void {
  assertClosedData(section, path);
  axis(section, "ground", ["base", "sunken", "inverse"], path);
  axis(section, "size", CONTRACT.sizes, path); axis(section, "layout", CONTRACT.layouts, path);
  const block = section.block;
  if (record(block) && block.type === "prose" && Array.isArray(block.paragraphs)) {
    block.paragraphs.forEach((paragraph, index) => {
      if (!Array.isArray(paragraph)) return;
      const spans = paragraph.filter((span): span is { text: string } => record(span) && typeof span.text === "string");
      if (spans.length !== paragraph.length) return;
      const length = proseParagraphTextLength(spans);
      const max = CONTRACT.prose.charactersPerParagraph;
      if (length > max) throw new Error(`sectioned-view-content-prose-text-length: ${path}.block.paragraphs.${index} holds at most ${max} characters; it holds ${length}.`);
    });
  }
  if (record(block) && block.type === "items") {
    for (const [key, values] of [["arrangement", CONTRACT.arrangements], ["order", CONTRACT.orders], ["reveal", CONTRACT.reveals], ["treatment", CONTRACT.treatments], ["scale", CONTRACT.scales]] as const) axis(block, key, values, `${path}.block`);
    if (block.arrangement === "columns") axis(block, "columns", CONTRACT.columnOptions, `${path}.block`);
    if (block.arrangement === "rows") axis(block, "columns", CONTRACT.rowColumnOptions, `${path}.block`);
    if (block.arrangement === "bento" && Array.isArray(block.items)) block.items.forEach((item, index) => { if (record(item)) axis(item, "span", Object.keys(CONTRACT.spans), `${path}.block.items.${index}`); });
    const continuation = block.order === "connected" && block.end === "continues" && block.endLabel === undefined;
    if (continuation ? !nonBlank(block.continuesLabel) : block.continuesLabel !== undefined) throw new Error(`${path}.block.continuesLabel must match the resolved continuation copy.`);
  }
  const media = record(section.media) ? section.media : undefined;
  function copy(value: unknown, fieldPath: string): unknown {
    if (value === undefined) return value;
    if (!nonBlank(value)) throw new Error(`${fieldPath} must be resolved non-blank copy.`);
    const field = fieldPath.slice(path.length + 1).replace(/\.\d+(?=\.|$)/g, ".*");
    let max: number | undefined;
    if (/^block\.items\.\*\.eyebrow$/.test(field)) max = CONTENT_ITEM_EYEBROW_MAX_CHARACTERS;
    if (/^block\.groups\.\*\.label$/.test(field)) max = 24;
    if (/^block\.lanes\.\*\.label$/.test(field)) max = 20;
    if (field === "block.endLabel") max = 40;
    if (field === "block.caption") max = 120;
    if (media?.type === "record") {
      const caps: Record<string, number> = { "media.groups.*.label": 24, "media.groups.*.rows.*.label": 40, "media.groups.*.rows.*.detail": 48, "media.groups.*.rows.*.status.label": 20, "media.groups.*.note": 80, "media.caption": 120 }; max = caps[field] ?? max;
    }
    if (media?.type === "specimen" && record(media.key)) {
      if (field === "media.label") { const words = value.trim().split(/\s+/).length; if (words < 6 || words > 25) throw new Error(`${fieldPath} needs 6–25 words.`); }
      if (/^media\.key\.items\.\*\.(heading|description)$/.test(field)) max = field.endsWith("heading") ? 40 : 140;
    }
    if (media?.type === "scene" && field.startsWith("media.")) {
      const template = record(media.input) ? media.input.template : undefined;
      if (field === "media.label") { const words = value.trim().split(/\s+/).length; if (words < 12 || words > 25) throw new Error(`${fieldPath} needs 12–25 words.`); }
      if (/\.heading$/.test(field)) max = 28;
      if (/sources\.(items\.)?\*\.title$/.test(field)) max = template === "evidence-trail" ? 22 : 28;
      if (/\.origin$/.test(field)) max = 16;
      if (/\.(cite|fn)$/.test(field)) max = 12;
      if (/findings\.\*\.title$/.test(field)) max = 40;
      if (/\.subjectOf$/.test(field)) max = 28;
      if (/input\.(target|result|decision)\.title$/.test(field)) max = template === "evidence-trail" ? 24 : 28;
      if (/\.meta$/.test(field)) max = template === "evidence-trail" ? 36 : 40;
      if (/rows\.\*\.label$/.test(field)) max = 16;
      if (/rows\.\*\.value$/.test(field)) {
        max = template === "approval-chain" ? 22 : 20;
        const match = /\.rows\.(\d+)\.value$/.exec(fieldPath); const input = record(media.input) ? media.input : undefined; const result = record(input?.result) ? input.result : undefined;
        const row = match !== null && Array.isArray(result?.rows) ? result.rows[Number(match[1])] : undefined;
        if (template === "evidence-trail" && record(row) && row.figure === true) max = 8;
      }
      if (/\.status\.text$/.test(field)) max = template === "approval-chain" ? 14 : 16;
      if (field === "media.input.node.label") max = 18;
      if (/\.person\.name$/.test(field)) max = 20;
      if (/\.person\.note$/.test(field)) max = 24;
    }
    if (max !== undefined && [...value.trim()].length > max) throw new Error(`${fieldPath} holds at most ${max} characters.`);
    return { id: "render.validation" };
  }
  function project(value: unknown, fieldPath: string, field = "", partType?: string): unknown {
    if (Array.isArray(value)) return value.map((entry, index) => field === "points" || field === "cites" ? copy(entry, `${fieldPath}.${index}`) : project(entry, `${fieldPath}.${index}`, "", partType));
    const sceneInitials = field === "initials" && fieldPath.startsWith(`${path}.media.input.`);
    const numericValue = field === "value" && typeof value === "number";
    const partCopy = partType !== undefined && Object.hasOwn(PART_COPY_FIELDS, partType) && PART_COPY_FIELDS[partType]?.includes(field) === true;
    const assetAlt = media?.type === "asset" && fieldPath === `${path}.media.alt`;
    if ((COPY_FIELDS.has(field) || partCopy || assetAlt) && !sceneInitials && !numericValue) return copy(value, fieldPath);
    if (record(value)) {
      const localPath = fieldPath.slice(path.length + 1);
      // Only specimen parts own these copy fields; Scene formats and source records stay structural.
      const childPartType = /^(media\.panel\.parts\.\d+|block\.items\.\d+\.visual|block\.sides\.\d+\.visual\.parts\.\d+)$/.test(localPath) && typeof value.type === "string" ? value.type : partType;
      return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !(fieldPath === `${path}.block` && key === "continuesLabel") && !(fieldPath === path && key === "ground" && entry !== "inverse")).map(([key, entry]) => [key, project(entry, `${fieldPath}.${key}`, key, childPartType)]));
    }
    return value;
  }
  // Structural errors retain their original section index instead of a synthetic validation index.
  const findings = validateSectionedViewDocument({ id: "render-validation", sections: [project(section, path)] }).filter(finding => finding.severity === "error");
  if (findings[0] !== undefined) throw new Error(`${(findings[0].path ?? path).replace(/^sections\.0(?=\.|$)/, path)}: ${findings[0].message.replaceAll("sections.0", path)}`);
}
