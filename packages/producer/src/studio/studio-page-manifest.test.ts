import { describe, expect, it } from 'vitest';
import { studioPageActions } from '../../studio/generated/studio-map';
import { studioPageManifest } from '../../studio/lib/studio-page-manifest';
import type { StudioModuleAction } from '../../studio/lib/studio-module-host';

describe('published native PageFrame manifest port', () => {
  it('passes actual actions, labels, icons and all closed module bodies to the native frame', () => {
    const actions = studioPageActions.publisher!.filter((action): action is StudioModuleAction => Boolean(action.module));
    const modules = actions.map(action => ({ action, content: `content:${action.id}` }));
    const manifest = studioPageManifest({ pageId: 'publisher', breadcrumbs: [{ id: 'publisher', label: 'Publisher', href: '#publisher' }], modules, icon: asset => asset, need: section => `NEED:${section}` });
    expect(manifest.actions.map(action => action.id)).toEqual(actions.map(action => action.id));
    expect(manifest.actions.filter(action => action.defaultOpen).map(action => action.module.sectionId)).toEqual(['sections.explorer']);
    expect(manifest.actions.every(action => action.module.children === `content:${action.id}`)).toBe(true);
    expect(manifest.actions.find(action => action.module.sectionId === 'sections.content')).toMatchObject({ defaultOpen: false, module: { children: 'content:source' } });
    expect(manifest.actions.map(action => action.icon)).toEqual(actions.map(action => action.icon));
  });
  it('uses a named selected NEED for missing module bodies instead of hiding the action', () => {
    const action = studioPageActions.home!.find((action): action is StudioModuleAction => Boolean(action.module))!;
    const manifest = studioPageManifest({ pageId: 'home', breadcrumbs: [{ label: 'Home' }], modules: [{ action }], icon: asset => asset, need: section => `NEED:${section}` });
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.actions[0]?.module.children).toBe('NEED:sections.task-list');
    expect(manifest.actions[0]?.defaultOpen).toBe(false);
    expect(manifest.breadcrumbs[0]?.id).toBe('home:breadcrumb:0');
  });
});
