import { describe, expect, it } from 'vitest';
import { studioModuleProps } from '../../studio/components/studio-module-props';
import type { StudioModuleAction } from '../../studio/lib/studio-module-host';
import { studioPageActions } from '../../studio/generated/studio-map';
const action = (section: string): StudioModuleAction => ({ id: 'fixture', label: 'Authored module label', icon: 'assets.icon-source', module: { section }, defaultOpen: false });
describe('existing closed module section APIs', () => {
  it('preserves manifest labels, Explorer hierarchy and a controlled selection callback', () => {
    const onSelect = () => undefined;
    expect(studioModuleProps(action('sections.explorer'), { tree: [{ id: 'group', label: 'Group', children: [{ id: 'leaf', label: 'Leaf' }] }], selectedId: 'leaf', onSelect }, {})).toMatchObject({ label: 'Authored module label', selectedId: 'leaf', defaultExpandedIds: ['group'], onSelect });
  });
  it('puts source only in a selected read-only code leaf and refuses an absent export', () => {
    const SemanticContent = () => null;
    const props = studioModuleProps(action('sections.content'), { source: '---\ntitle: fixture\n---\nbody', readOnly: true }, { SemanticContent });
    expect(props?.children).toMatchObject({ type: SemanticContent, props: { as: 'code', 'aria-readonly': true, children: '---\ntitle: fixture\n---\nbody' } });
    expect(studioModuleProps(action('sections.content'), { source: 'source' }, {})).toBeUndefined();
  });
  it('keeps exit2 unavailable checks outside the passing readiness axis', () => {
    const props = studioModuleProps(action('sections.status-list'), { state: 'ready', results: [{ agent: 'writer', verb: 'write', exitCode: 2, state: 'unavailable', message: 'Not implemented' }] }, {});
    expect(props?.items).toEqual([{ id: 'writer:write', label: 'writer: write', detail: 'Not implemented (exit 2)', disposition: 'not-offered' }]);
  });
  it('joins actual Inspector facts without exposing raw source', () => {
    const props = studioModuleProps(action('sections.record-detail'), { cell: { title: 'Core', version: 2, status: 'draft', uses: ['writer:example.page@1'] }, roleFacts: { tone: 'Concise' } }, {});
    expect(props).toMatchObject({ title: 'Core', fields: [{ label: 'version', value: '2' }, { label: 'status', value: 'draft' }, { label: 'uses', value: 'writer:example.page@1' }, { label: 'tone', value: 'Concise' }] });
  });
  it('uses the actual five module entries and Home only Needs, initially closed', () => {
    for (const page of ['director', 'designer', 'writer', 'publisher']) {
      expect(studioPageActions[page]?.map(entry => entry.module?.section)).toEqual(['sections.explorer', 'sections.record-detail', 'sections.content', 'sections.status-list', 'sections.task-list']);
      expect(studioPageActions[page]?.filter(entry => entry.defaultOpen).map(entry => entry.module?.section)).toEqual(['sections.explorer']);
    }
    expect(studioPageActions.home).toMatchObject([{ module: { section: 'sections.task-list', source: 'home.open-requests' }, defaultOpen: false }]);
    expect(studioPageActions.home).toHaveLength(1);
  });
});
