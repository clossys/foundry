import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, SpecimenFigure, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

import { BlockViewerIframe } from '../studio-specimen/BlockViewerIframe';

/**
 * What one version shows beside the others: a framed render (Designer items, Publisher pages),
 * its strings set against the active version (Writer, Director), or a note when it has neither.
 */
export type OptionPreview =
  | { kind: 'frame'; src: string; viewport: 375 | 768 | 1280 }
  | { kind: 'strings'; rows: readonly { key: string; text: string; change: 'added' | 'changed' | 'removed' | 'same' }[] }
  | { kind: 'note'; text: string };

export interface OptionRow { version: number; pinned: boolean; label: string; reason: string; preview: OptionPreview }

/** The `options` input of `sections.studio.options`: the pinned or active version first, then every newer unpinned version or draft. */
export interface OptionsInput { name: string; description: string; rows: readonly OptionRow[] }

const CHANGE_LABEL = { added: 'Added', changed: 'Changed', removed: 'Removed', same: 'Same' } as const;
const CHANGE_TONE = { added: 'secondary', changed: 'secondary', removed: 'destructive', same: 'ghost' } as const;

function Preview({ name, row }: { name: string; row: OptionRow }) {
  if (row.preview.kind === 'frame') return <BlockViewerIframe interactive viewport={row.preview.viewport} iframeKey={`${name}:${row.version}`} title={`${name} v${row.version}${row.pinned ? ', pinned' : ', option'}`} src={row.preview.src} />;
  if (row.preview.kind === 'note') return <CardDescription>{row.preview.text}</CardDescription>;
  return <Table aria-label={`${name} v${row.version} strings`}>
    <TableHeader>
      <TableHead isRowHeader>Key</TableHead>
      <TableHead>Text</TableHead>
    </TableHeader>
    <TableBody>
      {row.preview.rows.map(line => <TableRow key={line.key} id={line.key}>
        <TableCell>{line.key}</TableCell>
        <TableCell className="min-w-48 whitespace-normal">
          {line.text}
          {line.change !== 'same' && <Badge variant={CHANGE_TONE[line.change]} className="ml-2">{CHANGE_LABEL[line.change]}</Badge>}
        </TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;
}

/** `sections.studio.options`: the pinned version (if any) beside every version waiting for the owner's approval. */
export default function OptionsSection({ options }: { options: OptionsInput }) {
  return <Card size="sm" data-studio-section="options">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Options (pending approval)</CardTitle>
      <CardDescription>{options.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <CardGrid density="specimens">
        {options.rows.map(row => <SpecimenFigure key={row.version} caption={<>
          <Badge variant={row.pinned ? 'secondary' : 'outline'}>{row.label}</Badge>
          {row.reason}
        </>}>
          <Preview name={options.name} row={row} />
        </SpecimenFigure>)}
      </CardGrid>
    </CardContent>
  </Card>;
}
