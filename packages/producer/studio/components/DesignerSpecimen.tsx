'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DesignerSpecimen, type DesignerSpecimenContext, type DesignerSpecimenNeed } from '@clossys/designer/studio';
import type { CellDetail } from '../lib/cells-client';

/** Producer's consumer-resolution owner supplies this port after native compilation/selection. */
export interface StudioDesignerSpecimens {
  readonly context: DesignerSpecimenContext;
  readonly need: (need: DesignerSpecimenNeed) => ReactNode;
}
const ConsumerSpecimens = createContext<StudioDesignerSpecimens | undefined>(undefined);
export function StudioDesignerSpecimenProvider({ value, children }: { value: StudioDesignerSpecimens; children: ReactNode }) {
  return <ConsumerSpecimens.Provider value={value}>{children}</ConsumerSpecimens.Provider>;
}

/** The cell identifies a leaf; its raw instruction/source never enters the specimen DOM. */
export function DesignerCellSpecimen({ cell, pending }: { cell: CellDetail; pending: ReactNode }) {
  const selected = useContext(ConsumerSpecimens);
  if (!selected) return pending;
  return <DesignerSpecimen key={`${cell.id}:${selected.context.profile.selectionHash}`} leaf={cell.id} context={selected.context} need={selected.need} />;
}
