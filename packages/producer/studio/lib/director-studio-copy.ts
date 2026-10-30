import type { CellSummary } from './cells-client';
import { resolveAdminDirectorInspectAction } from '@clossys/writer/admin-copy';
import { createDirectorCopyBindings, type DirectorCopyBindings, type DirectorLabelResult } from './director-copy-bindings';

export type DirectorInspectAction = NonNullable<ReturnType<typeof resolveAdminDirectorInspectAction>>;

/** Studio previews authored draft copy without changing its approval state. */
export const directorStudioCopy = createDirectorCopyBindings({ options: { target: 'preview' } });

/** Keep the canonical identity for actions, and the resolved label for display. */
export function directorStudioCell<T extends CellSummary>(cell: T, bindings: DirectorCopyBindings = directorStudioCopy): T & { directorLabel: DirectorLabelResult; directorInspectAction?: DirectorInspectAction } {
  const directorLabel = bindings.cellTitle(cell.id);
  const title = directorLabel.state === 'bound' ? directorLabel.text : directorLabel.message;
  const directorInspectAction = directorLabel.state === 'bound' ? resolveAdminDirectorInspectAction(title, undefined, { target: 'preview' }) : undefined;
  return { ...cell, title, directorLabel, directorInspectAction };
}
