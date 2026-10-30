import type { ReactNode } from 'react';
import type { PageBarAction } from '@clossys/designer/blocks';
import type { StudioPageAction } from '../generated/studio-map';

export const STUDIO_PAGE_ACTION_EVENT = 'studio:page-action';
export interface StudioPageActionDetail { pageId: string; action: StudioPageAction }

/** The module host receives the original Publisher manifest, including defaultOpen. */
export function dispatchStudioPageAction(pageId: string, action: StudioPageAction, target: EventTarget = window) {
  target.dispatchEvent(new CustomEvent<StudioPageActionDetail>(STUDIO_PAGE_ACTION_EVENT, { detail: { pageId, action } }));
}

/** Bind Publisher identities to the selected Designer page-action components. */
export function studioPageActionItems(pageId: string, actions: readonly StudioPageAction[], icon: (asset: string) => ReactNode): PageBarAction[] {
  return actions.map(action => ({
    id: action.id,
    label: action.label,
    icon: icon(action.icon),
    onAction: () => dispatchStudioPageAction(pageId, action),
  }));
}
