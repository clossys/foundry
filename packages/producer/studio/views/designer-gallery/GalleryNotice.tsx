import { Card, CardDescription, CardHeader, CardTitle, Skeleton } from '@clossys/designer-ui';

/** Loading, empty and failed gallery states. */
export function GalleryNotice({ state, message }: { state: 'loading' | 'missing' | 'error'; message?: string }) {
  if (state === 'loading') return <Card className="m-4 md:m-6"><CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64" /></CardHeader></Card>;
  return <Card className="m-4 md:m-6">
    <CardHeader>
      <CardTitle role="heading" aria-level={1}>{state === 'missing' ? 'No Designer library yet' : 'The Designer library could not load'}</CardTitle>
      <CardDescription>{state === 'missing' ? 'Producer found no record store for this workspace.' : message}</CardDescription>
    </CardHeader>
  </Card>;
}
