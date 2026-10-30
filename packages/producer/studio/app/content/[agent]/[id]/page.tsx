import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { isAgent } from '../../../../lib/agents';
import { cellContentHref, contentVersion } from '../../../../lib/cell-content';
import { StandaloneCellContent } from '../../../../components/StandaloneCellContent';

export default async function ContentPage({ params, searchParams }: { params: Promise<{ agent: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { agent, id } = await params;
  let version: number | undefined;
  try {
    version = contentVersion((await searchParams).version);
    cellContentHref(agent, id, { version });
  } catch { notFound(); }
  if (!isAgent(agent)) notFound();
  return <Suspense fallback={null}><StandaloneCellContent agent={agent} id={id} version={version} /></Suspense>;
}
