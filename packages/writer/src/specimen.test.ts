import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materializeWriterSpecimen, resolveWriterReferenceText, type WriterRecord } from './specimen.js';
import { resolveWriterRefText } from './checks/approval.js';

const site = JSON.parse(readFileSync(new URL('./catalog/records/site.en.json', import.meta.url), 'utf8'));
const common = JSON.parse(readFileSync(new URL('./catalog/records/common-labels.r1.en.json', import.meta.url), 'utf8'));
const records: WriterRecord[] = [...site.records, ...common.records];
const strings = (value: unknown): string[] => typeof value === 'object' && value !== null ? [...('type' in value && value.type === 'text' && 'text' in value && typeof value.text === 'string' ? [value.text] : []), ...Object.values(value).flatMap(strings)] : Array.isArray(value) ? value.flatMap(strings) : [];

describe('native Writer specimen wording', () => {
  it('materializes every real site string, pattern, passage and narrative without record JSON', () => {
    for (const record of site.records as WriterRecord[]) {
      const value = materializeWriterSpecimen(record, records);
      expect(value.issues, record.id).toEqual([]);
      if ('text' in record) expect(value.text).toBe(record.text);
      else if ('fields' in record && Object.keys(record.fields).length === 0) expect(value.inspectorOnly).toBe(true);
      else expect(value.passage?.content?.length, record.id).toBeGreaterThan(0);
    }
    const hero = site.records.find((record: WriterRecord) => record.leaf === 'passages.hero');
    const passage = materializeWriterSpecimen(hero, records);
    expect(strings(passage.passage)).toEqual(Object.values(hero.fields).map(ref => resolveWriterReferenceText(ref as any, records).text));
    expect(JSON.stringify(passage.passage)).not.toMatch(/schemaDigest|Generic draft site starter|"ref"/);
  });
  it('shares reference wording with the existing native approval checker', () => {
    const ref = { ref: 'pattern', id: site.records.find((record: WriterRecord) => record.leaf.startsWith('patterns.')).id } as const;
    expect(resolveWriterReferenceText(ref, records)).toEqual({ text: resolveWriterRefText(ref, records), issues: [] });
    const missing = { ref: 'string', id: 'st.0000000000' } as const;
    expect(resolveWriterReferenceText(missing, records)).toEqual({ text: '[unresolved:st.0000000000]', issues: ['unresolved:st.0000000000'] });
  });
  it('distinguishes catalog layout-only metadata from missing required produced copy', () => {
    const band = site.records.find((record: WriterRecord) => record.leaf === 'passages.band');
    expect(materializeWriterSpecimen(band, records)).toEqual({ inspectorOnly: true, issues: [] });
    const hero = site.records.find((record: WriterRecord) => record.leaf === 'passages.hero');
    const missing = materializeWriterSpecimen({ ...hero, fields: {} }, records);
    expect(missing.inspectorOnly).toBeUndefined();
    expect(missing.issues).toContain(`${hero.id}: Required copy field unavailable: header.heading`);
    const undeclared = materializeWriterSpecimen({ ...hero, fields: { ...hero.fields, invented: { ref: 'string', id: 'st.0000000001' } } }, records);
    expect(undeclared.issues).toContain(`${hero.id}: Unsupported copy field: invented`);
  });
  it('keeps unknown leaves, missing/cyclic references and unsupported blocks as named needs', () => {
    const hero = site.records.find((record: WriterRecord) => record.leaf === 'passages.hero');
    const text = site.records.find((record: WriterRecord) => 'text' in record);
    expect(materializeWriterSpecimen({ ...text, leaf: 'strings.unknown' }, records).issues).toContain(`${text.id}: Unsupported native Writer text leaf.`);
    expect(materializeWriterSpecimen({ ...hero, leaf: 'passages.unknown' }, records).issues).toContain(`${hero.id}: Unsupported native Writer leaf.`);
    const broken = materializeWriterSpecimen({ ...hero, fields: { 'header.heading': { ref: 'string', id: 'st.0000000000' } } }, records);
    expect(broken.issues).toContain(`${hero.id}: unresolved:st.0000000000`);
    const pattern = { id: 'pt.0000000000', leaf: 'patterns.section-title', context: 'example.pattern', parts: { title: { ref: { kind: 'string', id: 'pt.0000000000' } } } } as unknown as WriterRecord;
    expect(materializeWriterSpecimen(pattern, [pattern]).issues).toContain('pt.0000000000: cycle:pt.0000000000');
    const narrative = site.records.find((record: WriterRecord) => record.leaf.startsWith('narratives.'));
    expect(materializeWriterSpecimen({ ...narrative, blocks: [{ type: 'figure', designer: { id: 'sections.figure', configId: '' } }] }, records).issues).toContain(`${narrative.id}: Unsupported narrative block: figure`);
  });
});
