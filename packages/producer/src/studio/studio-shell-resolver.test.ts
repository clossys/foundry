import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppFrame, SHELL_COPY_REFS, type ShellCopyRef } from '@clossys/designer/frames';
import { resolveShellCopy } from '../../../designer/src/components/Banner.copy';
import { createStudioShellCopyResolver, studioShellThemeLabels } from '../../studio/lib/studio-shell-resolver';

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
  it('keeps unavailable, empty, throwing or unsupported-locale Writer results from breaking initial mount', () => {
    for (const writer of [() => undefined, () => ({ text: ' ' }), () => { throw new Error('Unavailable'); }]) {
      const reference = { id: 'fixture.missing', locale: 'fr' };
      expect(createStudioShellCopyResolver(writer)(reference)).toEqual({ ref: reference, text: 'Studio' });
    }
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
