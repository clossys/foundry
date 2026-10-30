import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NativeLeafResolution } from '../../studio/lib/native-specimen-runtime';
import { validateDirectorNativeSpecimen } from '../../studio/components/director-specimen-ds';

// Anonymous boundary controls, not evidence of selected consumer-native adoption.
function fixture() {
  const items = [
    { id: 'sample.direction#v2', title: 'Direction', value: 'First complete paragraph.\n\nFinal **direction** paragraph.' },
    { id: 'sample.because#v2', title: 'Because', value: '- First rationale\n- Final rationale with [reference](https://example.com)' },
    { id: 'sample.watch#v1', title: 'Watch', value: 'Watch the complete older active passage.' },
  ];
  const Component = vi.fn((props: Record<string, unknown>) => createElement(Fragment, null, ...(props.items as typeof items).map(item => item.value)));
  const props = { items, expanded: false };
  const result: NativeLeafResolution = { sectionId: 'sections.specimen-rich-passage', registered: true, span: 'full', Component, items, variantIds: items.map(item => item.id), props, issues: [] };
  return { result, Component, props, items };
}

describe('Director selected-native passage boundary', () => {
  it('preserves one selected leaf and the complete passage items without host layout', () => {
    const { result, Component, props, items } = fixture();
    const validated = validateDirectorNativeSpecimen(result);
    expect(validated).toBe(result);
    expect(validated.Component).toBe(Component);
    expect(validated.props).toBe(props);
    expect(validated.props.items).toBe(items);
    const html = renderToStaticMarkup(createElement(validated.Component!, validated.props));
    expect(Component).toHaveBeenCalledTimes(1);
    expect(Component.mock.calls[0]?.[0].items).toBe(items);
    for (const item of items) expect(html).toContain(item.value);
    expect(html).not.toContain('data-ds-leaf');
  });

  it.each([
    { sectionId: 'sections.specimen-other' },
    { span: 'half' as const },
    { items: [] },
    { props: { items: [] } },
  ])('refuses an incompatible or empty Director leaf: %j', patch => {
    const { result, Component, props } = fixture();
    const candidate = { ...result, ...patch };
    const validated = validateDirectorNativeSpecimen(candidate);
    expect(validated.registered).toBe(false);
    expect(validated.issues.length).toBeGreaterThan(0);
    expect(validated.Component).toBe(Component);
    expect(validated.props).toBe(candidate.props);
    expect(Component).not.toHaveBeenCalled();
    expect(props.items).toHaveLength(3);
  });

  it('preserves native registration refusals and their issues', () => {
    const { result } = fixture();
    const refused = { ...result, registered: false, issues: ['The selected rich-text dependency is unavailable.'] };
    expect(validateDirectorNativeSpecimen(refused)).toBe(refused);
    const empty = validateDirectorNativeSpecimen({ ...refused, items: [], props: { items: [] } });
    expect(empty.registered).toBe(false);
    expect(empty.issues[0]).toBe(refused.issues[0]);
    expect(empty.issues).toHaveLength(2);
  });
});
