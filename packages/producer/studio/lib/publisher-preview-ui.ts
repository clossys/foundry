'use client';

import { useStudioSelection, useStudioUI } from '../components/StudioSelection';

/** Use the shared consumer selection; this adapter never chooses a second kit. */
export function usePublisherPreviewUI() {
  const shared = useStudioUI();
  const { runtime, selection } = useStudioSelection();
  const components = runtime?.components as Record<string, any> | undefined;
  const table = runtime?.table as Record<string, any> | undefined;
  const Table = components?.Table;
  return { ...shared, selection, Card: components?.Card, Button: components?.Button,
    Table, TableHeader: Table?.Header ?? table?.TableHeader ?? components?.TableHeader,
    TableColumn: Table?.Column ?? table?.Column ?? table?.TableColumn ?? table?.TableHead ?? components?.TableColumn,
    TableBody: Table?.Body ?? table?.TableBody ?? components?.TableBody,
    TableRow: Table?.Row ?? table?.Row ?? table?.TableRow ?? components?.TableRow,
    TableCell: Table?.Cell ?? table?.Cell ?? table?.TableCell ?? components?.TableCell,
  };
}
