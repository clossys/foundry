import type { ReactNode } from 'react';
import type { PageBarAction } from '@clossys/designer/blocks';
import type { StudioPageAction } from '../generated/studio-map';

export const STUDIO_PAGE_ACTION_EVENT = 'studio:page-action';
export interface StudioPageActionDetail { pageId: string; action: StudioPageAction }
export interface StudioPageActionCapabilities { appDevServerUrl?: string }

/** The module host receives the original Publisher manifest, including defaultOpen. */
export function dispatchStudioPageAction(pageId: string, action: StudioPageAction, target: EventTarget = window) {
  target.dispatchEvent(new CustomEvent<StudioPageActionDetail>(STUDIO_PAGE_ACTION_EVENT, { detail: { pageId, action } }));
}

function declaredAppUrl(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* An invalid runtime capability cannot become a navigation target. */ }
}

/** Bind Publisher identities to the selected Designer page-action components. */
export function studioPageActionItems(pageId: string, actions: readonly StudioPageAction[], icon: (asset: string) => ReactNode, capabilities: StudioPageActionCapabilities = {}): PageBarAction[] {
  return actions.map(action => {
    const identity = { id: action.id, label: action.label, icon: icon(action.icon) };
    if (action.module) return { ...identity, onAction: () => dispatchStudioPageAction(pageId, action) };
    const href = action.intent === 'open-app-dev-server' ? declaredAppUrl(capabilities.appDevServerUrl) : undefined;
    return { ...identity, isDisabled: !href, onAction: () => { if (href) window.open(href, '_blank', 'noopener,noreferrer'); } };
  });
}
