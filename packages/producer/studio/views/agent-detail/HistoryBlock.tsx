import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailHistoryRow } from './types';

/** Every recorded version, newest first, with its date, note and marks. */
export function HistoryBlock({ rows }: { rows: readonly DetailHistoryRow[] }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>History</CardTitle>
      <CardDescription>{rows.length === 1 ? '1 recorded version' : `${rows.length} recorded versions`}, newest first.</CardDescription>
    </CardHeader>
    <CardContent>
      <Table aria-label="History">
        <TableHeader>
          <TableHead isRowHeader>Version</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>Marks</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.version} id={String(row.version)}>
            <TableCell>v{row.version}</TableCell>
            <TableCell>{row.date}</TableCell>
            <TableCell className="whitespace-normal">{row.note}</TableCell>
            <TableCell>{row.marks.map(mark => <Badge key={mark} variant="secondary">{mark}</Badge>)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
