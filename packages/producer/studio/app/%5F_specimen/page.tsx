import { notFound } from 'next/navigation';
import type { RecordSpecimenInput } from '../../../src/server/slot-gallery';
import { SpecimenContent } from '../../sections/studio-specimen';

/** Producer owns the record bytes; Studio supplies the existing shared specimen markup. */
export default async function RecordSpecimenPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const agent = params.agent;
  const slot = params.slot;
  const candidate = params.candidate;
  if ((agent !== 'director' && agent !== 'writer') || typeof slot !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(slot)
    || (candidate !== undefined && typeof candidate !== 'string')) notFound();
  const origin = process.env.CLOSSYS_PRODUCER_ORIGIN;
  if (!origin) throw new Error('Producer origin is unavailable');
  const query = candidate ? `?${new URLSearchParams({ candidate })}` : '';
  const response = await fetch(`${origin}/api/slots/${agent}/${encodeURIComponent(slot)}/specimen${query}`, { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Producer could not load the record specimen');
  const specimen = await response.json() as RecordSpecimenInput;
  return <SpecimenContent specimen={specimen} />;
}
