import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldGroup, LinkButton, ScrollArea, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export type SpecimenTone = 'secondary' | 'outline' | 'destructive';
export type SpecimenViewport = 375 | 768 | 1280;

/** Where a shown status comes from: a run record (`<step>#<id>`) or a check id, and its result (Writer copy). */
export interface SpecimenCitation {
  source: string;
  result: string;
}

/** One viewport's specimen URLs; the frame renders the page at `viewport` CSS px. */
export interface ViewportSpecimen {
  viewport: SpecimenViewport; light: string; dark?: string;
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
  /** A cell's status renders only with the run record or check result it comes from (`citation`). */
  rows: readonly { key: string; cells: readonly { text: string; href?: string; statusLabel?: string; statusTone?: SpecimenTone; citation?: SpecimenCitation }[] }[];
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
    lead?: readonly string[]; status?: { label: string; tone: SpecimenTone; description: string };
    /** The run record or check result the status comes from; null when none ran (the status then reads as not run). */
    citation: SpecimenCitation | null; empty: string }
);

/** A viewport's frame height in CSS px: a phone, a tablet and a laptop screen. */
const FRAME_HEIGHT: Readonly<Record<SpecimenViewport, number>> = { 375: 667, 768: 1024, 1280: 800 };
/** A gallery card's view-only frame height in CSS px. */
const CARD_FRAME_HEIGHT = 480;

/** The two projected specimen route shapes: Producer's specimen frame and a Publisher page preview (a shape, not a route this section links to). */
const PROJECTED_ROUTE = /^\/(?:__specimen$|preview\/)/;

/** Only already-projected, local specimen routes whose width matches the frame are framed; never arbitrary URLs. */
export function specimenSource(src: string, viewport: SpecimenViewport): string {
  if (/[\\\s\u0000-\u001f\u007f]/.test(src) || !src.startsWith('/') || src.startsWith('//')) throw new Error('Expected a local specimen route');
  const url = new URL(src, 'https://example.com');
  if (!PROJECTED_ROUTE.test(url.pathname)) throw new Error('Expected a projected specimen route');
  const widths = url.searchParams.getAll('width');
  // Producer's routes default to 1280 when width is absent.
  if (widths.length > 1 || (widths.length ? widths[0] !== String(viewport) : viewport !== 1280)) throw new Error('Specimen viewport does not match its projected source');
  return src;
}

/**
 * Every viewport in one vertical run, widest first, each a headed row of its light and dark frames
 * side by side where there is room; each frame is the page at its own CSS width in a stock scroll area.
 * A single view-only viewport, as a gallery card shows it, is the frame alone at the card's width.
 */
function Viewports({ name, specimens, empty }: { name: string; specimens: readonly ViewportSpecimen[]; empty: string }) {
  if (!specimens.length) return <CardContent><Badge variant="outline" data-preview-status="empty">{empty}</Badge></CardContent>;
  const rows = [...specimens].sort((a, b) => b.viewport - a.viewport);
  const card = rows.length === 1 && rows[0]!.interactive === false && !rows[0]!.dark ? rows[0]! : undefined;
  if (card) return <CardContent data-specimen-viewport={card.viewport}>
    <iframe key={`${name}:${card.viewport}:card`} src={specimenSource(card.light, card.viewport)} title={card.title} loading="lazy" inert width="100%" height={CARD_FRAME_HEIGHT} />
  </CardContent>;
  return <CardContent>
    {rows.map(row => <CardContent key={row.viewport} data-specimen-viewport={row.viewport}>
      {rows.length > 1 && <CardDescription role="heading" aria-level={3}>{row.heading}</CardDescription>}
      <FieldGroup>
        <Field orientation="responsive">
          <ScrollArea>
            <iframe key={`${name}:${row.viewport}:light`} src={specimenSource(row.light, row.viewport)} title={row.title} loading="lazy" inert={row.interactive === false} width={row.viewport} height={FRAME_HEIGHT[row.viewport]} />
          </ScrollArea>
          {row.dark && <ScrollArea>
            <iframe key={`${name}:${row.viewport}:dark`} src={specimenSource(row.dark, row.viewport)} title={row.darkTitle ?? row.title} loading="lazy" inert={row.interactive === false} width={row.viewport} height={FRAME_HEIGHT[row.viewport]} />
          </ScrollArea>}
        </Field>
      </FieldGroup>
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
            {cell.statusLabel && cell.citation && <Badge variant={cell.statusTone ?? 'outline'} data-citation={cell.citation.source}>{cell.statusLabel}</Badge>}
          </TableCell>)}
        </TableRow>)}
      </TableBody>
    </Table>
  </CardContent>;
}

/** The specimen body without its card: what the leaf produces. */
export function SpecimenContent({ specimen }: { specimen: SpecimenInput }) {
  if (specimen.kind === 'viewports') return <Viewports name={specimen.name} specimens={specimen.specimens} empty={specimen.empty} />;
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
    {specimen.citation && <CardDescription data-citation={specimen.citation.source}>{[specimen.citation.source, specimen.citation.result].join(' · ')}</CardDescription>}
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
