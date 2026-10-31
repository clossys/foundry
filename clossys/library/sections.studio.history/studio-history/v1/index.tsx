import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

/** How a version came to be: its mode (`verbatim`, `customized`, ...) and, when it has one, its source. */
export interface HistoryLineage { mode: string; source?: string }
/** One recorded version; `lineage` and `hash` columns show only when some row carries them. */
export interface HistoryRow { version: number; date: string; note: string; marks: readonly string[]; lineage?: HistoryLineage; hash?: string }
/** The `history` input of `sections.studio.history`: rows newest first. */
export interface HistoryInput { rows: readonly HistoryRow[] }

/** A content hash as its first 8 characters after the `sha256:` prefix; the full value stays in the title. */
export const shortHash = (hash: string) => hash.replace(/^sha256:/, '').slice(0, 8);

function LineageCell({ lineage }: { lineage: HistoryRow['lineage'] }) {
  if (!lineage) return <TableCell>—</TableCell>;
  return <TableCell>
    {lineage.mode}
    {lineage.source && <Badge variant="outline" title={lineage.source} className="ml-2 inline-block max-w-40 truncate align-middle">{lineage.source}</Badge>}
  </TableCell>;
}

/**
 * Every recorded version, newest first: date, note, lineage (mode plus a truncating source chip),
 * a short monospace hash and marks. Only the note wraps; the table scrolls inside its card when
 * the columns are wider than the card. `sections.studio.history` reads only its `history` input.
 */
export default function HistorySection({ history }: { history: HistoryInput }) {
  const { rows } = history;
  const lineage = rows.some(row => row.lineage);
  const hash = rows.some(row => row.hash);
  return <Card size="sm" data-studio-section="history">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>History</CardTitle>
      <CardDescription>{rows.length === 1 ? '1 recorded version' : `${rows.length} recorded versions`}, newest first.</CardDescription>
    </CardHeader>
    <CardContent className="min-w-0">
      <Table aria-label="History">
        <TableHeader>
          <TableHead isRowHeader>Version</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Note</TableHead>
          {lineage && <TableHead>Lineage</TableHead>}
          {hash && <TableHead>Hash</TableHead>}
          <TableHead>Marks</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.version} id={String(row.version)}>
            <TableCell>v{row.version}</TableCell>
            <TableCell>{row.date}</TableCell>
            <TableCell className="min-w-64 whitespace-normal">{row.note}</TableCell>
            {lineage && <LineageCell lineage={row.lineage} />}
            {hash && <TableCell>{row.hash ? <Badge variant="outline" title={row.hash} className="font-mono">{shortHash(row.hash)}</Badge> : '—'}</TableCell>}
            <TableCell className="space-x-1">{row.marks.map(mark => <Badge key={mark} variant="secondary">{mark}</Badge>)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
