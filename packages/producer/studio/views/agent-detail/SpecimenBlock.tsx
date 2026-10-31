import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, SpecimenFrame, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import { LEAF_STATUS_LABEL, LEAF_STATUS_TONE, specimenDescription } from '../../lib/leaf-status';
import type { DetailSpecimenData, DetailSpecimenTable } from './types';

/** One table of a structured specimen kind: its label, then the record content row by row. */
function KindTable({ name, table, titled }: { name: string; table: DetailSpecimenTable; titled: boolean }) {
  return <CardContent className="flex flex-col gap-2">
    {titled && <CardDescription role="heading" aria-level={3} className="font-medium text-foreground">{table.label}</CardDescription>}
    <Table aria-label={`${name} ${table.label}`}>
      <TableHeader>
        {table.columns.map((column, index) => <TableHead key={column} isRowHeader={index === 0}>{column}</TableHead>)}
      </TableHeader>
      <TableBody>
        {table.rows.map(row => <TableRow key={row.key} id={row.key}>
          {row.cells.map((cell, index) => <TableCell key={index} className={index === table.prose ? 'min-w-72 whitespace-normal' : 'whitespace-normal'}>
            {cell.statusLabel && <Badge variant={cell.statusTone ?? 'outline'}>{cell.statusLabel}</Badge>}
            {cell.href ? <LinkButton href={cell.href} variant="link" size="sm" className="h-auto px-0">{cell.text}</LinkButton> : cell.statusLabel ? ` ${cell.text}` : cell.text}
          </TableCell>)}
        </TableRow>)}
      </TableBody>
    </Table>
  </CardContent>;
}

/** What the leaf produces: a rendered specimen, or its text as labelled rows. */
export function SpecimenBlock({ name, specimen }: { name: string; specimen: DetailSpecimenData }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{specimen.title}</CardTitle>
      <CardDescription className="max-w-(--measure)">{specimen.description}</CardDescription>
    </CardHeader>
    {specimen.tables?.length
      ? specimen.tables.map(table => <KindTable key={table.id} name={name} table={table} titled={specimen.tables!.length > 1} />)
      : specimen.src
      ? <CardContent><SpecimenFrame interactive ratio="desktop" title={`${name} specimen`} src={specimen.src} /></CardContent>
      : specimen.rows?.length
        ? <CardContent>
          <Table aria-label={`${name} specimen`}>
            <TableHeader>
              <TableHead isRowHeader>Key</TableHead>
              <TableHead>Content</TableHead>
            </TableHeader>
            <TableBody>
              {specimen.rows.map(row => <TableRow key={row.key} id={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="whitespace-normal">
                  {row.href ? <LinkButton href={row.href} variant="link" size="sm" className="h-auto px-0">{row.text}</LinkButton> : row.text}
                </TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
        : specimen.status
          ? <CardContent className="flex flex-col items-start gap-2">
            <Badge variant={LEAF_STATUS_TONE[specimen.status]}>{LEAF_STATUS_LABEL[specimen.status]}</Badge>
            <CardDescription>{specimenDescription(specimen.status)}</CardDescription>
          </CardContent>
          : <CardContent><Badge variant="outline">No specimen for this leaf</Badge></CardContent>}
  </Card>;
}
