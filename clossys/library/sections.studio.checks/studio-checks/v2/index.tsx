import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export interface ChecksCopy {
  title: string;
  summary: string;
  check: string;
  result: string;
  detail: string;
  pass: string;
  finding: string;
}

export interface CheckRow { key: string; label: string; ok: boolean; detail: string }

export interface ChecksInput { rows: readonly CheckRow[]; copy: ChecksCopy }

/** `sections.studio.checks`: the record's checks, each passing or reported. Reports never block Studio. */
export default function ChecksSection({ checks }: { checks: ChecksInput }) {
  const { rows, copy } = checks;
  return <Card size="sm" data-studio-section="checks">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{copy.title}</CardTitle>
      <CardDescription>{copy.summary}</CardDescription>
    </CardHeader>
    <CardContent>
      <Table aria-label={copy.title}>
        <TableHeader>
          <TableHead isRowHeader>{copy.check}</TableHead>
          <TableHead>{copy.result}</TableHead>
          <TableHead>{copy.detail}</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.key} id={row.key}>
            <TableCell className="whitespace-normal">{row.label}</TableCell>
            <TableCell><Badge variant={row.ok ? 'secondary' : 'destructive'}>{row.ok ? copy.pass : copy.finding}</Badge></TableCell>
            <TableCell className="whitespace-normal">{row.detail}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
