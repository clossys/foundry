import lexicon from './catalog/slots/lexicon.json' with { type: 'json' };
import strings from './catalog/slots/strings.json' with { type: 'json' };
import patterns from './catalog/slots/patterns.json' with { type: 'json' };
import passages from './catalog/slots/passages.json' with { type: 'json' };
import narratives from './catalog/slots/narratives.json' with { type: 'json' };
import type { Block, PassageRef, WriterRecord } from './model/types.js';
import { resolveWriterReferenceText } from './model/resolve-text.js';

/** Structural rich-text data; the selected Designer RichText leaf owns validation and rendering. */
export interface WriterSpecimenNode { type: string; text?: string; attrs?: Record<string, unknown>; content?: WriterSpecimenNode[] }
export interface WriterSpecimenValue { text?: string; passage?: WriterSpecimenNode; inspectorOnly?: boolean; issues: string[] }
const canonicalLexiconLeaves = new Set(lexicon.map(slot => slot.id));
const canonicalTextLeaves = new Set(strings.map(slot => slot.id));
const canonicalContentLeaves = new Set([...strings, ...patterns, ...passages, ...narratives].map(slot => slot.id));
/** Exact shipped membership, never a broad strings.* fallback. */
export const isWriterSpecimenTextLeaf = (leaf: unknown): boolean => typeof leaf === 'string' && canonicalTextLeaves.has(leaf);
export const isWriterSpecimenContentLeaf = (leaf: unknown): boolean => typeof leaf === 'string' && canonicalContentLeaves.has(leaf);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const paragraph = (text: string): WriterSpecimenNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });

/** Complete native wording, never record JSON, rationale, guessed copy, or another locale. */
export function materializeWriterSpecimen(record: WriterRecord, records: readonly WriterRecord[]): WriterSpecimenValue {
  const issues: string[] = [];
  const fail = (reason: string): void => { issues.push(`${record.id}: ${reason}`); };
  const reference = (ref: PassageRef): string | undefined => {
    const targets = ref && records.filter(record => record.id === ref.id);
    if (targets && targets.length > 1) { fail(`ambiguous:${ref.id}`); return undefined; }
    if (targets?.[0]?.status === 'retired') { fail(`retired:${ref.id}`); return undefined; }
    const result = resolveWriterReferenceText(ref, records);
    if (result.issues.length) { result.issues.forEach(fail); return undefined; }
    return result.text;
  };
  const refs = (value: PassageRef | PassageRef[]): WriterSpecimenNode[] => (Array.isArray(value) ? value : [value]).flatMap(ref => {
    const text = reference(ref); return text === undefined ? [] : [paragraph(text)];
  });
  const document = (content: WriterSpecimenNode[]): WriterSpecimenValue => {
    if (!content.length) fail('No produced wording is available.');
    return { ...(content.length ? { passage: { type: 'doc', content } } : {}), issues };
  };
  if ('text' in record && typeof record.text === 'string') {
    if (!isWriterSpecimenTextLeaf(record.leaf)) { fail('Unsupported native Writer text leaf.'); return { issues }; }
    return { text: record.text, issues };
  }
  if (canonicalLexiconLeaves.has(record.leaf) && 'kind' in record && ['voice-rule', 'pattern-rule', 'format', 'term'].includes(record.kind)) return { inspectorOnly: true, issues };
  if (!isWriterSpecimenContentLeaf(record.leaf)) { fail('Unsupported native Writer leaf.'); return { issues }; }
  if ('parts' in record && object(record.parts)) {
    const content = Object.keys(record.parts).sort().flatMap(part => {
      const text = reference({ ref: 'pattern', id: record.id, part });
      return text === undefined ? [] : [paragraph(text)];
    });
    return document(content);
  }
  if ('fields' in record && object(record.fields)) {
    const slot = passages.find(slot => slot.id === record.leaf);
    const fields = slot?.contract.copy.fields;
    if (!slot || record.schema !== record.leaf) { fail('Passage schema does not match its canonical leaf.'); return { issues }; }
    if (fields?.length === 0 && Object.keys(record.fields).length === 0) return { inspectorOnly: true, issues };
    const declared = new Set((fields ?? []).map(field => field.key));
    for (const key of Object.keys(record.fields)) if (!declared.has(key)) fail(`Unsupported copy field: ${key}`);
    for (const field of fields ?? []) {
      const value = record.fields[field.key];
      if (field.required && (value === undefined || Array.isArray(value) && value.length === 0)) fail(`Required copy field unavailable: ${field.key}`);
    }
    return document(Object.values(record.fields).flatMap(refs));
  }
  if ('regions' in record && object(record.regions)) return document(Object.values(record.regions).flatMap(fields => Object.values(fields).flatMap(refs)));
  if ('blocks' in record && Array.isArray(record.blocks)) {
    const blocks = (items: readonly Block[]): WriterSpecimenNode[] => items.flatMap(block => {
      const children = Array.isArray(block.children) ? blocks(block.children) : [];
      const text = typeof block.text === 'string' ? block.text : undefined;
      if (block.claim !== undefined) fail(`Unsupported narrative claim reference: ${block.claim}`);
      if (block.type === 'heading') return [{ type: 'heading', attrs: { level: 2 }, ...(text ? { content: [{ type: 'text', text }] } : {}) }, ...children];
      if (block.type === 'paragraph') return [...(text === undefined ? [] : [paragraph(text)]), ...children];
      if (block.type === 'quote' || block.type === 'callout') return [{ type: block.type === 'quote' ? 'blockquote' : 'callout', content: [...(text === undefined ? [] : [paragraph(text)]), ...children] }];
      if (block.type === 'code') return [{ type: 'codeBlock', ...(text ? { content: [{ type: 'text', text }] } : {}) }, ...children];
      if (block.type === 'list') return [{ type: 'bulletList', content: [...(text === undefined ? [] : [paragraph(text)]), ...children].map(item => ({ type: 'listItem', content: [item] })) }];
      fail(`Unsupported narrative block: ${block.type}`); return [];
    });
    let title = typeof record.title === 'string' ? record.title : undefined;
    if (title && /^(?:st|lx|pt|ps|nr)\.[0-9a-hjkmnp-tv-z]{10}$/.test(title)) title = reference({ ref: 'string', id: title as PassageRef['id'] });
    return document([...(title === undefined ? [] : [{ type: 'heading', attrs: { level: 1 }, ...(title ? { content: [{ type: 'text', text: title }] } : {}) }]), ...blocks(record.blocks)]);
  }
  if ('passages' in record && Array.isArray(record.passages)) {
    const seen = new Set<string>([record.id]);
    const resolveRecord = (id: string): WriterSpecimenNode[] => {
      if (seen.has(id)) { fail(`cycle:${id}`); return []; }
      const matches = records.filter(item => item.id === id);
      if (matches.length !== 1) { fail(`unresolved:${id}`); return []; }
      const target = matches[0]!;
      if (!('fields' in target)) { fail(`Unsupported narrative passage: ${id}`); return []; }
      seen.add(id);
      const value = materializeWriterSpecimen(target, records); value.issues.forEach(fail);
      seen.delete(id);
      return value.passage?.content ?? (value.text === undefined ? [] : [paragraph(value.text)]);
    };
    const content = record.passages.flatMap(resolveRecord);
    if (record.chrome !== undefined) {
      const chrome = records.find(item => item.id === record.chrome);
      if (!chrome || !('regions' in chrome)) fail(`unresolved:${record.chrome}`);
      else { const value = materializeWriterSpecimen(chrome, records); value.issues.forEach(fail); content.unshift(...(value.passage?.content ?? [])); }
    }
    return document(content);
  }
  fail('Unsupported native Writer content.');
  return { issues };
}

export { resolveWriterReferenceText } from './model/resolve-text.js';
export type { WriterRecord } from './model/types.js';
