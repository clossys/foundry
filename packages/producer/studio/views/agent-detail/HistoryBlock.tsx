import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailHistoryData } from './types';

/** Every recorded version, newest first, with its date, note, any agent columns and marks. Long text wraps. */
export function HistoryBlock({ history }: { history: DetailHistoryData }) {
  const { rows, columns = [] } = history;
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
          {columns.map(column => <TableHead key={column}>{column}</TableHead>)}
          <TableHead>Marks</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.version} id={String(row.version)}>
            <TableCell>v{row.version}</TableCell>
            <TableCell>{row.date}</TableCell>
            <TableCell className="min-w-48 whitespace-normal break-words">{row.note}</TableCell>
            {columns.map((column, index) => <TableCell key={column} className="whitespace-normal break-all">{row.extra?.[index] ?? '—'}</TableCell>)}
            <TableCell className="space-x-1 whitespace-normal">{row.marks.map(mark => <Badge key={mark} variant="secondary">{mark}</Badge>)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
