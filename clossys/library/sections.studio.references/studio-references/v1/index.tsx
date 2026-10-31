import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export interface ReferenceLink { label: string; href?: string }
/** One step of how the shown version came to be: a version, its mode and where it came from. */
export interface LineageRow { key: string; version: string; mode: string; source: string }

/** The `references` input of `sections.studio.references`: links in both directions, then lineage. */
export interface ReferencesInput { uses: readonly ReferenceLink[]; usedBy: readonly ReferenceLink[]; lineage: readonly LineageRow[] }

function RefList({ label, refs }: { label: string; refs: readonly ReferenceLink[] }) {
  return <CardDescription className="flex flex-wrap items-center gap-1">
    {label}
    {refs.length
      ? refs.map(ref => ref.href
        ? <LinkButton key={ref.label} href={ref.href} variant="outline" size="sm">{ref.label}</LinkButton>
        : <Badge key={ref.label} variant="outline">{ref.label}</Badge>)
      : <Badge variant="ghost">None</Badge>}
  </CardDescription>;
}

/** `sections.studio.references`: what this leaf reads from other leaves, what reads it, and its lineage. */
export default function ReferencesSection({ references }: { references: ReferencesInput }) {
  return <Card size="sm" data-studio-section="references">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Uses and used by</CardTitle>
      <CardDescription>Links to the other agents' leaves, in both directions, and where each version came from.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <RefList label="Uses" refs={references.uses} />
      <RefList label="Used by" refs={references.usedBy} />
      {references.lineage.length > 0 && <Table aria-label="Lineage">
        <TableHeader>
          <TableHead isRowHeader>Version</TableHead>
          <TableHead>Lineage</TableHead>
          <TableHead>Source</TableHead>
        </TableHeader>
        <TableBody>
          {references.lineage.map(row => <TableRow key={row.key} id={row.key}>
            <TableCell>{row.version}</TableCell>
            <TableCell>{row.mode}</TableCell>
            <TableCell className="whitespace-normal break-all">{row.source}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
    </CardContent>
  </Card>;
}
