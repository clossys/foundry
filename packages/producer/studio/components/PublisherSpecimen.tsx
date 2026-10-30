'use client';

import type { AgentCells } from '../lib/cells-client';
import { PUBLISH_PREVIEW_COMMAND } from '../lib/publisher-preview';
import { RoleToolsProvider, usePublisherRoleTools } from './RoleToolsProvider';
import { useStudioUI } from './StudioSelection';

function PublishedPageStage() {
  const role = usePublisherRoleTools();
  const { ContentSection, EmptyState } = useStudioUI();
  if (!role || role.resource.state === 'loading') return null;
  if (role.resource.state === 'error') return <EmptyState title={role.resource.message} />;
  const value = role.resource.value;
  if (value.state !== 'ready') return <EmptyState title={value.message} description={value.command} />;
  if (!role.page?.emitted) return <EmptyState title={role.page?.title ?? value.publication} description={PUBLISH_PREVIEW_COMMAND} />;
  const page = role.page;
  return <ContentSection aria-label={page.title ?? page.route} style={{ overflowX: 'auto' }}>
    <iframe title={page.title ?? page.route} src={page.previewUrl} sandbox="" referrerPolicy="no-referrer" width={role.viewport.width} height={role.viewport.height} style={{ width: role.viewport.width, minWidth: role.viewport.width, height: role.viewport.height, border: 0 }} />
  </ContentSection>;
}

/** Page body is only the publication. Tools share the surrounding provider. */
export function PublisherSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  const role = usePublisherRoleTools();
  return role ? <PublishedPageStage /> : <RoleToolsProvider index={index} selectedId={selectedId}><PublishedPageStage /></RoleToolsProvider>;
}
