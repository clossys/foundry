import { Badge, Card, CardAction, CardDescription, CardHeader, CardTitle, Tooltip, TooltipTrigger } from '@clossys/designer-ui';

/** The node kinds a pipeline step carries; graph.json names one per step. */
export type StepKind = 'plumb' | 'decide:creative' | 'decide:judgment';

/** One legend entry: a kind, its Writer label and its Writer meaning (the badge's tooltip). */
export interface LegendRow { kind: StepKind; label: string; meaning: string }

/** Writer copy of the counts and legend row (studio.pipeline.counts*, studio.pipeline.legend.*); `counts` and `untyped` are already resolved. */
export interface LegendCopy { title: string; counts: string; legend: string; untyped: string }

/** The `legend` input of `sections.producer.pipeline-legend`. */
export interface PipelineLegendInput { rows: readonly LegendRow[]; untypedCount: number; copy: LegendCopy }

/** Each kind's stock Badge variant; the flow nodes use the same mapping. */
const KIND_VARIANT = { plumb: 'outline', 'decide:creative': 'secondary', 'decide:judgment': 'default' } as const;

/** `sections.producer.pipeline-legend`: one compact stock Card row above the canvas: the step and edge counts (and the untyped file count) on the left, one stock Badge per node kind on the right, each with its meaning in a stock Tooltip. */
export default function PipelineLegendSection({ legend, ...provenance }: { legend: PipelineLegendInput } & { [marker: `data-clossys-${string}`]: string }) {
  const { rows, untypedCount, copy } = legend;
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{copy.title}</CardTitle>
      <CardDescription data-untyped-count={untypedCount}>{untypedCount > 0 ? `${copy.counts} ${copy.untyped}` : copy.counts}</CardDescription>
      <CardAction role="group" aria-label={copy.legend}>
        {/* A text space between badges, as inline badges in running text have. */}
        {rows.flatMap((row, at) => [at ? ' ' : '', <TooltipTrigger key={row.kind}>
          <Badge variant={KIND_VARIANT[row.kind]} data-kind={row.kind} tabIndex={0}>{row.label}</Badge>
          <Tooltip>{row.meaning}</Tooltip>
        </TooltipTrigger>])}
      </CardAction>
    </CardHeader>
  </Card>;
}
