import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, LinkButton, SpecimenFrame, Tabs, TabsContent, TabsList, TabsTrigger, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export type SpecimenTone = 'secondary' | 'outline' | 'destructive';

/** One viewport's specimen URLs; the frame renders the page at `viewport` CSS px and scales it to fit. */
export interface ViewportSpecimen { viewport: 375 | 768 | 1280; light: string; dark?: string }

/** A structured record kind (Writer voice, claims, names; Director direction): one titled table. */
export interface SpecimenTable {
  id: string;
  label: string;
  columns: readonly string[];
  /** The prose column, given a readable minimum width. */
  prose?: number;
  rows: readonly { key: string; cells: readonly { text: string; href?: string; statusLabel?: string; statusTone?: SpecimenTone }[] }[];
}

/**
 * The `specimen` input of `sections.studio.specimen`, one shape for every agent:
 * `viewports` frames rendered output (Designer items, Publisher pages) at 375/768/1280 in light
 * and, when the source has one, dark; `record` lays out a record's own content as tables or rows.
 */
export type SpecimenInput = { name: string; title: string; description: string } & (
  | { kind: 'viewports'; specimens: readonly ViewportSpecimen[]; empty: string }
  | { kind: 'record'; tables?: readonly SpecimenTable[]; rows?: readonly { key: string; label: string; text: string; href?: string }[]; status?: { label: string; tone: SpecimenTone; description: string }; empty: string }
);

const RATIO = { 375: 'mobile', 768: 'tablet', 1280: 'desktop' } as const;

function Viewports({ name, specimens, empty }: { name: string; specimens: readonly ViewportSpecimen[]; empty: string }) {
  if (!specimens.length) return <CardContent><Badge variant="outline">{empty}</Badge></CardContent>;
  return <CardContent>
    <Tabs defaultSelectedKey={String(specimens.at(-1)!.viewport)}>
      <TabsList aria-label="Viewport">
        {specimens.map(row => <TabsTrigger key={row.viewport} id={String(row.viewport)}>{row.viewport} px</TabsTrigger>)}
      </TabsList>
      {specimens.map(row => <TabsContent key={row.viewport} id={String(row.viewport)}>
        <CardGrid density="specimens">
          <SpecimenFrame interactive ratio={RATIO[row.viewport]} title={`${name} at ${row.viewport} px, light`} src={row.light} />
          {row.dark && <SpecimenFrame interactive ratio={RATIO[row.viewport]} title={`${name} at ${row.viewport} px, dark`} src={row.dark} />}
        </CardGrid>
      </TabsContent>)}
    </Tabs>
  </CardContent>;
}

function RecordTable({ name, table, titled }: { name: string; table: SpecimenTable; titled: boolean }) {
  return <CardContent className="flex flex-col gap-2">
    {titled && <CardDescription role="heading" aria-level={3} className="font-medium text-foreground">{table.label}</CardDescription>}
    <Table aria-label={`${name} ${table.label}`}>
      <TableHeader>
        {table.columns.map((column, index) => <TableHead key={column} isRowHeader={index === 0}>{column}</TableHead>)}
      </TableHeader>
      <TableBody>
        {table.rows.map(row => <TableRow key={row.key} id={row.key}>
          {row.cells.map((cell, index) => <TableCell key={index} className={index === table.prose ? 'min-w-48 whitespace-normal' : 'whitespace-normal'}>
            {cell.href ? <LinkButton href={cell.href} variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal break-words">{cell.text}</LinkButton> : cell.text}
            {cell.statusLabel && <Badge variant={cell.statusTone ?? 'outline'} className="ml-2">{cell.statusLabel}</Badge>}
          </TableCell>)}
        </TableRow>)}
      </TableBody>
    </Table>
  </CardContent>;
}

/** `sections.studio.specimen`: what the leaf produces, framed at every viewport or laid out as its record content. */
export default function SpecimenSection({ specimen }: { specimen: SpecimenInput }) {
  return <Card size="sm" data-studio-section="specimen">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{specimen.title}</CardTitle>
      <CardDescription className="max-w-(--measure)">{specimen.description}</CardDescription>
    </CardHeader>
    {specimen.kind === 'viewports'
      ? <Viewports name={specimen.name} specimens={specimen.specimens} empty={specimen.empty} />
      : specimen.tables?.length
        ? specimen.tables.map(table => <RecordTable key={table.id} name={specimen.name} table={table} titled={specimen.tables!.length > 1} />)
        : specimen.rows?.length
          ? <CardContent>
            <Table aria-label={`${specimen.name} specimen`}>
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
              <Badge variant={specimen.status.tone}>{specimen.status.label}</Badge>
              <CardDescription>{specimen.status.description}</CardDescription>
            </CardContent>
            : <CardContent><Badge variant="outline">{specimen.empty}</Badge></CardContent>}
  </Card>;
}
