import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as components from '@clossys/designer/components';
import type { CompositeResolved } from '@clossys/designer/catalog';
import { DesignerCellSpecimen, StudioDesignerSpecimenProvider } from '../studio/components/DesignerSpecimen';
import type { CellDetail } from '../studio/lib/cells-client';
import valueData from '../../designer/src/catalog-core/__golden__/resolved.foundry.json' with { type: 'json' };
import componentData from '../../designer/src/studio/__fixtures__/default-component-preview-profile.json' with { type: 'json' };

const cell: CellDetail = { agent: 'designer', id: 'tokens.heading-size', title: 'Heading scale', version: 1, status: 'active', content: '---\noriginKinds: [authored]\nconfirmed: migration\n---\n## Fill\nraw instruction' };
it('shows an explicit pending runtime state without rendering the cell instruction', () => {
  const html = renderToStaticMarkup(createElement(DesignerCellSpecimen, { cell, pending: createElement(components.SemanticContent, { as: 'p', children: 'NEED consumer runtime' }) }));
  expect(html).toContain('NEED consumer runtime');
  expect(html).not.toMatch(/originKinds|confirmed|raw instruction|<pre/);
});
it('uses the provider’s selected consumer values as the default Designer route content', () => {
  const profile = { selectionHash: valueData.selectionHash, consumer: valueData.consumer, values: valueData, components: componentData } as unknown as CompositeResolved;
  const html = renderToStaticMarkup(createElement(StudioDesignerSpecimenProvider, { value: { context: { profile, modules: { '@clossys/designer/components': components } }, need: ({ reason }) => createElement(components.SemanticContent, { as: 'p', children: reason }) }, children: createElement(DesignerCellSpecimen, { cell, pending: 'pending' }) }));
  expect(html).toContain('data-type-sample="tokens.heading-size.');
  expect(html).toContain('font-size:');
  expect(html).not.toMatch(/originKinds|confirmed|raw instruction|<pre|contenteditable/);
});
