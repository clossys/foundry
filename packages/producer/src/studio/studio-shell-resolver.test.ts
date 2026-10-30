import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppFrame, SHELL_COPY_REFS, type ShellCopyRef } from '@clossys/designer/frames';
import { getAdminCopyRecord } from '@clossys/writer/admin-copy';
import { serializeWriterCell } from '../../../writer/src/cells/parse';
import { projectStudioAdminCopy } from '../../studio/lib/studio-shell-copy';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import { resolveShellCopy } from '../../../designer/src/components/Banner.copy';
import { createStudioShellCopyResolver, studioShellThemeLabels, studioShellText } from '../../studio/lib/studio-shell-resolver';

describe('Studio consumer shell-copy binding', () => {
  it('provides only the owner-granted bootstrap word for every missing native reference', () => {
    const resolve = createStudioShellCopyResolver();
    for (const group of Object.values(SHELL_COPY_REFS)) for (const reference of Object.values(group)) {
      expect(resolveShellCopy(resolve, reference)).toBe('Studio');
    }
    expect(studioShellThemeLabels(resolve)).toEqual({ system: 'Studio', light: 'Studio', dark: 'Studio' });
  });
  it('preserves exact requested id, locale and values while delegating all formatting to Writer', () => {
    const reference: ShellCopyRef = { id: SHELL_COPY_REFS.theme.announcement.id, locale: 'en', values: { theme: 'Fixture theme' } };
    const writer = vi.fn(() => ({ text: 'Writer formatted fixture' }));
    const resolve = createStudioShellCopyResolver(writer);
    expect(resolve(reference)).toEqual({ ref: reference, text: 'Writer formatted fixture' });
    expect(resolve(reference)?.ref).toBe(reference);
    expect(writer).toHaveBeenCalledWith(reference);
    expect(resolveShellCopy(resolve, { id: reference.id }, { theme: 'Fixture theme' })).toBe('Writer formatted fixture');
  });
  it('delegates explicit native shell labels and ICU values through the same Writer request port', () => {
    const writer = vi.fn((ref: ShellCopyRef) => ({ text: ref.values?.count === 2 ? 'Writer formatted count' : 'Writer label' }));
    const resolve = createStudioShellCopyResolver(writer);
    expect(studioShellText(resolve, SHELL_COPY_REFS.commands.results, { count: 2 })).toBe('Writer formatted count');
    expect(writer).toHaveBeenLastCalledWith({ id: SHELL_COPY_REFS.commands.results.id, values: { count: 2 } });
    expect(studioShellText(resolve, SHELL_COPY_REFS.frame.breadcrumb)).toBe('Writer label');
  });
  it('keeps unavailable, empty, throwing or unsupported-locale Writer results from breaking initial mount', () => {
    for (const writer of [() => undefined, () => ({ text: ' ' }), () => { throw new Error('Unavailable'); }]) {
      const reference = { id: 'fixture.missing', locale: 'fr' };
      expect(createStudioShellCopyResolver(writer)(reference)).toEqual({ ref: reference, text: 'Studio' });
    }
  });
  it('connects actual Writer cell preview and ICU formatting to native AppFrame without changing approval', () => {
    const refs = Object.values(SHELL_COPY_REFS).flatMap(group => Object.values(group));
    const records = refs.flatMap(ref => { const record = getAdminCopyRecord(ref.id); return record ? [structuredClone(record)] : []; });
    const source: CellDetail = { agent: 'writer', id: 'admin.fixture', title: 'Fixture', version: 1, status: 'draft', fields: { locales: ['en'] }, content: serializeWriterCell({ id: 'admin.fixture', version: 1, status: 'draft', updated: '2026-10-29', links: [], locales: ['en'], records: records.map(record => ({ locale: 'en', record, bindings: [] })) }) };
    const before = source.content;
    const index: AgentCells = { agent: 'writer', state: 'ready', cells: [source], tree: { active: {} } };
    const data = projectStudioAdminCopy(index, [source]);
    const resolve = createStudioShellCopyResolver(data.resolve);
    const countRequest = { id: SHELL_COPY_REFS.commands.results.id, values: { count: 3 } };
    expect(resolve(countRequest)?.ref).toBe(countRequest);
    expect(resolveShellCopy(resolve, SHELL_COPY_REFS.commands.results, { count: 3 })).toBe(data.resolve(countRequest)?.text);
    expect(studioShellThemeLabels(resolve).system).toBe(data.resolve(SHELL_COPY_REFS.theme.system)?.text);
    const html = renderToStaticMarkup(createElement(AppFrame, { copyResolver: resolve, brand: { markSrc: '/studio-mark.svg' }, navigation: { tree: [] }, account: { signedOutLabel: 'Clossys', sections: [] }, showAccount: false, commands: { heading: 'Studio', triggerLabel: 'Studio', searchLabel: 'Studio', closeLabel: 'Studio', emptyMessage: 'Studio', groups: [] }, theme: { preferenceLabels: studioShellThemeLabels(resolve) }, themeControl: null, children: 'Studio' }));
    expect(html).toContain(data.resolve(SHELL_COPY_REFS.frame.skip)!.text);
    expect(source.content).toBe(before);
    expect(data.cells).toEqual([{ id: source.id, version: 1, status: 'draft', records: records.length }]);
    const absent = refs.find(ref => getAdminCopyRecord(ref.id) === undefined);
    expect(absent).toBeDefined();
    expect(resolve(absent!)?.text).toBe('Studio');
  });
  it('renders the actual native AppFrame with themeControl null and an empty initial Writer source', () => {
    const copyResolver = createStudioShellCopyResolver();
    const props = {
      copyResolver, brand: { markSrc: '/studio-mark.svg', navigationMark: { label: 'Studio' } },
      navigation: { tree: [] }, account: { signedOutLabel: 'Clossys', sections: [] }, showAccount: false,
      commands: { heading: 'Studio', triggerLabel: 'Studio', searchLabel: 'Studio', closeLabel: 'Studio', emptyMessage: 'Studio', groups: [] },
      theme: { preferenceLabels: studioShellThemeLabels(copyResolver) }, themeControl: null,
      children: 'Studio',
    };
    expect(() => renderToStaticMarkup(createElement(AppFrame, { ...props, copyResolver: undefined, theme: undefined }))).toThrow('Designer shell copy requires a host resolver or explicit host labels');
    const html = renderToStaticMarkup(createElement(AppFrame, props));
    expect(html).toContain('Studio');
    expect(html).not.toContain('Designer shell copy requires');
    expect(html).not.toContain('contenteditable="true"');
  });
});
