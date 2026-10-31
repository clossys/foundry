import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';
import type { DetailRef, DetailUsesData } from './types';

function RefList({ label, refs }: { label: string; refs: readonly DetailRef[] }) {
  return <CardDescription className="flex flex-wrap items-center gap-1">
    {label}
    {refs.length
      ? refs.map(ref => ref.href
        ? <LinkButton key={ref.label} href={ref.href} variant="outline" size="sm">{ref.label}</LinkButton>
        : <Badge key={ref.label} variant="outline">{ref.label}</Badge>)
      : <Badge variant="ghost">None</Badge>}
  </CardDescription>;
}

/** What this leaf reads from other agents, and what reads it. */
export function UsesBlock({ uses }: { uses: DetailUsesData }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Uses and used by</CardTitle>
      <CardDescription>Links to the other agents' leaves, in both directions.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <RefList label="Uses" refs={uses.uses} />
      <RefList label="Used by" refs={uses.usedBy} />
    </CardContent>
  </Card>;
}
