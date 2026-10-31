import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailSpecimenData } from './types';

/** What the leaf produces: a rendered specimen, or its text as labelled rows. */
export function SpecimenBlock({ name, specimen }: { name: string; specimen: DetailSpecimenData }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{specimen.title}</CardTitle>
      <CardDescription>{specimen.description}</CardDescription>
    </CardHeader>
    {specimen.src
      ? <iframe title={`${name} specimen`} src={specimen.src} width="100%" height="460" />
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
        : <CardContent><Badge variant="outline">No specimen for this leaf</Badge></CardContent>}
  </Card>;
}
