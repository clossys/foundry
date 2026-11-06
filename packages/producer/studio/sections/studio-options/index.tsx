import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldDescription, FieldGroup, ScrollArea, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

/**
 * What one version shows beside the others: a framed render (Designer items, Publisher pages),
 * its strings set against the active version (Writer, Director), or a note when it has neither.
 */
export type OptionPreview =
  | { kind: 'frame'; src: string; viewport: 375 | 768 | 1280 }
  | { kind: 'strings'; rows: readonly { key: string; text: string; change: 'added' | 'changed' | 'removed' | 'same' }[] }
  | { kind: 'note'; text: string };

export interface OptionsCopy { title: string; key: string; text: string; changeLabels: Readonly<Record<'added' | 'changed' | 'removed' | 'same', string>> }
export interface OptionCopy { frameTitle: string; stringsLabel: string }

export interface OptionRow { version: number; pinned: boolean; label: string; reason: string; preview: OptionPreview }

/** The `options` input of `sections.studio.options`: the pinned or active version first, then every newer unpinned version or draft. */
export interface OptionsInput { name: string; description: string; copy: OptionsCopy; rows: readonly (OptionRow & { copy: OptionCopy })[] }

const CHANGE_TONE = { added: 'secondary', changed: 'secondary', removed: 'destructive', same: 'ghost' } as const;
/** A viewport's frame height in CSS px: a phone, a tablet and a laptop screen. */
const FRAME_HEIGHT = { 375: 667, 768: 1024, 1280: 800 } as const;

/** The two projected specimen route shapes: Producer's specimen frame and a Publisher page preview (a shape, not a route this section links to). */
const PROJECTED_ROUTE = /^\/(?:__specimen$|preview\/)/;

/** Only already-projected, local specimen routes whose width matches the frame are framed; never arbitrary URLs. */
function frameSource(src: string, viewport: 375 | 768 | 1280): string {
  if (/[\\\s\u0000-\u001f\u007f]/.test(src) || !src.startsWith('/') || src.startsWith('//')) throw new Error('Expected a local specimen route');
  const url = new URL(src, 'https://example.com');
  if (!PROJECTED_ROUTE.test(url.pathname)) throw new Error('Expected a projected specimen route');
  const widths = url.searchParams.getAll('width');
  if (widths.length > 1 || (widths.length ? widths[0] !== String(viewport) : viewport !== 1280)) throw new Error('Specimen viewport does not match its projected source');
  return src;
}

function Preview({ name, row, copy }: { name: string; row: OptionRow & { copy: OptionCopy }; copy: OptionsCopy }) {
  if (row.preview.kind === 'frame') return <ScrollArea data-specimen-viewport={row.preview.viewport}>
    <iframe key={`${name}:${row.version}`} src={frameSource(row.preview.src, row.preview.viewport)} title={row.copy.frameTitle} loading="lazy" width={row.preview.viewport} height={FRAME_HEIGHT[row.preview.viewport]} />
  </ScrollArea>;
  if (row.preview.kind === 'note') return <CardDescription>{row.preview.text}</CardDescription>;
  return <Table aria-label={row.copy.stringsLabel}>
    <TableHeader>
      <TableHead isRowHeader>{copy.key}</TableHead>
      <TableHead>{copy.text}</TableHead>
    </TableHeader>
    <TableBody>
      {row.preview.rows.map(line => <TableRow key={line.key} id={line.key}>
        <TableCell>{line.key}</TableCell>
        <TableCell>
          {line.text}
          {line.change !== 'same' && <Badge variant={CHANGE_TONE[line.change]}>{copy.changeLabels[line.change]}</Badge>}
        </TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;
}

/** `sections.studio.options`: the pinned version (if any) beside every version waiting for the owner's approval. */
export default function OptionsSection({ options, ...provenance }: { options: OptionsInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{options.copy.title}</CardTitle>
      <CardDescription>{options.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <FieldGroup>
        <Field orientation="responsive">
          {options.rows.map(row => <Field key={row.version} data-option-version={row.version}>
            <Preview name={options.name} row={row} copy={options.copy} />
            <FieldDescription>
              <Badge variant={row.pinned ? 'secondary' : 'outline'}>{row.label}</Badge>
              {row.reason}
            </FieldDescription>
          </Field>)}
        </Field>
      </FieldGroup>
    </CardContent>
  </Card>;
}
