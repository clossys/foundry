// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { resolve } from '../catalog-core/api.js';
import { runtimeHash, type RuntimeCell } from '../catalog-core/runtime-ports.js';
import type { RuntimeLayoutPort } from '../catalog-core/runtime-assembly.js';
import { standardM1FixtureEngine } from '../catalog-core/__fixtures__/standard-m1-runtime.js';
import { createPortal } from 'react-dom';
import userEvent from '@testing-library/user-event';
import { AppFrame } from './AppFrame.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FrameStage, frameSectionRefKey, type FrameStageProps } from './FrameStage.js';
let width = 1200;
let resize: () => void;
const observed: Element[] = [];
const resizeCallbacks: (() => void)[] = [];
const disconnect = vi.fn();
beforeEach(() => {
  width = 1200; observed.length = 0; resizeCallbacks.length = 0;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; resizeCallbacks.push(callback); } observe(node: Element) { observed.push(node); } disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return (this as HTMLElement).hasAttribute('data-frame-stage') ? width : 600; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () { return (this as HTMLElement).dataset.frameStageMeasure === 'a' ? 300 : 200; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () { return (this as HTMLElement).dataset.frameStageMeasure === 'a' ? 80 : 140; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnect.mockClear(); });
const a = { slot: 'sections.comparison', index: 0 }, b = { slot: 'sections.comparison', index: 1 };
function Editor() { const [edit, setEdit] = useState(false); return <button onClick={() => setEdit(!edit)}>{edit ? 'Editing' : 'Edit'}</button>; }
function props(): Extract<FrameStageProps<typeof a>, { body: { kind: 'canvas' } }> { return {
  'aria-label': 'Library boards', body: { kind: 'canvas', source: { kind: 'derived', query: { id: 'layer-boards', version: 1 } }, boards: [{ id: 'a', section: a, groups: { domain: 'first' } }, { id: 'b', section: b, groups: { domain: 'second' } }], arrangement: { kind: 'lanes', groupKey: 'domain', gap: { x: 12, y: 8 }, laneGap: 20 }, collapseBelow: 'tokens.breakpoint.tablet' },
  contract: { accepts: ['flow', 'canvas'], scroll: 'region' }, collapseBelowPx: 768,
  sectionNodes: { [frameSectionRefKey(a)]: { label: 'Colors', node: <Editor /> }, [frameSectionRefKey(b)]: { label: 'Spacing', node: <input aria-label="Native input" /> } },
  camera: { viewport: { x: 0, y: 0, zoom: 1 }, onViewportChange: vi.fn(), minZoom: .12, maxZoom: 2, fitPadding: 0 },
}; }
it('uses one observer for stage and content-sized boards and exact arrangement bounds', () => {
  const view = render(<FrameStage {...props()} />);
  expect(observed).toHaveLength(3);
  expect(screen.getByRole('list')).toHaveAttribute('data-frame-stage-bounds', '300,248');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('region', { name: 'Spacing' }).closest('[data-frame-stage-board]')).toHaveStyle({ top: '108px' });
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
});
it('preserves board identity, current board and Edit across lanes, grid and 400 percent container fallback', () => {
  const value = props(); const current = vi.fn();
  const view = render(<FrameStage {...value} onCurrentBoardChange={current} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const board = screen.getByRole('region', { name: 'Colors' });
  fireEvent.focus(board); expect(current).toHaveBeenCalledWith('a');
  view.rerender(<FrameStage {...value} body={{ ...value.body, arrangement: { kind: 'grid', columns: 2, gap: { x: 12, y: 8 } } }} onCurrentBoardChange={current} />);
  expect(screen.getByRole('region', { name: 'Colors' })).toBe(board);
  width = 300; act(() => resize());
  expect(screen.getByRole('button', { name: 'Editing' })).toBeInTheDocument();
  expect(board).toBe(screen.getByRole('region', { name: 'Colors' }));
  expect(screen.getByRole('list')).toHaveAttribute('data-frame-stage-layout', 'flow');
  expect(screen.getByRole('region', { name: 'Library boards' })).toHaveStyle({ overflow: 'auto' });
});
it('moves focus in readingOrder while preserving native key ownership', () => {
  const value = props(); render(<FrameStage {...value} />);
  const colors = screen.getByRole('region', { name: 'Colors' }), spacing = screen.getByRole('region', { name: 'Spacing' });
  colors.focus(); fireEvent.keyDown(colors, { key: 'ArrowRight' }); expect(spacing).toHaveFocus();
  const input = screen.getByRole('textbox'); input.focus(); fireEvent.keyDown(input, { key: 'ArrowLeft' }); expect(input).toHaveFocus();
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 });
  width = 300; act(() => resize()); input.dispatchEvent(wheel); expect(wheel.defaultPrevented).toBe(false);
});
it('refuses missing selected sections, unsupported stage and unavailable engines', () => {
  const value = props();
  expect(() => render(<FrameStage {...value} sectionNodes={{}} />)).toThrow(/selected Section/);
  expect(() => render(<FrameStage {...value} contract={{ accepts: ['flow'], scroll: 'region' }} />)).toThrow(/canvas/);
  expect(() => render(<FrameStage {...value} body={{ ...value.body, arrangement: { kind: 'graph', edges: [], direction: 'right', gap: { x: 0, y: 0 } } }} />)).toThrow(/unavailable/);
});

it('renders interleaved lanes in canonical readingOrder in canvas and fallback and leaves nested widgets their arrows', () => {
  const value = props(), c = { ...a, index: 2 };
  const view = render(<FrameStage {...value} body={{ ...value.body, boards: [...value.body.boards, { id: 'c', section: c, groups: { domain: 'first' } }] }} sectionNodes={{ ...value.sectionNodes, [frameSectionRefKey(c)]: { label: 'Extra', node: <div role="slider" tabIndex={0} aria-label="Native slider" /> } }} />);
  const ids = () => screen.getAllByRole('listitem').map(node => node.getAttribute('data-frame-stage-board'));
  expect(ids()).toEqual(['a', 'c', 'b']);
  const slider = screen.getByRole('slider'); slider.focus();
  const before = vi.mocked(value.camera.onViewportChange).mock.calls.length;
  fireEvent.keyDown(slider, { key: 'ArrowRight' }); expect(slider).toHaveFocus();
  expect(value.camera.onViewportChange).toHaveBeenCalledTimes(before);
  width = 300; act(() => resize()); expect(ids()).toEqual(['a', 'c', 'b']);
  view.unmount();
});

it('reveals descendant focus against the remaining stage region and keeps intra-board native focus steady', () => {
  const value = props(), current = vi.fn();
  const rect = (x: number, y: number, width: number, height: number) => ({ x,y,left:x,top:y,width,height,right:x+width,bottom:y+height,toJSON() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function() {
    const node = this as HTMLElement;
    if (node.hasAttribute('data-frame-stage') || node.hasAttribute('data-canvas-surface')) return rect(0,0,1200,400);
    if (node.tagName === 'INPUT') return rect(50,700,100,30);
    return rect(20,20,100,30);
  });
  const view = render(<FrameStage {...value} onCurrentBoardChange={current} />);
  const input = screen.getByRole('textbox'); input.focus();
  expect(current).toHaveBeenLastCalledWith('b');
  expect(value.camera.onViewportChange).toHaveBeenCalled();
  const scroll = vi.fn(); input.scrollIntoView = scroll;
  width = 300; act(() => resize()); input.blur(); input.focus();
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  view.rerender(<FrameStage {...value} contract={{ accepts: ['canvas'], scroll: 'document' }} />);
  expect(screen.getByRole('region', { name: 'Library boards' })).toHaveStyle({ overflow: 'visible', height: 'auto' });
});

it('registers real map and zoom in the AppFrame dock and hides both in container fallback with reduced motion', async () => {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: media === '(prefers-reduced-motion: reduce)' || media.includes('min-width'), media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  const value = props();
  const view = render(<AppFrame brand={{ markSrc: '/mark.svg', wordmark: 'Example', label: 'Example' }} navigation={{ tree: [], label: 'Navigation' }} account={{ signedOutLabel: 'Account', sections: [] }} commands={{ heading: 'Commands', searchLabel: 'Search', closeLabel: 'Close', emptyMessage: 'Empty', triggerLabel: 'Commands', groups: [] }}>
    <FrameStage {...value} modules={{ map: { id: 'stage-map', label: 'Stage map' }, zoom: { id: 'stage-zoom', labels: { group: 'Stage zoom', in: 'Zoom in', out: 'Zoom out', fit: 'Fit boards', percent: 'Zoom percent' } } }} />
  </AppFrame>);
  const dock = view.container.querySelector('[data-application-frame-region="dock"]')!;
  expect(dock).toContainElement(screen.getByRole('toolbar', { name: 'Stage zoom' }));
  expect(dock).toContainElement(screen.getByRole('tab', { name: 'Stage map' }));
  await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(value.camera.onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 1.2 }));
  await userEvent.click(screen.getByRole('tab', { name: 'Stage map' }));
  const map = screen.getByRole('button', { name: 'Stage map' });
  expect(map.querySelectorAll('svg > rect')).toHaveLength(3);
  map.focus(); await userEvent.keyboard('{Enter}');
  expect(value.camera.onViewportChange).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Fit boards' }));
  screen.getByRole('textbox', { name: 'Native input' }).focus();
  const world = view.container.querySelector('[data-canvas-world]')!;
  expect(world).not.toHaveClass('transition-transform');
  expect(world).toHaveStyle({ transitionDuration: '0s' });
  width = 300; act(() => resizeCallbacks.forEach(callback => callback()));
  expect(screen.queryByRole('toolbar', { name: 'Stage zoom' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Stage map' })).toBeNull();
  expect(screen.getByRole('list', { name: 'Library boards' })).toHaveAttribute('data-frame-stage-layout', 'flow');
});
it('ignores synthetic focus bubbling from a portal outside the physical board', () => {
  const value = props(), current = vi.fn();
  render(<FrameStage {...value} onCurrentBoardChange={current} sectionNodes={{ ...value.sectionNodes, [frameSectionRefKey(a)]: { label: 'Colors', node: <>{createPortal(<button>Portal action</button>, document.body)}<button>Local action</button></> } }} />);
  screen.getByRole('button', { name: 'Portal action' }).focus();
  expect(current).not.toHaveBeenCalled();
  expect(value.camera.onViewportChange).not.toHaveBeenCalled();
  screen.getByRole('button', { name: 'Local action' }).focus();
  expect(current).toHaveBeenCalledWith('a');
});

/** SYNTHETIC selected Layout port; no consumer qualification or public config change. */
function flowFixture() {
  const profile = resolve(standardM1FixtureEngine());
  const token = profile.values.members['tokens.breakpoint.tablet']!.value.light;
  if (!token || typeof token !== 'object' || Array.isArray(token) || !('value' in token) || !('unit' in token) || token.unit !== 'px' || typeof token.value !== 'number') throw new Error('Fixture requires actual pixel tablet token');
  const threshold = token.value;
  const main = { slot: 'main', index: 0 }, aside = { slot: 'aside', index: 0 };
  const source = { entry: 'SYNTHETIC-layout.tsx', files: { 'SYNTHETIC-layout.tsx': '// SYNTHETIC selected port only' }, dependencies: {} };
  const cell: RuntimeCell = { theme: 'light', state: 'default', width: threshold * 3 };
  const renderLayout = vi.fn<RuntimeLayoutPort<ReactNode>['render']>(({ slots, stageWidth }) => <div data-synthetic-selected-layout="">
    {(stageWidth < threshold ? ['main', 'aside'] : ['aside', 'main']).map(slot => <div key={slot} data-synthetic-slot={slot}>{slots[slot]}</div>)}
  </div>);
  const layout: RuntimeLayoutPort<ReactNode> = {
    descriptor: { library: profile.consumer, fill: 'SYNTHETIC selected layout', leaf: 'layouts.sidebar-content', config: 'SYNTHETIC-order', members: {}, slots: [{ id: 'main', min: 1, max: 1, accepts: ['sections.comparison'] }, { id: 'aside', min: 1, max: 1, accepts: ['sections.comparison'] }], breakpoints: ['tokens.breakpoint.tablet'], states: ['default'], renderer: { id: 'SYNTHETIC-layout', source, sourceHash: runtimeHash(source) } },
    render: renderLayout,
    expectedOrder: (_cell, paths, stageWidth) => (stageWidth < threshold ? ['main', 'aside'] : ['aside', 'main']).flatMap(slot => paths[slot] ?? []),
  };
  const value: Extract<FrameStageProps, { body: { kind: 'flow' } }> = {
    'aria-label': 'Flow stage', body: { kind: 'flow', source: { kind: 'static' }, sections: [main, aside] }, contract: { accepts: ['flow', 'canvas'], scroll: 'region' }, layout, cell, profile,
    sectionNodes: { [frameSectionRefKey(main)]: { label: 'Main content', node: <Editor /> }, [frameSectionRefKey(aside)]: { label: 'Aside content', node: <input aria-label="Flow native input" /> } },
  };
  return { value, renderLayout, threshold };
}
it('passes live Stage width rather than viewport cell width to the exact selected flow port', () => {
  const f = flowFixture(); width = f.threshold - 1;
  render(<FrameStage {...f.value} />);
  expect(f.renderLayout).toHaveBeenCalled();
  const first = f.renderLayout.mock.calls.at(-1)![0];
  expect(first).toEqual({ slots: { main: [f.value.sectionNodes[frameSectionRefKey(f.value.body.sections[0]!)]!.node], aside: [f.value.sectionNodes[frameSectionRefKey(f.value.body.sections[1]!)]!.node] }, cell: f.value.cell, profile: f.value.profile, stageWidth: width });
  for (const next of [f.threshold, f.threshold + 1, f.threshold / 4]) {
    width = next; act(() => resize());
    const current = f.renderLayout.mock.calls.at(-1)![0];
    expect(current.stageWidth).toBe(next); expect(current.cell).toBe(f.value.cell); expect(current.profile).toBe(f.value.profile);
  }
  expect(resizeCallbacks).toHaveLength(1);
});
it('SYNTHETIC selected port changes physical DOM reading order after Stage resize and preserves native state', () => {
  const f = flowFixture(); width = f.threshold - 1;
  const view = render(<FrameStage {...f.value} />);
  const order = () => [...view.container.querySelectorAll('[data-synthetic-slot]')].map(node => node.getAttribute('data-synthetic-slot'));
  expect(order()).toEqual(['main', 'aside']);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const editor = screen.getByRole('button', { name: 'Editing' });
  const input = screen.getByRole('textbox', { name: 'Flow native input' }); input.focus();
  fireEvent.keyDown(input, { key: 'ArrowLeft' }); expect(input).toHaveFocus();
  width = f.threshold; act(() => resize()); expect(order()).toEqual(['aside', 'main']);
  expect(screen.getByRole('button', { name: 'Editing' })).toBe(editor);
  expect(screen.getByRole('textbox', { name: 'Flow native input' })).toBe(input);
  width = f.threshold / 4; act(() => resize()); expect(order()).toEqual(['main', 'aside']);
  expect(screen.queryByRole('list')).toBeNull();
});
it('one common observer owns flow Stage and canvas content across body arms', () => {
  const f = flowFixture(), view = render(<FrameStage {...f.value} />);
  const host = view.container.querySelector('[data-frame-stage]');
  expect(resizeCallbacks).toHaveLength(1); expect(observed).toEqual([host]);
  view.rerender(<FrameStage {...props()} />);
  expect(view.container.querySelector('[data-frame-stage]')).toBe(host);
  expect(resizeCallbacks).toHaveLength(1); expect(observed).toHaveLength(3);
  expect(screen.getByRole('list')).toHaveAttribute('data-frame-stage-bounds', '300,248');
  view.rerender(<FrameStage {...f.value} />); expect(resizeCallbacks).toHaveLength(1);
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
});
it('keeps flow region and document scrolling in the Stage and refuses unmeasured width', () => {
  const f = flowFixture(); width = 0;
  const view = render(<FrameStage {...f.value} />);
  expect(f.renderLayout).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Flow stage' })).toHaveAttribute('aria-busy', 'true');
  width = f.threshold; act(() => resize());
  expect(screen.getByRole('region', { name: 'Flow stage' })).toHaveStyle({ overflow: 'auto', height: '100%' });
  view.rerender(<FrameStage {...f.value} contract={{ accepts: ['flow', 'canvas'], scroll: 'document' }} />);
  expect(screen.getByRole('region', { name: 'Flow stage' })).toHaveStyle({ overflow: 'visible', height: 'auto' });
  expect(screen.queryByRole('toolbar')).toBeNull();
});
it('refuses missing canonical flow nodes and a Frame that does not accept flow', () => {
  const f = flowFixture();
  expect(() => render(<FrameStage {...f.value} sectionNodes={{}} />)).toThrow(/selected Section/);
  expect(() => render(<FrameStage {...f.value} contract={{ accepts: ['canvas'], scroll: 'region' }} />)).toThrow(/flow/);
});
