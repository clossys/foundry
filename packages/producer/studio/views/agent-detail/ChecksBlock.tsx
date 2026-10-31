import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailCheckRow } from './types';

/** The record's checks, each passing or reported. Reports never block Studio. */
export function ChecksBlock({ rows }: { rows: readonly DetailCheckRow[] }) {
  const failing = rows.filter(row => !row.ok).length;
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Checks</CardTitle>
      <CardDescription>{failing ? `${failing} of ${rows.length} checks report a finding.` : `All ${rows.length} checks pass.`}</CardDescription>
    </CardHeader>
    <CardContent>
      <Table aria-label="Checks">
        <TableHeader>
          <TableHead isRowHeader>Check</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>Detail</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.key} id={row.key}>
            <TableCell className="whitespace-normal">{row.label}</TableCell>
            <TableCell><Badge variant={row.ok ? 'secondary' : 'destructive'}>{row.ok ? 'Pass' : 'Finding'}</Badge></TableCell>
            <TableCell className="whitespace-normal">{row.detail}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
