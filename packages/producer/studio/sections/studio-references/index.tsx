import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export interface ReferencesCopy {
  title: string;
  description: string;
  uses: string;
  usedBy: string;
  lineage: string;
  version: string;
  source: string;
  none: string;
}

export interface ReferenceLink { label: string; href?: string }
/** One step of how the shown version came to be: a version, its mode and where it came from. */
export interface LineageRow { key: string; version: string; mode: string; source: string }

/** The `references` input of `sections.studio.references`: links in both directions, then lineage. */
export interface ReferencesInput { copy: ReferencesCopy; uses: readonly ReferenceLink[]; usedBy: readonly ReferenceLink[]; lineage: readonly LineageRow[] }

function RefList({ label, refs, none }: { label: string; refs: readonly ReferenceLink[]; none: string }) {
  return <CardDescription>
    {label}
    {refs.length
      ? refs.map(ref => ref.href
        ? <LinkButton key={ref.label} href={ref.href} variant="outline" size="sm">{ref.label}</LinkButton>
        : <Badge key={ref.label} variant="outline">{ref.label}</Badge>)
      : <Badge variant="ghost">{none}</Badge>}
  </CardDescription>;
}

/** `sections.studio.references`: what this leaf reads from other leaves, what reads it, and its lineage. */
export default function ReferencesSection({ references, ...provenance }: { references: ReferencesInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{references.copy.title}</CardTitle>
      <CardDescription>{references.copy.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <RefList label={references.copy.uses} refs={references.uses} none={references.copy.none} />
      <RefList label={references.copy.usedBy} refs={references.usedBy} none={references.copy.none} />
      {references.lineage.length > 0 && <Table aria-label={references.copy.lineage}>
        <TableHeader>
          <TableHead isRowHeader>{references.copy.version}</TableHead>
          <TableHead>{references.copy.lineage}</TableHead>
          <TableHead>{references.copy.source}</TableHead>
        </TableHeader>
        <TableBody>
          {references.lineage.map(row => <TableRow key={row.key} id={row.key}>
            <TableCell>{row.version}</TableCell>
            <TableCell>{row.mode}</TableCell>
            <TableCell>{row.source}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
    </CardContent>
  </Card>;
}
