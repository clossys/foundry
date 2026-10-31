import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailVersionRow } from './types';

/** Every recorded version, newest first, with its pinned, released and verified marks. */
export function VersionsBlock({ rows }: { rows: readonly DetailVersionRow[] }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Versions</CardTitle>
      <CardDescription>{rows.length === 1 ? '1 recorded version' : `${rows.length} recorded versions`}, newest first.</CardDescription>
    </CardHeader>
    <CardContent>
      <Table aria-label="Versions">
        <TableHeader>
          <TableHead isRowHeader>Version</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Hash</TableHead>
          <TableHead>Marks</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.version} id={String(row.version)}>
            <TableCell>v{row.version}</TableCell>
            <TableCell>{row.createdAt}</TableCell>
            <TableCell>{row.reason}</TableCell>
            <TableCell>{row.hash}</TableCell>
            <TableCell>{row.flags.map(flag => <Badge key={flag} variant="secondary">{flag}</Badge>)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
