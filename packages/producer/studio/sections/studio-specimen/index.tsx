import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

import { BlockViewerCardIframe, BlockViewerIframe } from './BlockViewerIframe';

export type SpecimenTone = 'secondary' | 'outline' | 'destructive';

/** One viewport's specimen URLs; the frame renders the page at `viewport` CSS px and scales it to fit. */
export interface ViewportSpecimen {
  viewport: 375 | 768 | 1280; light: string; dark?: string;
  /** The row's heading (Writer copy), and each frame's accessible title: the light frame, and the dark one when there is one. */
  heading: string; title: string; darkTitle?: string;
  /** False for a preview in a list (a gallery card): the frame is view-only so the page scrolls past it. */
  interactive?: boolean;
}

/** A structured record kind (Writer voice, claims, names; Director direction): one titled table. */
export interface SpecimenTable {
  id: string;
  label: string;
  columns: readonly string[];
  /** The column containing prose. */
  prose?: number;
  rows: readonly { key: string; cells: readonly { text: string; href?: string; statusLabel?: string; statusTone?: SpecimenTone }[] }[];
}

/**
 * The `specimen` input of `sections.studio.specimen`, one shape for every agent:
 * `viewports` frames rendered output (Designer items, Publisher pages) at 375/768/1280 in light
 * and, when the source has one, dark; `record` lays out a record's own content as tables or rows.
 */
export type SpecimenInput = { name: string; title: string; description: string } & (
  | { kind: 'viewports'; specimens: readonly ViewportSpecimen[]; empty: string;
    /** A gallery card's text while its frame loads, and for a frame whose specimen failed to render. */
    loading?: string; unavailable?: string }
  | { kind: 'record'; tables?: readonly SpecimenTable[]; rows?: readonly { key: string; label: string; text: string; href?: string }[];
    /** The rows table's accessible label and column headings (Writer copy). */
    rowsCopy: { label: string; key: string; content: string };
    /** A gallery card's lead: the record's first lines as text that reads at card size. */
    lead?: readonly string[]; status?: { label: string; tone: SpecimenTone; description: string }; empty: string }
);

/**
 * Every viewport in one vertical run, widest first, each a headed row of its light and dark frames
 * (no tabs). A single viewport, as a gallery card shows it, is the frame alone at full width.
 * The extracted stock iframe uses the projected viewport and bounded local content-size binding.
 * The surrounding light/dark comparison layout remains pending a verified stock composition.
 */
function Viewports({ name, specimens, empty, loading, unavailable }: { name: string; specimens: readonly ViewportSpecimen[]; empty: string; loading?: string; unavailable?: string }) {
  if (!specimens.length) return <CardContent><Badge variant="outline" data-preview-status="empty">{empty}</Badge></CardContent>;
  const rows = [...specimens].sort((a, b) => b.viewport - a.viewport);
  // A gallery card's single view-only frame: skeleton until sized, no body when it paints nothing.
  const card = rows.length === 1 && rows[0]!.interactive === false && !rows[0]!.dark ? rows[0]! : undefined;
  if (card) return <BlockViewerCardIframe iframeKey={`${name}:${card.viewport}:card`} viewport={card.viewport} title={card.title} src={card.light}
    loadingLabel={loading ?? name} failedLabel={unavailable} wrap={frame => <CardContent data-specimen-viewport={card.viewport}>{frame}</CardContent>} />;
  return <CardContent>
    {rows.map(row => <CardContent key={row.viewport} data-specimen-viewport={row.viewport}>
      {rows.length > 1 && <CardDescription role="heading" aria-level={3}>{row.heading}</CardDescription>}
      <CardGrid density={row.dark ? 'specimens' : undefined}>
        <BlockViewerIframe iframeKey={`${name}:${row.viewport}:light`} viewport={row.viewport} interactive={row.interactive ?? true} title={row.title} src={row.light} />
        {row.dark && <BlockViewerIframe iframeKey={`${name}:${row.viewport}:dark`} viewport={row.viewport} interactive={row.interactive ?? true} title={row.darkTitle ?? row.title} src={row.dark} />}
      </CardGrid>
    </CardContent>)}
  </CardContent>;
}

function RecordTable({ name, table, titled }: { name: string; table: SpecimenTable; titled: boolean }) {
  return <CardContent>
    {titled && <CardDescription role="heading" aria-level={3}>{table.label}</CardDescription>}
    <Table aria-label={`${name} ${table.label}`}>
      <TableHeader>
        {table.columns.map((column, index) => <TableHead key={column} isRowHeader={index === 0}>{column}</TableHead>)}
      </TableHeader>
      <TableBody>
        {table.rows.map(row => <TableRow key={row.key} id={row.key}>
          {row.cells.map((cell, index) => <TableCell key={index}>
            {cell.href ? <LinkButton href={cell.href} variant="link" size="sm">{cell.text}</LinkButton> : cell.text}
            {cell.statusLabel && <Badge variant={cell.statusTone ?? 'outline'}>{cell.statusLabel}</Badge>}
          </TableCell>)}
        </TableRow>)}
      </TableBody>
    </Table>
  </CardContent>;
}

/** The specimen body without its card: what the leaf produces. A gallery card places it under its own header. */
export function SpecimenContent({ specimen }: { specimen: SpecimenInput }) {
  if (specimen.kind === 'viewports') return <Viewports name={specimen.name} specimens={specimen.specimens} empty={specimen.empty} loading={specimen.loading} unavailable={specimen.unavailable} />;
  if (specimen.lead?.length) return <CardContent data-specimen-lead>
    {specimen.lead.map((text, index) => <CardDescription key={index}>{text}</CardDescription>)}
  </CardContent>;
  if (specimen.tables?.length) return <>{specimen.tables.map(table => <RecordTable key={table.id} name={specimen.name} table={table} titled={specimen.tables!.length > 1} />)}</>;
  if (specimen.rows?.length) return <CardContent>
    <Table aria-label={specimen.rowsCopy.label}>
      <TableHeader>
        <TableHead isRowHeader>{specimen.rowsCopy.key}</TableHead>
        <TableHead>{specimen.rowsCopy.content}</TableHead>
      </TableHeader>
      <TableBody>
        {specimen.rows.map(row => <TableRow key={row.key} id={row.key}>
          <TableCell>{row.label}</TableCell>
          <TableCell>
            {row.href ? <LinkButton href={row.href} variant="link" size="sm">{row.text}</LinkButton> : row.text}
          </TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </CardContent>;
  if (specimen.status) return <CardContent>
    <Badge variant={specimen.status.tone} data-preview-status="status">{specimen.status.label}</Badge>
    <CardDescription>{specimen.status.description}</CardDescription>
  </CardContent>;
  return <CardContent><Badge variant="outline" data-preview-status="empty">{specimen.empty}</Badge></CardContent>;
}

/** `sections.studio.specimen`: what the leaf produces, framed at every viewport or laid out as its record content. */
export default function SpecimenSection({ specimen, ...provenance }: { specimen: SpecimenInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{specimen.title}</CardTitle>
      <CardDescription>{specimen.description}</CardDescription>
    </CardHeader>
    <SpecimenContent specimen={specimen} />
  </Card>;
}
