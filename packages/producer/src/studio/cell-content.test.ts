import { describe, expect, it } from 'vitest';
import { cellContentHref, cellContentTarget, contentVersion } from '../../studio/lib/cell-content';

describe('content-only targets', () => {
  it('links every registered agent without frame or module state', () => {
    for (const agent of ['director', 'designer', 'writer', 'publisher']) expect(cellContentTarget(agent, 'sample.page')).toEqual({ href: `/content/${agent}/sample.page`, target: '_blank', rel: 'noopener noreferrer' });
    expect(cellContentHref('director', 'sample.page', { version: 2 })).toBe('/content/director/sample.page?version=2');
  });
  it.each(['../sample.page', 'sample.page/extra', 'sample%2epage', 'sample..page', 'https://example.invalid', 'sample'])('refuses unsafe cell identity %s', id => expect(() => cellContentHref('writer', id)).toThrow());
  it('refuses unknown agents and ambiguous versions', () => {
    expect(() => cellContentHref('unknown', 'sample.page')).toThrow();
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => cellContentHref('writer', 'sample.page', { version: value })).toThrow();
    for (const value of ['0', '01', '1.5', '9007199254740992', ['1', '2']]) expect(() => contentVersion(value)).toThrow();
    expect(contentVersion(undefined)).toBeUndefined(); expect(contentVersion('12')).toBe(12);
  });
});
