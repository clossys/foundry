import { expect, it, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMServer from 'react-dom/server';
import * as JSXRuntime from 'react/jsx-runtime';
import * as JSXDevRuntime from 'react/jsx-dev-runtime';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { applyLibraryChange, libraryHash, type CompositeResolved } from '@clossys/designer/catalog';
import { emittedDesignerSpecimenContext } from '@clossys/designer/studio';
import { DesignerCellSpecimen } from '../studio/components/DesignerSpecimen';
import type { CellDetail } from '../studio/lib/cells-client';
import { compileSelection, selectionProfile, selectionRuntime } from './server/selection';
import { prepareStudioSelection } from './server/selection-defaults';
import type { StudioRuntimeModule } from '../studio/lib/selection-runtime';
import { DESIGNER_SPECIMEN_REQUIRED_LEAVES } from './server/designer-specimen-requirements';

const hook = vi.hoisted(() => ({ value: undefined as unknown as { profile?: CompositeResolved; runtime: StudioRuntimeModule } }));
vi.mock('../studio/components/StudioSelection', () => ({ useStudioSelection: () => hook.value, useStudioUI: () => ({ EmptyState: hook.value.runtime.surfaces.EmptyState }) }));

const cell: CellDetail = { agent: 'designer', id: 'tokens.body-size', title: 'Body size', version: 1, status: 'active', content: '---\noriginKinds: [authored]\nconfirmed: migration\n---\n## Fill\nraw instruction' };
it('renders all five layers through the published selection profile/runtime and follows real token/fill changes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'designer-specimen-runtime-'));
  const host = globalThis as typeof globalThis & { __studioDesignerRuntime?: Record<string, unknown> };
  const previous = host.__studioDesignerRuntime;
  host.__studioDesignerRuntime = { react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react-dom/server': ReactDOMServer, 'react/jsx-runtime': JSXRuntime, 'react/jsx-dev-runtime': JSXDevRuntime };
  try {
    const prepared = await prepareStudioSelection();
    const execute = async (input: typeof prepared.input, name: string) => {
      const selection = await compileSelection(temporary, input, prepared.leaves, libraryHash(input.library));
      const hash = new URL(selection.runtimeUrl!, 'http://127.0.0.1').searchParams.get('hash')!;
      const path = join(temporary, `${name}.mjs`);
      await writeFile(path, selectionRuntime(hash)!);
      const runtime = await import(pathToFileURL(path).href) as StudioRuntimeModule;
      const profile = selectionProfile(selection.hash)!;
      hook.value = { profile, runtime };
      return { profile, runtime, context: emittedDesignerSpecimenContext(profile, runtime) };
    };
    const first = await execute(prepared.input, 'first');
    for (const leaf of DESIGNER_SPECIMEN_REQUIRED_LEAVES) expect(first.profile.components.components[leaf], leaf).toBeDefined();
    const render = (id = cell.id) => ReactDOMServer.renderToStaticMarkup(React.createElement(DesignerCellSpecimen, { cell: { ...cell, id } }));
    const html = render();
    expect(html).toContain(`font-size:${first.profile.values.members['tokens.body-size.default']!.css.light}`);
    expect(html).not.toMatch(/originKinds|confirmed|raw instruction|<pre|contenteditable/);
    for (const id of ['tokens.accent-color', 'tokens.body-size', 'tokens.heading-size', 'tokens.spacing', 'tokens.radius', 'tokens.duration', 'tokens.typeface']) {
      expect(render(id), id).toContain(`data-designer-specimen="${id}"`);
      expect(render(id), id).not.toContain('NEED:');
    }
    const badge = render('components.badge');
    expect(badge).toContain('data-ds-fill="shadcn@aria/components.badge"');
    expect(badge).not.toContain('Unsupported component member');
    expect(render('assets.icon-close')).toContain('data-ds-leaf="components.icon"');
    expect(render('sections.content')).toContain('sections.content 375px specimen');
    expect(render('frames.app-shell')).toContain('frames.app-shell 1280px specimen');
    const section = first.context.surfaces!['sections.content']!.render({ width: 375, state: 'default' });
    expect(React.isValidElement(section) && section.type).toBe(first.runtime.surfaces.Content);
    const frame = first.context.surfaces!['frames.app-shell']!.render({ width: 1280, state: 'default' });
    expect(React.isValidElement(frame) && frame.type).toBe(first.runtime.surfaces.AppShell);
    hook.value = { profile: first.profile, runtime: { ...first.runtime, surfaces: { ...first.runtime.surfaces, Content: undefined } } };
    expect(render('sections.content')).toContain('no executable fixture binding');
    hook.value = { profile: first.profile, runtime: first.runtime };
    const library = applyLibraryChange(prepared.input.catalog, prepared.input.library, { baseHash: libraryHash(prepared.input.library), changes: [
      { portion: 'values', change: { op: 'author', slot: 'tokens.body-size', tokens: { default: { $type: 'dimension', $value: { value: 27, unit: 'px' } } } } },
      { portion: 'components', change: { op: 'adopt', slot: 'components.badge', source: 'foundry' } },
    ] }, { componentOptions: prepared.input.componentOptions, surfaceOptions: prepared.input.surfaceOptions });
    const second = await execute({ ...prepared.input, library }, 'second');
    expect(second.profile.selectionHash).not.toBe(first.profile.selectionHash);
    expect(render()).toContain('font-size:27px');
    expect(render('components.badge')).toContain('data-ds-fill="foundry/components.badge"');
    hook.value = { runtime: second.runtime };
    expect(render()).toContain('Consumer Designer resolution is unavailable');
    expect(render()).not.toMatch(/raw instruction|<pre/);
  } finally { host.__studioDesignerRuntime = previous; await rm(temporary, { recursive: true, force: true }); }
}, 60_000);
