import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, SpecimenFigure, SpecimenFrame } from '@clossys/designer-ui';
import type { DetailOptionData } from './types';

/** The pinned version beside every newer, unpinned version: options waiting for the owner's approval. */
export function OptionsBlock({ name, rows }: { name: string; rows: readonly DetailOptionData[] }) {
  const options = rows.filter(row => !row.pinned).length;
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Options (pending approval)</CardTitle>
      <CardDescription>{options === 1 ? '1 newer version is' : `${options} newer versions are`} not pinned. The site keeps the pinned version until one is approved.</CardDescription>
    </CardHeader>
    <CardContent>
      <CardGrid>
        {rows.map(row => <SpecimenFigure key={row.version} caption={<>
          <Badge variant={row.pinned ? 'secondary' : 'outline'}>{row.pinned ? `Pinned v${row.version}` : `Option v${row.version}`}</Badge>
          {row.reason}
        </>}>
          <SpecimenFrame interactive ratio="desktop" title={`${name} v${row.version}${row.pinned ? ', pinned' : ', option'}`} src={row.src} />
        </SpecimenFigure>)}
      </CardGrid>
    </CardContent>
  </Card>;
}
