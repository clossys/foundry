'use client';

import { createElement, type Attributes, type ComponentProps, type ComponentType } from 'react';
import { useStudioSelection, useStudioUI } from './StudioSelection';

type StudioUI = ReturnType<typeof useStudioUI>;
/** Stable host adapters execute the exact compiled consumer selection and its official fallback. */
function selected<K extends keyof StudioUI>(name: K) {
  return function SelectedComponent(props: ComponentProps<StudioUI[K]>) {
    const Component = useStudioUI()[name] as ComponentType<ComponentProps<StudioUI[K]>>;
    return createElement(Component, props as Attributes & ComponentProps<StudioUI[K]>);
  };
}
export const ArticleBody = selected('ArticleBody');
export const ContentSection = selected('ContentSection');
export const DetailView = selected('DetailView');
export const EmptyState = selected('EmptyState');
export const SectionHeader = selected('SectionHeader');
export const Badge = selected('Badge');
export const Button = selected('Button');
export const Link = selected('Link');
export const RichText = selected('RichText');
export const NavigationTree = selected('NavigationTree');
export const NavigationTreeItem = selected('NavigationTreeItem');
export const NavigationTreeItemContent = selected('NavigationTreeItemContent');

export function SpecimenSelectionNeeds() {
  const { selection } = useStudioSelection();
  const missing = selection.leaves.filter(leaf => leaf.source !== 'consumer');
  return missing.length ? <ContentSection><SectionHeader title="Designer specimen gaps" description={missing.map(leaf => `NEED: ${leaf.leaf} → ${leaf.fill ?? 'unavailable'}`).join('; ')} /></ContentSection> : null;
}
