import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, SpecimenFigure, SpecimenFrame } from '@clossys/designer-ui';
import type { DetailOptionData } from './types';

/** The pinned version (if any) beside every unpinned version: options waiting for the owner's approval. */
export function OptionsBlock({ name, rows }: { name: string; rows: readonly DetailOptionData[] }) {
  const options = rows.filter(row => !row.pinned).length;
  const pinned = rows.some(row => row.pinned);
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Options (pending approval)</CardTitle>
      <CardDescription className="max-w-(--measure)">{pinned
        ? `${options === 1 ? '1 newer version is' : `${options} newer versions are`} not pinned. The site keeps the pinned version until one is approved.`
        : `Nothing is pinned yet. ${options === 1 ? '1 recorded version waits' : `${options} recorded versions wait`} for approval.`}</CardDescription>
    </CardHeader>
    <CardContent>
      <CardGrid density="specimens">
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
