import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailLineageRow } from './types';

/** How each recorded version came to be. */
export function LineageBlock({ rows }: { rows: readonly DetailLineageRow[] }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Lineage</CardTitle>
      <CardDescription>Each version names its mode and, where it has one, its parent and source.</CardDescription>
    </CardHeader>
    <CardContent>
      <Table aria-label="Lineage">
        <TableHeader>
          <TableHead isRowHeader>Version</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Parent</TableHead>
          <TableHead>Source</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.version} id={String(row.version)}>
            <TableCell>v{row.version}</TableCell>
            <TableCell>{row.mode}</TableCell>
            <TableCell>{row.parent}</TableCell>
            <TableCell>{row.source}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
