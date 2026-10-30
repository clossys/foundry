import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { serializeWriterCell } from '../../../writer/src/cells/parse';
import type { CellDetail } from '../../studio/lib/cells-client';
import { copyRole, localeDirection, writerProjection } from '../../studio/lib/writer-specimen';

const cell = (content: string, locales = ['en', 'ar']): CellDetail => ({ agent: 'writer', id: 'example.page', title: 'Page', status: 'draft', version: 1, fields: { locales }, content });
const record = (id: string, context: string, text: string) => ({ id, context, leaf: 'strings.common', text });

describe('Writer specimen projection', () => {
  it('reads native serialized copy, preserves multiline and escaped text, and configured missing locales', () => {
    const envelope = JSON.parse(readFileSync(new URL('../../../writer/src/cells/__fixtures__/generic-envelope.json', import.meta.url), 'utf8'));
    const source = serializeWriterCell({ id: 'example.page', version: 1, status: 'draft', updated: '2026-10-29', links: [], locales: ['en', 'ar'], records: envelope.records.map((record: Record<string, unknown>) => ({ locale: 'en', record, bindings: [] })) });
    const projection = writerProjection(cell(source));
    expect(projection.locales).toEqual(['en', 'ar']);
    expect(projection.records).toHaveLength(3);
    expect(projection.records[0]!.text).toBe(envelope.records[0].text);
    expect(projection.records[1]!.text).toBe('Continue');
    expect(projection.records[2]!.text).toBeUndefined();
    expect(projection.records.map(copy => copy.text).join('')).not.toContain('schemaDigest');
  });
  it('extracts old Fill copy envelopes without showing rationale or JSON', () => {
    const projection = writerProjection(cell(`---\nstatus: draft\n---\n## Rationale\nEdit the generated file.\n## Fill\n\n\`\`\`json\n${JSON.stringify({ locale: 'en', records: [record('st.1', 'sample.hero.headline', 'Made for studios')] })}\n\`\`\`\n`));
    expect(projection.records.map(copy => [copy.role, copy.text])).toEqual([['headline', 'Made for studios']]);
    expect(projection.records[0]!.text).not.toMatch(/Rationale|records|Edit/);
  });
  it.each([['sample.hero.headline', 'headline'], ['sample.hero.body', 'body'], ['sample.hero.cta', 'cta'], ['sample.main.nav', 'nav'], ['sample.form.error', 'error'], ['sample.search.empty', 'empty'], ['sample.unknown', 'unknown']])('maps %s to the %s specimen', (context, role) => expect(copyRole(record('st.1', context, 'Copy'))).toBe(role));
  it('keeps locales side by side with an explicit RTL direction', () => {
    const source = serializeWriterCell({ id: 'example.page', version: 1, status: 'draft', updated: '2026-10-29', links: [], locales: ['en', 'ar'], records: [{ locale: 'en', record: record('st.1', 'sample.hero.cta', 'Continue'), bindings: [] }, { locale: 'ar', record: record('st.1', 'sample.hero.cta', 'متابعة'), bindings: [] }] });
    expect(writerProjection(cell(source)).records.map(copy => [copy.locale, copy.text, localeDirection(copy.locale)])).toEqual([['en', 'Continue', 'ltr'], ['ar', 'متابعة', 'rtl']]);
    expect(localeDirection('he-IL')).toBe('rtl');
  });
  it('extracts actual VoiceRules and forbidden glossary entries from a textless record', () => {
    const voice = { id: 'voice.1', context: 'example.voice', rules: { tone: ['direct', 'warm'] }, glossary: [{ term: 'effortless', status: 'forbidden' }, { term: 'clear', status: 'preferred' }] };
    const source = serializeWriterCell({ id: 'example.page', version: 1, status: 'draft', updated: '2026-10-29', links: [], locales: ['en'], records: [{ locale: 'en', record: voice, bindings: [] }] });
    expect(writerProjection(cell(source, ['en']))).toMatchObject({ tone: ['direct', 'warm'], banned: ['effortless'] });
  });
  it('shows a named gap instead of fabricated copy for an invalid fill', () => {
    expect(writerProjection(cell('## Fill\n```json\ninvalid\n```')).gaps).toContain('Writer Fill JSON is invalid.');
    expect(writerProjection(cell('## Rationale\n- Write a headline')).records).toEqual([]);
  });
});
