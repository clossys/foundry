import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

/** The node kinds a pipeline step carries; graph.json names one per step. */
export type StepKind = 'plumb' | 'decide:creative' | 'decide:judgment';

/** One legend row: a kind, its Writer label and its Writer meaning. */
export interface LegendRow { kind: StepKind; label: string; meaning: string }

/** Writer copy of the legend (studio.pipeline.legend.*); `untyped` is the count line, already resolved with untypedCount. */
export interface LegendCopy { title: string; kind: string; meaning: string; untyped: string }

/** The `legend` input of `sections.producer.pipeline-legend`. */
export interface PipelineLegendInput { rows: readonly LegendRow[]; untypedCount: number; copy: LegendCopy }

/** Each kind's stock Badge variant; the flow nodes use the same mapping. */
const KIND_VARIANT = { plumb: 'outline', 'decide:creative': 'secondary', 'decide:judgment': 'default' } as const;

/** `sections.producer.pipeline-legend`: what each node kind means, as stock Badges in a stock Table, and how many files no step types yet. */
export default function PipelineLegendSection({ legend, ...provenance }: { legend: PipelineLegendInput } & { [marker: `data-clossys-${string}`]: string }) {
  const { rows, untypedCount, copy } = legend;
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{copy.title}</CardTitle>
      {untypedCount > 0 ? <CardDescription data-untyped-count={untypedCount}>{copy.untyped}</CardDescription> : null}
    </CardHeader>
    <CardContent>
      <Table aria-label={copy.title}>
        <TableHeader>
          <TableHead isRowHeader>{copy.kind}</TableHead>
          <TableHead>{copy.meaning}</TableHead>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.kind} id={row.kind}>
            <TableCell><Badge variant={KIND_VARIANT[row.kind]}>{row.label}</Badge></TableCell>
            <TableCell>{row.meaning}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </CardContent>
  </Card>;
}
