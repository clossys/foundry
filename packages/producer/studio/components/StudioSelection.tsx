'use client';

import { createContext, useContext, useEffect, useInsertionEffect, useState, type ComponentType, type ReactNode } from 'react';
import type * as Blocks from '@clossys/designer/blocks';
import type * as Components from '@clossys/designer/components';
import type * as Frames from '@clossys/designer/frames';
import type { CompositeResolved } from '@clossys/designer/catalog';
import { loadSelection, loadSelectionProfile, verifySelectionCss, type StudioSelection } from '../lib/selection-client';
import { importStudioRuntime, type StudioRuntimeModule } from '../lib/selection-runtime';
import { StudioSelectionBoundary } from './StudioSelectionBoundary';

interface SelectedRuntime { selection: StudioSelection; runtime: StudioRuntimeModule; profile?: CompositeResolved; error?: string }
const SelectionContext = createContext<SelectedRuntime | undefined>(undefined);

function exported<T>(namespace: Record<string, unknown>, name: string): T {
  const value = namespace[name];
  if (!value || !['function', 'object'].includes(typeof value)) throw new Error(`The selected Designer fill does not export ${name}.`);
  return value as T;
}

export function useStudioSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error('Studio requires the compiled consumer Designer selection.');
  return value;
}

/** Resolve each visual leaf from the actual emitted consumer module. */
export function useStudioUI() {
  const { runtime } = useStudioSelection();
  return {
    AppFrame: exported<typeof Frames.AppFrame>(runtime.surfaces, 'AppShell'),
    SectionFrame: exported<typeof Blocks.SectionFrame>(runtime.surfaces, 'Band'),
    SectionHeader: exported<typeof Blocks.SectionHeader>(runtime.surfaces, 'SectionHeader'),
    ContentSection: exported<typeof Blocks.ContentSection>(runtime.surfaces, 'Content'),
    ArticleBody: exported<typeof Blocks.ArticleBody>(runtime.surfaces, 'Article'),
    EmptyState: exported<typeof Blocks.EmptyState>(runtime.surfaces, 'EmptyState'),
    Badge: exported<typeof Components.Badge>(runtime.components, 'Badge'),
    Button: exported<typeof Components.Button>(runtime.components, 'Button'),
    RichText: exported<typeof Components.RichText>(runtime.components, 'RichText'),
    DetailView: exported<typeof Blocks.DetailView>(runtime.surfaces, 'RecordDetail'),
    Disclosure: exported<ComponentType<Components.DisclosureProps>>(runtime.disclosure, 'Disclosure'),
    Link: exported<typeof Components.Link>(runtime.components, 'Link'),
    Icon: exported<ComponentType<Omit<Components.IconProps, 'glyph'> & { asset: string }>>(runtime.components, 'Icon'),
    NavigationTree: exported<typeof Components.NavigationTree>(runtime.components, 'NavigationTree'),
    NavigationTreeItem: exported<typeof Components.NavigationTreeItem>(runtime.tree, 'NavigationTreeItem'),
    NavigationTreeItemContent: exported<typeof Components.NavigationTreeItemContent>(runtime.tree, 'NavigationTreeItemContent'),
  };
}

export function StudioSelectionError({ message }: { message: string }) {
  const value = useContext(SelectionContext);
  if (!value?.runtime.surfaces.EmptyState) return null;
  const EmptyState = exported<typeof Blocks.EmptyState>(value.runtime.surfaces, 'EmptyState');
  return <EmptyState role="alert" title="NEED: Designer selection" description={message} />;
}

/** Keep mounted pages attached to the current active cell revision, including implementation edits. */
export function StudioSelectionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SelectedRuntime>();
  const [initialError, setInitialError] = useState<string>();
  useInsertionEffect(() => {
    if (!value) return;
    const style = document.getElementById('studio-selection-style');
    if (style) {
      style.textContent = value.selection.css!;
      document.documentElement.dataset.selectionCssHash = value.selection.cssHash;
      document.documentElement.dataset.selectionHash = value.selection.hash;
      if (value.error === undefined) document.documentElement.dataset.studioState = 'ready';
    }
  }, [value]);
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void loadSelection(controller.signal).then(async selection => {
        if (!selection.runtimeUrl) throw new Error(selection.message ?? 'Producer could not compile the current selected fills.');
        const [runtime, , profile] = await Promise.all([importStudioRuntime(selection.runtimeUrl), verifySelectionCss(selection), loadSelectionProfile(selection, controller.signal)]);
        for (const name of ['AppShell', 'Band', 'SectionHeader', 'Content', 'Article', 'EmptyState', 'RecordDetail']) exported(runtime.surfaces, name);
        for (const name of ['Badge', 'Link', 'Icon', 'NavigationTree', 'Button', 'RichText']) exported(runtime.components, name);
        for (const name of ['NavigationTreeItem', 'NavigationTreeItemContent']) exported(runtime.tree, name);
        exported(runtime.disclosure, 'Disclosure');
        if (controller.signal.aborted) return;
        if (!document.getElementById('studio-selection-style')) throw new Error('The selected Designer stylesheet mount is unavailable.');
        setInitialError(undefined);
        setValue({ selection, runtime, ...(profile ? { profile } : {}) });
      }).catch(error => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Studio Designer selection failed:', message);
          document.documentElement.dataset.studioState = 'selection-unavailable';
          setInitialError(message);
          setValue(current => current ? { ...current, error: message } : undefined);
        }
      });
    };
    refresh();
    const events = new EventSource('/api/events');
    events.addEventListener('ready', refresh);
    events.addEventListener('change', refresh);
    return () => { request?.abort(); events.close(); };
  }, []);
  if (!value) return initialError !== undefined ? <>NEED: Designer selection. {initialError}</> : null;
  return <SelectionContext.Provider value={value}><StudioSelectionBoundary key={value.selection.hash}>{value.error !== undefined ? <StudioSelectionError message={value.error} /> : children}</StudioSelectionBoundary></SelectionContext.Provider>;
}

/** Suspense fallbacks use the same selected section module as the loaded page. */
export function StudioLoading() {
  const { SectionFrame, EmptyState } = useStudioUI();
  return <SectionFrame><EmptyState role="status" title="Loading Studio…" /></SectionFrame>;
}
