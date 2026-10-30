'use client';

import { useMemo } from 'react';
import { DesignerSpecimen, emittedDesignerSpecimenContext } from '@clossys/designer/studio';
import type { CellDetail } from '../lib/cells-client';
import { useStudioSelection, useStudioUI } from './StudioSelection';

/** The same native profile/runtime/CSS revision that owns Studio owns its specimens. */
export function DesignerCellSpecimen({ cell }: { cell: CellDetail }) {
  const { profile, runtime } = useStudioSelection();
  const { EmptyState } = useStudioUI();
  const context = useMemo(() => profile ? emittedDesignerSpecimenContext(profile, runtime) : undefined, [profile, runtime]);
  return <DesignerSpecimen key={`${cell.id}:${profile?.selectionHash ?? 'missing'}`} leaf={cell.id} context={context}
    need={({ leaf, reason }) => <EmptyState role="status" title={`NEED: ${leaf}`} description={reason} />} />;
}
