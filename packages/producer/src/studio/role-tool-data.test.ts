import { describe, expect, it } from 'vitest';
import { serializeWriterCell } from '../../../writer/src/cells/parse';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import { writerRoleLocales, writerRoleView, writerRoleVoice } from '../../studio/lib/role-tool-data';

const index: AgentCells = { agent: 'writer', state: 'ready', cells: [], tree: { meta: { libraryManifest: { defaultLocale: 'ar', locales: [{ tag: 'en', dir: 'ltr', state: 'active' }, { tag: 'ar', dir: 'rtl', state: 'active' }, { tag: 'he', dir: 'rtl', state: 'active' }, { tag: 'fr', dir: 'ltr', state: 'retired' }] } } } };
const record = (text: string) => ({ id: 'st.1', context: 'example.hero.cta', leaf: 'strings.common', text });
const cell = (records: { locale: string; record: Record<string, unknown>; bindings: [] }[]): CellDetail => ({ agent: 'writer', id: 'example.hero', title: 'Hero', version: 1, status: 'draft', fields: { locales: ['en', 'ar'] }, content: serializeWriterCell({ id: 'example.hero', version: 1, status: 'draft', updated: '2026-10-30', links: [], locales: ['en', 'ar'], records }) });

describe('Role module Writer state', () => {
  it('uses the configured default and preserves untranslated configured locales', () => {
    const source = cell([{ locale: 'en', record: record('Continue'), bindings: [] }, { locale: 'ar', record: record('متابعة'), bindings: [] }]);
    const view = writerRoleView(index, source);
    expect(view.selectedLocale).toBe('ar'); expect(view.selectedDirection).toBe('rtl');
    expect(view.locales.map(locale => locale.id)).toEqual(['en', 'ar', 'he']);
    expect(view.comparisonLocales.map(locale => locale.id)).toEqual(['ar', 'en', 'he']);
    expect(view.projection?.records.filter(copy => copy.locale === 'he')).toEqual([]);
  });
  it('keeps the selected locale and same-passage comparison independent from module visibility', () => {
    const source = cell([{ locale: 'en', record: record('Continue'), bindings: [] }, { locale: 'ar', record: record('متابعة'), bindings: [] }]);
    const view = writerRoleView(index, source, 'en', 'rtl');
    expect(view.selectedLocale).toBe('en'); expect(view.selectedDirection).toBe('rtl');
    expect(view.comparisonLocales.map(locale => locale.id)).toEqual(['en', 'ar', 'he']);
    expect(view.projection?.records.map(copy => [copy.context, copy.locale, copy.text])).toEqual([['example.hero.cta', 'en', 'Continue'], ['example.hero.cta', 'ar', 'متابعة']]);
    expect(writerRoleView(index, source, 'unknown').selectedLocale).toBe('ar');
  });
  it('uses actual cell locales when no Writer library manifest exists', () => {
    const local: AgentCells = { agent: 'writer', state: 'ready', cells: [] };
    const source = cell([{ locale: 'ar', record: record('متابعة'), bindings: [] }]);
    expect(writerRoleView(local, source).locales).toEqual([{ id: 'en', direction: 'ltr' }, { id: 'ar', direction: 'rtl' }]);
    expect(writerRoleLocales(local).locales).toEqual([]);
  });
  it('moves actual voice rules to a payload without replacing textless records with made-up copy', () => {
    const voice = cell([{ locale: 'en', record: { id: 'voice.1', context: 'example.voice', rules: { tone: ['direct', 'warm'] }, glossary: [{ term: 'effortless', status: 'forbidden' }, { term: 'clear', status: 'preferred' }] }, bindings: [] }]);
    expect(writerRoleVoice([voice])).toEqual({ tone: ['direct', 'warm'], bannedWords: ['effortless'] });
    expect(writerRoleView(index, voice).projection?.records[0]?.text).toBeUndefined();
  });
});
